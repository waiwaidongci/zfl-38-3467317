const BASE_URL = "http://localhost:3038";

async function testRedirects() {
  console.log("=== 测试登录重定向和路由鉴权 ===\n");

  // 1. 测试未登录访问主页
  console.log("【1】测试未登录访问主页（应重定向到登录页）");
  const res1 = await fetch(BASE_URL + "/", { redirect: "manual" });
  console.log(`  响应: ${res1.status}`);
  console.log(`  Location: ${res1.headers.get("location")}`);
  const loc1 = res1.headers.get("location") || "";
  const hasRedirect = res1.status === 302 && loc1.startsWith("/login?redirect=");
  console.log(`  包含 redirect 参数: ${hasRedirect}`);

  // 2. 测试未登录访问工作区
  console.log("\n【2】测试未登录访问工作区 /workspace/周宁（应重定向到 /login?redirect=/workspace/%E5%91%A8%E5%AE%81）");
  const res2 = await fetch(BASE_URL + "/workspace/周宁", { redirect: "manual" });
  console.log(`  响应: ${res2.status}`);
  console.log(`  Location: ${res2.headers.get("location")}`);
  const loc2 = res2.headers.get("location") || "";
  console.log(`  包含 /workspace/%E5%91%A8%E5%AE%81: ${loc2.includes("/workspace/")}`);

  // 3. 测试未登录访问 /audit
  console.log("\n【3】测试未登录访问审计页 /audit");
  const res3 = await fetch(BASE_URL + "/audit", { redirect: "manual" });
  console.log(`  响应: ${res3.status}`);
  console.log(`  Location: ${res3.headers.get("location")}`);
  const loc3 = res3.headers.get("location") || "";
  console.log(`  包含 redirect=/audit: ${loc3.includes("redirect=%2Faudit")}`);

  // 4. 登录周宁
  console.log("\n【4】登录周宁");
  const loginRes = await fetch(BASE_URL + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "zhouning", password: "zhou123" })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log(`  登录成功: ${!!token}`);

  // 5. 已登录访问 /login 页面（服务端应根据角色重定向）
  console.log("\n【5】已登录访问 /login（服务端根据角色重定向到工作区）");
  const res5 = await fetch(BASE_URL + "/login", {
    redirect: "manual",
    headers: { Cookie: `auth_token=${token}` }
  });
  console.log(`  响应: ${res5.status}`);
  console.log(`  Location: ${res5.headers.get("location")}`);
  const loc5 = res5.headers.get("location") || "";
  console.log(`  重定向到工作区 /workspace/周宁: ${loc5.startsWith("/workspace/")}`);

  // 6. 普通用户访问 /audit（服务端应 302 到 /?error=）
  console.log("\n【6】普通用户（周宁）访问 /audit（应重定向到首页提示权限不足）");
  const res6 = await fetch(BASE_URL + "/audit", {
    redirect: "manual",
    headers: { Cookie: `auth_token=${token}` }
  });
  console.log(`  响应: ${res6.status}`);
  console.log(`  Location: ${res6.headers.get("location")}`);
  const loc6 = res6.headers.get("location") || "";
  console.log(`  重定向到 /?error=: ${loc6.startsWith("/?error=")}`);

  // 7. 登录 admin
  console.log("\n【7】登录管理员");
  const adminLoginRes = await fetch(BASE_URL + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" })
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;
  console.log(`  登录成功: ${!!adminToken}`);

  // 8. 管理员已登录访问 /login（应重定向到主页）
  console.log("\n【8】管理员已登录访问 /login（服务端应重定向到 /）");
  const res8 = await fetch(BASE_URL + "/login", {
    redirect: "manual",
    headers: { Cookie: `auth_token=${adminToken}` }
  });
  console.log(`  响应: ${res8.status}`);
  console.log(`  Location: ${res8.headers.get("location")}`);
  const loc8 = res8.headers.get("location") || "";
  console.log(`  重定向到 /: ${loc8 === "/"}`);

  // 9. 管理员访问 /audit
  console.log("\n【9】管理员访问 /audit（应返回 200 HTML）");
  const res9 = await fetch(BASE_URL + "/audit", {
    redirect: "manual",
    headers: { Cookie: `auth_token=${adminToken}` }
  });
  console.log(`  响应: ${res9.status}`);
  const auditText = await res9.text();
  const hasAuditTitle = auditText.includes("审计日志");
  console.log(`  页面包含审计日志标题: ${hasAuditTitle}`);

  // 10. 测试带 redirect 参数的登录
  console.log("\n【10】测试带 redirect 参数访问登录页（已登录时跳回原目标）");
  const res10 = await fetch(BASE_URL + "/login?redirect=%2Fworkspace%2F%E8%B5%B5%E5%85%AD", {
    redirect: "manual",
    headers: { Cookie: `auth_token=${adminToken}` }
  });
  console.log(`  响应: ${res10.status}`);
  console.log(`  Location: ${res10.headers.get("location")}`);
  const loc10 = res10.headers.get("location") || "";
  console.log(`  按 redirect 参数跳转到 /workspace/赵六: ${loc10 === "/workspace/" + encodeURIComponent("赵六")}`);

  console.log("\n=== 后端路由重定向测试完成 ===");
}

testRedirects().catch(err => {
  console.error(err);
  process.exit(1);
});
