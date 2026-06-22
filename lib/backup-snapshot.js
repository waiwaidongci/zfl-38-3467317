import { readFile, writeFile, mkdir, readdir, unlink, copyFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  SNAPSHOTS_DIR,
  DB_PATH,
  DATA_DIR,
  MIGRATION_STATE_PATH,
  readRawDatabase,
  writeRawDatabase,
  saveMigrationState,
  loadMigrationState
} from "./migration-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_SNAPSHOTS_TO_KEEP = 20;

function generateSnapshotId(prefix = "SNAP") {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${timestamp}-${random}`;
}

function computeDataChecksum(data) {
  const jsonStr = JSON.stringify(data);
  return createHash("sha256").update(jsonStr).digest("hex");
}

function countModelsTasks(data) {
  const items = data?.items || [];
  let taskCount = 0;
  for (const item of items) {
    taskCount += (item.tasks || []).length;
  }
  return { modelCount: items.length, taskCount };
}

async function ensureSnapshotsDir() {
  if (!existsSync(SNAPSHOTS_DIR)) {
    await mkdir(SNAPSHOTS_DIR, { recursive: true });
  }
}

async function createSnapshot({ reason, sourceVersion, targetVersion, tag } = {}) {
  await ensureSnapshotsDir();

  const currentData = await readRawDatabase();
  if (!currentData) {
    return { skipped: true, reason: "no_data_to_snapshot" };
  }

  const { modelCount, taskCount } = countModelsTasks(currentData);
  const checksum = computeDataChecksum(currentData);
  const snapshotId = generateSnapshotId(tag ? `SNAP-${tag.toUpperCase()}` : "SNAP");
  const createdAt = new Date().toISOString();

  const snapshotMeta = {
    id: snapshotId,
    createdAt,
    reason: reason || "",
    tag: tag || "",
    sourceSchemaVersion: sourceVersion ?? null,
    targetSchemaVersion: targetVersion ?? null,
    checksum,
    modelCount,
    taskCount,
    file: `${snapshotId}.json`
  };

  const snapshotContent = {
    meta: snapshotMeta,
    data: currentData
  };

  const filePath = join(SNAPSHOTS_DIR, snapshotMeta.file);
  await writeFile(filePath, JSON.stringify(snapshotContent, null, 2));

  await cleanupOldSnapshots();

  return {
    created: true,
    id: snapshotId,
    ...snapshotMeta,
    filePath
  };
}

async function listSnapshots() {
  if (!existsSync(SNAPSHOTS_DIR)) return [];
  const files = (await readdir(SNAPSHOTS_DIR)).filter((f) => f.endsWith(".json"));
  const snapshots = [];

  for (const file of files) {
    const filePath = join(SNAPSHOTS_DIR, file);
    try {
      const stat = statSync(filePath);
      const content = JSON.parse(await readFile(filePath, "utf8"));
      const meta = content.meta || {};
      const data = content.data || {};
      const actualChecksum = computeDataChecksum(data);
      const checksumValid = meta.checksum ? actualChecksum === meta.checksum : false;

      snapshots.push({
        id: meta.id || basename(file, ".json"),
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        reason: meta.reason || "",
        tag: meta.tag || "",
        sourceSchemaVersion: meta.sourceSchemaVersion ?? null,
        targetSchemaVersion: meta.targetSchemaVersion ?? null,
        checksumValid,
        modelCount: meta.modelCount ?? (data.items?.length || 0),
        taskCount: meta.taskCount ?? countModelsTasks(data).taskCount,
        fileSize: stat.size
      });
    } catch (e) {
      snapshots.push({
        id: basename(file, ".json"),
        createdAt: statSync(filePath).mtime.toISOString(),
        corrupted: true,
        error: e.message,
        fileSize: statSync(filePath).size
      });
    }
  }

  return snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getSnapshot(snapshotId) {
  await ensureSnapshotsDir();
  const candidates = [
    join(SNAPSHOTS_DIR, `${snapshotId}.json`),
    join(SNAPSHOTS_DIR, snapshotId)
  ];
  let filePath = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      filePath = c;
      break;
    }
  }
  if (!filePath) throw new Error("snapshot_not_found");

  const content = JSON.parse(await readFile(filePath, "utf8"));
  return content;
}

async function verifySnapshot(snapshotId) {
  try {
    const snap = await getSnapshot(snapshotId);
    if (!snap.meta || !snap.data) {
      return { valid: false, reason: "missing_meta_or_data" };
    }
    const actualChecksum = computeDataChecksum(snap.data);
    if (actualChecksum !== snap.meta.checksum) {
      return { valid: false, reason: "checksum_mismatch" };
    }
    return { valid: true, meta: snap.meta };
  } catch (e) {
    return { valid: false, reason: e.message };
  }
}

async function restoreSnapshot(snapshotId, { force = false } = {}) {
  const snap = await getSnapshot(snapshotId);
  const verification = await verifySnapshot(snapshotId);
  if (!verification.valid && !force) {
    throw new Error(`snapshot_invalid: ${verification.reason}`);
  }
  if (!snap.data || typeof snap.data !== "object") {
    throw new Error("snapshot_data_missing");
  }

  const restoreSafetyId = generateSnapshotId("SNAP-BEFORE-RESTORE");
  const beforeRestorePath = join(SNAPSHOTS_DIR, `${restoreSafetyId}.json`);
  try {
    const currentData = await readRawDatabase();
    if (currentData) {
      await writeFile(
        beforeRestorePath,
        JSON.stringify(
          {
            meta: {
              id: restoreSafetyId,
              createdAt: new Date().toISOString(),
              reason: `恢复 ${snapshotId} 前的自动安全快照`,
              tag: "PRE-RESTORE",
              checksum: computeDataChecksum(currentData),
              ...countModelsTasks(currentData),
              file: `${restoreSafetyId}.json`
            },
            data: currentData
          },
          null,
          2
        )
      );
    }
  } catch (e) {
    if (!force) {
      throw new Error(`安全快照创建失败：${e.message}`);
    }
  }

  await writeRawDatabase(snap.data);

  const state = await loadMigrationState();
  state.history.push({
    type: "snapshot_restore",
    snapshotId,
    at: new Date().toISOString(),
    restoredFromVersion: snap.meta?.targetSchemaVersion ?? snap.meta?.sourceSchemaVersion ?? null,
    safetySnapshotId: restoreSafetyId
  });
  if (snap.meta?.targetSchemaVersion !== undefined) {
    state.currentVersion = snap.meta.targetSchemaVersion;
  }
  await saveMigrationState(state);

  return {
    restored: true,
    snapshotId,
    safetySnapshotId: restoreSafetyId,
    meta: snap.meta
  };
}

async function deleteSnapshot(snapshotId) {
  const filePath = join(SNAPSHOTS_DIR, `${snapshotId}.json`);
  if (!existsSync(filePath)) {
    throw new Error("snapshot_not_found");
  }
  await unlink(filePath);
  return { deleted: true, snapshotId };
}

async function cleanupOldSnapshots(maxKeep = MAX_SNAPSHOTS_TO_KEEP) {
  const all = await listSnapshots();
  const toDelete = all.filter((s) => s.tag !== "PERMANENT").slice(maxKeep);
  const results = [];
  for (const s of toDelete) {
    try {
      await deleteSnapshot(s.id);
      results.push({ id: s.id, deleted: true });
    } catch (e) {
      results.push({ id: s.id, deleted: false, error: e.message });
    }
  }
  return results;
}

async function createAtomicWrite(data, operationFn) {
  const tempPath = DB_PATH + ".tmp";
  const backupPath = DB_PATH + ".bak-" + Date.now();

  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2));
    if (existsSync(DB_PATH)) {
      await copyFile(DB_PATH, backupPath);
    }
    await operationFn();
    await copyFile(tempPath, DB_PATH);
    try {
      await unlink(tempPath);
    } catch {}
    return { success: true, backupPath };
  } catch (e) {
    if (existsSync(backupPath)) {
      try {
        await copyFile(backupPath, DB_PATH);
      } catch (rollbackErr) {
        e.rollbackError = rollbackErr.message;
      }
    }
    throw e;
  }
}

export {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  verifySnapshot,
  restoreSnapshot,
  deleteSnapshot,
  cleanupOldSnapshots,
  createAtomicWrite,
  computeDataChecksum,
  generateSnapshotId,
  countModelsTasks,
  ensureSnapshotsDir,
  MAX_SNAPSHOTS_TO_KEEP
};
