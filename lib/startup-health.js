import {
  CURRENT_SCHEMA_VERSION,
  detectDataVersion,
  loadMigrationState,
  readRawDatabase,
  writeRawDatabase,
  globalRegistry
} from "./migration-registry.js";
import {
  globalRepository
} from "./data-repository.js";
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  restoreSnapshot,
  verifySnapshot,
  deleteSnapshot,
  computeDataChecksum,
  countModelsTasks
} from "./backup-snapshot.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
  return true;
}

function sendError(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error }, null, 2));
  return true;
}

async function runSystemHealthCheck() {
  const checks = [];
  let overallStatus = "ok";

  function addCheck(name, status, detail = {}) {
    checks.push({ name, status, ...detail });
    if (status === "error") overallStatus = "error";
    if (status === "warning" && overallStatus !== "error") overallStatus = "warning";
  }

  const initResult = await globalRepository.initialize();
  addCheck("repository_init", initResult.initialized ? "ok" : "error", { detail: initResult });

  const rawData = await readRawDatabase();
  const versionInfo = detectDataVersion(rawData);
  addCheck("schema_version",
    versionInfo.version === CURRENT_SCHEMA_VERSION ? "ok" :
      (versionInfo.version < CURRENT_SCHEMA_VERSION ? "warning" : "error"),
    {
      current: versionInfo.version,
      expected: CURRENT_SCHEMA_VERSION,
      reason: versionInfo.reason,
      reliable: versionInfo.reliable
    }
  );

  if (rawData && rawData.items) {
    let missingIdCount = 0;
    let missingTaskIdCount = 0;
    let missingTaskLogsCount = 0;
    let missingItemLogsCount = 0;
    for (const item of rawData.items) {
      if (!item.id) missingIdCount++;
      if (!item.logs || item.logs.length === 0) missingItemLogsCount++;
      if (item.tasks) {
        for (const task of item.tasks) {
          if (!task.id) missingTaskIdCount++;
          if (!task.logs || task.logs.length === 0) missingTaskLogsCount++;
        }
      }
    }
    const itemCount = rawData.items.length;
    addCheck("data_integrity",
      missingIdCount === 0 && missingTaskIdCount === 0 ? "ok" : "warning",
      {
        itemCount,
        missingIdCount,
        missingTaskIdCount,
        missingItemLogsCount,
        missingTaskLogsCount
      }
    );
  } else {
    addCheck("data_integrity", "warning", { message: "无items数据" });
  }

  if (rawData) {
    const hasAudit = !!rawData.audit && Array.isArray(rawData.audit.records);
    const hasCalLib = !!rawData.calibrationLibrary && Array.isArray(rawData.calibrationLibrary.rules);
    const hasSysCfg = !!rawData.systemConfig;
    addCheck("schema_fields",
      hasAudit && hasCalLib && hasSysCfg ? "ok" : "warning",
      { hasAudit, hasCalibrationLibrary: hasCalLib, hasSystemConfig: hasSysCfg }
    );
  }

  const state = await loadMigrationState();
  addCheck("migration_state",
    state.currentVersion === CURRENT_SCHEMA_VERSION ? "ok" : "warning",
    {
      stateVersion: state.currentVersion,
      expected: CURRENT_SCHEMA_VERSION,
      historyCount: state.history?.length || 0,
      failedCount: state.failedAttempts?.length || 0
    }
  );

  const snapshots = await listSnapshots();
  addCheck("snapshot_system", snapshots.length > 0 ? "ok" : "warning", {
    snapshotCount: snapshots.length,
    validCount: snapshots.filter((s) => s.checksumValid).length
  });

  if (rawData) {
    const ct = countModelsTasks(rawData);
    addCheck("content_summary", "ok", {
      modelCount: ct.modelCount,
      taskCount: ct.taskCount,
      checksum: computeDataChecksum(rawData).slice(0, 16) + "..."
    });
  }

  return {
    overallStatus,
    schemaVersion: versionInfo.version,
    expectedVersion: CURRENT_SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    checks
  };
}

function healthCheckPageHtml(health, migrationState, snapshots) {
  const checksHtml = health.checks.map((c) => {
    const statusColor = c.status === "ok" ? "#526f43" : c.status === "warning" ? "#c58b14" : "#9b4937";
    const statusIcon = c.status === "ok" ? "✓" : c.status === "warning" ? "⚠" : "✗";
    const detailStr = Object.entries(c)
      .filter(([k]) => k !== "name" && k !== "status")
      .map(([k, v]) => `<div style="font-size:11px;color:#687066;margin-top:2px;"><strong>${k}:</strong> ${typeof v === "object" ? JSON.stringify(v) : v}</div>`)
      .join("");
    return `
      <div style="background:#fafbf9;border:1px solid #d4ddd0;border-radius:6px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:${statusColor};font-weight:700;font-size:16px;">${statusIcon}</span>
          <strong style="font-size:13px;">${c.name}</strong>
          <span style="margin-left:auto;font-size:11px;color:${statusColor};font-weight:600;text-transform:uppercase;">${c.status}</span>
        </div>
        ${detailStr}
      </div>`;
  }).join("");

  const historyHtml = (migrationState.history || []).slice(-10).reverse().map((h, i) => {
    const bg = h.type === "migration" ? "#e6ebe2" : h.type === "seed" ? "#ece9f2" : h.type === "snapshot_restore" ? "#f7f0db" : "#f5e6e2";
    const meta = h.fromVersion !== undefined
      ? `v${h.fromVersion}→v${h.toVersion}`
      : h.snapshotId ? `快照: ${h.snapshotId}` : h.version ? `v${h.version}` : "";
    return `<div style="background:${bg};border-radius:4px;padding:6px 10px;font-size:12px;margin-bottom:4px;">
      <span style="font-weight:600;">[${h.type || "?"}]</span> ${meta}
      <span style="color:#687066;margin-left:8px;">${h.at}</span>
    </div>`;
  }).join("") || `<div style="color:#687066;font-size:12px;">暂无迁移历史</div>`;

  const snapshotsHtml = snapshots.length === 0
    ? `<div style="color:#687066;font-size:12px;">暂无快照</div>`
    : snapshots.slice(0, 10).map((s) => {
      const validColor = s.corrupted ? "#9b4937" : s.checksumValid ? "#526f43" : "#c58b14";
      return `<div style="background:#fafbf9;border:1px solid #d4ddd0;border-radius:4px;padding:6px 10px;font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <code style="background:#fff;padding:1px 6px;border-radius:3px;">${s.id.slice(0, 28)}...</code>
        ${s.tag ? `<span style="background:#526f43;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">${s.tag}</span>` : ""}
        <span style="color:#687066;">${s.modelCount}模型/${s.taskCount}任务</span>
        <span style="color:${validColor};font-weight:600;">${s.corrupted ? "损坏" : s.checksumValid ? "校验通过" : "校验失败"}</span>
        <span style="margin-left:auto;color:#687066;font-size:11px;">${new Date(s.createdAt).toLocaleString("zh-CN")}</span>
      </div>`;
    }).join("");

  const overallColor = health.overallStatus === "ok" ? "#526f43" : health.overallStatus === "warning" ? "#c58b14" : "#9b4937";
  const overallLabel = health.overallStatus === "ok" ? "系统正常" : health.overallStatus === "warning" ? "存在警告" : "存在错误";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>系统自检与数据迁移 - 古船模型帆索校准</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#c58b14; --danger:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; padding:20px; }
    header { max-width:1200px; margin:0 auto 20px; }
    main { max-width:1200px; margin:0 auto; }
    .hero { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; margin-bottom:20px; }
    .status-pill { display:inline-flex; align-items:center; gap:8px; padding:6px 14px; border-radius:999px; font-weight:700; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:16px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; }
    .card h2 { margin:0 0 12px; font-size:16px; border-bottom:1px solid var(--line); padding-bottom:8px; }
    .checks-stack { display:flex; flex-direction:column; gap:8px; }
    .version-banner { font-size:14px; color:var(--muted); margin-top:6px; }
    .btn { background:var(--accent); color:#fff; border:0; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600; font:inherit; }
    .btn.secondary { background:transparent; color:var(--muted); border:1px solid var(--line); }
    .btn.danger { background:var(--danger); }
    .btn-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
    .loading { text-align:center; padding:20px; color:var(--muted); }
    .nav-links { display:flex; gap:12px; margin-bottom:12px; }
    .nav-links a { color:var(--accent); text-decoration:none; font-size:13px; font-weight:600; }
    .modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); align-items:center; justify-content:center; z-index:999; }
    .modal-bg.show { display:flex; }
    .modal { background:#fff; border-radius:10px; padding:20px; max-width:500px; width:90%; max-height:80vh; overflow:auto; }
    .action-row { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
    .meta-tag { font-size:11px; color:var(--muted); }
    textarea, input, select { font:inherit; padding:6px 10px; border:1px solid var(--line); border-radius:6px; width:100%; }
    label { display:block; font-size:12px; color:var(--muted); font-weight:600; margin:10px 0 4px; }
  </style>
</head>
<body>
  <header>
    <div class="nav-links">
      <a href="/">← 返回系统</a>
      <a href="/api/health/refresh">🔄 刷新检测</a>
      <a href="#" onclick="event.preventDefault();showModal('migrateModal');">🚀 执行迁移</a>
      <a href="#" onclick="event.preventDefault();showModal('snapModal');">📸 快照管理</a>
      <a href="#" onclick="event.preventDefault();showModal('rawModal');">🔍 查看原始结构</a>
    </div>
    <div class="hero">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div style="font-size:48px;">⚙️</div>
        <div style="flex:1;min-width:280px;">
          <h1 style="margin:0;font-size:24px;">系统自检与数据迁移面板</h1>
          <div class="version-banner">
            当前Schema版本: <strong>v${health.schemaVersion}</strong> / 期望: v${health.expectedVersion}
            · 检测时间: ${new Date(health.checkedAt).toLocaleString("zh-CN")}
          </div>
        </div>
        <span class="status-pill" style="background:${overallColor}20;color:${overallColor};">
          ${health.overallStatus === "ok" ? "✓" : health.overallStatus === "warning" ? "⚠" : "✗"}
          ${overallLabel}
        </span>
      </div>
    </div>
  </header>

  <main>
    <div class="grid">
      <div class="card">
        <h2>🔬 项目健康检查 (${health.checks.length})</h2>
        <div class="checks-stack" id="checksContainer">${checksHtml}</div>
      </div>

      <div class="card">
        <h2>📜 迁移与操作历史</h2>
        <div style="display:flex;flex-direction:column;gap:4px;">${historyHtml}</div>
        <div class="btn-row">
          <button class="btn secondary" onclick="location.href='/api/migrations/state';">📄 查看完整状态JSON</button>
        </div>
      </div>

      <div class="card">
        <h2>💾 快照管理 (${snapshots.length})</h2>
        <div style="display:flex;flex-direction:column;gap:4px;">${snapshotsHtml}</div>
        <div class="btn-row">
          <button class="btn" onclick="createSnapshot();">📸 创建快照</button>
          <button class="btn secondary" onclick="location.href='/api/snapshots';">📋 列出全部快照</button>
        </div>
      </div>

      <div class="card">
        <h2>🛠 迁移工具</h2>
        <div style="font-size:13px;line-height:1.7;color:var(--muted);">
          <p><strong>迁移流程保护：</strong></p>
          <ul style="margin:6px 0;padding-left:20px;">
            <li>迁移前自动创建快照（PRE-MIGRATION 标签）</li>
            <li>每个迁移步骤单独创建快照</li>
            <li>迁移失败自动回滚到迁移前快照</li>
            <li>重复启动不会重复迁移（状态文件保护）</li>
            <li>迁移后自动写入状态，防止重复执行</li>
          </ul>
          <p><strong>回滚能力：</strong>使用快照管理恢复任意历史快照。</p>
        </div>
        <div class="btn-row">
          <button class="btn danger" onclick="if(confirm('确认强制重新迁移？将跳过重复启动保护'))forceMigrate();">🔧 强制重新迁移</button>
        </div>
      </div>
    </div>
  </main>

  <div class="modal-bg" id="migrateModal">
    <div class="modal">
      <h2 style="margin-top:0;">🚀 执行数据迁移</h2>
      <label>目标版本</label>
      <select id="targetVersionSelect"></select>
      <label>备注（写入迁移历史）</label>
      <input id="migrateRemark" placeholder="可选备注">
      <div style="margin-top:8px;font-size:12px;color:var(--muted);">
        ⚠️ 迁移前会自动创建可恢复的快照。迁移失败将自动回滚。
      </div>
      <div class="btn-row">
        <button class="btn" onclick="runMigration();">开始迁移</button>
        <button class="btn secondary" onclick="hideModal('migrateModal');">取消</button>
      </div>
      <div id="migrateResult" style="margin-top:12px;"></div>
    </div>
  </div>

  <div class="modal-bg" id="snapModal">
    <div class="modal">
      <h2 style="margin-top:0;">📸 快照管理</h2>
      <label>快照ID（恢复/验证/删除）</label>
      <input id="snapIdInput" placeholder="输入或粘贴快照ID">
      <label>恢复备注</label>
      <input id="snapRestoreRemark" placeholder="恢复原因（可选）">
      <div class="btn-row">
        <button class="btn" onclick="createSnapshot();">创建快照</button>
        <button class="btn secondary" onclick="verifySnap();">验证快照</button>
        <button class="btn" onclick="restoreSnap();">恢复快照</button>
        <button class="btn danger" onclick="deleteSnap();">删除快照</button>
        <button class="btn secondary" onclick="hideModal('snapModal');">关闭</button>
      </div>
      <div id="snapResult" style="margin-top:12px;"></div>
    </div>
  </div>

  <div class="modal-bg" id="rawModal">
    <div class="modal" style="max-width:800px;">
      <h2 style="margin-top:0;">🔍 原始数据结构</h2>
      <div id="rawContent" class="loading">加载中...</div>
      <div class="btn-row">
        <button class="btn secondary" onclick="hideModal('rawModal');">关闭</button>
      </div>
    </div>
  </div>

  <script>
    async function ajax(url, method = "GET", body) {
      const opts = { method, headers: { "Authorization": "Bearer " + (localStorage.getItem("auth_token") || "") } };
      if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));
      return data;
    }

    function showModal(id) { document.getElementById(id).classList.add("show"); }
    function hideModal(id) { document.getElementById(id).classList.remove("show"); }

    document.querySelectorAll(".modal-bg").forEach(bg => {
      bg.addEventListener("click", e => { if (e.target === bg) bg.classList.remove("show"); });
    });

    (async function fillVersions() {
      const sel = document.getElementById("targetVersionSelect");
      try {
        const st = await ajax("/api/migrations/state");
        sel.innerHTML = "";
        for (let v = (st.currentVersion || 0) + 1; v <= ${CURRENT_SCHEMA_VERSION}; v++) {
          const opt = document.createElement("option");
          opt.value = v; opt.textContent = "升级到 v" + v;
          sel.appendChild(opt);
        }
        if (!sel.options.length) {
          const opt = document.createElement("option");
          opt.value = ${CURRENT_SCHEMA_VERSION};
          opt.textContent = "已在最新版本 v" + ${CURRENT_SCHEMA_VERSION};
          sel.appendChild(opt);
        }
      } catch (e) { console.error(e); }
    })();

    async function runMigration() {
      const target = parseInt(document.getElementById("targetVersionSelect").value);
      const remark = document.getElementById("migrateRemark").value;
      const box = document.getElementById("migrateResult");
      box.innerHTML = '<div class="loading">迁移执行中...</div>';
      try {
        const r = await ajax("/api/migrations/run", "POST", { targetVersion: target, remark, force: true });
        box.innerHTML = '<pre style="background:#fafbf9;padding:10px;border-radius:6px;font-size:12px;max-height:300px;overflow:auto;">' + JSON.stringify(r, null, 2) + '</pre>';
      } catch (e) {
        box.innerHTML = '<div style="color:var(--danger);">失败: ' + e.message + "</div>";
      }
    }

    async function forceMigrate() {
      if (!confirm("将清除重复启动保护并重新执行迁移，确认继续？")) return;
      try {
        const r = await ajax("/api/migrations/run", "POST", { targetVersion: ${CURRENT_SCHEMA_VERSION}, force: true, resetState: true });
        alert("执行完成：\n" + JSON.stringify(r, null, 2));
        location.reload();
      } catch (e) { alert("失败: " + e.message); }
    }

    async function createSnapshot() {
      try {
        const r = await ajax("/api/snapshots", "POST", { reason: prompt("快照备注：") || "手动创建", tag: "MANUAL" });
        alert("创建成功：ID = " + r.id);
        location.reload();
      } catch (e) { alert("失败: " + e.message); }
    }

    async function verifySnap() {
      const id = document.getElementById("snapIdInput").value.trim();
      if (!id) return alert("请输入快照ID");
      try { const r = await ajax("/api/snapshots/" + encodeURIComponent(id) + "/verify"); document.getElementById("snapResult").innerHTML = JSON.stringify(r); }
      catch (e) { document.getElementById("snapResult").innerHTML = '<span style="color:var(--danger);">' + e.message + '</span>'; }
    }

    async function restoreSnap() {
      const id = document.getElementById("snapIdInput").value.trim();
      if (!id) return alert("请输入快照ID");
      if (!confirm("确认恢复快照 " + id + "？当前数据将被覆盖，但会先自动创建恢复前快照。")) return;
      try {
        const r = await ajax("/api/snapshots/" + encodeURIComponent(id) + "/restore", "POST", { confirmed: true, force: false });
        alert("恢复成功：\n" + JSON.stringify(r, null, 2));
        location.reload();
      } catch (e) { alert("失败: " + e.message); }
    }

    async function deleteSnap() {
      const id = document.getElementById("snapIdInput").value.trim();
      if (!id) return alert("请输入快照ID");
      if (!confirm("确认删除快照 " + id + "？")) return;
      try { const r = await ajax("/api/snapshots/" + encodeURIComponent(id), "DELETE"); document.getElementById("snapResult").innerHTML = JSON.stringify(r); }
      catch (e) { document.getElementById("snapResult").innerHTML = '<span style="color:var(--danger);">' + e.message + '</span>'; }
    }

    document.getElementById("rawModal").addEventListener("click", async function() {
      const box = document.getElementById("rawContent");
      if (box.classList.contains("loading") && !box.dataset.loaded) {
        box.dataset.loaded = "1";
        try {
          const r = await ajax("/api/health/raw");
          box.innerHTML = '<pre style="background:#fafbf9;padding:10px;border-radius:6px;font-size:11px;max-height:500px;overflow:auto;">' + JSON.stringify(r, null, 2) + '</pre>';
        } catch (e) { box.innerHTML = '<span style="color:var(--danger);">加载失败: ' + e.message + '</span>'; }
      }
    });
  </script>
</body>
</html>`;
}

async function handleHealthApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/health") && !pathname.startsWith("/api/migrations") && !pathname.startsWith("/api/snapshots")) return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  if (pathname === "/api/health/status" || pathname === "/api/health") {
    const health = await runSystemHealthCheck();
    const state = await loadMigrationState();
    const snaps = await listSnapshots();
    return send(res, 200, { health, state, snapshots: snaps.slice(0, 20) });
  }

  if (pathname === "/api/health/refresh") {
    await globalRepository.forceReload();
    const health = await runSystemHealthCheck();
    return send(res, 200, health);
  }

  if (pathname === "/api/health/raw") {
    const raw = await readRawDatabase();
    const versionInfo = detectDataVersion(raw);
    const schema = raw ? Object.keys(raw) : [];
    return send(res, 200, {
      schemaVersion: versionInfo.version,
      reliable: versionInfo.reliable,
      reason: versionInfo.reason,
      topLevelKeys: schema,
      modelCount: raw?.items?.length || 0,
      taskCount: raw?.items?.reduce((n, i) => n + (i.tasks?.length || 0), 0) || 0,
      firstItemSample: raw?.items?.[0] ? {
        hasId: !!raw.items[0].id,
        hasCreatedAt: !!raw.items[0].createdAt,
        keyCount: Object.keys(raw.items[0]).length,
        topLevelKeys: Object.keys(raw.items[0])
      } : null,
      checksum: raw ? computeDataChecksum(raw).slice(0, 16) : null
    });
  }

  if (pathname === "/api/health/page") {
    const health = await runSystemHealthCheck();
    const state = await loadMigrationState();
    const snaps = await listSnapshots();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(healthCheckPageHtml(health, state, snaps));
    return true;
  }

  return null;
}

async function handleMigrationsApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/migrations")) return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  if (pathname === "/api/migrations/state") {
    return send(res, 200, await loadMigrationState());
  }

  if (pathname === "/api/migrations/registered") {
    await globalRegistry.loadFromDirectory();
    return send(res, 200, {
      current: CURRENT_SCHEMA_VERSION,
      migrations: globalRegistry.getMigrations().map((m) => ({
        from: m.fromVersion,
        to: m.toVersion,
        name: m.name,
        description: m.description
      }))
    });
  }

  if (pathname === "/api/migrations/run" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};

      if (body.resetState) {
        const emptyState = { history: [], currentVersion: null, lastMigrationAt: null, failedAttempts: [] };
        const { writeFile: _wf } = await import("node:fs/promises");
        const { MIGRATION_STATE_PATH } = await import("./migration-registry.js");
        await _wf(MIGRATION_STATE_PATH, JSON.stringify(emptyState, null, 2));
      }

      const result = await globalRepository.initialize();
      return send(res, 200, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  const dryRunMatch = pathname.match(/^\/api\/migrations\/dry-run\/v(\d+)-to-v(\d+)$/);
  if (dryRunMatch && req.method === "POST") {
    try {
      await globalRegistry.loadFromDirectory();
      const raw = await readRawDatabase();
      const fromV = parseInt(dryRunMatch[1]);
      const toV = parseInt(dryRunMatch[2]);
      const path = globalRegistry.findMigrationPath(fromV, toV);
      const previews = [];
      let working = JSON.parse(JSON.stringify(raw));
      for (const m of path) {
        if (typeof m.dryRun === "function") {
          previews.push({ from: m.fromVersion, to: m.toVersion, ...m.dryRun(working) });
        }
        working = m.up(working);
      }
      return send(res, 200, { fromVersion: fromV, toVersion: toV, steps: previews });
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  return null;
}

async function handleSnapshotsApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/snapshots")) return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  if (pathname === "/api/snapshots" && req.method === "GET") {
    return send(res, 200, await listSnapshots());
  }

  if (pathname === "/api/snapshots" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const result = await createSnapshot({
        reason: body.reason,
        tag: body.tag || "MANUAL",
        sourceVersion: (await globalRepository.getSchemaVersion()),
        targetVersion: (await globalRepository.getSchemaVersion())
      });
      return send(res, 201, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  const snapIdMatch = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
  if (snapIdMatch) {
    const id = decodeURIComponent(snapIdMatch[1]);
    if (req.method === "GET") {
      try { return send(res, 200, await getSnapshot(id)); }
      catch (e) { return sendError(res, 404, e.message); }
    }
    if (req.method === "DELETE") {
      try { return send(res, 200, await deleteSnapshot(id)); }
      catch (e) { return sendError(res, e.message === "snapshot_not_found" ? 404 : 500, e.message); }
    }
  }

  const snapVerifyMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/verify$/);
  if (snapVerifyMatch && req.method === "GET") {
    const id = decodeURIComponent(snapVerifyMatch[1]);
    return send(res, 200, await verifySnapshot(id));
  }

  const snapRestoreMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/restore$/);
  if (snapRestoreMatch && req.method === "POST") {
    try {
      const id = decodeURIComponent(snapRestoreMatch[1]);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!body.confirmed) return sendError(res, 400, "confirmation_required");
      const result = await restoreSnapshot(id, { force: !!body.force });
      await globalRepository.forceReload();
      return send(res, 200, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  return null;
}

export {
  runSystemHealthCheck,
  healthCheckPageHtml,
  handleHealthApi,
  handleMigrationsApi,
  handleSnapshotsApi
};
