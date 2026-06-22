import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "model-rigging-calibration.json");
const migrationMarkerPath = join(__dirname, "..", "data", ".migration-v1");

const LEGACY_OWNER_MAP = {
  "周宁": "zhouning",
  "赵六": "zhaoliu",
  "张三": "zhangsan",
  "李四": "lisi",
  "王五": "wangwu"
};

function ensureItemStructure(item) {
  const normalized = { ...item };
  if (!normalized.id && normalized.code) {
    normalized.id = normalized.code;
  }
  if (!normalized.owner) {
    normalized.owner = "";
  }
  if (!normalized.tasks) {
    normalized.tasks = [];
  }
  if (!normalized.logs) {
    normalized.logs = [];
  }
  if (!normalized.status) {
    normalized.status = "待检查";
  }
  if (!normalized.createdAt && normalized.logs && normalized.logs.length > 0) {
    normalized.createdAt = normalized.logs[0].at || new Date().toISOString();
  }
  for (const task of normalized.tasks) {
    if (!task.logs) {
      task.logs = [];
    }
    if (!task.status) {
      task.status = "待检查";
    }
    if (!task.tension) {
      task.tension = "待检测";
    }
  }
  return normalized;
}

async function runMigrationIfNeeded() {
  const markerExists = existsSync(migrationMarkerPath);
  if (markerExists) {
    return { migrated: false, reason: "already_migrated" };
  }

  if (!existsSync(dbPath)) {
    await writeFile(migrationMarkerPath, JSON.stringify({
      version: 1,
      timestamp: new Date().toISOString(),
      notes: "Initial migration marker for auth and audit system"
    }, null, 2));
    return { migrated: false, reason: "no_existing_data" };
  }

  const rawData = await readFile(dbPath, "utf8");
  const db = JSON.parse(rawData);
  
  if (!db.items) {
    db.items = [];
  }

  let changed = false;
  const stats = {
    totalItems: db.items.length,
    normalizedItems: 0,
    addedOwnerField: 0,
    addedIdField: 0,
    addedTasksField: 0,
    addedLogsField: 0,
    addedStatusField: 0,
    normalizedTasks: 0
  };

  const normalizedItems = db.items.map(item => {
    const original = JSON.stringify(item);
    const normalized = ensureItemStructure(item);
    const after = JSON.stringify(normalized);
    
    if (original !== after) {
      changed = true;
      stats.normalizedItems++;
      
      if (!item.owner && normalized.owner !== undefined) stats.addedOwnerField++;
      if (!item.id && normalized.id) stats.addedIdField++;
      if (!item.tasks && normalized.tasks) stats.addedTasksField++;
      if (!item.logs && normalized.logs) stats.addedLogsField++;
      if (!item.status && normalized.status) stats.addedStatusField++;
      
      const origTaskCount = (item.tasks || []).length;
      const normTaskCount = normalized.tasks.length;
      if (normTaskCount > origTaskCount) {
        stats.normalizedTasks += (normTaskCount - origTaskCount);
      }
    }
    return normalized;
  });

  db.items = normalizedItems;

  if (changed) {
    await writeFile(dbPath, JSON.stringify(db, null, 2));
  }

  await writeFile(migrationMarkerPath, JSON.stringify({
    version: 1,
    timestamp: new Date().toISOString(),
    stats,
    notes: "Migration v1: Normalized item structure for auth and audit system"
  }, null, 2));

  return {
    migrated: changed,
    stats,
    reason: changed ? "normalized_structure" : "no_changes_needed"
  };
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

export {
  runMigrationIfNeeded,
  LEGACY_OWNER_MAP,
  ensureItemStructure,
  getClientIp
};
