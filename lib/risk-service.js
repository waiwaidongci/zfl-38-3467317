import {
  daysFromToday,
  isOverdue,
  isWithinDays,
  daysSinceLastLog,
  formatDate,
  getNextNDates
} from "./date-utils.js";

const RISK_LEVELS = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
  UNSCHEDULED: "unscheduled"
};

const RISK_LABELS = {
  high: "高危",
  medium: "中危",
  low: "低危",
  none: "无风险",
  unscheduled: "未计划"
};

const RISK_COLORS = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#65a30d",
  none: "#16a34a",
  unscheduled: "#6b7280"
};

function countIncompleteTasks(item) {
  const tasks = item.tasks || [];
  return tasks.filter(t => t.status !== "完成").length;
}

function countTotalTasks(item) {
  return (item.tasks || []).length;
}

function calculateItemRisk(item) {
  if (item.status === "已交付") {
    return {
      level: RISK_LEVELS.NONE,
      score: 0,
      factors: [],
      reason: "已交付"
    };
  }

  if (!item.dueDate) {
    return {
      level: RISK_LEVELS.UNSCHEDULED,
      score: 0,
      factors: [],
      reason: "未设置交付日期"
    };
  }

  const factors = [];
  let score = 0;

  const incompleteTasks = countIncompleteTasks(item);
  const totalTasks = countTotalTasks(item);
  const daysToDue = daysFromToday(item.dueDate);
  const daysIdle = daysSinceLastLog(item);
  const overdue = isOverdue(item.dueDate);

  if (overdue) {
    score += 100;
    factors.push({
      type: "overdue",
      weight: 100,
      description: `已逾期 ${Math.abs(daysToDue)} 天`
    });
  }

  if (!overdue && daysToDue !== null) {
    if (daysToDue <= 7 && incompleteTasks > 0) {
      const urgency = Math.max(10, (7 - daysToDue) * 10);
      const taskFactor = Math.min(40, incompleteTasks * 8);
      const taskScore = urgency + taskFactor;
      score += taskScore;
      factors.push({
        type: "near_due_incomplete",
        weight: taskScore,
        description: `${daysToDue} 天内交付，仍有 ${incompleteTasks} 个未完成任务`
      });
    } else if (daysToDue <= 14 && incompleteTasks > 0) {
      const taskRatio = totalTasks > 0 ? incompleteTasks / totalTasks : 1;
      if (taskRatio > 0.5) {
        const taskScore = 30 + Math.round(taskRatio * 20);
        score += taskScore;
        factors.push({
          type: "medium_due_high_incomplete",
          weight: taskScore,
          description: `${daysToDue} 天内交付，${Math.round(taskRatio * 100)}% 任务未完成`
        });
      }
    }
  }

  if (daysIdle !== null && daysIdle > 7) {
    const idleScore = Math.min(30, (daysIdle - 7) * 5);
    score += idleScore;
    factors.push({
      type: "no_activity",
      weight: idleScore,
      description: `已 ${daysIdle} 天无更新记录`
    });
  } else if (daysIdle === null) {
    score += 15;
    factors.push({
      type: "no_logs",
      weight: 15,
      description: "暂无任何操作记录"
    });
  }

  if (item.status === "待检查" && totalTasks > 0 && incompleteTasks === totalTasks) {
    score += 20;
    factors.push({
      type: "not_started",
      weight: 20,
      description: "任务尚未开始"
    });
  }

  let level;
  if (score >= 70) {
    level = RISK_LEVELS.HIGH;
  } else if (score >= 40) {
    level = RISK_LEVELS.MEDIUM;
  } else {
    level = RISK_LEVELS.LOW;
  }

  const reasons = factors.map(f => f.description).join("；");

  return {
    level,
    score,
    factors,
    reason: reasons || "进度正常",
    details: {
      daysToDue,
      incompleteTasks,
      totalTasks,
      daysIdle,
      overdue
    }
  };
}

function calculateAllRisks(items) {
  return items.map(item => ({
    ...item,
    risk: calculateItemRisk(item)
  }));
}

function filterByRiskLevel(itemsWithRisk, level) {
  return itemsWithRisk.filter(item => item.risk.level === level);
}

function groupByOwner(itemsWithRisk) {
  const groups = {};
  for (const item of itemsWithRisk) {
    const owner = item.owner || "未分配";
    if (!groups[owner]) {
      groups[owner] = {
        owner,
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
        unscheduled: 0,
        items: []
      };
    }
    groups[owner].total++;
    groups[owner][item.risk.level]++;
    groups[owner].items.push(item);
  }
  return Object.values(groups).sort((a, b) => {
    const riskScoreA = a.high * 3 + a.medium * 2 + a.low;
    const riskScoreB = b.high * 3 + b.medium * 2 + b.low;
    return riskScoreB - riskScoreA;
  });
}

function getDeliveryPressure(itemsWithRisk, days = 7) {
  const dates = getNextNDates(days);
  const pressure = dates.map(date => {
    const dayItems = itemsWithRisk.filter(item => item.dueDate === date);
    const highRisk = dayItems.filter(i => i.risk.level === RISK_LEVELS.HIGH).length;
    const mediumRisk = dayItems.filter(i => i.risk.level === RISK_LEVELS.MEDIUM).length;
    const lowRisk = dayItems.filter(i => i.risk.level === RISK_LEVELS.LOW).length;
    const completed = dayItems.filter(i => i.risk.level === RISK_LEVELS.NONE).length;

    let pressureLevel = "low";
    if (highRisk > 0 || (dayItems.length > 2 && mediumRisk > 1)) {
      pressureLevel = "high";
    } else if (mediumRisk > 0 || dayItems.length > 2) {
      pressureLevel = "medium";
    }

    return {
      date,
      weekday: date.slice(8, 10),
      total: dayItems.length,
      highRisk,
      mediumRisk,
      lowRisk,
      completed,
      pressureLevel,
      items: dayItems
    };
  });
  return pressure;
}

function getRiskSummary(itemsWithRisk) {
  const summary = {
    total: itemsWithRisk.length,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
    unscheduled: 0,
    overdue: 0,
    dueSoon: 0
  };

  for (const item of itemsWithRisk) {
    summary[item.risk.level]++;
    if (item.risk.details?.overdue) summary.overdue++;
    if (item.dueDate && isWithinDays(item.dueDate, 7) && item.status !== "已交付") {
      summary.dueSoon++;
    }
  }

  return summary;
}

function getHighRiskList(itemsWithRisk) {
  return itemsWithRisk
    .filter(item => item.risk.level === RISK_LEVELS.HIGH || item.risk.level === RISK_LEVELS.MEDIUM)
    .sort((a, b) => {
      const levelOrder = { high: 0, medium: 1 };
      const levelDiff = levelOrder[a.risk.level] - levelOrder[b.risk.level];
      if (levelDiff !== 0) return levelDiff;
      return b.risk.score - a.risk.score;
    });
}

export {
  RISK_LEVELS,
  RISK_LABELS,
  RISK_COLORS,
  calculateItemRisk,
  calculateAllRisks,
  filterByRiskLevel,
  groupByOwner,
  getDeliveryPressure,
  getRiskSummary,
  getHighRiskList,
  countIncompleteTasks,
  countTotalTasks
};
