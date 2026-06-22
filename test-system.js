const BASE_URL = "http://localhost:3038";

async function api(method, path, token, body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (token) options.headers["Authorization"] = `Bearer ${token}`;
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function login(username, password) {
  const res = await api("POST", "/api/auth/login", null, { username, password });
  if (res.status !== 200) throw new Error(`登录失败: ${username} - ${JSON.stringify(res.data)}`);
  return res.data.token;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ 断言失败: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${msg}`);
  }
}

async function main() {
  console.log("=== 多用户协作与操作审计系统测试 ===\n");

  // 1. 测试登录
  console.log("【1】测试登录功能");
  const adminToken = await login("admin", "admin123");
  assert(!!adminToken, "管理员登录成功");

  const zhouningToken = await login("zhouning", "zhou123");
  assert(!!zhouningToken, "周宁登录成功");

  const zhangsanToken = await login("zhangsan", "zhang123");
  assert(!!zhangsanToken, "张三登录成功");

  // 测试错误密码
  const wrongLogin = await api("POST", "/api/auth/login", null, { username: "admin", password: "wrong" });
  assert(wrongLogin.status === 401, "错误密码被拒绝");
  console.log();

  // 2. 测试管理员查看所有数据
  console.log("【2】测试管理员权限 - 查看所有模型");
  const adminItems = await api("GET", "/api/items", adminToken);
  assert(adminItems.status === 200, "管理员API返回200");
  assert(adminItems.data.items.length >= 10, `管理员可以看到所有模型 (${adminItems.data.items.length}个)`);
  assert(adminItems.data.currentUser.role === "admin", "当前用户角色为管理员");
  assert(adminItems.data.allOwners.length >= 5, `可以选择所有负责人 (${adminItems.data.allOwners.length}个)`);
  console.log();

  // 3. 测试普通用户数据隔离
  console.log("【3】测试用户数据隔离 - 周宁");
  const zhouItems = await api("GET", "/api/items", zhouningToken);
  assert(zhouItems.status === 200, "周宁API返回200");
  const zhouOwners = new Set(zhouItems.data.items.map(i => i.owner || "空"));
  console.log(`  周宁可见模型负责人: ${[...zhouOwners].join(", ")}`);
  const onlyZhou = zhouItems.data.items.every(i => !i.owner || i.owner === "周宁");
  assert(onlyZhou || zhouItems.data.items.every(i => i.owner === "周宁" || i.owner === ""), "周宁只能看到自己或无负责人的模型");
  assert(zhouItems.data.allOwners.length === 1 && zhouItems.data.allOwners[0] === "周宁", "周宁只能选择自己作为负责人");
  console.log();

  // 4. 测试越权访问 - 周宁查看赵六的模型(MR-204 负责人是赵六)
  console.log("【4】测试越权访问阻止");
  const unauthorized = await api("GET", "/api/items/MR-204", zhouningToken);
  assert(unauthorized.status === 403, `周宁访问赵六的模型MR-204被拒绝 (返回${unauthorized.status})`);

  // 管理员可以访问
  const adminCanSee = await api("GET", "/api/items/MR-204", adminToken);
  assert(adminCanSee.status === 200, `管理员可以访问MR-204 (返回${adminCanSee.status})`);

  // 普通用户访问审计日志被拒绝
  const auditByUser = await api("GET", "/api/audit/stats", zhouningToken);
  assert(auditByUser.status === 403, `普通用户访问审计日志被拒绝 (返回${auditByUser.status})`);
  console.log();

  // 5. 测试创建模型并检查审计日志
  console.log("【5】测试创建模型 + 审计日志记录");
  const newModel = await api("POST", "/api/items", zhouningToken, {
    code: "MR-TEST-" + Date.now(),
    shipType: "测试船",
    scale: "1:100",
    mastCount: 2,
    riggingMaterial: "测试线",
    owner: "周宁",
    dueDate: "2026-12-31",
    status: "待检查"
  });
  assert(newModel.status === 201, `周宁成功创建自己的模型 (返回${newModel.status})`);
  const createdModel = newModel.data;
  assert(createdModel.owner === "周宁", "创建的模型负责人正确");

  // 测试普通用户尝试创建他人负责的模型
  const createOther = await api("POST", "/api/items", zhouningToken, {
    code: "MR-OTHER-" + Date.now(),
    shipType: "越权测试",
    owner: "赵六",
    status: "待检查"
  });
  assert(createOther.status === 403, `周宁不能创建赵六负责的模型 (返回${createOther.status})`);
  console.log();

  // 6. 测试状态切换 + 审计
  console.log("【6】测试状态切换 + 审计日志");
  const statusChange = await api("PATCH", `/api/items/${createdModel.id}`, zhouningToken, {
    status: "校准中"
  });
  assert(statusChange.status === 200, `周宁成功切换自己模型的状态 (返回${statusChange.status})`);

  // 越权修改他人模型状态
  const statusChangeOther = await api("PATCH", "/api/items/MR-204", zhouningToken, {
    status: "校准中"
  });
  assert(statusChangeOther.status === 403, `周宁不能修改赵六模型的状态 (返回${statusChangeOther.status})`);
  console.log();

  // 7. 测试追加备注 + 审计
  console.log("【7】测试追加备注 + 审计日志");
  const addNote = await api("POST", `/api/items/${createdModel.id}/logs`, zhouningToken, {
    step: "备注",
    note: "这是一条测试备注"
  });
  assert(addNote.status === 201, `周宁成功给自己的模型追加备注 (返回${addNote.status})`);
  console.log();

  // 8. 测试创建帆索任务 + 审计
  console.log("【8】测试创建帆索任务 + 审计日志");
  const newTask = await api("POST", `/api/items/${createdModel.id}/tasks`, zhouningToken, {
    position: "测试位置索具",
    tension: "正常",
    note: "测试任务创建"
  });
  assert(newTask.status === 201, `周宁成功给自己的模型创建帆索任务 (返回${newTask.status})`);
  const createdTask = newTask.data.task;
  console.log();

  // 9. 测试任务状态切换 + 审计
  console.log("【9】测试任务状态切换 + 审计日志");
  const taskStatus = await api("PATCH", `/api/tasks/${createdTask.id}/status?itemId=${createdModel.id}`, zhouningToken, {
    status: "调整中"
  });
  assert(taskStatus.status === 200, `周宁成功切换自己任务的状态 (返回${taskStatus.status})`);
  console.log();

  // 10. 测试审计日志（管理员）
  console.log("【10】测试审计日志功能");
  const auditStats = await api("GET", "/api/audit/stats", adminToken);
  assert(auditStats.status === 200, `管理员成功获取审计统计 (返回${auditStats.status})`);
  console.log(`  审计日志总数: ${auditStats.data.total}`);
  console.log(`  最近24小时: ${auditStats.data.last24h}`);
  assert(auditStats.data.total > 0, "审计日志中存在记录");

  const auditLogs = await api("GET", "/api/audit/logs?limit=20", adminToken);
  assert(auditLogs.status === 200, "管理员成功获取审计日志列表");
  const recentLogs = auditLogs.data.logs.slice(0, 10);
  console.log(`  最近操作记录:`);
  for (const log of recentLogs) {
    const actor = log.actor ? `${log.actor.displayName}(@${log.actor.username})` : "系统";
    const target = log.target ? `${log.target.type}:${log.target.name || log.target.id}` : "-";
    console.log(`    [${log.timestamp.slice(0,19)}] ${log.action} - ${actor} -> ${target}`);
  }

  // 验证特定操作被记录
  const hasModelCreate = recentLogs.some(l => l.action === "model.create" && l.actor?.username === "zhouning") || 
    auditLogs.data.logs.some(l => l.action === "model.create" && l.actor?.username === "zhouning");
  assert(hasModelCreate, "审计日志中记录了周宁创建模型的操作");

  const hasStatusChange = auditLogs.data.logs.some(l => l.action === "model.status_change" && l.actor?.username === "zhouning");
  assert(hasStatusChange, "审计日志中记录了状态变更操作");

  const hasTaskCreate = auditLogs.data.logs.some(l => l.action === "task.create" && l.actor?.username === "zhouning");
  assert(hasTaskCreate, "审计日志中记录了创建任务操作");
  console.log();

  // 11. 测试旧数据兼容性 - 无负责人的模型(MR-NO-OWNER-001 负责人是空)
  console.log("【11】测试旧数据兼容性");
  const noOwnerModel = await api("GET", "/api/items/MR-NO-OWNER-001", adminToken);
  assert(noOwnerModel.status === 200, `管理员可以访问无负责人的模型 (返回${noOwnerModel.status})`);
  assert(noOwnerModel.data.owner === "" || noOwnerModel.data.owner === undefined || noOwnerModel.data.owner === null, "该模型确实没有负责人");

  // 无负责人的模型对所有人可见
  const zhouSeeNoOwner = zhouItems.data.items.some(i => i.id === "MR-NO-OWNER-001" || i.code === "MR-105");
  console.log(`  周宁可见无负责人模型: ${zhouSeeNoOwner}`);
  console.log();

  // 12. 测试备份功能
  console.log("【12】测试备份功能权限");
  const userBackup = await api("POST", "/api/backups", zhouningToken, { remark: "测试备份" });
  assert(userBackup.status === 403, `普通用户不能创建备份 (返回${userBackup.status})`);

  const adminBackup = await api("POST", "/api/backups", adminToken, { remark: "管理员测试备份" });
  assert(adminBackup.status === 201, `管理员可以创建备份 (返回${adminBackup.status})`);
  console.log();

  console.log("=== 测试完成 ===");
}

main().catch(err => {
  console.error("测试异常:", err);
  process.exit(1);
});
