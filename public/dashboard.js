const RISK_LABELS = {
  high: "高危",
  medium: "中危",
  low: "低危",
  none: "无风险",
  unscheduled: "未计划"
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

let dashboardData = null;
let currentRiskFilter = "all";

async function api(path, options) {
  const requestOptions = options && options.body && !(options.body instanceof FormData)
    ? { ...options, headers: { 'Content-Type': 'application/json' } }
    : options;
  const res = await fetch(path, requestOptions);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekday(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return WEEKDAYS[d.getDay()];
}

function emptyHtml(icon, title, desc) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <h3>${title}</h3>
      <div class="meta">${desc}</div>
    </div>
  `;
}

function renderStats(summary) {
  const statsEl = document.getElementById('riskStats');
  if (!statsEl) return;

  statsEl.innerHTML = `
    <div class="stat"><span class="label">模型总数</span><strong>${summary.total}</strong></div>
    <div class="stat high"><span class="label">高危</span><strong>${summary.high}</strong></div>
    <div class="stat medium"><span class="label">中危</span><strong>${summary.medium}</strong></div>
    <div class="stat low"><span class="label">低危</span><strong>${summary.low}</strong></div>
    <div class="stat overdue"><span class="label">已逾期</span><strong>${summary.overdue}</strong></div>
    <div class="stat due-soon"><span class="label">7天内交付</span><strong>${summary.dueSoon}</strong></div>
    <div class="stat none"><span class="label">已交付</span><strong>${summary.none}</strong></div>
    <div class="stat unscheduled"><span class="label">未计划</span><strong>${summary.unscheduled}</strong></div>
  `;
}

function riskCardHtml(item) {
  const risk = item.risk;
  const level = risk.level;
  const details = risk.details || {};
  const totalTasks = details.totalTasks || 0;
  const incompleteTasks = details.incompleteTasks || 0;
  const completedTasks = totalTasks - incompleteTasks;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const overdue = details.overdue;
  const dueDate = item.dueDate;

  let dueHtml = '';
  if (dueDate) {
    const dueClass = overdue && item.status !== '已交付' ? 'due-highlight' : '';
    dueHtml = `<span class="pill ${dueClass}">交付: ${dueDate}${overdue && item.status !== '已交付' ? ' · 已逾期' : ''}</span>`;
  } else {
    dueHtml = '<span class="pill">无交付日期</span>';
  }

  const ownerHtml = item.owner ? `<span class="pill">负责人: ${item.owner}</span>` : '';
  const statusHtml = `<span class="pill">状态: ${item.status}</span>`;

  let progressClass = 'low';
  if (level === 'high') progressClass = 'high';
  else if (level === 'medium') progressClass = 'medium';

  return `
    <div class="risk-card ${level}">
      <div class="risk-card-header">
        <div>
          <div class="risk-card-title">${item.code || item.id} · ${item.shipType || ''}</div>
          <div class="risk-score">风险评分: ${risk.score} 分</div>
        </div>
        <span class="risk-badge ${level}">${RISK_LABELS[level]}</span>
      </div>
      <div class="risk-card-meta">
        ${statusHtml}
        ${ownerHtml}
        ${dueHtml}
        <span class="pill">任务: ${completedTasks}/${totalTasks}</span>
      </div>
      <div class="risk-reason">⚠️ ${risk.reason}</div>
      <div class="risk-progress">
        <span>任务进度</span>
        <div class="progress-bar">
          <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
        </div>
        <span>${progress}%</span>
      </div>
    </div>
  `;
}

function renderHighRiskList(highRiskList) {
  const listEl = document.getElementById('highRiskList');
  if (!listEl) return;

  let filtered = [...highRiskList];
  if (currentRiskFilter === 'high') {
    filtered = filtered.filter(i => i.risk.level === 'high');
  } else if (currentRiskFilter === 'medium') {
    filtered = filtered.filter(i => i.risk.level === 'medium');
  }

  if (filtered.length === 0) {
    listEl.innerHTML = emptyHtml('✅', '暂无风险模型', '所有模型进度正常，继续保持！');
    return;
  }

  listEl.innerHTML = filtered.map(item => riskCardHtml(item)).join('');
}

function ownerCardHtml(ownerGroup) {
  const { owner, total, high, medium, low, none, unscheduled } = ownerGroup;
  const segments = [];
  if (high > 0) segments.push({ level: 'high', count: high, percent: (high / total) * 100 });
  if (medium > 0) segments.push({ level: 'medium', count: medium, percent: (medium / total) * 100 });
  if (low > 0) segments.push({ level: 'low', count: low, percent: (low / total) * 100 });
  if (none > 0) segments.push({ level: 'none', count: none, percent: (none / total) * 100 });
  if (unscheduled > 0) segments.push({ level: 'unscheduled', count: unscheduled, percent: (unscheduled / total) * 100 });

  const breakdown = [];
  if (high > 0) breakdown.push(`<span class="high">高危 ${high}</span>`);
  if (medium > 0) breakdown.push(`<span class="medium">中危 ${medium}</span>`);
  if (low > 0) breakdown.push(`<span class="low">低危 ${low}</span>`);
  if (none > 0) breakdown.push(`<span class="none">已交付 ${none}</span>`);
  if (unscheduled > 0) breakdown.push(`<span class="unscheduled">未计划 ${unscheduled}</span>`);

  return `
    <div class="owner-card">
      <div class="owner-card-header">
        <span class="owner-name">👤 ${owner}</span>
        <span class="owner-total">共 ${total} 个模型</span>
      </div>
      <div class="owner-breakdown">
        ${breakdown.join('')}
      </div>
      <div class="owner-bar">
        ${segments.map(s => `<div class="owner-bar-segment ${s.level}" style="width: ${s.percent}%" title="${RISK_LABELS[s.level]}: ${s.count}"></div>`).join('')}
      </div>
    </div>
  `;
}

function renderOwnerDistribution(byOwner) {
  const ownerEl = document.getElementById('ownerDistribution');
  if (!ownerEl) return;

  if (byOwner.length === 0) {
    ownerEl.innerHTML = emptyHtml('👥', '暂无负责人数据', '请为模型分配负责人');
    return;
  }

  ownerEl.innerHTML = byOwner.map(group => ownerCardHtml(group)).join('');
}

function renderDeliveryPressure(pressure) {
  const pressureEl = document.getElementById('deliveryPressure');
  if (!pressureEl) return;

  const hasData = pressure.some(p => p.total > 0);
  if (!hasData) {
    pressureEl.innerHTML = `
      ${emptyHtml('📅', '未来7天无交付计划', '暂无近期需要交付的模型')}
      <div class="pressure-legend">
        <div class="legend-item"><span class="legend-dot high"></span>高危</div>
        <div class="legend-item"><span class="legend-dot medium"></span>中危</div>
        <div class="legend-item"><span class="legend-dot low"></span>低危</div>
        <div class="legend-item"><span class="legend-dot completed"></span>已交付</div>
      </div>
    `;
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysHtml = pressure.map(day => {
    const dateObj = new Date(day.date);
    const isToday = dateObj.getTime() === today.getTime();
    const weekday = getWeekday(day.date);
    const dateDisplay = `${day.date.slice(5)}${isToday ? ' (今天)' : ''}`;

    const segments = [];
    if (day.highRisk > 0) segments.push({ level: 'high', count: day.highRisk, percent: (day.highRisk / day.total) * 100 });
    if (day.mediumRisk > 0) segments.push({ level: 'medium', count: day.mediumRisk, percent: (day.mediumRisk / day.total) * 100 });
    if (day.lowRisk > 0) segments.push({ level: 'low', count: day.lowRisk, percent: (day.lowRisk / day.total) * 100 });
    if (day.completed > 0) segments.push({ level: 'completed', count: day.completed, percent: (day.completed / day.total) * 100 });

    let barInner = '';
    if (day.total === 0) {
      barInner = '';
    } else {
      barInner = segments.map(s =>
        `<div class="pressure-bar-segment ${s.level}" style="width: ${s.percent}%" title="${RISK_LABELS[s.level]}: ${s.count}">${s.count > 0 ? s.count : ''}</div>`
      ).join('');
    }

    const barClass = day.total > 0 ? `pressure-${day.pressureLevel}` : '';

    return `
      <div class="pressure-day">
        <div class="pressure-date">
          ${dateDisplay}
          <div class="weekday">周${weekday}</div>
        </div>
        <div class="pressure-bar-container">
          <div class="pressure-bar ${barClass}">
            ${barInner}
          </div>
        </div>
        <div class="pressure-total">${day.total > 0 ? day.total : '-'}</div>
      </div>
    `;
  }).join('');

  pressureEl.innerHTML = `
    ${daysHtml}
    <div class="pressure-legend">
      <div class="legend-item"><span class="legend-dot high"></span>高危</div>
      <div class="legend-item"><span class="legend-dot medium"></span>中危</div>
      <div class="legend-item"><span class="legend-dot low"></span>低危</div>
      <div class="legend-item"><span class="legend-dot completed"></span>已交付</div>
    </div>
  `;
}

async function loadDashboardData() {
  try {
    dashboardData = await api('/api/risk');
    renderAll();
  } catch (err) {
    console.error('加载仪表盘数据失败:', err);
    alert('加载数据失败: ' + err.message);
  }
}

function renderAll() {
  if (!dashboardData) return;

  renderStats(dashboardData.summary);
  renderHighRiskList(dashboardData.highRiskList);
  renderOwnerDistribution(dashboardData.byOwner);
  renderDeliveryPressure(dashboardData.deliveryPressure);
}

function initEventListeners() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = loadDashboardData;
  }

  const riskFilter = document.getElementById('riskLevelFilter');
  if (riskFilter) {
    riskFilter.onchange = function () {
      currentRiskFilter = riskFilter.value;
      if (dashboardData) {
        renderHighRiskList(dashboardData.highRiskList);
      }
    };
  }
}

document.addEventListener('DOMContentLoaded', function () {
  initEventListeners();
  loadDashboardData();
});
