import {
  calculateAllRisks,
  getRiskSummary,
  getHighRiskList,
  groupByOwner,
  getDeliveryPressure,
  RISK_LEVELS,
  RISK_LABELS,
  RISK_COLORS,
  calculateItemRisk
} from "./risk-service.js";
import { getAllItems } from "./data-access.js";
import { filterItemsByOwner, canViewItem } from "./permissions.js";

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

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleRiskApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/risk") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const items = filterItemsByOwner(req.auth, getAllItems(db));
    const itemsWithRisk = calculateAllRisks(items);
    const summary = getRiskSummary(itemsWithRisk);
    const highRiskList = getHighRiskList(itemsWithRisk);
    const byOwner = groupByOwner(itemsWithRisk);
    const deliveryPressure = getDeliveryPressure(itemsWithRisk, 7);

    return send(res, 200, {
      summary,
      highRiskList,
      byOwner,
      deliveryPressure,
      meta: {
        levels: RISK_LEVELS,
        labels: RISK_LABELS,
        colors: RISK_COLORS
      }
    });
  }

  if (req.method === "GET" && pathname === "/api/risk/summary") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const items = filterItemsByOwner(req.auth, getAllItems(db));
    const itemsWithRisk = calculateAllRisks(items);
    const summary = getRiskSummary(itemsWithRisk);
    return send(res, 200, summary);
  }

  if (req.method === "GET" && pathname === "/api/risk/high") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const items = filterItemsByOwner(req.auth, getAllItems(db));
    const itemsWithRisk = calculateAllRisks(items);
    const highRiskList = getHighRiskList(itemsWithRisk);
    return send(res, 200, highRiskList);
  }

  if (req.method === "GET" && pathname === "/api/risk/by-owner") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const items = filterItemsByOwner(req.auth, getAllItems(db));
    const itemsWithRisk = calculateAllRisks(items);
    const byOwner = groupByOwner(itemsWithRisk);
    return send(res, 200, byOwner);
  }

  if (req.method === "GET" && pathname === "/api/risk/delivery-pressure") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const days = parseInt(url.searchParams.get("days")) || 7;
    const items = filterItemsByOwner(req.auth, getAllItems(db));
    const itemsWithRisk = calculateAllRisks(items);
    const deliveryPressure = getDeliveryPressure(itemsWithRisk, days);
    return send(res, 200, deliveryPressure);
  }

  const itemRiskMatch = pathname.match(/^\/api\/risk\/items\/([^/]+)$/);
  if (itemRiskMatch && req.method === "GET") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    const itemId = itemRiskMatch[1];
    const item = db.items.find(x => x.id === itemId || x.code === itemId);
    if (!item) {
      return sendError(res, 404, "item_not_found");
    }
    if (!canViewItem(req.auth, item)) return sendError(res, 403, "forbidden");
    const risk = calculateItemRisk(item);
    return send(res, 200, { item, risk });
  }

  if (req.method === "GET" && pathname === "/api/risk/meta") {
    if (!req.auth.isAuthenticated) return sendError(res, 401, "unauthorized");
    return send(res, 200, {
      levels: RISK_LEVELS,
      labels: RISK_LABELS,
      colors: RISK_COLORS
    });
  }

  return null;
}

export { handleRiskApi };
