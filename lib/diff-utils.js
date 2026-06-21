function countTasks(items) {
  return (items || []).reduce((count, item) => count + ((item.tasks || []).length), 0);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

function getItemKey(item) {
  return item.id || item.code;
}

function buildItemMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = getItemKey(item);
    if (key) map.set(key, item);
  }
  return map;
}

function buildRuleMap(rules) {
  const map = new Map();
  for (const rule of rules || []) {
    if (rule.id) map.set(rule.id, rule);
  }
  return map;
}

function compareModels(currentItems, backupItems) {
  const currentMap = buildItemMap(currentItems);
  const backupMap = buildItemMap(backupItems);
  const allKeys = new Set([...currentMap.keys(), ...backupMap.keys()]);
  const added = [];
  const removed = [];
  const modified = [];

  for (const key of allKeys) {
    const inCurrent = currentMap.has(key);
    const inBackup = backupMap.has(key);
    if (inCurrent && !inBackup) {
      added.push({ key, item: currentMap.get(key) });
    } else if (!inCurrent && inBackup) {
      removed.push({ key, item: backupMap.get(key) });
    } else {
      const current = currentMap.get(key);
      const backup = backupMap.get(key);
      if (!deepEqual(current, backup)) {
        modified.push({
          key,
          current,
          backup,
          changes: findItemChanges(current, backup)
        });
      }
    }
  }

  return { added, removed, modified };
}

function findItemChanges(current, backup) {
  const changes = [];
  const fields = ['code', 'shipType', 'scale', 'mastCount', 'riggingMaterial', 'owner', 'dueDate', 'status'];
  for (const field of fields) {
    if (!deepEqual(current[field], backup[field])) {
      changes.push({
        field,
        current: current[field],
        backup: backup[field]
      });
    }
  }

  const currentTasks = current.tasks || [];
  const backupTasks = backup.tasks || [];
  if (currentTasks.length !== backupTasks.length) {
    changes.push({
      field: 'tasks',
      type: 'count',
      current: currentTasks.length,
      backup: backupTasks.length
    });
  } else {
    for (let i = 0; i < currentTasks.length; i++) {
      if (!deepEqual(currentTasks[i], backupTasks[i])) {
        changes.push({
          field: 'tasks',
          type: 'modified',
          index: i,
          taskId: currentTasks[i].id || backupTasks[i]?.id
        });
      }
    }
  }

  const currentLogs = current.logs || [];
  const backupLogs = backup.logs || [];
  if (currentLogs.length !== backupLogs.length) {
    changes.push({
      field: 'logs',
      type: 'count',
      current: currentLogs.length,
      backup: backupLogs.length
    });
  }

  return changes;
}

function compareRules(currentRules, backupRules) {
  const currentMap = buildRuleMap(currentRules);
  const backupMap = buildRuleMap(backupRules);
  const allKeys = new Set([...currentMap.keys(), ...backupMap.keys()]);
  const added = [];
  const removed = [];
  const modified = [];

  for (const key of allKeys) {
    const inCurrent = currentMap.has(key);
    const inBackup = backupMap.has(key);
    if (inCurrent && !inBackup) {
      added.push({ id: key, rule: currentMap.get(key) });
    } else if (!inCurrent && inBackup) {
      removed.push({ id: key, rule: backupMap.get(key) });
    } else {
      const current = currentMap.get(key);
      const backup = backupMap.get(key);
      if (!deepEqual(current, backup)) {
        modified.push({
          id: key,
          current,
          backup
        });
      }
    }
  }

  return { added, removed, modified };
}

function computeDiff(currentData, backupData) {
  const currentItems = currentData.models?.items || currentData.items || [];
  const backupItems = backupData.data?.models?.items || backupData.models?.items || backupData.items || [];
  const currentRules = currentData.calibration?.rules || [];
  const backupRules = backupData.data?.calibration?.rules || backupData.calibration?.rules || [];

  const modelsDiff = compareModels(currentItems, backupItems);
  const rulesDiff = compareRules(currentRules, backupRules);

  const currentModelCount = currentItems.length;
  const backupModelCount = backupItems.length;
  const currentTaskCount = countTasks(currentItems);
  const backupTaskCount = countTasks(backupItems);
  const currentRuleCount = currentRules.length;
  const backupRuleCount = backupRules.length;

  const summary = {
    models: {
      current: currentModelCount,
      backup: backupModelCount,
      added: modelsDiff.added.length,
      removed: modelsDiff.removed.length,
      modified: modelsDiff.modified.length
    },
    tasks: {
      current: currentTaskCount,
      backup: backupTaskCount
    },
    rules: {
      current: currentRuleCount,
      backup: backupRuleCount,
      added: rulesDiff.added.length,
      removed: rulesDiff.removed.length,
      modified: rulesDiff.modified.length
    },
    hasChanges:
      modelsDiff.added.length > 0 ||
      modelsDiff.removed.length > 0 ||
      modelsDiff.modified.length > 0 ||
      rulesDiff.added.length > 0 ||
      rulesDiff.removed.length > 0 ||
      rulesDiff.modified.length > 0
  };

  return {
    summary,
    models: modelsDiff,
    rules: rulesDiff
  };
}

export { computeDiff, deepEqual, countTasks };
