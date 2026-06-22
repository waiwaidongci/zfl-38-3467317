import {
  globalRepository,
  TASK_STATUSES,
  MODEL_STATUSES
} from "./data-repository.js";
import { DB_PATH } from "./migration-registry.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

async function _ensureRepo() {
  await globalRepository.initialize();
}

async function loadDb() {
  await _ensureRepo();
  return await globalRepository.readAll();
}

async function saveDb(db) {
  await globalRepository.replaceRawForRestore(db);
}

function newItemId() {
  return "MR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

function newTaskId() {
  return "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 4);
}

function findItemById(db, id) {
  if (db && db.items) {
    return db.items.find((x) => x.id === id || x.code === id) || null;
  }
  return (async () => {
    await _ensureRepo();
    return await globalRepository.findItemById(id);
  })();
}

function findTaskById(item, taskId) {
  if (!item?.tasks) return null;
  return item.tasks.find((t) => t.id === taskId) || null;
}

function computeModelStatusFromTasks(item) {
  if (!item.tasks || item.tasks.length === 0) return "待检查";
  const taskStatuses = item.tasks.map((t) => t.status);
  const allDone = taskStatuses.every((s) => s === "完成");
  if (allDone) return "待复核";
  const someInProgress = taskStatuses.some((s) => s === "调整中" || s === "待复核");
  if (someInProgress) return "校准中";
  return "待检查";
}

function getAllItems(db) {
  if (db && Array.isArray(db.items)) {
    return db.items.map((item) => ({
      ...item,
      logCount:
        (item.logs || []).length +
        (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0)
    }));
  }
  return (async () => {
    await _ensureRepo();
    return await globalRepository.getAllItems();
  })();
}

function getAllTasks(db) {
  if (db && Array.isArray(db.items)) {
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
  return (async () => {
    await _ensureRepo();
    return await globalRepository.getAllTasks();
  })();
}

function filterTasks(tasks, filters = {}) {
  return tasks.filter((task) => {
    if (filters.modelId && task.modelId !== filters.modelId && task.modelCode !== filters.modelId) {
      return false;
    }
    if (filters.owner && task.modelOwner !== filters.owner) return false;
    if (filters.tension && task.tension !== filters.tension) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.dueDateStart && task.modelDueDate) {
      if (new Date(task.modelDueDate) < new Date(filters.dueDateStart)) return false;
    }
    if (filters.dueDateEnd && task.modelDueDate) {
      const end = new Date(filters.dueDateEnd + "T23:59:59");
      if (new Date(task.modelDueDate) > end) return false;
    }
    return true;
  });
}

async function updateTaskStatus(db, itemId, taskId, newStatus) {
  if (db && Array.isArray(db.items)) {
    const item = findItemById(db, itemId);
    if (!item) throw new Error("item_not_found");
    const task = findTaskById(item, taskId);
    if (!task) throw new Error("task_not_found");
    if (!TASK_STATUSES.includes(newStatus)) throw new Error("invalid_status");
    const oldStatus = task.status;
    task.status = newStatus;
    task.logs = task.logs || [];
    task.logs.push({
      at: new Date().toISOString(),
      note: `状态从「${oldStatus}」变更为「${newStatus}」`
    });
    const newModelStatus = computeModelStatusFromTasks(item);
    if (item.status !== newModelStatus) {
      item.status = newModelStatus;
      item.logs = item.logs || [];
      item.logs.push({
        at: new Date().toISOString(),
        step: "状态",
        note: `自动更新为「${newModelStatus}」（任务状态联动）`
      });
    }
    item.logs = item.logs || [];
    item.logs.push({
      at: new Date().toISOString(),
      step: "帆索",
      note: `${task.position} · 状态变更为「${newStatus}」`
    });
    await saveDb(db);
    return { item, task };
  }
  await _ensureRepo();
  return await globalRepository.updateTaskStatus(itemId, taskId, newStatus);
}

async function addTaskLog(db, itemId, taskId, note) {
  if (db && Array.isArray(db.items)) {
    const item = findItemById(db, itemId);
    if (!item) throw new Error("item_not_found");
    const task = findTaskById(item, taskId);
    if (!task) throw new Error("task_not_found");
    task.logs = task.logs || [];
    task.logs.push({ at: new Date().toISOString(), note });
    await saveDb(db);
    return task;
  }
  await _ensureRepo();
  return await globalRepository.addTaskLog(itemId, taskId, note);
}

async function createItem(db, input) {
  if (db && Array.isArray(db.items)) {
    const now = new Date().toISOString();
    const item = {
      id: newItemId(),
      ...input,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      auditRefs: [],
      logs: [
        {
          at: now,
          step: "建档",
          note: "创建模型"
        }
      ]
    };
    db.items.unshift(item);
    await saveDb(db);
    return item;
  }
  await _ensureRepo();
  return await globalRepository.createItem(input);
}

async function createTask(db, itemId, input) {
  if (db && Array.isArray(db.items)) {
    const item = findItemById(db, itemId);
    if (!item) throw new Error("item_not_found");
    const now = new Date().toISOString();
    const task = {
      id: newTaskId(),
      position: input.position || "",
      tension: input.tension || "待检测",
      status: "待检查",
      modelRef: item.id,
      modelCode: item.code || "",
      createdAt: now,
      logs: [
        {
          at: now,
          note: input.note || "新增帆索任务"
        }
      ]
    };
    item.tasks = item.tasks || [];
    item.tasks.push(task);
    item.status = "校准中";
    item.updatedAt = now;
    item.logs = item.logs || [];
    item.logs.push({
      at: now,
      step: "帆索",
      note: `${task.position} · ${task.tension}`
    });
    await saveDb(db);
    return { item, task };
  }
  await _ensureRepo();
  return await globalRepository.createTask(itemId, input);
}

async function updateItem(db, itemId, updates) {
  if (db && Array.isArray(db.items)) {
    const item = findItemById(db, itemId);
    if (!item) throw new Error("item_not_found");
    Object.assign(item, updates);
    item.updatedAt = new Date().toISOString();
    if (updates.status) {
      item.logs = item.logs || [];
      item.logs.push({
        at: new Date().toISOString(),
        step: "状态",
        note: "更新为" + item.status
      });
    }
    await saveDb(db);
    return item;
  }
  await _ensureRepo();
  return await globalRepository.updateItem(itemId, updates);
}

async function addItemLog(db, itemId, step, note) {
  if (db && Array.isArray(db.items)) {
    const item = findItemById(db, itemId);
    if (!item) throw new Error("item_not_found");
    item.logs = item.logs || [];
    item.logs.push({
      at: new Date().toISOString(),
      step: step || "记录",
      note: note || ""
    });
    item.updatedAt = new Date().toISOString();
    await saveDb(db);
    return item;
  }
  await _ensureRepo();
  return await globalRepository.addItemLog(itemId, step, note);
}

function getUniqueOwners(db) {
  if (db && Array.isArray(db.items)) {
    const owners = new Set();
    for (const item of db.items) {
      if (item.owner) owners.add(item.owner);
    }
    return [...owners].sort();
  }
  return (async () => {
    await _ensureRepo();
    return await globalRepository.getUniqueOwners();
  })();
}

function getUniqueTensions(db) {
  if (db && Array.isArray(db.items)) {
    const tensions = new Set();
    for (const item of db.items) {
      if (item.tasks) {
        for (const task of item.tasks) {
          if (task.tension) tensions.add(task.tension);
        }
      }
    }
    return [...tensions].sort();
  }
  return (async () => {
    await _ensureRepo();
    return await globalRepository.getUniqueTensions();
  })();
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
  TASK_STATUSES,
  MODEL_STATUSES
};
