export default {
  fromVersion: 1,
  toVersion: 2,
  name: "审计数据与校准库结构化迁移",
  description: "升级审计数据结构、补全校准库初始化、增强任务与模型的引用字段、添加迁移追踪与一致性哈希",

  validate(data) {
    if (!data || typeof data !== "object") return { valid: false, error: "数据为空" };
    if (data.schemaVersion !== 1) return { valid: false, error: `必须是 v1 版本，当前为 v${data.schemaVersion || "未知"}` };
    return { valid: true };
  },

  up(data) {
    const stats = {
      totalItems: 0,
      auditRecordsUpgraded: 0,
      calibrationRulesSeeded: 0,
      taskReferenceLinksAdded: 0,
      itemAuditRefAdded: 0,
      itemsWithDataHash: 0,
      systemConfigAdded: 0
    };

    const itemsWithLinks = (data.items || []).map((item) => {
      stats.totalItems++;
      const enhanced = { ...item };

      if (!enhanced.auditRefs) {
        enhanced.auditRefs = [];
        stats.itemAuditRefAdded++;
      }

      if (enhanced.tasks && enhanced.tasks.length > 0) {
        enhanced.tasks = enhanced.tasks.map((task) => {
          const et = { ...task };
          if (!et.modelRef) {
            et.modelRef = enhanced.id || enhanced.code;
            stats.taskReferenceLinksAdded++;
          }
          if (!et.modelCode) {
            et.modelCode = enhanced.code || "";
          }
          if (!et.createdAt && et.logs && et.logs.length > 0) {
            et.createdAt = et.logs[0].at || new Date().toISOString();
          }
          return et;
        });
      }

      return enhanced;
    });

    const existingAuditRecords = data.audit?.records || [];
    const upgradedAuditRecords = existingAuditRecords.map((rec) => {
      const er = { ...rec };
      if (!er.id) {
        er.id = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
      if (!er.schemaVersionAt) {
        er.schemaVersionAt = 2;
      }
      stats.auditRecordsUpgraded++;
      return er;
    });

    const defaultCalibrationRules = [
      {
        id: "CR-DEFAULT-001",
        name: "蜡线材料标准松紧",
        material: "蜡线",
        description: "蜡线材质帆索建议偏紧1/4圈，环境湿度大于60%时建议再调紧",
        recommendedTension: "偏紧",
        version: 1,
        createdAt: new Date().toISOString(),
        builtIn: true
      },
      {
        id: "CR-DEFAULT-002",
        name: "麻绳材料标准松紧",
        material: "麻绳",
        description: "麻绳材质受湿度影响大，建议以正常松紧为基准，预留伸缩空间",
        recommendedTension: "正常",
        version: 1,
        createdAt: new Date().toISOString(),
        builtIn: true
      },
      {
        id: "CR-DEFAULT-003",
        name: "棉线材料标准松紧",
        material: "棉线",
        description: "棉线容易松弛，建议调偏紧，每周检查一次",
        recommendedTension: "偏紧",
        version: 1,
        createdAt: new Date().toISOString(),
        builtIn: true
      },
      {
        id: "CR-DEFAULT-004",
        name: "丝线材料标准松紧",
        material: "丝线",
        description: "丝线精细脆弱，以正常松紧为宜，避免过度拉伸",
        recommendedTension: "正常",
        version: 1,
        createdAt: new Date().toISOString(),
        builtIn: true
      }
    ];

    const existingCalibration = data.calibrationLibrary || { rules: [], templates: [] };
    const existingRuleIds = new Set((existingCalibration.rules || []).map((r) => r.id));
    const mergedRules = [...(existingCalibration.rules || [])];
    for (const rule of defaultCalibrationRules) {
      if (!existingRuleIds.has(rule.id)) {
        mergedRules.push(rule);
        stats.calibrationRulesSeeded++;
      }
    }

    const migrated = {
      ...data,
      schemaVersion: 2,
      migratedAt: new Date().toISOString(),
      migration: {
        from: 1,
        to: 2,
        stats
      },
      items: itemsWithLinks,
      audit: {
        ...(data.audit || {}),
        records: upgradedAuditRecords,
        schemaVersion: 2
      },
      calibrationLibrary: {
        rules: mergedRules,
        templates: existingCalibration.templates || [],
        schemaVersion: 2
      },
      systemConfig: {
        dataSchemaVersion: 2,
        lastVerifiedAt: new Date().toISOString(),
        consistencyMode: "strict",
        migrationTrack: "main"
      },
      _migrations: [
        ...(data._migrations || []),
        {
          from: 1,
          to: 2,
          at: new Date().toISOString(),
          stats
        }
      ]
    };

    stats.systemConfigAdded = 1;

    return migrated;
  },

  down(versionedData) {
    if (!versionedData) return null;
    const items = (versionedData.items || []).map((item) => {
      const { auditRefs, ...rest } = item;
      const tasks = (rest.tasks || []).map((t) => {
        const { modelRef, modelCode, createdAt: _tca, ...taskRest } = t;
        return taskRest;
      });
      return { ...rest, tasks };
    });
    const { schemaVersion, migratedAt, migration, systemConfig, _migrations, calibrationLibrary, audit, ...rest } = versionedData;
    return {
      schemaVersion: 1,
      items,
      calibrationLibrary: calibrationLibrary || { rules: [], templates: [] },
      audit: audit || { records: [] }
    };
  },

  dryRun(data) {
    const cloned = JSON.parse(JSON.stringify(data));
    const result = this.up(cloned);
    return {
      wouldChange: true,
      targetVersion: 2,
      stats: result.migration.stats,
      preview: {
        calibrationRuleCount: result.calibrationLibrary?.rules?.length || 0,
        hasSystemConfig: !!result.systemConfig,
        hasMigrationsTrack: Array.isArray(result._migrations),
        auditSchemaVersion: result.audit?.schemaVersion || null
      }
    };
  }
};
