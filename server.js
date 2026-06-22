import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuffer, generateTaskSummary } from "./lib/upload-parser.js";
import { validateAll } from "./lib/data-validator.js";
import { commitImport } from "./lib/data-writer.js";
import { importPage } from "./lib/pages.js";
import { parseMultipart, extractBoundary } from "./lib/multipart.js";
import { handleTasksApi } from "./lib/task-api.js";
import { handleRiskApi } from "./lib/risk-api.js";
import {
  loadDb as dalLoadDb,
  saveDb as dalSaveDb,
  getAllItems,
  createItem as dalCreateItem,
  updateItem as dalUpdateItem,
  addItemLog as dalAddItemLog,
  createTask as dalCreateTask,
  TASK_STATUSES
} from "./lib/data-access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "model-rigging-calibration.json");
const port = Number(process.env.PORT || 3038);
const seed = {
  "items": [
    {
      "code": "MR-001",
      "shipType": "福船",
      "scale": "1:48",
      "mastCount": 3,
      "riggingMaterial": "蜡线",
      "owner": "周宁",
      "dueDate": "2026-06-28",
      "status": "校准中",
      "tasks": [
        {
          "id": "T-1",
          "position": "前桅侧支索",
          "tension": "偏松",
          "status": "调整中",
          "logs": [
            {
              "at": "2026-06-12",
              "note": "已缩短2mm"
            }
          ]
        }
      ],
      "logs": []
    }
  ]
};
const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
const stages = ["待检查","校准中","待复核","已交付"];
const statLabels = ["待检查","校准中","待复核","已交付"];
const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "MR-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
function filterByDateRange(items, start, end) {
  return items.filter(item => {
    if (!item.dueDate) return false;
    const d = new Date(item.dueDate);
    if (start && d < new Date(start)) return false;
    if (end && d > new Date(end + "T23:59:59")) return false;
    return true;
  });
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function serveStatic(res, filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return false;
    }
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch (err) {
    return false;
  }
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古船模型帆索校准</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --calendar-bg:#fafbf9; --calendar-hover:#e6ebe2; --calendar-today:#d6e3cc; --calendar-due:#c4d6b4; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    .header-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    .view-tabs { display:flex; gap:4px; background:var(--bg); padding:4px; border-radius:8px; }
    .view-tabs button { background:transparent; color:var(--muted); padding:6px 14px; border-radius:6px; font-weight:600; }
    .view-tabs button.active { background:var(--panel); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.08); }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    main.calendar-view { grid-template-columns:1fr; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    button.ghost { background:transparent; color:var(--muted); border:1px solid var(--line); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; align-items:center; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .empty { text-align:center; padding:60px 20px; color:var(--muted); }
    .empty-icon { font-size:56px; margin-bottom:12px; opacity:.5; }
    .empty h3 { margin:0 0 8px; color:var(--ink); font-size:18px; }
    .calendar-panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:20px; }
    .calendar-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .calendar-header h2 { margin:0; font-size:20px; }
    .calendar-nav { display:flex; gap:8px; }
    .calendar-nav button { padding:6px 12px; font-size:14px; }
    .calendar-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; background:var(--line); border-radius:6px; overflow:hidden; }
    .calendar-cell { background:var(--calendar-bg); min-height:96px; padding:8px; cursor:pointer; transition:background .15s; display:flex; flex-direction:column; }
    .calendar-cell:hover { background:var(--calendar-hover); }
    .calendar-cell.other-month { opacity:.35; }
    .calendar-cell.today { background:var(--calendar-today); }
    .calendar-cell.selected { background:var(--accent); color:#fff; }
    .calendar-cell.selected .day-number { color:#fff; }
    .calendar-cell.selected .meta { color:#e6ebe2; }
    .day-number { font-weight:600; font-size:15px; margin-bottom:4px; }
    .day-dots { display:flex; flex-wrap:wrap; gap:3px; margin-top:auto; }
    .day-dot { width:6px; height:6px; border-radius:50%; background:var(--accent); }
    .day-count { font-size:11px; color:var(--muted); margin-top:2px; }
    .calendar-cell.selected .day-count { color:#e6ebe2; }
    .weekday { background:var(--panel); padding:10px 8px; text-align:center; font-size:13px; color:var(--muted); font-weight:600; }
    .calendar-detail { margin-top:20px; }
    .calendar-detail-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    .calendar-detail-header h3 { margin:0; font-size:16px; }
    .due-tag { display:inline-block; background:var(--calendar-due); color:var(--accent); padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600; margin-left:6px; }
    .card .due-highlight { color:var(--warn); font-weight:700; }
    .import-btn { background:#2d5a8e; }
    main.kanban-view { grid-template-columns: 1fr; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .calendar-cell{min-height:70px;padding:4px;} }
  </style>
  <link rel="stylesheet" href="/public/kanban.css">
</head>
<body>
  <header>
    <div class="header-left">
      <div><h1>古船模型帆索校准</h1><div class="meta">模型、帆索任务和校准记录串联</div></div>
      <div class="view-tabs">
        <button id="tabList" class="active">模型列表</button>
        <button id="tabKanban">任务看板</button>
        <button id="tabCalendar">交付日历</button>
        <button id="tabDashboard">风险仪表盘</button>
      </div>
    </div>
    <div style="display:flex; gap:8px; align-items:center;">
      <button id="importBtn" class="import-btn">📥 批量导入</button>
      <button id="reload">刷新</button>
    </div>
  </header>
  <main id="main">
    <section id="listSection">
      <form id="createForm"><h2>新增模型</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存模型</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>新增帆索任务</h2><label>选择模型</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
    </section>
    <section id="listSectionRight">
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select>
        <input id="search" placeholder="搜索编号或关键词">
      </div>
      <div class="panel"><h2>创建模型后可拆分帆索任务，逐条记录松紧状态、调整备注和完成时间。</h2><div class="grid" id="cards"></div></div>
    </section>
    <section id="calendarSection" style="display:none">
      <div class="calendar-panel">
        <div class="calendar-header">
          <h2 id="calendarTitle"></h2>
          <div class="calendar-nav">
            <button class="ghost" id="prevMonth">← 上月</button>
            <button class="ghost" id="todayBtn">今天</button>
            <button class="ghost" id="nextMonth">下月 →</button>
          </div>
        </div>
        <div class="calendar-grid" id="calendarGrid"></div>
      </div>
      <div class="calendar-detail" id="calendarDetail"></div>
    </section>
    <section id="kanbanSection" style="display:none">
      <div class="kanban-view">
        <div class="kanban-stats" id="kanbanStats"></div>
        <div class="kanban-toolbar">
          <label>模型
            <select id="kanbanModelFilter"><option value="">全部模型</option></select>
          </label>
          <label>负责人
            <select id="kanbanOwnerFilter"><option value="">全部负责人</option></select>
          </label>
          <label>松紧状态
            <select id="kanbanTensionFilter"><option value="">全部松紧</option></select>
          </label>
          <label class="date-range">交付日期
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="date" id="kanbanDueStart" placeholder="开始">
              <span style="color:var(--muted)">至</span>
              <input type="date" id="kanbanDueEnd" placeholder="结束">
            </div>
          </label>
          <button class="btn-clear" id="kanbanClearFilters">清除筛选</button>
        </div>
        <div class="kanban-board" id="kanbanBoard"></div>
      </div>
    </section>
  </main>
  <script>
    const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
    const stages = ["待检查","校准中","待复核","已交付"];
    const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];
    const weekdays = ["日","一","二","三","四","五","六"];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    const calendarGrid = document.querySelector('#calendarGrid');
    const calendarTitle = document.querySelector('#calendarTitle');
    const calendarDetail = document.querySelector('#calendarDetail');
    let items = [];
    let currentView = 'list';
    let viewDate = new Date();
    let selectedDate = null;

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }

    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }

    function isSameDay(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    }

    function formatDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    function isOverdue(dueDate) {
      if (!dueDate) return false;
      const today = new Date();
      today.setHours(0,0,0,0);
      return new Date(dueDate) < today;
    }

    function emptyHtml(icon, title, desc) {
      return '<div class="empty"><div class="empty-icon">' + icon + '</div><h3>' + title + '</h3><div class="meta">' + desc + '</div></div>';
    }

    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const dueHtml = item.dueDate ? '<div class="meta"><b>交付日期</b> <span class="' + (isOverdue(item.dueDate) && item.status !== '已交付' ? 'due-highlight' : '') + '">' + item.dueDate + '</span>' + (isOverdue(item.dueDate) && item.status !== '已交付' ? ' <span class="due-tag">已逾期</span>' : '') + '</div>' : '';
      const ownerHtml = item.owner ? '<div class="meta"><b>负责人</b> ' + item.owner + '</div>' : '';
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+t.position+' · '+t.status+' · '+t.tension+'</div>').join('');
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+'</span>'+main+ownerHtml+dueHtml+tasks+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }

    function renderList() {
      itemSelect.innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      if (visible.length === 0) {
        cards.innerHTML = emptyHtml('📋', '暂无模型', '请创建模型或调整筛选条件');
      } else {
        cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      }
      bindCardEvents();
    }

    function bindCardEvents() {
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
    }

    function getItemsByDate(dateStr) {
      return items.filter(item => item.dueDate === dateStr);
    }

    function renderCalendar() {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      calendarTitle.textContent = year + '年' + (month + 1) + '月';

      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDay = firstDay.getDay();
      const daysInMonth = lastDay.getDate();
      const today = new Date();

      let html = weekdays.map(w => '<div class="weekday">' + w + '</div>').join('');

      const prevMonthLast = new Date(year, month, 0).getDate();
      for (let i = startDay - 1; i >= 0; i--) {
        const d = prevMonthLast - i;
        const dateObj = new Date(year, month - 1, d);
        const dateStr = formatDate(dateObj);
        const dayItems = getItemsByDate(dateStr);
        html += '<div class="calendar-cell other-month" data-date="' + dateStr + '"><div class="day-number">' + d + '</div>' + renderDayDots(dayItems) + '</div>';
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const dateStr = formatDate(dateObj);
        const dayItems = getItemsByDate(dateStr);
        let classes = 'calendar-cell';
        if (isSameDay(dateObj, today)) classes += ' today';
        if (selectedDate && dateStr === selectedDate) classes += ' selected';
        html += '<div class="' + classes + '" data-date="' + dateStr + '"><div class="day-number">' + d + '</div>' + renderDayDots(dayItems) + '</div>';
      }

      const remaining = 42 - (startDay + daysInMonth);
      for (let d = 1; d <= remaining; d++) {
        const dateObj = new Date(year, month + 1, d);
        const dateStr = formatDate(dateObj);
        const dayItems = getItemsByDate(dateStr);
        html += '<div class="calendar-cell other-month" data-date="' + dateStr + '"><div class="day-number">' + d + '</div>' + renderDayDots(dayItems) + '</div>';
      }

      calendarGrid.innerHTML = html;

      document.querySelectorAll('.calendar-cell').forEach(cell => {
        cell.onclick = () => {
          selectedDate = cell.dataset.date;
          renderCalendar();
          renderCalendarDetail();
        };
      });

      renderCalendarDetail();
    }

    function renderDayDots(dayItems) {
      if (dayItems.length === 0) return '';
      const dots = dayItems.slice(0, 5).map(() => '<span class="day-dot"></span>').join('');
      const count = dayItems.length > 5 ? '<div class="day-count">+' + (dayItems.length - 5) + '</div>' : '';
      return '<div class="day-dots">' + dots + '</div>' + count;
    }

    function renderCalendarDetail() {
      if (!selectedDate) {
        const monthItems = items.filter(item => {
          if (!item.dueDate) return false;
          const d = new Date(item.dueDate);
          return d.getFullYear() === viewDate.getFullYear() && d.getMonth() === viewDate.getMonth();
        });
        if (monthItems.length === 0) {
          calendarDetail.innerHTML = '<div class="panel">' + emptyHtml('📅', '本月暂无交付计划', '选择具体日期查看当天交付的模型，或创建新模型设置交付日期') + '</div>';
        } else {
          const sorted = [...monthItems].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
          calendarDetail.innerHTML = '<div class="panel"><div class="calendar-detail-header"><h3>本月待交付（' + sorted.length + '）</h3></div><div class="grid">' + sorted.map(item => cardHtml(item)).join('') + '</div></div>';
        }
      } else {
        const dayItems = getItemsByDate(selectedDate);
        const dateObj = new Date(selectedDate);
        const dateLabel = selectedDate + ' 周' + weekdays[dateObj.getDay()];
        if (dayItems.length === 0) {
          calendarDetail.innerHTML = '<div class="panel"><div class="calendar-detail-header"><h3>' + dateLabel + '</h3><button class="ghost" id="clearDate">清除筛选</button></div>' + emptyHtml('🌊', '当天无交付模型', '该日期没有计划交付的模型') + '</div>';
        } else {
          calendarDetail.innerHTML = '<div class="panel"><div class="calendar-detail-header"><h3>' + dateLabel + ' · 共 ' + dayItems.length + ' 个模型</h3><button class="ghost" id="clearDate">清除筛选</button></div><div class="grid">' + dayItems.map(item => cardHtml(item)).join('') + '</div></div>';
        }
        const clearBtn = document.querySelector('#clearDate');
        if (clearBtn) clearBtn.onclick = () => { selectedDate = null; renderCalendar(); };
      }
      bindCardEvents();
    }

    function switchView(view) {
      currentView = view;
      document.querySelector('#tabList').classList.toggle('active', view === 'list');
      document.querySelector('#tabKanban').classList.toggle('active', view === 'kanban');
      document.querySelector('#tabCalendar').classList.toggle('active', view === 'calendar');
      document.querySelector('#listSection').style.display = view === 'list' ? '' : 'none';
      document.querySelector('#listSectionRight').style.display = view === 'list' ? '' : 'none';
      document.querySelector('#calendarSection').style.display = view === 'calendar' ? '' : 'none';
      document.querySelector('#kanbanSection').style.display = view === 'kanban' ? '' : 'none';
      document.querySelector('#main').classList.toggle('calendar-view', view === 'calendar');
      document.querySelector('#main').classList.toggle('kanban-view', view === 'kanban');
      if (view === 'calendar') {
        renderCalendar();
      } else if (view === 'kanban') {
        if (window.initKanban) {
          initKanban();
        }
      } else {
        renderList();
      }
    }

    function render() {
      if (currentView === 'list') renderList();
      else if (currentView === 'calendar') renderCalendar();
      else if (currentView === 'kanban' && window.refreshKanban) refreshKanban();
    }

    async function load() {
      items = await api('/api/items');
      render();
    }

    async function refreshAll() {
      items = await api('/api/items');
      if (currentView === 'kanban' && window.refreshKanban) {
        await refreshKanban();
      } else {
        render();
      }
    }

    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await refreshAll(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await refreshAll(); };
    document.querySelector('#statusFilter').onchange = render;
    document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = refreshAll;
    document.querySelector('#importBtn').onclick = () => { location.href = '/import'; };
    document.querySelector('#tabList').onclick = () => switchView('list');
    document.querySelector('#tabKanban').onclick = () => switchView('kanban');
    document.querySelector('#tabCalendar').onclick = () => switchView('calendar');
    document.querySelector('#tabDashboard').onclick = () => { location.href = '/dashboard'; };
    document.querySelector('#prevMonth').onclick = () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); };
    document.querySelector('#nextMonth').onclick = () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); };
    document.querySelector('#todayBtn').onclick = () => { viewDate = new Date(); selectedDate = formatDate(new Date()); renderCalendar(); };

    renderForms();
    load();
  </script>
  <script src="/public/kanban.js"></script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    if (url.pathname.startsWith('/public/')) {
      const publicPath = join(__dirname, 'public');
      const filePath = join(publicPath, url.pathname.slice('/public/'.length));
      const served = await serveStatic(res, filePath);
      if (served) return;
    }
    
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/import") return html(res, importPage());
    if (req.method === "GET" && url.pathname === "/dashboard") {
      const dashboardPath = join(__dirname, "public", "dashboard.html");
      const served = await serveStatic(res, dashboardPath);
      if (served) return;
    }
    
    const taskResult = await handleTasksApi(req, res, db);
    if (taskResult !== null) return;

    const riskResult = await handleRiskApi(req, res, db);
    if (riskResult !== null) return;

    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "GET" && url.pathname === "/api/items/calendar") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const filtered = filterByDateRange(db.items, start, end);
      return send(res, 200, filtered.map(summarize));
    }
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建模型" }] };
      item.tasks = [];
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = db.items.find(x => x.id === patch[1] || x.code === patch[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      Object.assign(item, await body(req));
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = db.items.find(x => x.id === log[1] || x.code === log[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = db.items.find(x => x.id === action[1] || x.code === action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.tasks ||= [];
      item.tasks.push({ id: "T-" + Date.now(), position: input.position, tension: input.tension, status: "待检查", logs: [{ at: new Date().toISOString(), note: input.note || "新增帆索任务" }] });
      item.status = "校准中";
      item.logs.push({ at: new Date().toISOString(), step: "帆索", note: input.position + " · " + input.tension });
      await saveDb(db);
      return send(res, 201, item);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));

    if (req.method === "POST" && url.pathname === "/api/import/preview") {
      const contentType = req.headers["content-type"] || "";
      const boundary = extractBoundary(contentType);
      if (!boundary) return send(res, 400, { error: "invalid_multipart" });

      const parts = await parseMultipart(req, boundary);
      const filePart = parts.find(p => p.isFile && p.name === "file");
      if (!filePart) return send(res, 400, { error: "no_file" });
      if (filePart.data.length === 0) return send(res, 400, { error: "empty_file" });

      const parsed = parseBuffer(filePart.data, filePart.filename || "");
      const validated = validateAll(parsed, db.items);
      validated.rows.forEach(r => {
        r._taskPreview = generateTaskSummary(r.normalized);
      });

      return send(res, 200, validated);
    }

    if (req.method === "POST" && url.pathname === "/api/import/commit") {
      const input = await body(req);
      if (!input.rows || !Array.isArray(input.rows)) {
        return send(res, 400, { error: "invalid_rows" });
      }
      const result = await commitImport(db, saveDb, input.rows);
      return send(res, 200, result);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古船模型帆索校准 listening on http://localhost:" + port));
