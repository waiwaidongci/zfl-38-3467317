import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "model-rigging-calibration.json");

const TASK_STATUSES = ["待检查", "调整中", "待复核", "完成"];
const MODEL_STATUSES = ["待检查", "校准中", "待复核", "已交付"];

const seed = {
  items: [
    {
      code: "MR-001",
      shipType: "福船",
      scale: "1:48",
      mastCount: 3,
      riggingMaterial: "蜡线",
      owner: "周宁",
      dueDate: "2026-06-28",
      status: "校准中",
      tasks: [
        {
          id: "T-1",
          position: "前桅侧支索",
          tension: "偏松",
          status: "调整中",
          logs: [
            {
              at: "2026-06-12",
              note: "已缩短2mm"
            }
          ]
        }
      ],
      logs: []
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function newItemId() {
  return "MR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

function newTaskId() {
  return "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 4);
}

function findItemById(db, id) {
  return db.items.find(x => x.id === id || x.code === id);
}

function findTaskById(item, taskId) {
  if (!item.tasks) return null;
  return item.tasks.find(t => t.id === taskId);
}

function computeModelStatusFromTasks(item) {
  if (!item.tasks || item.tasks.length === 0) {
    return "待检查";
  }
  const taskStatuses = item.tasks.map(t => t.status);
  const allDone = taskStatuses.every(s => s === "完成");
  if (allDone) return "待复核";
  const someInProgress = taskStatuses.some(s => s === "调整中" || s === "待复核");
  if (someInProgress) return "校准中";
  return "待检查";
}

function getAllItems(db) {
  return db.items.map(item => ({
    ...item,
    logCount: (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0)
  }));
}

function getAllTasks(db) {
  const tasks = [];
  for (const item of db.items) {
    if (item.tasks) {
      for (const task of item.tasks) {
        tasks.push({
          ...task,
          modelId: item.id || item.code,
          modelCode: item.code,
          modelShipType: item.shipType,
          modelOwner: item.owner,
          modelDueDate: item.dueDate
        });
      }
    }
  }
  return tasks;
}

function filterTasks(tasks, filters = {}) {
  return tasks.filter(task => {
    if (filters.modelId && task.modelId !== filters.modelId && task.modelCode !== filters.modelId) {
      return false;
    }
    if (filters.owner && task.modelOwner !== filters.owner) {
      return false;
    }
    if (filters.tension && task.tension !== filters.tension) {
      return false;
    }
    if (filters.status && task.status !== filters.status) {
      return false;
    }
    if (filters.dueDateStart && task.modelDueDate) {
      if (new Date(task.modelDueDate) < new Date(filters.dueDateStart)) {
        return false;
      }
    }
    if (filters.dueDateEnd && task.modelDueDate) {
      const endDate = new Date(filters.dueDateEnd + "T23:59:59");
      if (new Date(task.modelDueDate) > endDate) {
        return false;
      }
    }
    return true;
  });
}

async function updateTaskStatus(db, itemId, taskId, newStatus) {
  const item = findItemById(db, itemId);
  if (!item) {
    throw new Error("item_not_found");
  }
  const task = findTaskById(item, taskId);
  if (!task) {
    throw new Error("task_not_found");
  }
  if (!TASK_STATUSES.includes(newStatus)) {
    throw new Error("invalid_status");
  }
  const oldStatus = task.status;
  task.status = newStatus;
  task.logs ||= [];
  task.logs.push({
    at: new Date().toISOString(),
    note: `状态从「${oldStatus}」变更为「${newStatus}」`
  });
  const newModelStatus = computeModelStatusFromTasks(item);
  if (item.status !== newModelStatus) {
    item.status = newModelStatus;
    item.logs ||= [];
    item.logs.push({
      at: new Date().toISOString(),
      step: "状态",
      note: `自动更新为「${newModelStatus}」（任务状态联动）`
    });
  }
  item.logs ||= [];
  item.logs.push({
    at: new Date().toISOString(),
    step: "帆索",
    note: `${task.position} · 状态变更为「${newStatus}」`
  });
  await saveDb(db);
  return { item, task };
}

async function addTaskLog(db, itemId, taskId, note) {
  const item = findItemById(db, itemId);
  if (!item) {
    throw new Error("item_not_found");
  }
  const task = findTaskById(item, taskId);
  if (!task) {
    throw new Error("task_not_found");
  }
  task.logs ||= [];
  task.logs.push({
    at: new Date().toISOString(),
    note
  });
  await saveDb(db);
  return task;
}

async function createItem(db, input) {
  const item = {
    id: newItemId(),
    ...input,
    tasks: [],
    logs: [
      {
        at: new Date().toISOString(),
        step: "建档",
        note: "创建模型"
      }
    ]
  };
  db.items.unshift(item);
  await saveDb(db);
  return item;
}

async function createTask(db, itemId, input) {
  const item = findItemById(db, itemId);
  if (!item) {
    throw new Error("item_not_found");
  }
  const task = {
    id: newTaskId(),
    position: input.position || "",
    tension: input.tension || "待检测",
    status: "待检查",
    logs: [
      {
        at: new Date().toISOString(),
        note: input.note || "新增帆索任务"
      }
    ]
  };
  item.tasks ||= [];
  item.tasks.push(task);
  item.status = "校准中";
  item.logs ||= [];
  item.logs.push({
    at: new Date().toISOString(),
    step: "帆索",
    note: `${task.position} · ${task.tension}`
  });
  await saveDb(db);
  return { item, task };
}

async function updateItem(db, itemId, updates) {
  const item = findItemById(db, itemId);
  if (!item) {
    throw new Error("item_not_found");
  }
  Object.assign(item, updates);
  if (updates.status) {
    item.logs ||= [];
    item.logs.push({
      at: new Date().toISOString(),
      step: "状态",
      note: "更新为" + item.status
    });
  }
  await saveDb(db);
  return item;
}

async function addItemLog(db, itemId, step, note) {
  const item = findItemById(db, itemId);
  if (!item) {
    throw new Error("item_not_found");
  }
  item.logs ||= [];
  item.logs.push({
    at: new Date().toISOString(),
    step: step || "记录",
    note: note || ""
  });
  await saveDb(db);
  return item;
}

function getUniqueOwners(db) {
  const owners = new Set();
  for (const item of db.items) {
    if (item.owner) {
      owners.add(item.owner);
    }
  }
  return [...owners].sort();
}

function getUniqueTensions(db) {
  const tensions = new Set();
  for (const item of db.items) {
    if (item.tasks) {
      for (const task of item.tasks) {
        if (task.tension) {
          tensions.add(task.tension);
        }
      }
    }
  }
  return [...tensions].sort();
}

const TIMELINE_TYPES = ["建档", "状态", "帆索", "备注", "任务"];

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normalizeLogs(item) {
  const timeline = [];

  const itemLogs = item.logs || [];
  for (const log of itemLogs) {
    const at = normalizeDate(log.at);
    if (!at) continue;
    timeline.push({
      id: `model-log-${item.id || item.code}-${log.at}-${log.step || ''}`,
      type: log.step || "记录",
      at: log.at,
      atTime: at.getTime(),
      note: log.note || "",
      source: "model",
      modelId: item.id || item.code,
      modelCode: item.code
    });
  }

  const tasks = item.tasks || [];
  for (const task of tasks) {
    const taskLogs = task.logs || [];
    for (const log of taskLogs) {
      const at = normalizeDate(log.at);
      if (!at) continue;
      timeline.push({
        id: `task-log-${task.id}-${log.at}`,
        type: "任务",
        at: log.at,
        atTime: at.getTime(),
        note: log.note || "",
        source: "task",
        modelId: item.id || item.code,
        modelCode: item.code,
        taskId: task.id,
        taskPosition: task.position
      });
    }
  }

  timeline.sort((a, b) => a.atTime - b.atTime);

  return timeline;
}

function getItemWithTimeline(db, itemId) {
  const item = findItemById(db, itemId);
  if (!item) return null;
  const timeline = normalizeLogs(item);
  return {
    ...item,
    timeline,
    timelineTypes: [...new Set(timeline.map(t => t.type))]
  };
}

export {
  loadDb,
  saveDb,
  newItemId,
  newTaskId,
  findItemById,
  findTaskById,
  computeModelStatusFromTasks,
  getAllItems,
  getAllTasks,
  filterTasks,
  updateTaskStatus,
  addTaskLog,
  createItem,
  createTask,
  updateItem,
  addItemLog,
  getUniqueOwners,
  getUniqueTensions,
  normalizeLogs,
  getItemWithTimeline,
  TIMELINE_TYPES,
  TASK_STATUSES,
  MODEL_STATUSES
};
