import { writeFile, readFile, unlink, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_SCHEMA_VERSION,
  detectDataVersion,
  loadMigrationState,
  saveMigrationState,
  MIGRATION_STATE_PATH
} from "./lib/migration-registry.js";

import {
  globalRegistry
} from "./lib/migration-registry.js";

import {
  V0_LEGACY_NO_IDS,
  V0_EMPTY_DB,
  V0_ONE_ITEM_NO_FIELDS,
  V1_ALREADY_MIGRATED_SAMPLE
} from "./lib/test-migration-fixtures.js";

import migration0to1 from "./lib/migrations/001_v0_to_v1.js";
import migration1to2 from "./lib/migrations/002_v1_to_v2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, "data", "test-scratch");
const TEST_DB_PATH = join(TEST_DATA_DIR, "test-db.json");
const TEST_STATE_PATH = join(TEST_DATA_DIR, ".test-migration-state.json");

let testPassed = 0;
let testFailed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("返回 false");
    testPassed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    testFailed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}

async function resetTestScratch() {
  if (!existsSync(TEST_DATA_DIR)) await mkdir(TEST_DATA_DIR, { recursive: true });
  for (const f of [TEST_DB_PATH, TEST_STATE_PATH]) {
    if (existsSync(f)) await unlink(f);
  }
}

console.log("=" .repeat(60));
console.log("🧪 迁移系统单元测试");
console.log("=" .repeat(60));

console.log("\n📐 1. 版本检测 (detectDataVersion)");
test("纯v0无schemaVersion+items → v0", () => {
  const r = detectDataVersion({ items: [] });
  assert(r.version === 0, `期望v0，得到v${r.version}`);
  assert(r.reliable === true);
});
test("已有schemaVersion=2 → v2", () => {
  const r = detectDataVersion({ schemaVersion: 2, items: [] });
  assert(r.version === 2, `期望v2，得到v${r.version}`);
});
test("null → v0 unreliable", () => {
  const r = detectDataVersion(null);
  assert(r.version === 0 && !r.reliable);
});
test("有schemaVersion=1但空 → v1", () => {
  const r = detectDataVersion({ schemaVersion: 1 });
  assert(r.version === 1);
});

console.log("\n📐 2. 迁移脚本 v0→v1 up()");
const r0to1 = migration0to1.up(JSON.parse(JSON.stringify(V0_LEGACY_NO_IDS)));
test("输出 schemaVersion = 1", () => assert(r0to1.schemaVersion === 1));
test("items 数组数量不变 (5)", () => assert(r0to1.items.length === 5));
test("所有item都获得 id", () => assert(r0to1.items.every((i) => !!i.id)));
test("缺失createdAt的item获得createdAt", () => {
  const it0 = r0to1.items[0];
  const it2 = r0to1.items[2];
  assert(!!it0.createdAt && !!it2.createdAt);
});
test("旧状态『校准完毕』规范化为『待复核』", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-OLDSTATUS-003");
  assert(it && it.status === "待复核", `状态=${it?.status}`);
});
test("旧任务状态『完成校准』规范化为『完成』", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-OLDSTATUS-003");
  const t = it.tasks[0];
  assert(t.status === "完成", `任务状态=${t.status}`);
});
test("缺失logs字段的任务补齐logs=[]", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-NOID-001");
  const t2 = it.tasks.find((tt) => tt.id && tt.id.includes("LEGACY-002"));
  assert(Array.isArray(t2.logs));
});
test("缺失status的任务默认=待检查", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-NOID-002");
  const t = it.tasks[0];
  assert(t.status === "待检查");
});
test("缺失tension的任务默认=待检测", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-NOID-002");
  const t = it.tasks[0];
  assert(t.tension === "待检测");
});
test("缺失id的任务获得id", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-NOID-001");
  const t1 = it.tasks[0];
  assert(!!t1.id);
});
test("有audit顶层结构", () => assert(!!r0to1.audit && Array.isArray(r0to1.audit.records)));
test("有calibrationLibrary结构", () => assert(!!r0to1.calibrationLibrary));
test("所有item补全 updatedAt", () => assert(r0to1.items.every((i) => !!i.updatedAt)));
test("原有任务内容不丢失", () => {
  const it = r0to1.items.find((i) => i.code === "MR-LEGACY-NOID-001");
  const t1 = it.tasks[0];
  assert(t1.position === "前桅侧支索" && t1.logs.length === 1);
});

console.log("\n📐 3. 迁移脚本 v0→v1 dryRun()");
const dry01 = migration0to1.dryRun(JSON.parse(JSON.stringify(V0_ONE_ITEM_NO_FIELDS)));
test("dryRun 不修改原始数据", () => {
  const orig = JSON.parse(JSON.stringify(V0_ONE_ITEM_NO_FIELDS));
  migration0to1.dryRun(orig);
  assert(!orig.items[0].id, "dryRun不应修改原对象id字段");
});
test("dryRun 返回目标版本 1", () => assert(dry01.targetVersion === 1));

console.log("\n📐 4. 迁移脚本 v1→v2 up()");
const r1to2 = migration1to2.up(JSON.parse(JSON.stringify(V1_ALREADY_MIGRATED_SAMPLE)));
test("输出 schemaVersion = 2", () => assert(r1to2.schemaVersion === 2));
test("有 systemConfig 结构", () => assert(!!r1to2.systemConfig && r1to2.systemConfig.dataSchemaVersion === 2));
test("所有item补全 auditRefs=[]", () => assert(r1to2.items.every((i) => Array.isArray(i.auditRefs))));
test("所有任务补全 modelRef / modelCode", () => {
  const t = r1to2.items[0].tasks[0];
  assert(t.modelRef === "MR-V1-SAMPLE-001" && t.modelCode === "MR-V1-SAMPLE");
});
test("校准库规则种子被注入 (默认4条)", () => {
  assert(Array.isArray(r1to2.calibrationLibrary.rules) && r1to2.calibrationLibrary.rules.length >= 4);
});
test("有 _migrations 历史追踪", () => assert(Array.isArray(r1to2._migrations) && r1to2._migrations.length >= 1));
test("audit records 中补全 id 字段", () => {
  const r = migration1to2.up(JSON.parse(JSON.stringify({
    ...V1_ALREADY_MIGRATED_SAMPLE,
    audit: { records: [{ foo: "bar" }, { baz: 1 }] }
  })));
  assert(r.audit.records.every((x) => !!x.id), "audit记录应获得id");
});

console.log("\n📐 5. 迁移脚本 v1→v2 validate() 检查前置版本");
test("对 schemaVersion=0 的数据 validate 返回失败", () => {
  const vr = migration1to2.validate({ schemaVersion: 0, items: [] });
  assert(vr.valid === false, "应返回无效");
});
test("对 schemaVersion=1 的数据 validate 返回通过", () => {
  const vr = migration1to2.validate({ schemaVersion: 1, items: [] });
  assert(vr.valid === true);
});

console.log("\n📐 6. v0→v1→v2 链式迁移端到端");
const chained0 = JSON.parse(JSON.stringify(V0_LEGACY_NO_IDS));
const chained1 = migration0to1.up(chained0);
const chained2 = migration1to2.up(chained1);
test("链式后 schemaVersion=2", () => assert(chained2.schemaVersion === 2));
test("链式后 item 数保持不变 (5)", () => assert(chained2.items.length === 5));
test("链式后所有item同时具备id+createdAt+auditRefs", () => {
  assert(chained2.items.every((i) => !!i.id && !!i.createdAt && Array.isArray(i.auditRefs)));
});
test("链式后第一个模型第一个任务具备modelRef", () => {
  assert(!!chained2.items[0].tasks[0]?.modelRef);
});
test("原始内容（船型、比例等）无损保留", () => {
  const it = chained2.items.find((i) => i.code === "MR-MIXED-005");
  assert(it.shipType === "郑和宝船" && it.scale === "1:100" && it.mastCount === 5);
});

console.log("\n📐 7. 迁移注册器 (MigrationRegistry)");
test("注册 v0→v1 和 v1→v2，查找路径 v0→v2 包含两步", () => {
  const reg = new globalRegistry.constructor();
  reg.register(migration0to1);
  reg.register(migration1to2);
  const path = reg.findMigrationPath(0, 2);
  assert(path.length === 2, `路径长度=${path.length}`);
  assert(path[0].fromVersion === 0 && path[0].toVersion === 1);
  assert(path[1].fromVersion === 1 && path[1].toVersion === 2);
});
test("缺少中间迁移应抛错", () => {
  const reg = new globalRegistry.constructor();
  reg.register(migration1to2);
  let threw = false;
  try { reg.findMigrationPath(0, 2); } catch { threw = true; }
  assert(threw, "缺少v0→v1应该抛错");
});

console.log("\n📐 8. 迁移脚本 down() 可逆验证");
test("v1→v2.down() 能降级回大致v1形态（丢新增字段保items）", () => {
  const downed = migration1to2.down(JSON.parse(JSON.stringify(r1to2)));
  assert(downed.schemaVersion === 1 || downed.schemaVersion === undefined);
  assert(Array.isArray(downed.items) && downed.items.length === 1);
});

console.log("\n" + "=" .repeat(60));
console.log(`📊 测试结束：通过 ${testPassed} / 失败 ${testFailed}`);
if (testFailed > 0) {
  console.log("\n❌ 失败详情:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log("🎉 全部测试通过！");
  process.exit(0);
}
