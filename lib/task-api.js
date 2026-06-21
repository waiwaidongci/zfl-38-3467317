import {
  getAllTasks,
  filterTasks,
  updateTaskStatus,
  addTaskLog,
  getUniqueOwners,
  getUniqueTensions,
  getAllItems,
  TASK_STATUSES
} from "./data-access.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function handleTasksApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/tasks") {
    const filters = {
      modelId: url.searchParams.get("modelId") || "",
      owner: url.searchParams.get("owner") || "",
      tension: url.searchParams.get("tension") || "",
      status: url.searchParams.get("status") || "",
      dueDateStart: url.searchParams.get("dueDateStart") || "",
      dueDateEnd: url.searchParams.get("dueDateEnd") || ""
    };
    const allTasks = getAllTasks(db);
    const filtered = filterTasks(allTasks, filters);
    return send(res, 200, filtered);
  }

  if (req.method === "GET" && pathname === "/api/tasks/filters") {
    const owners = getUniqueOwners(db);
    const tensions = getUniqueTensions(db);
    const models = getAllItems(db).map(item => ({
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
    const taskId = taskStatusMatch[1];
    const itemId = url.searchParams.get("itemId") || "";
    try {
      const body = await parseBody(req);
      const result = await updateTaskStatus(db, itemId, taskId, body.status);
      return send(res, 200, result);
    } catch (error) {
      const statusMap = {
        item_not_found: 404,
        task_not_found: 404,
        invalid_status: 400
      };
      const statusCode = statusMap[error.message] || 500;
      return send(res, statusCode, { error: error.message });
    }
  }

  const taskLogMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/logs$/);
  if (taskLogMatch && req.method === "POST") {
    const taskId = taskLogMatch[1];
    const itemId = url.searchParams.get("itemId") || "";
    try {
      const body = await parseBody(req);
      const task = await addTaskLog(db, itemId, taskId, body.note || "");
      return send(res, 201, task);
    } catch (error) {
      const statusMap = {
        item_not_found: 404,
        task_not_found: 404
      };
      const statusCode = statusMap[error.message] || 500;
      return send(res, statusCode, { error: error.message });
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
