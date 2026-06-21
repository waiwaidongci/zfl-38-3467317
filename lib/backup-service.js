import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { countTasks } from "./diff-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupsDir = join(__dirname, "..", "data", "backups");
const dbPath = join(__dirname, "..", "data", "model-rigging-calibration.json");
const calibrationDbPath = join(__dirname, "..", "data", "calibration-rules.json");
const systemLogsPath = join(__dirname, "..", "data", "system-logs.json");
const BACKUP_VERSION = "1.0.0";

function generateBackupId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `BK-${timestamp}-${random}`;
}

function generateLogId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `LOG-${timestamp}-${random}`;
}

function computeChecksum(data) {
  const jsonStr = JSON.stringify(data);
  return createHash("sha256").update(jsonStr).digest("hex");
}

async function ensureBackupsDir() {
  if (!existsSync(backupsDir)) {
    await mkdir(backupsDir, { recursive: true });
  }
}

async function loadMainDb() {
  if (!existsSync(dbPath)) return { items: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function loadCalibrationDb() {
  if (!existsSync(calibrationDbPath)) return { rules: [] };
  return JSON.parse(await readFile(calibrationDbPath, "utf8"));
}

async function loadSystemLogs() {
  if (!existsSync(systemLogsPath)) return { logs: [] };
  const content = await readFile(systemLogsPath, "utf8");
  try {
    return JSON.parse(content);
  } catch {
    return { logs: [] };
  }
}

async function saveSystemLogs(logsDb) {
  await writeFile(systemLogsPath, JSON.stringify(logsDb, null, 2));
}

async function addSystemLog(type, action, detail, operator = "system") {
  const logsDb = await loadSystemLogs();
  logsDb.logs ||= [];
  const log = {
    id: generateLogId(),
    type,
    action,
    detail,
    operator,
    at: new Date().toISOString()
  };
  logsDb.logs.unshift(log);
  await saveSystemLogs(logsDb);
  return log;
}

function validateBackupStructure(backupData) {
  if (!backupData || typeof backupData !== "object") {
    return { valid: false, reason: "invalid_json", message: "无效的JSON格式" };
  }
  if (!backupData.id || !backupData.id.startsWith("BK-")) {
    return { valid: false, reason: "missing_id", message: "缺少有效的备份ID" };
  }
  if (!backupData.version) {
    return { valid: false, reason: "missing_version", message: "缺少版本信息" };
  }
  if (!backupData.createdAt) {
    return { valid: false, reason: "missing_createdAt", message: "缺少创建时间" };
  }
  if (!backupData.checksum) {
    return { valid: false, reason: "missing_checksum", message: "缺少校验和" };
  }
  if (!backupData.data || typeof backupData.data !== "object") {
    return { valid: false, reason: "missing_data", message: "缺少备份数据" };
  }
  if (!backupData.data.models || !Array.isArray(backupData.data.models.items)) {
    return { valid: false, reason: "invalid_models", message: "模型数据格式无效" };
  }
  if (!backupData.data.calibration || !Array.isArray(backupData.data.calibration.rules)) {
    return { valid: false, reason: "invalid_calibration", message: "校准规则数据格式无效" };
  }
  return { valid: true };
}

function verifyChecksum(backupData) {
  const dataToVerify = backupData.data;
  const expectedChecksum = backupData.checksum;
  const actualChecksum = computeChecksum(dataToVerify);
  return actualChecksum === expectedChecksum;
}

async function createBackup(remark = "", operator = "system") {
  await ensureBackupsDir();

  const mainDb = await loadMainDb();
  const calibrationDb = await loadCalibrationDb();

  const backupData = {
    models: mainDb,
    calibration: calibrationDb
  };

  const checksum = computeChecksum(backupData);
  const backupId = generateBackupId();
  const modelCount = mainDb.items?.length || 0;
  const taskCount = countTasks(mainDb.items || []);

  const backup = {
    id: backupId,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    remark: remark || "",
    operator,
    checksum,
    modelCount,
    taskCount,
    data: backupData
  };

  const filePath = join(backupsDir, `${backupId}.json`);
  await writeFile(filePath, JSON.stringify(backup, null, 2));

  await addSystemLog(
    "backup_create",
    "创建备份",
    `创建备份 ${backupId}，包含 ${modelCount} 个模型，${taskCount} 个任务。备注：${remark || "无"}`,
    operator
  );

  return {
    id: backup.id,
    version: backup.version,
    createdAt: backup.createdAt,
    remark: backup.remark,
    operator: backup.operator,
    modelCount: backup.modelCount,
    taskCount: backup.taskCount
  };
}

async function listBackups() {
  await ensureBackupsDir();
  const files = await readdir(backupsDir);
  const backupFiles = files.filter(f => f.startsWith("BK-") && f.endsWith(".json"));

  const backups = [];
  for (const file of backupFiles) {
    const filePath = join(backupsDir, file);
    try {
      const stat = statSync(filePath);
      const content = await readFile(filePath, "utf8");
      const backup = JSON.parse(content);

      const structureValidation = validateBackupStructure(backup);
      const checksumValid = structureValidation.valid ? verifyChecksum(backup) : false;

      backups.push({
        id: backup.id || basename(file, ".json"),
        version: backup.version,
        createdAt: backup.createdAt || stat.mtime.toISOString(),
        remark: backup.remark || "",
        operator: backup.operator || "system",
        modelCount: backup.modelCount ?? (backup.data?.models?.items?.length || 0),
        taskCount: backup.taskCount ?? countTasks(backup.data?.models?.items || []),
        fileSize: stat.size,
        valid: structureValidation.valid && checksumValid,
        validationError: structureValidation.valid ? (checksumValid ? null : "校验和不匹配") : structureValidation.message
      });
    } catch (e) {
      backups.push({
        id: basename(file, ".json"),
        version: null,
        createdAt: statSync(filePath).mtime.toISOString(),
        remark: "",
        operator: "system",
        modelCount: 0,
        taskCount: 0,
        fileSize: statSync(filePath).size,
        valid: false,
        validationError: "文件损坏或格式无效"
      });
    }
  }

  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return backups;
}

async function getBackupMeta(backupId) {
  const filePath = join(backupsDir, `${backupId}.json`);
  if (!existsSync(filePath)) {
    throw new Error("backup_not_found");
  }

  const content = await readFile(filePath, "utf8");
  const backup = JSON.parse(content);

  const structureValidation = validateBackupStructure(backup);
  const checksumValid = structureValidation.valid ? verifyChecksum(backup) : false;

  return {
    id: backup.id,
    version: backup.version,
    createdAt: backup.createdAt,
    remark: backup.remark,
    operator: backup.operator,
    modelCount: backup.modelCount,
    taskCount: backup.taskCount,
    fileSize: statSync(filePath).size,
    valid: structureValidation.valid && checksumValid,
    validationError: structureValidation.valid ? (checksumValid ? null : "校验和不匹配") : structureValidation.message
  };
}

async function getBackupContent(backupId) {
  const filePath = join(backupsDir, `${backupId}.json`);
  if (!existsSync(filePath)) {
    throw new Error("backup_not_found");
  }

  const content = await readFile(filePath, "utf8");
  const backup = JSON.parse(content);

  const structureValidation = validateBackupStructure(backup);
  if (!structureValidation.valid) {
    throw new Error(`invalid_backup: ${structureValidation.message}`);
  }

  if (!verifyChecksum(backup)) {
    throw new Error("invalid_backup: 校验和不匹配，文件可能已损坏");
  }

  return backup;
}

async function getBackupRawContent(backupId) {
  const filePath = join(backupsDir, `${backupId}.json`);
  if (!existsSync(filePath)) {
    throw new Error("backup_not_found");
  }
  return await readFile(filePath, "utf8");
}

async function validateBackup(backupId) {
  const filePath = join(backupsDir, `${backupId}.json`);
  if (!existsSync(filePath)) {
    return { valid: false, reason: "not_found", message: "备份文件不存在" };
  }

  try {
    const content = await readFile(filePath, "utf8");
    const backup = JSON.parse(content);

    const structureValidation = validateBackupStructure(backup);
    if (!structureValidation.valid) {
      return structureValidation;
    }

    if (!verifyChecksum(backup)) {
      return { valid: false, reason: "checksum_mismatch", message: "校验和不匹配，文件可能已损坏" };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, reason: "parse_error", message: "文件解析失败：" + e.message };
  }
}

async function restoreBackup(backupId, confirmed = false, operator = "system") {
  if (!confirmed) {
    throw new Error("confirmation_required");
  }

  const validation = await validateBackup(backupId);
  if (!validation.valid) {
    throw new Error(`invalid_backup: ${validation.message}`);
  }

  const backup = await getBackupContent(backupId);
  const currentMainDb = await loadMainDb();
  const currentCalibrationDb = await loadCalibrationDb();

  const beforeModelCount = currentMainDb.items?.length || 0;
  const beforeTaskCount = countTasks(currentMainDb.items || []);
  const afterModelCount = backup.modelCount;
  const afterTaskCount = backup.taskCount;

  await writeFile(dbPath, JSON.stringify(backup.data.models, null, 2));
  await writeFile(calibrationDbPath, JSON.stringify(backup.data.calibration, null, 2));

  await addSystemLog(
    "backup_restore",
    "恢复备份",
    `从备份 ${backupId} 恢复数据。恢复前：${beforeModelCount} 个模型，${beforeTaskCount} 个任务；恢复后：${afterModelCount} 个模型，${afterTaskCount} 个任务。备注：${backup.remark || "无"}`,
    operator
  );

  return {
    success: true,
    backupId,
    before: {
      modelCount: beforeModelCount,
      taskCount: beforeTaskCount
    },
    after: {
      modelCount: afterModelCount,
      taskCount: afterTaskCount
    }
  };
}

async function logDownload(backupId, operator = "system") {
  await addSystemLog(
    "backup_download",
    "下载备份",
    `下载备份 ${backupId}`,
    operator
  );
}

export {
  createBackup,
  listBackups,
  getBackupMeta,
  getBackupContent,
  getBackupRawContent,
  validateBackup,
  restoreBackup,
  logDownload,
  addSystemLog
};
