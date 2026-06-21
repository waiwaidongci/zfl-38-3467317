import { generateTaskSummary } from "./upload-parser.js";

function newItemId() {
  return "MR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

function newTaskId() {
  return "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 4);
}

function buildItem(validatedRow, importAt) {
  const normalized = validatedRow.normalized;
  const item = {
    id: newItemId(),
    code: normalized.code,
    shipType: normalized.shipType || "",
    scale: normalized.scale || "",
    mastCount: normalized.mastCount || 0,
    riggingMaterial: normalized.riggingMaterial || "",
    owner: normalized.owner || "",
    dueDate: normalized.dueDate || "",
    status: "待检查",
    tasks: [],
    logs: [
      {
        at: importAt,
        step: "建档",
        note: "批量导入创建模型",
      },
    ],
  };

  const taskSummaries = generateTaskSummary(normalized);
  taskSummaries.forEach(task => {
    item.tasks.push({
      id: newTaskId(),
      position: task.position,
      tension: task.tension,
      status: task.status,
      logs: [
        {
          at: importAt,
          note: "导入时自动创建帆索任务",
        },
      ],
    });
  });

  if (taskSummaries.length > 0) {
    item.logs.push({
      at: importAt,
      step: "帆索",
      note: `导入时自动创建 ${taskSummaries.length} 条帆索任务`,
    });
  }

  return item;
}

function importValidatedRows(db, validRows) {
  const importAt = new Date().toISOString();
  const createdItems = [];
  const skippedItems = [];
  const importSession = {
    at: importAt,
    totalAttempted: validRows.length,
  };

  const existingCodes = new Set(db.items.map(item => item.code).filter(Boolean));

  for (const row of validRows) {
    const code = row.normalized.code;
    if (existingCodes.has(code)) {
      skippedItems.push({
        originalIndex: row.originalIndex,
        code,
        reason: "duplicate_system",
        message: `编号 ${code} 已存在，跳过`,
      });
      continue;
    }

    const item = buildItem(row, importAt);
    db.items.unshift(item);
    existingCodes.add(code);
    createdItems.push({
      originalIndex: row.originalIndex,
      code,
      id: item.id,
      taskCount: item.tasks.length,
    });
  }

  return {
    db,
    importSession: {
      ...importSession,
      created: createdItems.length,
      skipped: skippedItems.length,
    },
    createdItems,
    skippedItems,
  };
}

function commitImport(db, saveDbFn, validRows) {
  const result = importValidatedRows(db, validRows);
  return saveDbFn(result.db).then(() => ({
    success: true,
    ...result.importSession,
    createdItems: result.createdItems,
    skippedItems: result.skippedItems,
  }));
}

export { commitImport, buildItem, newItemId, newTaskId };
