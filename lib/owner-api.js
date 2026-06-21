import { getOwnerList, getOwnerWorkspace } from "./owner-stats.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function handleOwnerApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/owners")) return null;

  if (req.method === "GET" && pathname === "/api/owners") {
    const list = getOwnerList(db);
    return send(res, 200, list);
  }

  const ownerMatch = pathname.match(/^\/api\/owners\/(.+)$/);
  if (ownerMatch && req.method === "GET") {
    const ownerName = decodeURIComponent(ownerMatch[1]);
    const workspace = getOwnerWorkspace(db, ownerName);
    if (workspace.modelCount === 0 && !db.items.some(item => (item.owner || "") === ownerName)) {
      return send(res, 404, { error: "owner_not_found" });
    }
    return send(res, 200, workspace);
  }

  return null;
}

export { handleOwnerApi };
