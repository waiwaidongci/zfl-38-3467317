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

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
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
    const items = getAllItems(db);
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
    const items = getAllItems(db);
    const itemsWithRisk = calculateAllRisks(items);
    const summary = getRiskSummary(itemsWithRisk);
    return send(res, 200, summary);
  }

  if (req.method === "GET" && pathname === "/api/risk/high") {
    const items = getAllItems(db);
    const itemsWithRisk = calculateAllRisks(items);
    const highRiskList = getHighRiskList(itemsWithRisk);
    return send(res, 200, highRiskList);
  }

  if (req.method === "GET" && pathname === "/api/risk/by-owner") {
    const items = getAllItems(db);
    const itemsWithRisk = calculateAllRisks(items);
    const byOwner = groupByOwner(itemsWithRisk);
    return send(res, 200, byOwner);
  }

  if (req.method === "GET" && pathname === "/api/risk/delivery-pressure") {
    const days = parseInt(url.searchParams.get("days")) || 7;
    const items = getAllItems(db);
    const itemsWithRisk = calculateAllRisks(items);
    const deliveryPressure = getDeliveryPressure(itemsWithRisk, days);
    return send(res, 200, deliveryPressure);
  }

  const itemRiskMatch = pathname.match(/^\/api\/risk\/items\/([^/]+)$/);
  if (itemRiskMatch && req.method === "GET") {
    const itemId = itemRiskMatch[1];
    const item = db.items.find(x => x.id === itemId || x.code === itemId);
    if (!item) {
      return send(res, 404, { error: "item_not_found" });
    }
    const risk = calculateItemRisk(item);
    return send(res, 200, { item, risk });
  }

  if (req.method === "GET" && pathname === "/api/risk/meta") {
    return send(res, 200, {
      levels: RISK_LEVELS,
      labels: RISK_LABELS,
      colors: RISK_COLORS
    });
  }

  return null;
}

export { handleRiskApi };
