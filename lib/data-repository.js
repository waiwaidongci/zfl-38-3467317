import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_SCHEMA_VERSION,
  DB_PATH,
  DATA_DIR,
  MigrationRegistry,
  globalRegistry,
  detectDataVersion,
  loadMigrationState,
  saveMigrationState,
  readRawDatabase,
  writeRawDatabase
} from "./migration-registry.js";
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  verifySnapshot,
  computeDataChecksum,
  countModelsTasks,
  ensureSnapshotsDir
} from "./backup-snapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SEED_DATA = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  migratedAt: new Date().toISOString(),
  items: [
    {
      id: "MR-SEED-001",
      code: "MR-001",
      shipType: "福船",
      scale: "1:48",
      mastCount: 3,
      riggingMaterial: "蜡线",
      owner: "周宁",
      dueDate: "2026-06-28",
      status: "校准中",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditRefs: [],
      tasks: [
        {
          id: "T-SEED-001",
          position: "前桅侧支索",
          tension: "偏松",
          status: "调整中",
          modelRef: "MR-SEED-001",
          modelCode: "MR-001",
          createdAt: new Date().toISOString(),
          logs: [
            {
              at: new Date().toISOString(),
              note: "已缩短2mm"
            }
          ]
        }
      ],
      logs: []
    }
  ],
  audit: {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    records: []
  },
  calibrationLibrary: {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rules: [
      {
        id: "CR-DEFAULT-001",
        name: "蜡线材料标准松紧",
        material: "蜡线",
        description: "蜡线材质帆索建议偏紧1/4圈",
        recommendedTension: "偏紧",
        version: 1,
        createdAt: new Date().toISOString(),
        builtIn: true
      }
    ],
    templates: []
  },
  systemConfig: {
    dataSchemaVersion: CURRENT_SCHEMA_VERSION,
    lastVerifiedAt: new Date().toISOString(),
    consistencyMode: "strict",
    migrationTrack: "main"
  }
};

const TASK_STATUSES = ["待检查", "调整中", "待复核", "完成"];
const MODEL_STATUSES = ["待检查", "校准中", "待复核", "已交付"];

class DataRepository {
  constructor(options = {}) {
    this._cache = null;
    this._cacheValid = false;
    this._initLock = null;
    this._registry = options.registry || globalRegistry;
    this._migrationOptions = options.migrationOptions || {};
  }

  async initialize() {
    if (this._initLock) return this._initLock;
    this._initLock = this._doInitialize();
    return this._initLock;
  }

  async _doInitialize() {
    await this._registry.loadFromDirectory();
    await ensureSnapshotsDir();

    if (!existsSync(DB_PATH)) {
      await mkdir(dirname(DB_PATH), { recursive: true });
      await writeRawDatabase(SEED_DATA);
      this._cache = JSON.parse(JSON.stringify(SEED_DATA));
      this._cacheValid = true;
      const state = await loadMigrationState();
      state.currentVersion = CURRENT_SCHEMA_VERSION;
      state.lastMigrationAt = new Date().toISOString();
      state.history.push({
        type: "seed",
        at: new Date().toISOString(),
        version: CURRENT_SCHEMA_VERSION
      });
      await saveMigrationState(state);
      return { initialized: true, from: "seed", version: CURRENT_SCHEMA_VERSION };
    }

    const raw = await readRawDatabase();
    const versionInfo = detectDataVersion(raw);

    if (versionInfo.version === CURRENT_SCHEMA_VERSION) {
      this._cache = raw;
      this._cacheValid = true;
      return { initialized: true, from: "current", version: CURRENT_SCHEMA_VERSION, versionReason: versionInfo.reason };
    }

    const migrationResult = await this._runMigrations(raw, versionInfo.version, CURRENT_SCHEMA_VERSION);
    this._cache = migrationResult.data;
    this._cacheValid = true;
    return migrationResult;
  }

  async _runMigrations(rawData, fromVersion, toVersion) {
    if (fromVersion > toVersion) {
      throw new Error(`不支持降级迁移：v${fromVersion} → v${toVersion}`);
    }

    const state = await loadMigrationState();
    const lastVersion = state.currentVersion;
    if (lastVersion === toVersion && !this._migrationOptions.force) {
      const dbOnDisk = await readRawDatabase();
      if (dbOnDisk && dbOnDisk.schemaVersion === toVersion) {
        return { initialized: true, from: "state_match", version: toVersion, skipped: true, reason: "重复启动，已在目标版本" };
      }
    }

    const path = this._registry.findMigrationPath(fromVersion, toVersion);
    if (path.length === 0) {
      throw new Error(`找不到从 v${fromVersion} 到 v${toVersion} 的迁移路径`);
    }

    const snapshotBefore = await createSnapshot({
      reason: `迁移前自动快照 v${fromVersion}→v${toVersion}`,
      sourceVersion: fromVersion,
      targetVersion: toVersion,
      tag: "PRE-MIGRATION"
    });

    let workingData = JSON.parse(JSON.stringify(rawData));
    const appliedMigrations = [];

    for (const migration of path) {
      const stepFrom = migration.fromVersion;
      const stepTo = migration.toVersion;
      try {
        if (migration.validate) {
          const vr = migration.validate(workingData);
          if (!vr.valid) {
            throw new Error(`迁移 v${stepFrom}→v${stepTo} 验证失败：${vr.error}`);
          }
        }
        const stepSnapshot = await createSnapshot({
          reason: `迁移步骤前快照 v${stepFrom}→v${stepTo}`,
          sourceVersion: stepFrom,
          targetVersion: stepTo,
          tag: "MIGRATION-STEP"
        });
        const result = migration.up(workingData);
        workingData = result;
        appliedMigrations.push({
          from: stepFrom,
          to: stepTo,
          name: migration.name,
          at: new Date().toISOString(),
          stats: result?.migration?.stats || null,
          preSnapshotId: stepSnapshot.id || null
        });
      } catch (migrationErr) {
        state.failedAttempts = state.failedAttempts || [];
        state.failedAttempts.push({
          at: new Date().toISOString(),
          fromVersion: stepFrom,
          toVersion: stepTo,
          error: migrationErr.message,
          preSnapshotId: snapshotBefore?.id || null
        });
        await saveMigrationState(state);
        if (snapshotBefore?.id && !snapshotBefore.skipped) {
          try {
            await restoreSnapshot(snapshotBefore.id, { force: false });
          } catch (restoreErr) {
            migrationErr.message += ` | 回滚失败：${restoreErr.message} | 手动回滚快照ID：${snapshotBefore.id}`;
          }
        }
        throw migrationErr;
      }
    }

    workingData._migrations = appliedMigrations.map((m) => ({
      from: m.from,
      to: m.to,
      at: m.at,
      stats: m.stats
    }));

    await writeRawDatabase(workingData);

    const snapshotAfter = await createSnapshot({
      reason: `迁移后自动快照 v${fromVersion}→v${toVersion}`,
      sourceVersion: fromVersion,
      targetVersion: toVersion,
      tag: "POST-MIGRATION"
    });

    state.currentVersion = toVersion;
    state.lastMigrationAt = new Date().toISOString();
    state.history = state.history || [];
    state.history.push({
      type: "migration",
      fromVersion,
      toVersion,
      at: new Date().toISOString(),
      appliedMigrations,
      preSnapshotId: snapshotBefore?.id || null,
      postSnapshotId: snapshotAfter?.id || null
    });
    await saveMigrationState(state);

    return {
      initialized: true,
      from: "migration",
      version: toVersion,
      migratedFrom: fromVersion,
      appliedMigrations,
      preSnapshotId: snapshotBefore?.id || null,
      postSnapshotId: snapshotAfter?.id || null,
      data: workingData
    };
  }

  async _requireInit() {
    if (!this._cacheValid) {
      await this.initialize();
    }
  }

  async readAll() {
    await this._requireInit();
    return this._cache;
  }

  async readItems() {
    await this._requireInit();
    return this._cache.items;
  }

  async getSchemaVersion() {
    await this._requireInit();
    return this._cache.schemaVersion;
  }

  async getMetadata() {
    await this._requireInit();
    const { modelCount, taskCount } = countModelsTasks(this._cache);
    return {
      schemaVersion: this._cache.schemaVersion,
      migratedAt: this._cache.migratedAt || null,
      modelCount,
      taskCount,
      checksum: computeDataChecksum(this._cache),
      systemConfig: this._cache.systemConfig || null,
      hasAudit: !!this._cache.audit,
      hasCalibrationLibrary: !!this._cache.calibrationLibrary
    };
  }

  async getAllItems() {
    await this._requireInit();
    return this._cache.items.map((item) => ({
      ...item,
      logCount:
        (item.logs || []).length +
        (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0)
    }));
  }

  async getAllTasks() {
    await this._requireInit();
    const tasks = [];
    for (const item of this._cache.items) {
      if (item.tasks) {
        for (const task of item.tasks) {
          tasks.push({
            ...task,
            modelId: item.id,
            modelCode: item.code,
            modelShipType: item.shipType,
            modelOwner: item.owner,
            modelDueDate: item.dueDate
          });
        }
      }
    }
    return tasks;
  }

  async findItemById(id) {
    await this._requireInit();
    return this._cache.items.find((x) => x.id === id || x.code === id) || null;
  }

  findTaskByIdSync(item, taskId) {
    if (!item?.tasks) return null;
    return item.tasks.find((t) => t.id === taskId) || null;
  }

  async filterTasks(filters = {}) {
    const allTasks = await this.getAllTasks();
    return allTasks.filter((task) => {
      if (filters.modelId && task.modelId !== filters.modelId && task.modelCode !== filters.modelId) {
        return false;
      }
      if (filters.owner && task.modelOwner !== filters.owner) {
        return false;
      }
      if (filters.tension && task.tension !== filters.tension) {
        return false;
      }
      if (filters.status && task.status !== filters.status) {
        return false;
      }
      if (filters.dueDateStart && task.modelDueDate) {
        if (new Date(task.modelDueDate) < new Date(filters.dueDateStart)) return false;
      }
      if (filters.dueDateEnd && task.modelDueDate) {
        const end = new Date(filters.dueDateEnd + "T23:59:59");
        if (new Date(task.modelDueDate) > end) return false;
      }
      return true;
    });
  }

  async getUniqueOwners() {
    await this._requireInit();
    const s = new Set();
    for (const item of this._cache.items) {
      if (item.owner) s.add(item.owner);
    }
    return [...s].sort();
  }

  async getUniqueTensions() {
    await this._requireInit();
    const s = new Set();
    for (const item of this._cache.items) {
      if (item.tasks) {
        for (const task of item.tasks) {
          if (task.tension) s.add(task.tension);
        }
      }
    }
    return [...s].sort();
  }

  _newItemId() {
    return "MR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  _newTaskId() {
    return "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 4);
  }

  _computeModelStatusFromTasks(item) {
    if (!item.tasks || item.tasks.length === 0) return "待检查";
    const statuses = item.tasks.map((t) => t.status);
    if (statuses.every((s) => s === "完成")) return "待复核";
    if (statuses.some((s) => s === "调整中" || s === "待复核")) return "校准中";
    return "待检查";
  }

  async createItem(input) {
    await this._requireInit();
    const id = this._newItemId();
    const now = new Date().toISOString();
    const item = {
      id,
      ...input,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      auditRefs: [],
      logs: [
        {
          at: now,
          step: "建档",
          note: "创建模型"
        }
      ]
    };
    this._cache.items.unshift(item);
    await this._persist();
    return item;
  }

  async createTask(itemId, input) {
    await this._requireInit();
    const item = await this.findItemById(itemId);
    if (!item) throw new Error("item_not_found");
    const now = new Date().toISOString();
    const task = {
      id: this._newTaskId(),
      position: input.position || "",
      tension: input.tension || "待检测",
      status: "待检查",
      modelRef: item.id,
      modelCode: item.code || "",
      createdAt: now,
      logs: [
        {
          at: now,
          note: input.note || "新增帆索任务"
        }
      ]
    };
    item.tasks = item.tasks || [];
    item.tasks.push(task);
    item.status = "校准中";
    item.updatedAt = now;
    item.logs = item.logs || [];
    item.logs.push({
      at: now,
      step: "帆索",
      note: `${task.position} · ${task.tension}`
    });
    await this._persist();
    return { item, task };
  }

  async updateItem(itemId, updates) {
    await this._requireInit();
    const item = await this.findItemById(itemId);
    if (!item) throw new Error("item_not_found");
    const now = new Date().toISOString();
    Object.assign(item, updates);
    item.updatedAt = now;
    if (updates.status) {
      item.logs = item.logs || [];
      item.logs.push({
        at: now,
        step: "状态",
        note: "更新为" + item.status
      });
    }
    await this._persist();
    return item;
  }

  async addItemLog(itemId, step, note) {
    await this._requireInit();
    const item = await this.findItemById(itemId);
    if (!item) throw new Error("item_not_found");
    const now = new Date().toISOString();
    item.logs = item.logs || [];
    item.logs.push({
      at: now,
      step: step || "记录",
      note: note || ""
    });
    item.updatedAt = now;
    await this._persist();
    return item;
  }

  async updateTaskStatus(itemId, taskId, newStatus) {
    await this._requireInit();
    const item = await this.findItemById(itemId);
    if (!item) throw new Error("item_not_found");
    const task = this.findTaskByIdSync(item, taskId);
    if (!task) throw new Error("task_not_found");
    if (!TASK_STATUSES.includes(newStatus)) throw new Error("invalid_status");
    const oldStatus = task.status;
    const now = new Date().toISOString();
    task.status = newStatus;
    task.logs = task.logs || [];
    task.logs.push({
      at: now,
      note: `状态从「${oldStatus}」变更为「${newStatus}」`
    });
    const newModelStatus = this._computeModelStatusFromTasks(item);
    if (item.status !== newModelStatus) {
      item.status = newModelStatus;
      item.logs = item.logs || [];
      item.logs.push({
        at: now,
        step: "状态",
        note: `自动更新为「${newModelStatus}」（任务状态联动）`
      });
    }
    item.logs = item.logs || [];
    item.logs.push({
      at: now,
      step: "帆索",
      note: `${task.position} · 状态变更为「${newStatus}」`
    });
    item.updatedAt = now;
    await this._persist();
    return { item, task };
  }

  async addTaskLog(itemId, taskId, note) {
    await this._requireInit();
    const item = await this.findItemById(itemId);
    if (!item) throw new Error("item_not_found");
    const task = this.findTaskByIdSync(item, taskId);
    if (!task) throw new Error("task_not_found");
    const now = new Date().toISOString();
    task.logs = task.logs || [];
    task.logs.push({ at: now, note });
    item.updatedAt = now;
    await this._persist();
    return task;
  }

  async _persist() {
    await writeRawDatabase(this._cache);
  }

  async forceReload() {
    const raw = await readRawDatabase();
    if (raw) {
      this._cache = raw;
      this._cacheValid = true;
    }
    return this._cache;
  }

  async getCalibrationLibrary() {
    await this._requireInit();
    return this._cache.calibrationLibrary || { rules: [], templates: [] };
  }

  async getAuditRecords() {
    await this._requireInit();
    return this._cache.audit?.records || [];
  }

  async getSystemConfig() {
    await this._requireInit();
    return this._cache.systemConfig || {};
  }

  async replaceRawForRestore(data) {
    await writeRawDatabase(data);
    this._cache = data;
    this._cacheValid = true;
  }
}

const globalRepository = new DataRepository();

export {
  DataRepository,
  globalRepository,
  SEED_DATA,
  TASK_STATUSES,
  MODEL_STATUSES
};
