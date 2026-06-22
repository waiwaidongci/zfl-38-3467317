import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "model-rigging-calibration.json");
const MIGRATIONS_DIR = join(__dirname, "migrations");
const SNAPSHOTS_DIR = join(DATA_DIR, "snapshots");
const MIGRATION_STATE_PATH = join(DATA_DIR, ".migration-state.json");

const CURRENT_SCHEMA_VERSION = 2;

const LEGACY_VERSION_DETECTORS = [
  {
    name: "v0_legacy_no_schemaVersion",
    detect: (data) => {
      if (!data || typeof data !== "object") return { match: false };
      const hasSchemaVersion = typeof data.schemaVersion === "number";
      const hasItems = Array.isArray(data.items);
      const hasIdOnAllItems = hasItems && data.items.every((i) => i.id !== undefined);
      const hasCreatedAtField = hasItems && data.items.some((i) => i.createdAt !== undefined);
      if (!hasSchemaVersion && hasItems) {
        if (!hasIdOnAllItems || !hasCreatedAtField) {
          return { match: true, version: 0, reason: "无schemaVersion，存在缺失id或createdAt的项" };
        }
        return { match: true, version: 0, reason: "无schemaVersion字段，纯旧版items结构" };
      }
      return { match: false };
    }
  }
];

function detectDataVersion(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return { version: 0, reliable: false, reason: "数据为空或不是对象" };
  }
  if (typeof rawData.schemaVersion === "number") {
    return {
      version: rawData.schemaVersion,
      reliable: true,
      reason: `schemaVersion字段明确标注为 v${rawData.schemaVersion}`
    };
  }
  for (const detector of LEGACY_VERSION_DETECTORS) {
    const result = detector.detect(rawData);
    if (result.match) {
      return { version: result.version, reliable: true, reason: result.reason, detector: detector.name };
    }
  }
  return { version: 0, reliable: false, reason: "无法可靠识别版本，按v0处理" };
}

class MigrationRegistry {
  constructor() {
    this._migrations = new Map();
    this._loaded = false;
  }

  register(migration) {
    if (!migration || typeof migration.fromVersion !== "number" || typeof migration.toVersion !== "number") {
      throw new Error("无效的迁移定义：必须包含 fromVersion 和 toVersion 数字字段");
    }
    if (typeof migration.up !== "function") {
      throw new Error(`迁移 v${migration.fromVersion}→v${migration.toVersion} 必须提供 up() 函数`);
    }
    const key = `${migration.fromVersion}->${migration.toVersion}`;
    if (this._migrations.has(key)) {
      throw new Error(`重复注册迁移：${key}`);
    }
    this._migrations.set(key, migration);
    return this;
  }

  getMigrations() {
    return [...this._migrations.values()].sort((a, b) => a.fromVersion - b.fromVersion);
  }

  findMigrationPath(fromVersion, toVersion) {
    const path = [];
    let current = fromVersion;
    const maxSteps = 100;
    let steps = 0;
    while (current < toVersion && steps < maxSteps) {
      const next = this._migrations.get(`${current}->${current + 1}`);
      if (!next) {
        const available = [...this._migrations.keys()];
        throw new Error(`找不到迁移路径 v${current}→v${current + 1}；已注册：${available.join(", ")}`);
      }
      path.push(next);
      current = next.toVersion;
      steps++;
    }
    if (steps >= maxSteps) {
      throw new Error("迁移路径过长，可能存在循环引用");
    }
    return path;
  }

  async loadFromDirectory() {
    if (this._loaded) return this._migrations.size;
    if (!existsSync(MIGRATIONS_DIR)) {
      this._loaded = true;
      return 0;
    }
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const modulePath = join(MIGRATIONS_DIR, file);
      const mod = await import(`file://${modulePath}`);
      if (mod.default) {
        this.register(mod.default);
      }
      if (Array.isArray(mod.migrations)) {
        for (const m of mod.migrations) this.register(m);
      }
    }
    this._loaded = true;
    return files.length;
  }
}

const globalRegistry = new MigrationRegistry();

async function loadMigrationState() {
  if (!existsSync(MIGRATION_STATE_PATH)) {
    return {
      history: [],
      currentVersion: null,
      lastMigrationAt: null,
      failedAttempts: []
    };
  }
  try {
    return JSON.parse(await readFile(MIGRATION_STATE_PATH, "utf8"));
  } catch (e) {
    return {
      history: [],
      currentVersion: null,
      lastMigrationAt: null,
      failedAttempts: [],
      _parseError: e.message
    };
  }
}

async function saveMigrationState(state) {
  await mkdir(dirname(MIGRATION_STATE_PATH), { recursive: true });
  await writeFile(MIGRATION_STATE_PATH, JSON.stringify(state, null, 2));
}

async function readRawDatabase() {
  if (!existsSync(DB_PATH)) return null;
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}

async function writeRawDatabase(data) {
  await mkdir(dirname(DB_PATH), { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

export {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS_DIR,
  SNAPSHOTS_DIR,
  MIGRATION_STATE_PATH,
  DB_PATH,
  DATA_DIR,
  MigrationRegistry,
  globalRegistry,
  detectDataVersion,
  loadMigrationState,
  saveMigrationState,
  readRawDatabase,
  writeRawDatabase
};
