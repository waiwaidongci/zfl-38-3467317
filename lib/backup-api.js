import {
  createBackup,
  listBackups,
  getBackupMeta,
  getBackupContent,
  getBackupRawContent,
  validateBackup,
  restoreBackup,
  logDownload
} from "./backup-service.js";
import { computeDiff } from "./diff-utils.js";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error }, null, 2));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleBackupApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/backups")) return null;

  const backupIdMatch = pathname.match(/^\/api\/backups\/([^/]+)$/);
  const backupActionMatch = pathname.match(/^\/api\/backups\/([^/]+)\/(download|diff|restore|validate)$/);

  if (req.method === "GET" && pathname === "/api/backups") {
    try {
      const backups = await listBackups();
      return send(res, 200, backups);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/backups") {
    try {
      const body = await parseBody(req);
      const remark = body.remark || "";
      const operator = body.operator || "system";
      const backup = await createBackup(remark, operator);
      return send(res, 201, backup);
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  if (req.method === "GET" && backupIdMatch) {
    const backupId = backupIdMatch[1];
    try {
      const meta = await getBackupMeta(backupId);
      return send(res, 200, meta);
    } catch (e) {
      if (e.message === "backup_not_found") {
        return sendError(res, 404, "backup_not_found");
      }
      return sendError(res, 500, e.message);
    }
  }

  if (req.method === "GET" && backupActionMatch && backupActionMatch[2] === "download") {
    const backupId = backupActionMatch[1];
    try {
      const validation = await validateBackup(backupId);
      if (!validation.valid) {
        return sendError(res, 400, `invalid_backup: ${validation.message}`);
      }
      const content = await getBackupRawContent(backupId);
      await logDownload(backupId);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${backupId}.json"`,
        "Content-Length": Buffer.byteLength(content, "utf8")
      });
      res.end(content);
      return true;
    } catch (e) {
      if (e.message === "backup_not_found") {
        return sendError(res, 404, "backup_not_found");
      }
      return sendError(res, 500, e.message);
    }
  }

  if (req.method === "GET" && backupActionMatch && backupActionMatch[2] === "diff") {
    const backupId = backupActionMatch[1];
    try {
      const backup = await getBackupContent(backupId);
      const { loadDb: loadMainDb } = await import("./data-access.js");
      const { loadCalibrationDb } = await import("./calibration-data.js");

      const currentModels = await loadMainDb();
      const currentCalibration = await loadCalibrationDb();

      const currentData = {
        models: currentModels,
        calibration: currentCalibration
      };

      const diff = computeDiff(currentData, backup);
      return send(res, 200, diff);
    } catch (e) {
      if (e.message === "backup_not_found") {
        return sendError(res, 404, "backup_not_found");
      }
      if (e.message.startsWith("invalid_backup:")) {
        return sendError(res, 400, e.message);
      }
      return sendError(res, 500, e.message);
    }
  }

  if (req.method === "GET" && backupActionMatch && backupActionMatch[2] === "validate") {
    const backupId = backupActionMatch[1];
    try {
      const result = await validateBackup(backupId);
      return send(res, 200, result);
    } catch (e) {
      return sendError(res, 500, e.message);
    }
  }

  if (req.method === "POST" && backupActionMatch && backupActionMatch[2] === "restore") {
    const backupId = backupActionMatch[1];
    try {
      const body = await parseBody(req);
      const confirmed = body.confirmed === true;
      const operator = body.operator || "system";

      if (!confirmed) {
        return sendError(res, 400, "confirmation_required");
      }

      const result = await restoreBackup(backupId, confirmed, operator);
      return send(res, 200, result);
    } catch (e) {
      if (e.message === "backup_not_found") {
        return sendError(res, 404, "backup_not_found");
      }
      if (e.message === "confirmation_required") {
        return sendError(res, 400, "confirmation_required");
      }
      if (e.message.startsWith("invalid_backup:")) {
        return sendError(res, 400, e.message);
      }
      return sendError(res, 500, e.message);
    }
  }

  return null;
}

export { handleBackupApi };
