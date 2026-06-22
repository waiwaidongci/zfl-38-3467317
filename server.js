import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuffer, generateTaskSummary } from "./lib/upload-parser.js";
import { validateAll } from "./lib/data-validator.js";
import { commitImport } from "./lib/data-writer.js";
import { importPage } from "./lib/pages.js";
import { parseMultipart, extractBoundary } from "./lib/multipart.js";
import { handleTasksApi } from "./lib/task-api.js";
import { handleRiskApi } from "./lib/risk-api.js";
import { handleCalibrationApi } from "./lib/calibration-api.js";
import { handleOwnerApi } from "./lib/owner-api.js";
import { handleBackupApi } from "./lib/backup-api.js";
import {
  authMiddleware,
  handleAuthApi,
  extractTokenFromRequest
} from "./lib/auth.js";
import { handleAuditApi, AUDIT_ACTIONS, writeAuditLog } from "./lib/audit.js";
import {
  filterItemsByOwner,
  filterTasksByOwner,
  filterOwnersForSelection,
  canViewItem,
  canEditItem,
  canCreateItem,
  canChangeItemOwner,
  isAdmin,
  getCurrentOwner
} from "./lib/permissions.js";
import { runMigrationIfNeeded, getClientIp } from "./lib/migration.js";
import {
  prepareExportData,
  generateCsvWithBom,
  getExportColumnLabels,
  getUniqueOwners as getUniqueOwnersFromItems,
  MODEL_STATUSES,
  formatDate
} from "./lib/calendar-export.js";
import {
  loadDb,
  saveDb,
  getAllItems,
  getAllTasks,
  findItemById,
  createItem,
  createTask,
  updateItem,
  addItemLog,
  updateTaskStatus,
  addTaskLog,
  getUniqueOwners,
  getUniqueTensions,
  TASK_STATUSES
} from "./lib/data-access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "model-rigging-calibration.json");
const port = Number(process.env.PORT || 3038);
const seed = {
  "items": [
    {
      "code": "MR-001",
      "shipType": "福船",
      "scale": "1:48",
      "mastCount": 3,
      "riggingMaterial": "蜡线",
      "owner": "周宁",
      "dueDate": "2026-06-28",
      "status": "校准中",
      "tasks": [
        {
          "id": "T-1",
          "position": "前桅侧支索",
          "tension": "偏松",
          "status": "调整中",
          "logs": [
            {
              "at": "2026-06-12",
              "note": "已缩短2mm"
            }
          ]
        }
      ],
      "logs": []
    }
  ]
};
const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
const stages = ["待检查","校准中","待复核","已交付"];
const statLabels = ["待检查","校准中","待复核","已交付"];
const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];

async function ensureDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
}

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

function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
  return true;
}

function newId() { return "MR-" + Date.now(); }

function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}

function filterByDateRange(items, start, end) {
  return items.filter(item => {
    if (!item.dueDate) return false;
    const d = new Date(item.dueDate);
    if (start && d < new Date(start)) return false;
    if (end && d > new Date(end + "T23:59:59")) return false;
    return true;
  });
}

function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}

function getItemWithTimeline(db, id) {
  const item = db.items.find(x => x.id === id || x.code === id);
  if (!item) return null;
  const timeline = [];
  const timelineTypes = new Set();
  if (item.logs && item.logs.length > 0) {
    for (const log of item.logs) {
      const type = log.step || "记录";
      timelineTypes.add(type);
      timeline.push({
        at: log.at,
        type: type,
        note: log.note || "",
        source: "item"
      });
    }
  }
  if (item.tasks && item.tasks.length > 0) {
    for (const task of item.tasks) {
      if (task.logs && task.logs.length > 0) {
        for (const log of task.logs) {
          timelineTypes.add("任务");
          timeline.push({
            at: log.at,
            type: "任务",
            note: log.note || "",
            source: "task",
            taskId: task.id,
            taskPosition: task.position
          });
        }
      }
    }
  }
  timeline.sort((a, b) => new Date(b.at) - new Date(a.at));
  return {
    ...item,
    timeline: timeline,
    timelineTypes: [...timelineTypes]
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function serveStatic(res, filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return false;
    }
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch (err) {
    return false;
  }
}

function loginPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 - 古船模型帆索校准</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .login-card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:36px 32px; width:100%; max-width:400px; box-shadow:0 8px 32px rgba(0,0,0,.08); }
    .login-header { text-align:center; margin-bottom:28px; }
    .login-icon { font-size:56px; margin-bottom:8px; }
    h1 { margin:0; font-size:22px; } .subtitle { color:var(--muted); font-size:13px; margin-top:6px; }
    label { display:block; margin:16px 0 6px; color:var(--muted); font-size:13px; font-weight:600; }
    input { width:100%; border:1px solid var(--line); border-radius:6px; padding:10px 12px; font:inherit; background:#fff; transition:border-color .15s; }
    input:focus { outline:none; border-color:var(--accent); }
    button { width:100%; border:0; border-radius:6px; background:var(--accent); color:#fff; padding:11px; font-weight:700; cursor:pointer; margin-top:24px; font-size:15px; transition:opacity .15s; }
    button:hover { opacity:.9; } button:disabled { opacity:.5; cursor:not-allowed; }
    .error-msg { background:#fdf0ed; color:var(--warn); border:1px solid #f1c9bf; border-radius:6px; padding:10px 12px; font-size:13px; margin-top:16px; display:none; }
    .default-accounts { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); }
    .default-accounts h3 { margin:0 0 10px; font-size:13px; color:var(--muted); font-weight:600; }
    .account-list { font-size:12px; color:var(--muted); line-height:1.8; }
    .account-item { display:flex; justify-content:space-between; padding:4px 0; }
    .account-item code { background:var(--bg); padding:1px 6px; border-radius:3px; font-family:monospace; color:var(--ink); }
    .loading { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:spin .8s linear infinite; vertical-align:middle; margin-right:6px; }
    @keyframes spin { to { transform:rotate(360deg); } }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="login-header">
      <div class="login-icon">⛵</div>
      <h1>古船模型帆索校准系统</h1>
      <div class="subtitle">多用户协作与操作审计</div>
    </div>
    <form id="loginForm">
      <label>用户名</label>
      <input type="text" id="username" name="username" autocomplete="username" placeholder="请输入用户名" required>
      <label>密码</label>
      <input type="password" id="password" name="password" autocomplete="current-password" placeholder="请输入密码" required>
      <button type="submit" id="loginBtn">登 录</button>
      <div class="error-msg" id="errorMsg"></div>
    </form>
    <div class="default-accounts">
      <h3>默认账号（首次使用）</h3>
      <div class="account-list">
        <div class="account-item"><span>管理员：</span><code>admin / admin123</code></div>
        <div class="account-item"><span>周宁：</span><code>zhouning / zhou123</code></div>
        <div class="account-item"><span>赵六：</span><code>zhaoliu / zhao123</code></div>
        <div class="account-item"><span>张三：</span><code>zhangsan / zhang123</code></div>
        <div class="account-item"><span>李四：</span><code>lisi / li123</code></div>
      </div>
    </div>
  </div>
  <script>
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('errorMsg');
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      if (!username || !password) return;
      
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>登录中...';
      errorMsg.style.display = 'none';
      
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '登录失败');
        
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        
        window.location.href = '/';
      } catch (err) {
        const msgMap = {
          user_not_found: '用户名不存在',
          wrong_password: '密码错误',
          username_and_password_required: '请输入用户名和密码'
        };
        errorMsg.textContent = msgMap[err.message] || err.message || '登录失败';
        errorMsg.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '登 录';
      }
    };
  </script>
</body>
</html>`;
}

function auditPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>审计日志 - 古船模型帆索校准</title>
  <link rel="stylesheet" href="/public/dashboard.css">
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --calendar-bg:#fafbf9; }
    header { padding:18px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    main { padding:22px 28px; max-width:1400px; margin:0 auto; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:20px; }
    .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .stat span { display:block; font-size:12px; color:var(--muted); margin-bottom:4px; }
    .stat strong { font-size:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center; }
    .toolbar select, .toolbar input { padding:7px 10px; border:1px solid var(--line); border-radius:6px; font:inherit; }
    .toolbar input[type=date] { min-width:140px; }
    .toolbar .ghost { background:transparent; border:1px solid var(--line); color:var(--muted); }
    .log-table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    .log-table th { background:var(--calendar-bg); padding:10px 12px; text-align:left; font-size:12px; color:var(--muted); font-weight:600; border-bottom:2px solid var(--line); }
    .log-table td { padding:10px 12px; border-bottom:1px solid var(--line); font-size:13px; vertical-align:top; }
    .log-table tr:last-child td { border-bottom:none; }
    .log-table tr:hover td { background:var(--calendar-bg); }
    .action-badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; }
    .action-model { background:#e6ebe2; color:var(--accent); }
    .action-task { background:#ece9f2; color:#6b5b95; }
    .action-backup { background:#f7f0db; color:#8b6914; }
    .action-auth { background:#e6eef7; color:#2d5a8e; }
    .action-calibration { background:#f5e6e2; color:var(--warn); }
    .meta { color:var(--muted); font-size:12px; }
    .actor-info { font-size:12px; }
    .actor-name { font-weight:600; }
    .actor-role { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; margin-left:4px; }
    .role-admin { background:#fdf0ed; color:var(--warn); }
    .role-user { background:var(--calendar-bg); color:var(--muted); }
    .target-info { font-size:12px; }
    .target-type { color:var(--muted); margin-right:4px; }
    .target-name { font-weight:500; }
    .detail-box { background:var(--calendar-bg); padding:6px 8px; border-radius:4px; font-size:11px; color:var(--muted); font-family:monospace; max-height:80px; overflow:auto; margin-top:4px; }
    .empty { text-align:center; padding:60px 20px; color:var(--muted); }
    .empty-icon { font-size:48px; margin-bottom:12px; opacity:.5; }
    .pagination { display:flex; justify-content:space-between; align-items:center; margin-top:16px; font-size:13px; color:var(--muted); }
    .pagination button { padding:6px 12px; border-radius:6px; }
    .user-badge { display:inline-flex; align-items:center; gap:6px; background:var(--calendar-bg); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; }
    .logout-btn { background:transparent; border:1px solid var(--line); color:var(--muted); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px; }
    .logout-btn:hover { border-color:var(--warn); color:var(--warn); }
    .view-tabs { display:flex; gap:4px; background:var(--bg); padding:4px; border-radius:8px; }
    .view-tabs button { background:transparent; color:var(--muted); padding:6px 14px; border-radius:6px; font-weight:600; border:none; cursor:pointer; }
    .view-tabs button.active { background:var(--panel); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.08); }
    .loading { text-align:center; padding:40px; color:var(--muted); }
    .loading-spinner { display:inline-block; width:24px; height:24px; border:3px solid var(--line); border-top-color:var(--accent); border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      <div><h1 style="margin:0; font-size:22px;">⛵ 审计日志</h1><div class="meta">操作审计记录与追溯</div></div>
      <div class="view-tabs">
        <button id="tabMain">返回系统</button>
        <button id="tabAudit" class="active">审计日志</button>
      </div>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <div class="user-badge" id="userBadge"></div>
      <button class="logout-btn" id="logoutBtn">退出登录</button>
    </div>
  </header>
  <main>
    <div class="stats" id="statsCards"></div>
    
    <div class="toolbar">
      <select id="actionFilter">
        <option value="">全部操作类型</option>
      </select>
      <select id="userFilter">
        <option value="">全部用户</option>
      </select>
      <input type="date" id="startDate" placeholder="开始日期">
      <input type="date" id="endDate" placeholder="结束日期">
      <input type="text" id="keywordSearch" placeholder="搜索关键词...">
      <button id="searchBtn">🔍 搜索</button>
      <button class="ghost" id="resetBtn">重置</button>
    </div>
    
    <div id="logContainer">
      <div class="loading"><div class="loading-spinner"></div><p class="meta" style="margin-top:10px;">加载审计日志中...</p></div>
    </div>
    
    <div class="pagination" id="pagination" style="display:none;">
      <div id="pageInfo"></div>
      <div style="display:flex; gap:8px;">
        <button class="ghost" id="prevPageBtn" disabled>上一页</button>
        <button id="nextPageBtn">下一页</button>
      </div>
    </div>
  </main>
  <script>
    const authToken = localStorage.getItem('auth_token');
    let authUser = null;
    try { authUser = JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch(e) {}
    
    if (!authToken) { window.location.href = '/login'; }
    
    let currentLogs = [];
    let currentOffset = 0;
    const pageSize = 50;
    
    function getActionClass(action) {
      if (action.startsWith('model.')) return 'action-model';
      if (action.startsWith('task.')) return 'action-task';
      if (action.startsWith('backup.')) return 'action-backup';
      if (action.startsWith('auth.') || action.startsWith('user.')) return 'action-auth';
      if (action.startsWith('calibration.')) return 'action-calibration';
      return '';
    }
    
    function formatAction(action) {
      const map = {
        'model.create': '新增模型',
        'model.update': '更新模型',
        'model.status_change': '模型状态变更',
        'model.note_add': '模型追加备注',
        'model.owner_change': '模型负责人变更',
        'task.create': '新增帆索任务',
        'task.status_change': '任务状态变更',
        'task.note_add': '任务追加备注',
        'backup.create': '创建备份',
        'backup.restore': '恢复备份',
        'backup.download': '下载备份',
        'calibration.rule_create': '新增校准规则',
        'calibration.rule_update': '更新校准规则',
        'calibration.rule_delete': '删除校准规则',
        'auth.login': '用户登录',
        'auth.logout': '用户登出',
        'auth.password_change': '修改密码',
        'user.create': '创建用户',
        'user.update': '更新用户'
      };
      return map[action] || action;
    }
    
    function formatDateTime(str) {
      const d = new Date(str);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
    }
    
    function renderUserBadge() {
      if (!authUser) return;
      const roleLabel = authUser.role === 'admin' ? '管理员' : '用户';
      const roleClass = authUser.role === 'admin' ? 'role-admin' : 'role-user';
      document.getElementById('userBadge').innerHTML = 
        '👤 ' + authUser.displayName + ' <span class="actor-role ' + roleClass + '">' + roleLabel + '</span>';
    }
    
    async function loadStats() {
      try {
        const res = await fetch('/api/audit/stats', { headers: { 'Authorization': 'Bearer ' + authToken } });
        if (!res.ok) throw new Error('Failed');
        const stats = await res.json();
        document.getElementById('statsCards').innerHTML =
          '<div class="stat"><span>审计日志总数</span><strong>' + stats.total + '</strong></div>' +
          '<div class="stat"><span>最近24小时</span><strong style="color:var(--accent)">' + stats.last24h + '</strong></div>' +
          '<div class="stat"><span>最近7天</span><strong>' + stats.last7d + '</strong></div>' +
          '<div class="stat"><span>活跃用户数</span><strong>' + Object.keys(stats.users || {}).length + '</strong></div>';
      } catch(e) {}
    }
    
    async function loadFilters() {
      try {
        const res = await fetch('/api/audit/actions', { headers: { 'Authorization': 'Bearer ' + authToken } });
        if (!res.ok) throw new Error('Failed');
        const actions = await res.json();
        const actionSelect = document.getElementById('actionFilter');
        const sortedActions = Object.values(actions).sort();
        const uniqueActions = [...new Set(sortedActions.map(a => a.split('.')[0]))];
        for (const prefix of uniqueActions) {
          const actionsInGroup = sortedActions.filter(a => a.startsWith(prefix + '.'));
          const groupLabel = { model:'模型', task:'任务', backup:'备份', calibration:'校准', auth:'认证', user:'用户' }[prefix] || prefix;
          const optgroup = document.createElement('optgroup');
          optgroup.label = groupLabel;
          for (const action of actionsInGroup) {
            const opt = document.createElement('option');
            opt.value = action;
            opt.textContent = formatAction(action);
            optgroup.appendChild(opt);
          }
          actionSelect.appendChild(optgroup);
        }
      } catch(e) {}
      
      try {
        const res = await fetch('/api/auth/users', { headers: { 'Authorization': 'Bearer ' + authToken } });
        if (!res.ok) throw new Error('Failed');
        const users = await res.json();
        const userSelect = document.getElementById('userFilter');
        for (const u of users) {
          const opt = document.createElement('option');
          opt.value = u.username;
          opt.textContent = u.displayName + ' (' + u.username + ')';
          userSelect.appendChild(opt);
        }
      } catch(e) {}
    }
    
    async function loadLogs() {
      document.getElementById('logContainer').innerHTML = '<div class="loading"><div class="loading-spinner"></div><p class="meta" style="margin-top:10px;">加载审计日志中...</p></div>';
      
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(currentOffset));
      
      const actionFilter = document.getElementById('actionFilter').value;
      const userFilter = document.getElementById('userFilter').value;
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      const keyword = document.getElementById('keywordSearch').value;
      
      if (actionFilter) params.set('action', actionFilter);
      if (userFilter) params.set('username', userFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (keyword) params.set('keyword', keyword);
      
      try {
        const res = await fetch('/api/audit/logs?' + params.toString(), { headers: { 'Authorization': 'Bearer ' + authToken } });
        if (!res.ok) throw new Error('Failed');
        const result = await res.json();
        currentLogs = result.logs;
        renderLogs(result);
      } catch(e) {
        document.getElementById('logContainer').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>加载审计日志失败</p></div>';
      }
    }
    
    function renderLogs(result) {
      const container = document.getElementById('logContainer');
      const pagination = document.getElementById('pagination');
      
      if (result.filteredTotal === 0) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>暂无符合条件的审计日志</p></div>';
        pagination.style.display = 'none';
        return;
      }
      
      const rows = currentLogs.map(log => {
        const roleClass = log.actor?.role === 'admin' ? 'role-admin' : 'role-user';
        const roleLabel = log.actor?.role === 'admin' ? '管理员' : '用户';
        const detailStr = log.detail && Object.keys(log.detail).length > 0 
          ? '<div class="detail-box">' + JSON.stringify(log.detail) + '</div>' 
          : '';
        
        return '<tr>' +
          '<td>' + formatDateTime(log.timestamp) + '</td>' +
          '<td><span class="action-badge ' + getActionClass(log.action) + '">' + formatAction(log.action) + '</span></td>' +
          '<td class="actor-info">' +
            (log.actor 
              ? '<span class="actor-name">' + log.actor.displayName + '</span>' +
                '<span class="actor-role ' + roleClass + '">' + roleLabel + '</span>' +
                '<div class="meta">@' + log.actor.username + '</div>'
              : '<span class="meta">系统</span>') +
          '</td>' +
          '<td class="target-info">' +
            (log.target?.id || log.target?.name
              ? '<span class="target-type">[' + (log.target.type || '-') + ']</span>' +
                '<span class="target-name">' + (log.target.name || log.target.id) + '</span>'
              : '<span class="meta">-</span>') +
            detailStr +
          '</td>' +
          '<td class="meta">' + (log.ip || '-') + '</td>' +
        '</tr>';
      }).join('');
      
      container.innerHTML = 
        '<table class="log-table">' +
          '<thead><tr>' +
            '<th style="width:160px;">时间</th>' +
            '<th style="width:130px;">操作类型</th>' +
            '<th style="width:160px;">操作人</th>' +
            '<th>操作对象 / 详情</th>' +
            '<th style="width:130px;">IP地址</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>';
      
      pagination.style.display = 'flex';
      const totalPages = Math.ceil(result.filteredTotal / pageSize);
      const currentPage = Math.floor(currentOffset / pageSize) + 1;
      document.getElementById('pageInfo').textContent = 
        '第 ' + currentPage + ' / ' + totalPages + ' 页，共 ' + result.filteredTotal + ' 条记录';
      document.getElementById('prevPageBtn').disabled = currentPage <= 1;
      document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
    }
    
    document.getElementById('tabMain').onclick = function() { window.location.href = '/'; };
    document.getElementById('logoutBtn').onclick = async function() {
      try {
        await fetch('/api/auth/logout', { 
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
      } catch(e) {}
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    };
    document.getElementById('searchBtn').onclick = function() { currentOffset = 0; loadLogs(); };
    document.getElementById('resetBtn').onclick = function() {
      document.getElementById('actionFilter').value = '';
      document.getElementById('userFilter').value = '';
      document.getElementById('startDate').value = '';
      document.getElementById('endDate').value = '';
      document.getElementById('keywordSearch').value = '';
      currentOffset = 0;
      loadLogs();
    };
    document.getElementById('prevPageBtn').onclick = function() {
      if (currentOffset >= pageSize) {
        currentOffset -= pageSize;
        loadLogs();
      }
    };
    document.getElementById('nextPageBtn').onclick = function() {
      currentOffset += pageSize;
      loadLogs();
    };
    
    renderUserBadge();
    loadStats();
    loadFilters();
    loadLogs();
  </script>
</body>
</html>`;
}

function mainPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古船模型帆索校准系统</title>
  <link rel="stylesheet" href="/public/dashboard.css">
  <link rel="stylesheet" href="/public/workspace.css">
  <link rel="stylesheet" href="/public/kanban.css">
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    header { padding:18px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    .header-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    h1 { margin:0; font-size:22px; }
    main { padding:22px 28px; max-width:1400px; margin:0 auto; }
    .user-badge { display:inline-flex; align-items:center; gap:6px; background:#fafbf9; border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; }
    .logout-btn { background:transparent; border:1px solid var(--line); color:var(--muted); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px; }
    .logout-btn:hover { border-color:var(--warn); color:var(--warn); }
    .view-tabs { display:flex; gap:4px; background:var(--bg); padding:4px; border-radius:8px; }
    .view-tabs button { background:transparent; color:var(--muted); padding:6px 14px; border-radius:6px; font-weight:600; border:none; cursor:pointer; font-size:13px; }
    .view-tabs button.active { background:var(--panel); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.08); }
    .role-badge { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; margin-left:4px; }
    .role-admin { background:#fdf0ed; color:var(--warn); }
    .role-user { background:#fafbf9; color:var(--muted); }
    .admin-only { display:none; }
    .view-section { display:none; }
    .view-section.active { display:block; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <div>
        <h1>⛵ 古船模型帆索校准系统</h1>
        <div class="meta">多用户协作 · 操作审计 · 权限隔离</div>
      </div>
      <div class="view-tabs">
        <button id="tabList" class="active">📦 模型列表</button>
        <button id="tabKanban">📋 任务看板</button>
        <button id="tabWorkspace">👥 工作区</button>
        <button id="tabRisk">📊 风险仪表盘</button>
        <button id="tabBackup">💾 备份管理</button>
        <button id="tabAudit" class="admin-only">📝 审计日志</button>
      </div>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <div class="user-badge" id="userBadge"></div>
      <button class="logout-btn" id="logoutBtn">退出登录</button>
    </div>
  </header>
  <main>
    <div id="viewList" class="view-section active"></div>
    <div id="viewKanban" class="view-section"></div>
    <div id="viewWorkspace" class="view-section"></div>
    <div id="viewRisk" class="view-section"></div>
    <div id="viewBackup" class="view-section"></div>
  </main>
  <script src="/public/workspace.js"></script>
  <script src="/public/kanban.js"></script>
  <script src="/public/dashboard.js"></script>
  <script src="/public/backup.js"></script>
  <script>
    const authToken = localStorage.getItem('auth_token');
    let authUser = null;
    try { authUser = JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch(e) {}
    
    if (!authToken) { window.location.href = '/login'; }
    
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
      if (authToken && !options.headers) options.headers = {};
      if (authToken && options.headers instanceof Headers) {
        options.headers.set('Authorization', 'Bearer ' + authToken);
      } else if (authToken && options.headers && typeof options.headers === 'object') {
        options.headers['Authorization'] = 'Bearer ' + authToken;
      } else if (authToken) {
        options.headers = { 'Authorization': 'Bearer ' + authToken };
      }
      return originalFetch.apply(this, arguments);
    };
    
    let currentView = 'list';
    
    function renderUserBadge() {
      if (!authUser) return;
      const roleLabel = authUser.role === 'admin' ? '管理员' : '用户';
      const roleClass = authUser.role === 'admin' ? 'role-admin' : 'role-user';
      document.getElementById('userBadge').innerHTML = 
        '👤 ' + authUser.displayName + ' <span class="role-badge ' + roleClass + '">' + roleLabel + '</span>';
      if (authUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
      }
    }
    
    function switchView(view) {
      currentView = view;
      document.querySelectorAll('.view-tabs button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
      const tabMap = { list: 'tabList', kanban: 'tabKanban', workspace: 'tabWorkspace', risk: 'tabRisk', backup: 'tabBackup', audit: 'tabAudit' };
      const viewMap = { list: 'viewList', kanban: 'viewKanban', workspace: 'viewWorkspace', risk: 'viewRisk', backup: 'viewBackup' };
      if (tabMap[view]) document.getElementById(tabMap[view]).classList.add('active');
      if (viewMap[view]) document.getElementById(viewMap[view]).classList.add('active');
      
      if (view === 'list') { if (typeof load === 'function') load(); }
      if (view === 'kanban') { if (typeof kanbanLoad === 'function') kanbanLoad(); }
      if (view === 'workspace') { 
        if (typeof wsLoadOwnerList === 'function') wsLoadOwnerList();
        const ownerFromPath = typeof wsGetOwnerFromPath === 'function' ? wsGetOwnerFromPath() : null;
        if (ownerFromPath && typeof wsShowWorkspace === 'function') wsShowWorkspace(ownerFromPath);
      }
      if (view === 'risk') { if (typeof dashboardLoad === 'function') dashboardLoad(); }
      if (view === 'backup') { if (typeof backupLoad === 'function') backupLoad(); }
      if (view === 'audit') { window.location.href = '/audit'; }
    }
    
    document.getElementById('tabList').onclick = () => switchView('list');
    document.getElementById('tabKanban').onclick = () => switchView('kanban');
    document.getElementById('tabWorkspace').onclick = () => switchView('workspace');
    document.getElementById('tabRisk').onclick = () => switchView('risk');
    document.getElementById('tabBackup').onclick = () => switchView('backup');
    document.getElementById('tabAudit').onclick = () => switchView('audit');
    
    document.getElementById('logoutBtn').onclick = async function() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch(e) {}
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    };
    
    renderUserBadge();
    
    window._authUser = authUser;
    window._authToken = authToken;
    
    document.getElementById('viewList').innerHTML = \`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <h2 style="margin:0;">📦 模型列表</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button onclick="location.href='/import'">📥 批量导入</button>
          <button id="addModelBtn" class="secondary">＋ 新增模型</button>
          <button id="exportBtn" class="secondary">📤 导出CSV</button>
        </div>
      </div>
      <div id="toolbar" style="margin-bottom:16px;"></div>
      <div id="statsBar" style="margin-bottom:16px;"></div>
      <div id="modelsGrid"></div>
      <div id="detailView" style="display:none;"></div>
    \`;
    
    document.getElementById('viewKanban').innerHTML = \`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <h2 style="margin:0;">📋 帆索任务看板</h2>
      </div>
      <div id="kanbanFilters" style="margin-bottom:16px;"></div>
      <div id="kanbanBoard"></div>
    \`;
    
    document.getElementById('viewWorkspace').innerHTML = \`
      <div style="margin-bottom:16px;">
        <h2 style="margin:0;">👥 负责人工作区</h2>
        <div class="meta" style="margin-top:4px;">点击负责人卡片进入对应工作区</div>
      </div>
      <div class="ws-section-header" style="margin-bottom:16px;">
        <h3 style="margin:0;">所有负责人</h3>
      </div>
      <div id="wsOwnerList"></div>
      <div id="wsWorkspace" style="display:none;"></div>
    \`;
    
    document.getElementById('viewRisk').innerHTML = \`
      <section id="summarySection">
        <div class="stats" id="riskStats"></div>
      </section>
      <div class="dashboard-grid">
        <section class="panel high-risk-section">
          <div class="panel-header">
            <h2>🚨 高风险模型列表</h2>
            <div class="panel-actions">
              <select id="riskLevelFilter">
                <option value="all">全部风险</option>
                <option value="high">仅高危</option>
                <option value="medium">仅中危</option>
              </select>
            </div>
          </div>
          <div id="highRiskList" class="risk-list"></div>
        </section>
        <section class="panel owner-section">
          <div class="panel-header">
            <h2>👤 负责人风险分布</h2>
          </div>
          <div id="ownerDistribution" class="owner-list"></div>
        </section>
        <section class="panel pressure-section">
          <div class="panel-header">
            <h2>📅 未来7天交付压力</h2>
          </div>
          <div id="deliveryPressure" class="pressure-chart"></div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-header">
          <h2>📋 风险评估规则说明</h2>
        </div>
        <div class="rules-grid">
          <div class="rule-card high">
            <h3>高危风险</h3>
            <ul><li>已逾期未交付</li><li>7天内交付且有未完成任务</li><li>风险评分 ≥ 70</li></ul>
          </div>
          <div class="rule-card medium">
            <h3>中危风险</h3>
            <ul><li>14天内交付且超50%任务未完成</li><li>超过7天无更新记录</li><li>风险评分 40-69</li></ul>
          </div>
          <div class="rule-card low">
            <h3>低危风险</h3>
            <ul><li>进度正常，任务有序推进</li><li>风险评分 &lt; 40</li></ul>
          </div>
          <div class="rule-card none">
            <h3>无风险 / 未计划</h3>
            <ul><li>已交付的模型不计风险</li><li>无交付日期单独归类</li></ul>
          </div>
        </div>
      </section>
    \`;
    
    document.getElementById('viewBackup').innerHTML = \`
      <div style="margin-bottom:16px;">
        <h2 style="margin:0;">💾 备份管理</h2>
        <div class="meta" style="margin-top:4px;">创建、下载、恢复数据备份</div>
      </div>
      <div id="statsSummary" style="margin-bottom:16px;"></div>
      <div style="margin-bottom:16px;">
        <button id="createBackupBtn">＋ 创建备份</button>
      </div>
      <div id="backupList"></div>
      <div id="diffModal" style="display:none;"></div>
      <div id="restoreModal" style="display:none;"></div>
    \`;
    
    if (typeof wsInitOwnerList === 'function') wsInitOwnerList();
    switchView('list');
  </script>
</body>
</html>`;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleItemsApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const ip = getClientIp(req);

  if (!pathname.startsWith("/api/items")) return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  if (req.method === "GET" && pathname === "/api/items") {
    const start = url.searchParams.get("start") || "";
    const end = url.searchParams.get("end") || "";
    const ownerFilter = url.searchParams.get("owner") || "";
    const statusFilter = url.searchParams.get("status") || "";
    const search = url.searchParams.get("q") || "";

    let items = getAllItems(db);
    items = filterItemsByOwner(req.auth, items);

    if (start || end) items = filterByDateRange(items, start, end);
    if (ownerFilter) items = items.filter(i => (i.owner || "") === ownerFilter);
    if (statusFilter) items = items.filter(i => i.status === statusFilter);
    if (search) {
      const kw = search.toLowerCase();
      items = items.filter(i =>
        (i.code || "").toLowerCase().includes(kw) ||
        (i.shipType || "").toLowerCase().includes(kw) ||
        (i.owner || "").toLowerCase().includes(kw)
      );
    }

    const allOwners = getUniqueOwners(db);
    const filteredOwners = filterOwnersForSelection(req.auth, allOwners);
    const stats = computeStats(items);

    return send(res, 200, {
      items: items.map(summarize),
      stats,
      allOwners: filteredOwners,
      statuses: MODEL_STATUSES,
      fields,
      extraFields,
      currentUser: {
        username: req.auth.user.username,
        displayName: req.auth.user.displayName,
        role: req.auth.user.role,
        owner: req.auth.user.owner,
        isAdmin: req.auth.isAdmin
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/items") {
    try {
      const body = await parseBody(req);
      if (!canCreateItem(req.auth, body)) {
        return sendError(res, 403, "forbidden_owner_mismatch");
      }
      if (!req.auth.isAdmin && body.owner && body.owner !== req.auth.user.owner) {
        return sendError(res, 403, "forbidden_owner_mismatch");
      }
      const item = await createItem(db, body);

      await writeAuditLog({
        action: AUDIT_ACTIONS.MODEL_CREATE,
        auth: req.auth,
        targetType: "model",
        targetId: item.id,
        targetName: item.code || item.id,
        detail: { code: item.code, shipType: item.shipType, owner: item.owner, dueDate: item.dueDate },
        ip
      });

      return send(res, 201, item);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  const itemIdMatch = pathname.match(/^\/api\/items\/([^/]+)$/);

  if (itemIdMatch && req.method === "GET") {
    const id = decodeURIComponent(itemIdMatch[1]);
    const item = findItemById(db, id);
    if (!item) return sendError(res, 404, "item_not_found");
    if (!canViewItem(req.auth, item)) return sendError(res, 403, "forbidden");
    const detail = getItemWithTimeline(db, id);
    return send(res, 200, detail);
  }

  if (itemIdMatch && req.method === "PATCH") {
    try {
      const id = decodeURIComponent(itemIdMatch[1]);
      const body = await parseBody(req);
      const item = findItemById(db, id);
      if (!item) return sendError(res, 404, "item_not_found");
      if (!canEditItem(req.auth, item)) return sendError(res, 403, "forbidden");

      const oldStatus = item.status;
      const oldOwner = item.owner;

      if (body.owner !== undefined && body.owner !== oldOwner) {
        if (!canChangeItemOwner(req.auth, item, body.owner)) {
          return sendError(res, 403, "forbidden_owner_change");
        }
      }

      const updated = await updateItem(db, id, body);

      if (body.status !== undefined && body.status !== oldStatus) {
        await writeAuditLog({
          action: AUDIT_ACTIONS.MODEL_STATUS_CHANGE,
          auth: req.auth,
          targetType: "model",
          targetId: updated.id,
          targetName: updated.code || updated.id,
          detail: { oldStatus, newStatus: body.status },
          ip
        });
      }

      if (body.owner !== undefined && body.owner !== oldOwner) {
        await writeAuditLog({
          action: AUDIT_ACTIONS.MODEL_OWNER_CHANGE,
          auth: req.auth,
          targetType: "model",
          targetId: updated.id,
          targetName: updated.code || updated.id,
          detail: { oldOwner, newOwner: body.owner },
          ip
        });
      }

      const otherUpdates = { ...body };
      delete otherUpdates.status;
      delete otherUpdates.owner;
      if (Object.keys(otherUpdates).length > 0) {
        await writeAuditLog({
          action: AUDIT_ACTIONS.MODEL_UPDATE,
          auth: req.auth,
          targetType: "model",
          targetId: updated.id,
          targetName: updated.code || updated.id,
          detail: otherUpdates,
          ip
        });
      }

      return send(res, 200, updated);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  const itemLogsMatch = pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
  if (itemLogsMatch && req.method === "POST") {
    try {
      const id = decodeURIComponent(itemLogsMatch[1]);
      const body = await parseBody(req);
      const item = findItemById(db, id);
      if (!item) return sendError(res, 404, "item_not_found");
      if (!canEditItem(req.auth, item)) return sendError(res, 403, "forbidden");

      const updated = await addItemLog(db, id, body.step || "备注", body.note || "");

      await writeAuditLog({
        action: AUDIT_ACTIONS.MODEL_NOTE_ADD,
        auth: req.auth,
        targetType: "model",
        targetId: updated.id,
        targetName: updated.code || updated.id,
        detail: { step: body.step || "备注", note: body.note || "" },
        ip
      });

      return send(res, 201, updated);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  const itemTasksMatch = pathname.match(/^\/api\/items\/([^/]+)\/tasks$/);
  if (itemTasksMatch && req.method === "POST") {
    try {
      const id = decodeURIComponent(itemTasksMatch[1]);
      const body = await parseBody(req);
      const item = findItemById(db, id);
      if (!item) return sendError(res, 404, "item_not_found");
      if (!canEditItem(req.auth, item)) return sendError(res, 403, "forbidden");

      const result = await createTask(db, id, body);

      await writeAuditLog({
        action: AUDIT_ACTIONS.TASK_CREATE,
        auth: req.auth,
        targetType: "task",
        targetId: result.task.id,
        targetName: body.position || result.task.id,
        detail: { modelId: id, modelCode: item.code, position: body.position, tension: body.tension, note: body.note },
        ip
      });

      return send(res, 201, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  return null;
}

async function handleExportApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname !== "/api/export/csv" || req.method !== "GET") return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  let items = getAllItems(db);
  items = filterItemsByOwner(req.auth, items);

  const labels = getExportColumnLabels();
  const rows = prepareExportData(items);
  const csv = generateCsvWithBom(labels, rows);
  const filename = `古船模型校准-${formatDate(new Date().toISOString())}.csv`;

  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  res.end(csv);
  return true;
}

async function handleImportApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const ip = getClientIp(req);

  if (!pathname.startsWith("/api/import")) return null;
  if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");

  if (pathname === "/api/import/preview" && req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.startsWith("multipart/form-data")) {
        return sendError(res, 400, "multipart_required");
      }
      const boundary = extractBoundary(contentType);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const parts = parseMultipart(buf, boundary);
      const filePart = parts.find(p => p.name === "file");
      if (!filePart || !filePart.content) {
        return sendError(res, 400, "file_required");
      }
      const result = await parseBuffer(filePart.content, filePart.filename || "");
      return send(res, 200, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  if (pathname === "/api/import/commit" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const validRows = (body.rows || []).filter(r => r.valid);
      const allowedRows = validRows.filter(r => {
        const itemData = { owner: r.normalized.owner };
        return canCreateItem(req.auth, itemData);
      });
      if (allowedRows.length < validRows.length && !req.auth.isAdmin) {
        return sendError(res, 403, "forbidden_some_rows_owner_mismatch");
      }
      const result = await commitImport(db, saveDb, allowedRows);

      for (const created of result.createdItems || []) {
        await writeAuditLog({
          action: AUDIT_ACTIONS.MODEL_CREATE,
          auth: req.auth,
          targetType: "model",
          targetId: created.id,
          targetName: created.code,
          detail: { source: "batch_import", code: created.code, taskCount: created.taskCount },
          ip
        });
      }

      return send(res, 200, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  return null;
}

async function handlePageRoute(req, res, pathname) {
  if (pathname === "/login") {
    html(res, loginPageHtml());
    return true;
  }
  if (pathname === "/audit") {
    if (!req.auth.isAuthenticated) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return true;
    }
    if (!req.auth.isAdmin) {
      return sendError(res, 403, "forbidden_admin_required");
    }
    html(res, auditPageHtml());
    return true;
  }
  if (pathname === "/import") {
    if (!req.auth.isAuthenticated) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return true;
    }
    html(res, importPage());
    return true;
  }
  if (pathname === "/" || pathname === "/index.html" || pathname.startsWith("/workspace/")) {
    if (!req.auth.isAuthenticated) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return true;
    }
    html(res, mainPageHtml());
    return true;
  }
  return false;
}

async function main() {
  await ensureDb();
  await runMigrationIfNeeded();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      await authMiddleware(req, res);

      if (pathname.startsWith("/public/")) {
        const filePath = join(__dirname, pathname);
        if (await serveStatic(res, filePath)) return;
      }

      if (await handlePageRoute(req, res, pathname)) return;

      if (pathname.startsWith("/api/")) {
        let db = await loadDb();

        if (pathname.startsWith("/api/auth")) {
          const result = await handleAuthApi(req, res);
          if (result !== null) return;
        }

        if (pathname.startsWith("/api/audit")) {
          const result = await handleAuditApi(req, res);
          if (result !== null) return;
        }

        if (pathname.startsWith("/api/items")) {
          const result = await handleItemsApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/tasks")) {
          const result = await handleTasksApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/risk")) {
          const result = await handleRiskApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/calibration")) {
          const result = await handleCalibrationApi(req, res);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/owners")) {
          const result = await handleOwnerApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/backups")) {
          const result = await handleBackupApi(req, res);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/export")) {
          const result = await handleExportApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }

        if (pathname.startsWith("/api/import")) {
          const result = await handleImportApi(req, res, db);
          if (result !== null && result !== undefined) return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (err) {
      console.error("Server error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal_server_error", message: err.message }));
    }
  });

  server.listen(port, () => {
    console.log(`⛵ 古船模型帆索校准系统已启动: http://localhost:${port}`);
    console.log(`   默认登录: admin / admin123`);
  });
}

main().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
