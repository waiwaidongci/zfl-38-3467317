import {
  getAllTasks,
  filterTasks,
  updateTaskStatus,
  addTaskLog,
  getUniqueOwners,
  getUniqueTensions,
  getAllItems,
  findItemById,
  TASK_STATUSES
} from "./data-access.js";
import { writeAuditLog, AUDIT_ACTIONS } from "./audit.js";
import { getClientIp } from "./migration.js";
import { canEditItem, canViewItem, filterTasksByOwner, filterOwnersForSelection } from "./permissions.js";

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

async function handleTasksApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/tasks") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const filters = {
      modelId: url.searchParams.get("modelId") || "",
      owner: url.searchParams.get("owner") || "",
      tension: url.searchParams.get("tension") || "",
      status: url.searchParams.get("status") || "",
      dueDateStart: url.searchParams.get("dueDateStart") || "",
      dueDateEnd: url.searchParams.get("dueDateEnd") || ""
    };
    const allTasks = getAllTasks(db);
    const filtered = filterTasksByOwner(req.auth, filterTasks(allTasks, filters));
    return send(res, 200, filtered);
  }

  if (req.method === "GET" && pathname === "/api/tasks/filters") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const allOwners = getUniqueOwners(db);
    const owners = filterOwnersForSelection(req.auth, allOwners);
    const tensions = getUniqueTensions(db);
    const allItems = getAllItems(db);
    const viewableItems = allItems.filter(item => canViewItem(req.auth, item));
    const models = viewableItems.map(item => ({
      id: item.id,
      code: item.code,
      shipType: item.shipType,
      owner: item.owner
    }));
    return send(res, 200, {
      owners,
      tensions,
      models,
      statuses: TASK_STATUSES
    });
  }

  const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
  if (taskStatusMatch && req.method === "PATCH") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const taskId = taskStatusMatch[1];
    const itemId = url.searchParams.get("itemId") || "";
    try {
      const item = findItemById(db, itemId);
      if (!item) return sendError(res, 404, "item_not_found");
      if (!canEditItem(req.auth, item)) return sendError(res, 403, "forbidden");
      const body = await parseBody(req);
      const result = await updateTaskStatus(db, itemId, taskId, body.status);
      const oldStatus = result.task.logs && result.task.logs.length > 0
        ? result.task.logs[result.task.logs.length - 1].note.match(/「([^」]+)」变更为「([^」]+)」/)?.[1]
        : null;
      await writeAuditLog({
        action: AUDIT_ACTIONS.TASK_STATUS_CHANGE,
        auth: req.auth,
        targetType: "task",
        targetId: taskId,
        targetName: result.task.position,
        detail: {
          oldStatus: oldStatus,
          newStatus: body.status,
          modelId: itemId,
          taskId: taskId,
          taskPosition: result.task.position
        },
        ip: getClientIp(req)
      });
      return send(res, 200, result);
    } catch (error) {
      const statusMap = {
        item_not_found: 404,
        task_not_found: 404,
        invalid_status: 400
      };
      const statusCode = statusMap[error.message] || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  const taskLogMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/logs$/);
  if (taskLogMatch && req.method === "POST") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const taskId = taskLogMatch[1];
    const itemId = url.searchParams.get("itemId") || "";
    try {
      const item = findItemById(db, itemId);
      if (!item) return sendError(res, 404, "item_not_found");
      if (!canEditItem(req.auth, item)) return sendError(res, 403, "forbidden");
      const body = await parseBody(req);
      const task = await addTaskLog(db, itemId, taskId, body.note || "");
      await writeAuditLog({
        action: AUDIT_ACTIONS.TASK_NOTE_ADD,
        auth: req.auth,
        targetType: "task",
        targetId: taskId,
        targetName: task.position,
        detail: {
          note: body.note || "",
          modelId: itemId,
          taskId: taskId,
          taskPosition: task.position
        },
        ip: getClientIp(req)
      });
      return send(res, 201, task);
    } catch (error) {
      const statusMap = {
        item_not_found: 404,
        task_not_found: 404
      };
      const statusCode = statusMap[error.message] || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  return null;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export { handleTasksApi };
