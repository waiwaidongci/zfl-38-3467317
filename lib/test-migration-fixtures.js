export const V0_LEGACY_NO_IDS = {
  items: [
    {
      code: "MR-LEGACY-NOID-001",
      shipType: "沙船",
      scale: "1:72",
      mastCount: 4,
      riggingMaterial: "蜡线",
      owner: "张三",
      dueDate: "2026-08-15",
      status: "校准中",
      tasks: [
        {
          position: "前桅侧支索",
          tension: "偏松",
          status: "调整中",
          logs: [
            { at: "2026-06-10T08:00:00.000Z", note: "开始调整，偏松需缩短3mm" }
          ]
        },
        {
          id: "T-LEGACY-002",
          position: "主桅升帆索",
          tension: "偏紧",
          logs: []
        }
      ]
    },
    {
      code: "MR-LEGACY-NOID-002",
      shipType: "广船",
      scale: "1:60",
      mastCount: 2,
      riggingMaterial: "麻绳",
      owner: "李四",
      dueDate: "2026-09-01",
      tasks: [
        {
          position: "后桅稳索",
          tension: "待检测"
        }
      ]
    },
    {
      code: "MR-LEGACY-OLDSTATUS-003",
      shipType: "鸟船",
      scale: "1:50",
      mastCount: 3,
      riggingMaterial: "棉线",
      owner: "王五",
      dueDate: "2026-07-20",
      status: "校准完毕",
      tasks: [
        {
          position: "前桅升帆索",
          tension: "正常",
          status: "完成校准",
          logs: [
            { at: "2026-06-05T10:00:00.000Z", note: "校准完毕" }
          ]
        }
      ]
    },
    {
      code: "MR-LEGACY-PARTIAL-004",
      shipType: "福船",
      scale: "1:48",
      mastCount: 3,
      riggingMaterial: "丝线",
      dueDate: "2026-10-01",
      status: "待校准"
    },
    {
      id: "MR-LEGCY-MIXED-005",
      code: "MR-MIXED-005",
      shipType: "郑和宝船",
      scale: "1:100",
      mastCount: 5,
      riggingMaterial: "麻绳",
      owner: "陈师傅",
      dueDate: "2026-12-01",
      status: "校准中",
      createdAt: "2026-05-01T00:00:00.000Z",
      tasks: [
        {
          id: "T-LEGACY-MIXED-1",
          position: "主桅侧支索",
          tension: "正常",
          status: "完成",
          logs: [
            { at: "2026-05-15T10:00:00.000Z", note: "完成校准" }
          ]
        }
      ],
      logs: [
        { at: "2026-05-01T00:00:00.000Z", step: "建档", note: "创建郑和宝船模型" }
      ]
    }
  ]
};

export const V0_EMPTY_DB = {
  items: []
};

export const V0_ONE_ITEM_NO_FIELDS = {
  items: [
    {
      code: "MR-MINIMAL-001",
      shipType: "福船"
    }
  ]
};

export const V1_ALREADY_MIGRATED_SAMPLE = {
  schemaVersion: 1,
  migratedAt: "2026-06-01T00:00:00.000Z",
  migration: {
    from: 0,
    to: 1,
    stats: { totalItems: 1, addedId: 1 }
  },
  items: [
    {
      id: "MR-V1-SAMPLE-001",
      code: "MR-V1-SAMPLE",
      shipType: "福船",
      scale: "1:48",
      mastCount: 3,
      riggingMaterial: "蜡线",
      owner: "周宁",
      dueDate: "2026-07-01",
      status: "校准中",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      tasks: [
        {
          id: "T-V1-SAMPLE-1",
          position: "前桅侧支索",
          tension: "偏松",
          status: "调整中",
          logs: [
            { at: "2026-06-01T00:00:00.000Z", note: "测试任务" }
          ]
        }
      ],
      logs: [
        { at: "2026-06-01T00:00:00.000Z", step: "建档", note: "创建v1示例" }
      ]
    }
  ],
  audit: {
    records: []
  },
  calibrationLibrary: {
    rules: [],
    templates: []
  }
};

export const CORRUPTED_JSON_SNIPPET = `{
  "items": [
    { "code": "BROKEN", "shipType": "Broken" }
  ]
  THIS IS INTENTIONALLY BROKEN`;
