const LEGACY_TASK_STATUS_NORMALIZE_MAP = {
  "待校准": "待检查",
  "校准中": "调整中",
  "完成校准": "完成",
  "已完成": "完成",
  "待调整": "待检查",
  "调整完毕": "完成",
  "检查中": "待复核"
};

const LEGACY_MODEL_STATUS_NORMALIZE_MAP = {
  "待校准": "待检查",
  "校准完毕": "待复核",
  "已验收": "已交付",
  "交付": "已交付"
};

function newItemIdLegacy(code, index) {
  if (code) return `MR-LEGACY-${code}`;
  return `MR-LEGACY-${Date.now()}-${index}`;
}

function newTaskIdLegacy(index, itemCode) {
  return `T-LEGACY-${itemCode || "ITEM"}-${index + 1}`;
}

export default {
  fromVersion: 0,
  toVersion: 1,
  name: "初始化结构规范化迁移",
  description: "为旧数据添加id/createdAt/缺失字段，规范化任务与模型状态，补全logs数组，添加audit审计数据初始化",

  validate(data) {
    if (!data || typeof data !== "object") return { valid: false, error: "数据为空" };
    if (!Array.isArray(data.items)) return { valid: false, error: "缺少items数组" };
    return { valid: true };
  },

  up(data) {
    const stats = {
      totalItems: 0,
      addedId: 0,
      addedCreatedAt: 0,
      addedOwner: 0,
      addedStatus: 0,
      addedTasksField: 0,
      addedLogsField: 0,
      normalizedTaskStatus: 0,
      normalizedModelStatus: 0,
      addedTaskLogs: 0,
      addedTaskId: 0,
      addedTaskTension: 0,
      addedTaskStatus: 0,
      auditTrailEntries: 0
    };

    const normalizedItems = data.items.map((item, idx) => {
      stats.totalItems++;
      const normalized = { ...item };

      if (!normalized.id) {
        normalized.id = newItemIdLegacy(normalized.code, idx);
        stats.addedId++;
      }

      if (!normalized.owner && normalized.owner !== "") {
        normalized.owner = "";
        stats.addedOwner++;
      }

      if (!normalized.status) {
        normalized.status = "待检查";
        stats.addedStatus++;
      } else if (LEGACY_MODEL_STATUS_NORMALIZE_MAP[normalized.status]) {
        const old = normalized.status;
        normalized.status = LEGACY_MODEL_STATUS_NORMALIZE_MAP[old];
        stats.normalizedModelStatus++;
      }

      if (!normalized.createdAt) {
        if (normalized.logs && normalized.logs.length > 0) {
          const firstLog = normalized.logs[0];
          normalized.createdAt = firstLog.at || new Date().toISOString();
        } else {
          normalized.createdAt = new Date().toISOString();
        }
        stats.addedCreatedAt++;
      }

      if (!normalized.tasks) {
        normalized.tasks = [];
        stats.addedTasksField++;
      }

      if (!normalized.logs) {
        normalized.logs = [];
        stats.addedLogsField++;
      }

      if (normalized.tasks && normalized.tasks.length > 0) {
        normalized.tasks = normalized.tasks.map((task, tIdx) => {
          const nt = { ...task };
          if (!nt.id) {
            nt.id = newTaskIdLegacy(tIdx, normalized.code || normalized.id);
            stats.addedTaskId++;
          }
          if (!nt.status) {
            nt.status = "待检查";
            stats.addedTaskStatus++;
          } else if (LEGACY_TASK_STATUS_NORMALIZE_MAP[nt.status]) {
            const old = nt.status;
            nt.status = LEGACY_TASK_STATUS_NORMALIZE_MAP[old];
            stats.normalizedTaskStatus++;
          }
          if (!nt.tension) {
            nt.tension = "待检测";
            stats.addedTaskTension++;
          }
          if (!nt.logs) {
            nt.logs = [];
            stats.addedTaskLogs++;
          }
          return nt;
        });
      }

      if (!normalized.updatedAt) {
        normalized.updatedAt = normalized.createdAt;
      }

      return normalized;
    });

    const migrated = {
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      migration: {
        from: 0,
        to: 1,
        stats
      },
      items: normalizedItems,
      audit: {
        records: []
      },
      calibrationLibrary: {
        rules: [],
        templates: []
      },
      _meta: {
        originalItemCount: data.items.length
      },
      _migrations: [
        {
          from: 0,
          to: 1,
          at: new Date().toISOString(),
          stats
        }
      ]
    };

    return migrated;
  },

  down(versionedData) {
    if (!versionedData) return null;
    const items = (versionedData.items || []).map((item) => {
      const { id, createdAt, updatedAt, ...rest } = item;
      return rest;
    });
    return { items };
  },

  dryRun(data) {
    const result = this.up(JSON.parse(JSON.stringify(data)));
    return {
      wouldChange: true,
      targetVersion: 1,
      stats: result.migration.stats,
      preview: {
        sampleFirstItemId: result.items[0]?.id || null,
        hasAuditField: !!result.audit,
        hasCalibrationLibrary: !!result.calibrationLibrary,
        hasSchemaVersion: result.schemaVersion === 1
      }
    };
  }
};
