import { getOwnerList, getOwnerWorkspace } from "./owner-stats.js";
import { isAdmin, getCurrentOwner } from "./permissions.js";

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

async function handleOwnerApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/owners")) return null;

  if (req.method === "GET" && pathname === "/api/owners") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const list = getOwnerList(db);
    if (!isAdmin(req.auth)) {
      const currentOwner = getCurrentOwner(req.auth);
      if (!currentOwner) {
        return send(res, 200, []);
      }
      const filtered = list.filter(o => o.name === currentOwner);
      return send(res, 200, filtered);
    }
    return send(res, 200, list);
  }

  const ownerMatch = pathname.match(/^\/api\/owners\/(.+)$/);
  if (ownerMatch && req.method === "GET") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const ownerName = decodeURIComponent(ownerMatch[1]);
    if (!isAdmin(req.auth)) {
      const currentOwner = getCurrentOwner(req.auth);
      if (ownerName !== currentOwner) {
        return sendError(res, 403, "forbidden");
      }
    }
    const workspace = getOwnerWorkspace(db, ownerName);
    if (workspace.modelCount === 0 && !db.items.some(item => (item.owner || "") === ownerName)) {
      return send(res, 404, { error: "owner_not_found" });
    }
    return send(res, 200, workspace);
  }

  return null;
}

export { handleOwnerApi };
