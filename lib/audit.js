import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const auditLogPath = join(__dirname, "..", "data", "audit-logs.json");

const AUDIT_ACTIONS = {
  MODEL_CREATE: "model.create",
  MODEL_UPDATE: "model.update",
  MODEL_STATUS_CHANGE: "model.status_change",
  MODEL_NOTE_ADD: "model.note_add",
  MODEL_OWNER_CHANGE: "model.owner_change",
  TASK_CREATE: "task.create",
  TASK_STATUS_CHANGE: "task.status_change",
  TASK_NOTE_ADD: "task.note_add",
  BACKUP_CREATE: "backup.create",
  BACKUP_RESTORE: "backup.restore",
  BACKUP_DOWNLOAD: "backup.download",
  CALIBRATION_RULE_CREATE: "calibration.rule_create",
  CALIBRATION_RULE_UPDATE: "calibration.rule_update",
  CALIBRATION_RULE_DELETE: "calibration.rule_delete",
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_PASSWORD_CHANGE: "auth.password_change",
  USER_CREATE: "user.create",
  USER_UPDATE: "user.update"
};

function newAuditId() {
  return "AUD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function ensureAuditLogFile() {
  if (!existsSync(auditLogPath)) {
    await mkdir(dirname(auditLogPath), { recursive: true });
    await writeFile(auditLogPath, JSON.stringify({ logs: [] }, null, 2));
    return { logs: [] };
  }
  return JSON.parse(await readFile(auditLogPath, "utf8"));
}

async function loadAuditLogs() {
  return await ensureAuditLogFile();
}

async function saveAuditLogs(data) {
  await writeFile(auditLogPath, JSON.stringify(data, null, 2));
}

async function writeAuditLog({ action, auth, targetType, targetId, targetName, detail, ip }) {
  const data = await loadAuditLogs();
  const log = {
    id: newAuditId(),
    action,
    timestamp: new Date().toISOString(),
    actor: auth?.user ? {
      username: auth.user.username,
      displayName: auth.user.displayName,
      role: auth.user.role,
      owner: auth.user.owner || null
    } : null,
    target: {
      type: targetType || null,
      id: targetId || null,
      name: targetName || null
    },
    detail: detail || {},
    ip: ip || null
  };
  data.logs.unshift(log);
  if (data.logs.length > 10000) {
    data.logs = data.logs.slice(0, 10000);
  }
  await saveAuditLogs(data);
  return log;
}

function queryLogs(logs, filters = {}) {
  return logs.filter(log => {
    if (filters.action && log.action !== filters.action) return false;
    if (filters.username && log.actor?.username !== filters.username) return false;
    if (filters.role && log.actor?.role !== filters.role) return false;
    if (filters.targetType && log.target?.type !== filters.targetType) return false;
    if (filters.targetId && log.target?.id !== filters.targetId) return false;
    if (filters.startDate) {
      if (new Date(log.timestamp) < new Date(filters.startDate)) return false;
    }
    if (filters.endDate) {
      const endOfDay = new Date(filters.endDate + "T23:59:59.999Z");
      if (new Date(log.timestamp) > endOfDay) return false;
    }
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      const searchStr = JSON.stringify(log).toLowerCase();
      if (!searchStr.includes(kw)) return false;
    }
    return true;
  });
}

async function getAuditLogs(filters = {}, limit = 100, offset = 0) {
  const data = await loadAuditLogs();
  let filtered = queryLogs(data.logs, filters);
  if (offset > 0) filtered = filtered.slice(offset);
  if (limit > 0) filtered = filtered.slice(0, limit);
  return {
    total: data.logs.length,
    filteredTotal: queryLogs(data.logs, filters).length,
    logs: filtered
  };
}

async function getAuditStats() {
  const data = await loadAuditLogs();
  const logs = data.logs;
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const last24h = logs.filter(l => new Date(l.timestamp) >= oneDayAgo);
  const last7d = logs.filter(l => new Date(l.timestamp) >= sevenDaysAgo);

  const actions = {};
  for (const log of logs) {
    actions[log.action] = (actions[log.action] || 0) + 1;
  }

  const users = {};
  for (const log of logs) {
    if (log.actor?.username) {
      const key = log.actor.username;
      users[key] = (users[key] || 0) + 1;
    }
  }

  return {
    total: logs.length,
    last24h: last24h.length,
    last7d: last7d.length,
    actions,
    users
  };
}

async function handleAuditApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data, null, 2));
    return true;
  };
  const sendError = (status, error) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error }, null, 2));
    return true;
  };

  if (!pathname.startsWith("/api/audit")) return null;

  if (!req.auth.isAuthenticated) {
    return sendError(401, "unauthorized");
  }

  if (pathname === "/api/audit/logs" && req.method === "GET") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    try {
      const filters = {
        action: url.searchParams.get("action") || "",
        username: url.searchParams.get("username") || "",
        targetType: url.searchParams.get("targetType") || "",
        targetId: url.searchParams.get("targetId") || "",
        startDate: url.searchParams.get("startDate") || "",
        endDate: url.searchParams.get("endDate") || "",
        keyword: url.searchParams.get("keyword") || ""
      };
      const limit = parseInt(url.searchParams.get("limit")) || 100;
      const offset = parseInt(url.searchParams.get("offset")) || 0;
      const result = await getAuditLogs(filters, limit, offset);
      return send(200, result);
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  if (pathname === "/api/audit/stats" && req.method === "GET") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    try {
      const stats = await getAuditStats();
      return send(200, stats);
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  if (pathname === "/api/audit/actions" && req.method === "GET") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    return send(200, AUDIT_ACTIONS);
  }

  const logIdMatch = pathname.match(/^\/api\/audit\/logs\/([^/]+)$/);
  if (logIdMatch && req.method === "GET") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    try {
      const logId = logIdMatch[1];
      const data = await loadAuditLogs();
      const log = data.logs.find(l => l.id === logId);
      if (!log) return sendError(404, "log_not_found");
      return send(200, log);
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  return null;
}

export {
  AUDIT_ACTIONS,
  writeAuditLog,
  getAuditLogs,
  getAuditStats,
  handleAuditApi
};
