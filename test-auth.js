const BASE_URL = "http://localhost:3038";

async function api(method, path, token, body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
    redirect: "manual"
  };
  if (token) options.headers["Authorization"] = `Bearer ${token}`;
  if (token) options.headers["Cookie"] = `auth_token=${token}`;
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
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
  console.log("=== 会话持久化与路由鉴权闭环测试 ===\n");

  // 1. 登录并检查Cookie
  console.log("【1】登录会话 - Cookie + Token 双重持久化");
  const adminToken = await login("admin", "admin123");
  assert(!!adminToken, "管理员登录成功获取Token");
  
  const loginRes = await api("POST", "/api/auth/login", null, { username: "zhouning", password: "zhou123" });
  assert(loginRes.status === 200, "周宁登录成功");
  const zhouToken = loginRes.data.token;
  assert(!!zhouToken, "周宁获取Token");
  const setCookie = loginRes.headers["set-cookie"];
  assert(!!setCookie && setCookie.includes("auth_token="), `登录响应设置Cookie (auth_token=...): ${setCookie ? setCookie.substring(0, 40) + '...' : '无'}`);
  console.log();

  // 2. 服务端路由鉴权 - 未登录访问受保护页面重定向到登录页
  console.log("【2】服务端路由鉴权 - 未登录重定向");
  const unauthMain = await api("GET", "/", null);
  assert(unauthMain.status === 302, `未登录访问主页返回302重定向 (返回${unauthMain.status})`);

  const unauthAudit = await api("GET", "/audit", null);
  assert(unauthAudit.status === 302, `未登录访问审计页返回302重定向 (返回${unauthAudit.status})`);

  const unauthImport = await api("GET", "/import", null);
  assert(unauthImport.status === 302, `未登录访问导入页返回302重定向 (返回${unauthImport.status})`);

  const unauthWorkspace = await api("GET", "/workspace/%E5%91%A8%E5%AE%81", null);
  assert(unauthWorkspace.status === 302, `未登录访问工作区返回302重定向 (返回${unauthWorkspace.status})`);
  console.log();

  // 3. 服务端路由鉴权 - 已登录用户正常访问
  console.log("【3】服务端路由鉴权 - 已登录正常访问");
  const authMain = await api("GET", "/", adminToken);
  assert(authMain.status === 200, `管理员访问主页返回200 (返回${authMain.status})`);

  const authAudit = await api("GET", "/audit", adminToken);
  assert(authAudit.status === 200, `管理员访问审计页返回200 (返回${authAudit.status})`);

  const authImport = await api("GET", "/import", adminToken);
  assert(authImport.status === 200, `管理员访问导入页返回200 (返回${authImport.status})`);
  console.log();

  // 4. 服务端路由鉴权 - 普通用户访问审计页被拒绝
  console.log("【4】服务端路由鉴权 - 普通用户越权被拒");
  const userAudit = await api("GET", "/audit", zhouToken);
  assert(userAudit.status === 403, `周宁访问审计页返回403 (返回${userAudit.status})`);
  console.log();

  // 5. 已登录用户访问登录页自动重定向
  console.log("【5】已登录用户访问登录页自动重定向");
  const authLogin = await api("GET", "/login", adminToken);
  assert(authLogin.status === 302, `已登录用户访问/login返回302重定向 (返回${authLogin.status})`);
  console.log();

  // 6. /api/auth/me 验证Token有效性
  console.log("【6】Token有效性验证 - /api/auth/me");
  const validMe = await api("GET", "/api/auth/me", adminToken);
  assert(validMe.status === 200, `有效Token调用/me返回200 (返回${validMe.status})`);
  assert(validMe.data.username === "admin", `/me返回正确用户名: ${validMe.data.username}`);
  assert(validMe.data.role === "admin", `/me返回正确角色: ${validMe.data.role}`);

  const expiredToken = "invalid_token_12345";
  const invalidMe = await api("GET", "/api/auth/me", expiredToken);
  assert(invalidMe.status === 401, `无效Token调用/me返回401 (返回${invalidMe.status})`);
  console.log();

  // 7. 登出后Token失效
  console.log("【7】登出后Token失效");
  const lisiToken = await login("lisi", "li123");
  const beforeLogout = await api("GET", "/api/auth/me", lisiToken);
  assert(beforeLogout.status === 200, `登出前/me返回200`);

  const logoutRes = await api("POST", "/api/auth/logout", lisiToken);
  assert(logoutRes.status === 200, `登出API返回200`);
  const logoutCookie = logoutRes.headers["set-cookie"];
  assert(!!logoutCookie && logoutCookie.includes("Max-Age=0"), `登出响应清除Cookie (Max-Age=0)`);

  const afterLogout = await api("GET", "/api/auth/me", lisiToken);
  assert(afterLogout.status === 401, `登出后/me返回401`);
  console.log();

  // 8. 负责人工作区 - 普通用户只能进入自己的工作区
  console.log("【8】负责人工作区 - 数据隔离");
  const zhouOwners = await api("GET", "/api/owners", zhouToken);
  assert(zhouOwners.status === 200, "周宁获取负责人列表成功");
  assert(zhouOwners.data.length === 1, `周宁只能看到1个负责人(自己) (实际${zhouOwners.data.length}个)`);
  assert(zhouOwners.data[0].name === "周宁", `唯一负责人是周宁`);

  const zhouWorkspace = await api("GET", "/api/owners/%E5%91%A8%E5%AE%81", zhouToken);
  assert(zhouWorkspace.status === 200, `周宁可以进入自己的工作区 (返回${zhouWorkspace.status})`);
  assert(zhouWorkspace.data.owner === "周宁", `工作区属于周宁`);

  const zhouOtherWorkspace = await api("GET", "/api/owners/%E8%B5%B5%E5%85%AD", zhouToken);
  assert(zhouOtherWorkspace.status === 403, `周宁不能进入赵六的工作区 (返回${zhouOtherWorkspace.status})`);
  console.log();

  // 9. Cookie-based鉴权 - 使用Cookie而非Authorization header
  console.log("【9】Cookie-based鉴权");
  const cookieMain = await api("GET", "/", adminToken);
  assert(cookieMain.status === 200, `使用Cookie鉴权访问主页返回200 (返回${cookieMain.status})`);
  console.log();

  // 10. API保护 - 各API端点的401/403处理
  console.log("【10】API保护 - 401/403返回正确");
  const noAuthItems = await api("GET", "/api/items", null);
  assert(noAuthItems.status === 401, `未登录访问/api/items返回401 (返回${noAuthItems.status})`);

  const noAuthTasks = await api("GET", "/api/tasks", null);
  assert(noAuthTasks.status === 401, `未登录访问/api/tasks返回401 (返回${noAuthTasks.status})`);

  const noAuthRisk = await api("GET", "/api/risk", null);
  assert(noAuthRisk.status === 401, `未登录访问/api/risk返回401 (返回${noAuthRisk.status})`);

  const noAuthAuditStats = await api("GET", "/api/audit/stats", null);
  assert(noAuthAuditStats.status === 401, `未登录访问/api/audit/stats返回401 (返回${noAuthAuditStats.status})`);

  const userAuditStats = await api("GET", "/api/audit/stats", zhouToken);
  assert(userAuditStats.status === 403, `普通用户访问/api/audit/stats返回403 (返回${userAuditStats.status})`);

  const adminAuditStats = await api("GET", "/api/audit/stats", adminToken);
  assert(adminAuditStats.status === 200, `管理员访问/api/audit/stats返回200 (返回${adminAuditStats.status})`);
  console.log();

  // 11. 前端页面内容检查
  console.log("【11】前端页面内容检查");
  const mainPageRes = await api("GET", "/", adminToken);
  const mainHtml = typeof mainPageRes.data === 'string' ? mainPageRes.data : JSON.stringify(mainPageRes.data);
  assert(mainHtml.includes("validateSession"), "主页包含validateSession会话验证函数");
  assert(mainHtml.includes("window.location.href = '/login'"), "主页包含401自动跳转登录逻辑");
  assert(mainHtml.includes("localStorage.removeItem('auth_token')"), "主页包含Token清除逻辑");

  const auditPageRes = await api("GET", "/audit", adminToken);
  const auditHtml = typeof auditPageRes.data === 'string' ? auditPageRes.data : JSON.stringify(auditPageRes.data);
  assert(auditHtml.includes("validateAuditSession"), "审计页包含validateAuditSession会话验证函数");
  assert(auditHtml.includes("window.location.href = '/'"), "审计页包含403跳转主页逻辑");

  const loginPageRes = await api("GET", "/login", null);
  const loginHtml = typeof loginPageRes.data === 'string' ? loginPageRes.data : JSON.stringify(loginPageRes.data);
  assert(loginHtml.includes("existingToken"), "登录页包含已登录检测逻辑");
  assert(loginHtml.includes("document.cookie = 'auth_token='"), "登录页包含Cookie设置逻辑");
  console.log();

  // 12. 导入页面认证保护
  console.log("【12】导入页面认证保护");
  const importPageRes = await api("GET", "/import", adminToken);
  const importHtml = typeof importPageRes.data === 'string' ? importPageRes.data : JSON.stringify(importPageRes.data);
  assert(importHtml.includes("authToken"), "导入页包含authToken变量");
  assert(importHtml.includes("'Authorization'"), "导入页API函数注入Authorization header");
  assert(importHtml.includes("window.location.href = '/login'"), "导入页包含401跳转逻辑");
  console.log();

  console.log("=== 测试完成 ===");
}

main().catch(err => {
  console.error("测试异常:", err);
  process.exit(1);
});
