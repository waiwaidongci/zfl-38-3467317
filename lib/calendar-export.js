const EXPORT_COLUMNS = [
  ["code", "模型编号"],
  ["shipType", "船型"],
  ["scale", "比例"],
  ["owner", "负责人"],
  ["dueDate", "交付日期"],
  ["status", "状态"],
  ["pendingTaskCount", "未完成任务数"],
  ["latestNote", "最近备注"]
];

const TASK_INCOMPLETE_STATUSES = ["待检查", "调整中", "待复核"];

function filterByDateRange(items, start, end) {
  return items.filter(item => {
    if (!item.dueDate) return false;
    const d = new Date(item.dueDate);
    if (start && d < new Date(start)) return false;
    if (end && d > new Date(end + "T23:59:59")) return false;
    return true;
  });
}

function filterByStatuses(items, statuses) {
  if (!statuses || statuses.length === 0) return items;
  return items.filter(item => statuses.includes(item.status));
}

function filterByOwners(items, owners) {
  if (!owners || owners.length === 0) return items;
  return items.filter(item => {
    const owner = item.owner || "";
    return owners.includes(owner);
  });
}

function countPendingTasks(item) {
  if (!item.tasks || item.tasks.length === 0) return 0;
  return item.tasks.filter(t => TASK_INCOMPLETE_STATUSES.includes(t.status)).length;
}

function getLatestNote(item) {
  const allLogs = [];
  if (item.logs && item.logs.length > 0) {
    for (const log of item.logs) {
      allLogs.push({ at: log.at, note: (log.step ? log.step + "：" : "") + (log.note || "") });
    }
  }
  if (item.tasks && item.tasks.length > 0) {
    for (const task of item.tasks) {
      if (task.logs && task.logs.length > 0) {
        for (const log of task.logs) {
          allLogs.push({ at: log.at, note: "【" + task.position + "】" + (log.note || "") });
        }
      }
    }
  }
  if (allLogs.length === 0) return "";
  allLogs.sort((a, b) => new Date(b.at) - new Date(a.at));
  return allLogs[0].note || "";
}

function buildExportRow(item) {
  return {
    code: item.code || item.id || "",
    shipType: item.shipType || "",
    scale: item.scale || "",
    owner: item.owner || "",
    dueDate: item.dueDate || "",
    status: item.status || "",
    pendingTaskCount: countPendingTasks(item),
    latestNote: getLatestNote(item)
  };
}

function prepareExportData(items, filters = {}) {
  let result = [...items];
  result = filterByDateRange(result, filters.startDate, filters.endDate);
  result = filterByStatuses(result, filters.statuses);
  result = filterByOwners(result, filters.owners);
  result.sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (da !== db) return da - db;
    return (a.code || a.id || "").localeCompare(b.code || b.id || "");
  });
  return result.map(buildExportRow);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateCsv(rows) {
  const header = EXPORT_COLUMNS.map(c => c[1]);
  const keys = EXPORT_COLUMNS.map(c => c[0]);
  const lines = [header.map(escapeCsvValue).join(",")];
  for (const row of rows) {
    lines.push(keys.map(k => escapeCsvValue(row[k])).join(","));
  }
  return lines.join("\r\n");
}

function generateCsvWithBom(rows) {
  const BOM = "\uFEFF";
  return BOM + generateCsv(rows);
}

function getExportColumnLabels() {
  return EXPORT_COLUMNS.map(c => ({ key: c[0], label: c[1] }));
}

function getUniqueOwners(items) {
  const owners = new Set();
  for (const item of items) {
    if (item.owner !== undefined && item.owner !== null) {
      owners.add(item.owner);
    }
  }
  return [...owners].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "zh-CN");
  });
}

const MODEL_STATUSES = ["待检查", "校准中", "待复核", "已交付"];

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

export {
  EXPORT_COLUMNS,
  MODEL_STATUSES,
  prepareExportData,
  generateCsv,
  generateCsvWithBom,
  getExportColumnLabels,
  getUniqueOwners,
  getWeekRange,
  getMonthRange,
  formatDate,
  buildExportRow,
  countPendingTasks,
  getLatestNote,
  filterByDateRange,
  filterByStatuses,
  filterByOwners
};
