import {
  loadCalibrationDb,
  getAllRules,
  findRuleById,
  findMatchingRule,
  getUniqueMaterials,
  getUniqueScales,
  getUniquePositions,
  createRule,
  updateRule,
  deleteRule
} from "./calibration-data.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleCalibrationApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/calibration")) return null;

  const calibrationDb = await loadCalibrationDb();

  if (req.method === "GET" && pathname === "/api/calibration/rules") {
    const filters = {
      material: url.searchParams.get("material") || "",
      scale: url.searchParams.get("scale") || "",
      position: url.searchParams.get("position") || "",
      keyword: url.searchParams.get("keyword") || ""
    };
    return send(res, 200, getAllRules(calibrationDb, filters));
  }

  if (req.method === "GET" && pathname === "/api/calibration/filters") {
    return send(res, 200, {
      materials: getUniqueMaterials(calibrationDb),
      scales: getUniqueScales(calibrationDb),
      positions: getUniquePositions(calibrationDb)
    });
  }

  if (req.method === "GET" && pathname === "/api/calibration/match") {
    const material = url.searchParams.get("material") || "";
    const scale = url.searchParams.get("scale") || "";
    const position = url.searchParams.get("position") || "";
    const matched = findMatchingRule(calibrationDb, material, scale, position);
    return send(res, 200, matched || null);
  }

  const ruleIdMatch = pathname.match(/^\/api\/calibration\/rules\/([^/]+)$/);

  if (req.method === "GET" && ruleIdMatch) {
    const rule = findRuleById(calibrationDb, ruleIdMatch[1]);
    if (!rule) return send(res, 404, { error: "rule_not_found" });
    return send(res, 200, rule);
  }

  if (req.method === "POST" && pathname === "/api/calibration/rules") {
    try {
      const input = await parseBody(req);
      const rule = await createRule(calibrationDb, input);
      return send(res, 201, rule);
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  if (req.method === "PATCH" && ruleIdMatch) {
    try {
      const input = await parseBody(req);
      const rule = await updateRule(calibrationDb, ruleIdMatch[1], input);
      return send(res, 200, rule);
    } catch (error) {
      const statusMap = { rule_not_found: 404 };
      const statusCode = statusMap[error.message] || 400;
      return send(res, statusCode, { error: error.message });
    }
  }

  if (req.method === "DELETE" && ruleIdMatch) {
    try {
      await deleteRule(calibrationDb, ruleIdMatch[1]);
      return send(res, 200, { ok: true });
    } catch (error) {
      const statusMap = { rule_not_found: 404 };
      const statusCode = statusMap[error.message] || 400;
      return send(res, statusCode, { error: error.message });
    }
  }

  return null;
}

export { handleCalibrationApi };
