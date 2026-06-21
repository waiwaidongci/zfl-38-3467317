import { getUniqueOwners } from "./data-access.js";

function getOwnerList(db) {
  const ownerMap = new Map();
  const items = db.items || [];
  for (const item of items) {
    const owner = item.owner || "";
    if (!owner) continue;
    if (!ownerMap.has(owner)) {
      ownerMap.set(owner, {
        name: owner,
        modelCount: 0,
        pendingTaskCount: 0,
        upcomingCount: 0,
        overdueCount: 0,
        latestActivity: null
      });
    }
    const stat = ownerMap.get(owner);
    stat.modelCount += 1;
    const tasks = item.tasks || [];
    for (const task of tasks) {
      if (task.status === "待检查" || task.status === "调整中") {
        stat.pendingTaskCount += 1;
      }
    }
    if (item.dueDate && item.status !== "已交付") {
      const due = new Date(item.dueDate);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      if (due <= sevenDaysLater) {
        stat.upcomingCount += 1;
      }
      if (due < now) {
        stat.overdueCount += 1;
      }
    }
    const allLogs = [
      ...(item.logs || []),
      ...(tasks.reduce((arr, t) => arr.concat(t.logs || []), []))
    ];
    for (const log of allLogs) {
      const at = new Date(log.at);
      if (!isNaN(at.getTime())) {
        if (!stat.latestActivity || at > stat.latestActivity) {
          stat.latestActivity = at;
        }
      }
    }
  }
  const list = [...ownerMap.values()];
  list.sort((a, b) => {
    if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
    if (b.pendingTaskCount !== a.pendingTaskCount) return b.pendingTaskCount - a.pendingTaskCount;
    if (a.latestActivity && b.latestActivity) return b.latestActivity - a.latestActivity;
    if (b.latestActivity) return 1;
    if (a.latestActivity) return -1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return list;
}

function getOwnerWorkspace(db, ownerName) {
  const safeOwnerName = ownerName || "";
  const items = db.items || [];
  const ownerItems = items.filter(item => (item.owner || "") === safeOwnerName);
  const models = ownerItems.map(item => {
    const tasks = item.tasks || [];
    const pendingTasks = tasks.filter(
      t => t.status === "待检查" || t.status === "调整中"
    );
    return {
      id: item.id || item.code,
      code: item.code || item.id,
      shipType: item.shipType || "",
      scale: item.scale || "",
      mastCount: item.mastCount || 0,
      riggingMaterial: item.riggingMaterial || "",
      dueDate: item.dueDate || "",
      status: item.status || "待检查",
      taskCount: tasks.length,
      pendingTaskCount: pendingTasks.length,
      tasks: tasks.map(t => ({
        id: t.id,
        position: t.position,
        tension: t.tension || "待检测",
        status: t.status,
        logs: t.logs || []
      }))
    };
  });
  const allPendingTasks = [];
  for (const item of ownerItems) {
    const tasks = item.tasks || [];
    for (const task of tasks) {
      if (task.status === "待检查" || task.status === "调整中") {
        allPendingTasks.push({
          id: task.id,
          position: task.position,
          tension: task.tension || "待检测",
          status: task.status,
          modelId: item.id || item.code,
          modelCode: item.code || item.id,
          modelShipType: item.shipType || "",
          logs: task.logs || []
        });
      }
    }
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const upcomingModels = ownerItems
    .filter(item => {
      if (!item.dueDate || item.status === "已交付") return false;
      const due = new Date(item.dueDate);
      return due <= sevenDaysLater;
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .map(item => ({
      id: item.id || item.code,
      code: item.code || item.id,
      shipType: item.shipType || "",
      dueDate: item.dueDate,
      status: item.status,
      overdue: new Date(item.dueDate) < now
    }));
  const recentCalibrationLogs = [];
  for (const item of ownerItems) {
    const itemId = item.id || item.code;
    const itemCode = item.code || item.id;
    const itemShipType = item.shipType || "";
    const itemLogs = item.logs || [];
    for (const log of itemLogs) {
      const at = new Date(log.at);
      if (isNaN(at.getTime())) continue;
      recentCalibrationLogs.push({
        at: log.at,
        step: log.step || "记录",
        note: log.note || "",
        modelId: itemId,
        modelCode: itemCode,
        modelShipType: itemShipType,
        source: "model"
      });
    }
    const tasks = item.tasks || [];
    for (const task of tasks) {
      const taskLogs = task.logs || [];
      for (const log of taskLogs) {
        const at = new Date(log.at);
        if (isNaN(at.getTime())) continue;
        recentCalibrationLogs.push({
          at: log.at,
          step: "任务",
          note: `${task.position} · ${log.note || ""}`,
          modelId: itemId,
          modelCode: itemCode,
          modelShipType: itemShipType,
          taskPosition: task.position,
          source: "task"
        });
      }
    }
  }
  recentCalibrationLogs.sort((a, b) => {
    const dateA = new Date(a.at);
    const dateB = new Date(b.at);
    return dateB.getTime() - dateA.getTime();
  });
  return {
    owner: safeOwnerName,
    modelCount: models.length,
    totalPendingTasks: allPendingTasks.length,
    upcomingModelCount: upcomingModels.length,
    overdueModelCount: upcomingModels.filter(m => m.overdue).length,
    models,
    pendingTasks: allPendingTasks,
    upcomingModels,
    recentCalibrationLogs: recentCalibrationLogs.slice(0, 20)
  };
}

export { getOwnerList, getOwnerWorkspace };
