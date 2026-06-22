var wsModelStatuses = ["待检查", "校准中", "待复核", "已交付"];
var wsTaskStatuses = ["待检查", "调整中", "待复核", "完成"];

var wsOwnerList = [];
var wsCurrentWorkspace = null;
var wsInitializing = false;

async function wsApi(path, options) {
  var token = localStorage.getItem('auth_token');
  var reqOptions = options || {};
  if (!reqOptions.headers) reqOptions.headers = {};
  if (token && typeof reqOptions.headers === 'object' && !(reqOptions.headers instanceof Headers)) {
    reqOptions.headers['Authorization'] = 'Bearer ' + token;
  }
  if (reqOptions.body && !(reqOptions.body instanceof FormData)) {
    reqOptions.headers['Content-Type'] = 'application/json';
  }
  var res = await fetch(path, reqOptions);
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('unauthorized');
  }
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function wsFormatDateTime(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  var h = String(d.getHours()).padStart(2, '0');
  var min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function wsGetTensionClass(tension) {
  var map = { '偏紧': 'tension-tight', '偏松': 'tension-loose', '正常': 'tension-normal' };
  return map[tension] || 'tension-pending';
}

function wsEmptyHtml(icon, title, desc) {
  return '<div class="ws-empty"><div class="ws-empty-icon">' + icon + '</div><div>' + title + '</div><div style="font-size:13px;margin-top:4px">' + desc + '</div></div>';
}

function wsModelCard(m) {
  var overdue = m.dueDate && m.status !== '已交付' && new Date(m.dueDate) < new Date();
  return '<div class="ws-model-card">' +
    '<div class="ws-model-card-header">' +
      '<span class="ws-model-code" data-ws-detail="' + m.id + '">' + m.code + '</span>' +
      '<span class="ws-model-status status-' + m.status + '">' + m.status + '</span>' +
    '</div>' +
    '<div class="ws-model-meta">' +
      '<span>' + (m.shipType || '') + '</span>' +
      '<span>' + (m.scale || '') + '</span>' +
      '<span>' + (m.riggingMaterial || '') + '</span>' +
      (m.dueDate ? '<span class="ws-model-due' + (overdue ? ' overdue' : '') + '">交付: ' + m.dueDate + (overdue ? ' (逾期)' : '') + '</span>' : '') +
    '</div>' +
    '<div class="ws-model-meta" style="font-size:12px">帆索任务 ' + m.taskCount + ' · 待处理 ' + m.pendingTaskCount + '</div>' +
    '<div class="ws-model-actions">' +
      '<select data-ws-model-status="' + m.id + '">' +
        wsModelStatuses.map(function(s) { return '<option' + (s === m.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
      '</select>' +
      '<button class="ws-btn-note" data-ws-note="' + m.id + '">追加备注</button>' +
      '<button class="ws-btn-detail" data-ws-detail="' + m.id + '">查看详情 →</button>' +
    '</div>' +
  '</div>';
}

function wsTaskCard(t) {
  return '<div class="ws-task-item">' +
    '<span class="ws-task-position">' + t.position + '</span>' +
    '<span class="ws-task-model" data-ws-detail="' + t.modelId + '">' + t.modelCode + '</span>' +
    '<span class="ws-task-tension ' + wsGetTensionClass(t.tension) + '">' + t.tension + '</span>' +
    '<div class="ws-task-status-switch">' +
      wsTaskStatuses.map(function(s) {
        return '<button class="ws-task-status-btn' + (s === t.status ? ' active' : '') + '" data-ws-task-status="' + t.id + '" data-ws-item-id="' + (t.modelItemId || t.modelId) + '" data-status="' + s + '">' + s + '</button>';
      }).join('') +
    '</div>' +
  '</div>';
}

function wsUpcomingCard(m) {
  return '<div class="ws-upcoming-item' + (m.overdue ? ' overdue' : '') + '" data-ws-detail="' + m.id + '">' +
    '<div class="ws-upcoming-left">' +
      '<span class="ws-upcoming-code">' + m.code + '</span>' +
      '<span class="ws-upcoming-ship">' + m.shipType + '</span>' +
    '</div>' +
    '<div class="ws-upcoming-right">' +
      '<span class="ws-model-status status-' + m.status + '">' + m.status + '</span>' +
      '<span class="ws-upcoming-date' + (m.overdue ? ' overdue' : '') + '">' + m.dueDate + (m.overdue ? ' 逾期' : '') + '</span>' +
    '</div>' +
  '</div>';
}

function wsLogCard(log) {
  return '<div class="ws-log-item">' +
    '<div class="ws-log-time">' + wsFormatDateTime(log.at) + '</div>' +
    '<span class="ws-log-step step-' + log.step + '">' + log.step + '</span>' +
    '<span class="ws-log-model" data-ws-detail="' + log.modelId + '">' + log.modelCode + '</span>' +
    '<div class="ws-log-note">' + log.note + '</div>' +
  '</div>';
}

function wsOwnerCard(o) {
  var initial = o.name ? o.name.charAt(0) : '?';
  return '<div class="ws-owner-card" data-owner="' + encodeURIComponent(o.name) + '">' +
    '<div class="ws-owner-header">' +
      '<div class="ws-owner-name">' + o.name + '</div>' +
      '<div class="ws-owner-avatar">' + initial + '</div>' +
    '</div>' +
    '<div class="ws-owner-stats">' +
      '<div class="ws-owner-stat"><span class="num accent">' + o.modelCount + '</span><span class="lbl">模型</span></div>' +
      '<div class="ws-owner-stat"><span class="num' + (o.pendingTaskCount > 0 ? ' warn' : '') + '">' + o.pendingTaskCount + '</span><span class="lbl">待处理</span></div>' +
      '<div class="ws-owner-stat"><span class="num' + (o.overdueCount > 0 ? ' warn' : '') + '">' + o.overdueCount + '</span><span class="lbl">逾期</span></div>' +
      '<div class="ws-owner-stat"><span class="num">' + o.upcomingCount + '</span><span class="lbl">近期交付</span></div>' +
    '</div>' +
  '</div>';
}

function wsSectionHtml(title, count, emptyIcon, emptyTitle, emptyDesc, itemsHtml) {
  var content = itemsHtml || wsEmptyHtml(emptyIcon, emptyTitle, emptyDesc);
  return '<div class="ws-section">' +
    '<div class="ws-section-title">' + title + ' <span class="badge">' + count + '</span></div>' +
    content +
  '</div>';
}

function wsRenderOwnerList() {
  var container = document.getElementById('wsOwnerList');
  if (!container) return;
  if (wsOwnerList.length === 0) {
    container.innerHTML = wsEmptyHtml('👤', '暂无负责人', '所有模型均未指定负责人');
    return;
  }
  container.innerHTML = wsOwnerList.map(wsOwnerCard).join('');

  container.querySelectorAll('.ws-owner-card').forEach(function(card) {
    card.onclick = function() {
      var ownerName = decodeURIComponent(card.dataset.owner);
      wsShowWorkspace(ownerName);
    };
  });
}

function wsShowWorkspace(ownerName) {
  var wsSection = document.getElementById('wsWorkspace');
  var listSection = document.getElementById('wsOwnerList');
  var wsHeader = document.querySelector('.ws-section-header');
  if (wsHeader) wsHeader.style.display = 'none';
  listSection.style.display = 'none';
  wsSection.style.display = '';
  if (typeof previousView !== 'undefined') {
    previousView = 'workspace';
  }
  if (typeof currentView !== 'undefined') {
    currentView = 'workspace';
  }
  if (!wsInitializing && typeof handlingPopState !== 'undefined' && !handlingPopState) {
    var targetUrl = '/workspace/' + encodeURIComponent(ownerName);
    if (location.pathname !== targetUrl) {
      history.pushState({}, '', targetUrl);
    }
  }
  wsLoadWorkspace(ownerName);
}

function wsShowOwnerList() {
  var wsSection = document.getElementById('wsWorkspace');
  var listSection = document.getElementById('wsOwnerList');
  var wsHeader = document.querySelector('.ws-section-header');
  if (wsHeader) wsHeader.style.display = '';
  listSection.style.display = '';
  wsSection.style.display = 'none';
  wsCurrentWorkspace = null;
  if (typeof handlingPopState !== 'undefined' && !handlingPopState && location.pathname.startsWith('/workspace/')) {
    history.pushState({}, '', '/');
  }
  if (typeof switchView === 'function') switchView('workspace');
}

function wsGetOwnerFromPath() {
  var m = location.pathname.match(/^\/workspace\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function wsRenderWorkspace(data) {
  var container = document.getElementById('wsWorkspace');
  if (!container || !data) return;
  var initial = data.owner ? data.owner.charAt(0) : '?';

  var html = '<div class="ws-workspace">';

  html += '<div class="ws-header">' +
    '<div class="ws-header-left">' +
      '<div class="ws-header-avatar">' + initial + '</div>' +
      '<div class="ws-header-info">' +
        '<h2>' + data.owner + ' 的工作台</h2>' +
        '<div class="meta">名下 ' + data.modelCount + ' 个模型 · ' + data.totalPendingTasks + ' 个待处理任务</div>' +
      '</div>' +
    '</div>' +
    '<button class="ghost" id="wsBackBtn">← 返回负责人列表</button>' +
  '</div>';

  html += '<div class="ws-summary-stats">' +
    '<div class="ws-summary-stat"><span class="num accent">' + data.modelCount + '</span><span class="lbl">名下模型</span></div>' +
    '<div class="ws-summary-stat"><span class="num' + (data.totalPendingTasks > 0 ? '" style="color:var(--warn)' : '') + '">' + data.totalPendingTasks + '</span><span class="lbl">待处理任务</span></div>' +
    '<div class="ws-summary-stat"><span class="num' + (data.overdueModelCount > 0 ? '" style="color:var(--warn)' : '') + '">' + data.overdueModelCount + '</span><span class="lbl">已逾期</span></div>' +
    '<div class="ws-summary-stat"><span class="num">' + data.upcomingModelCount + '</span><span class="lbl">近期交付</span></div>' +
  '</div>';

  var modelsHtml = data.models.length === 0
    ? null
    : '<div class="ws-model-grid">' + data.models.map(wsModelCard).join('') + '</div>';
  html += wsSectionHtml('名下模型', data.models.length, '📦', '暂无模型', '该负责人名下暂无分配的模型', modelsHtml);

  var tasksHtml = data.pendingTasks.length === 0
    ? null
    : '<div class="ws-task-list">' + data.pendingTasks.map(wsTaskCard).join('') + '</div>';
  html += wsSectionHtml('待处理帆索任务', data.pendingTasks.length, '✅', '暂无待处理任务', '所有帆索任务已处理完毕', tasksHtml);

  var upcomingHtml = data.upcomingModels.length === 0
    ? null
    : '<div class="ws-upcoming-list">' + data.upcomingModels.map(wsUpcomingCard).join('') + '</div>';
  html += wsSectionHtml('近期待交付模型', data.upcomingModels.length, '📅', '近期无待交付模型', '7天内无计划交付的模型', upcomingHtml);

  var logsHtml = data.recentCalibrationLogs.length === 0
    ? null
    : '<div class="ws-logs-list">' + data.recentCalibrationLogs.map(wsLogCard).join('') + '</div>';
  html += wsSectionHtml('最近校准记录', data.recentCalibrationLogs.length, '📝', '暂无校准记录', '该负责人名下模型还没有校准操作记录', logsHtml);

  html += '</div>';

  container.innerHTML = html;
  wsBindEvents(data.owner);
}

function wsBindEvents(ownerName) {
  var backBtn = document.getElementById('wsBackBtn');
  if (backBtn) {
    backBtn.onclick = function() { wsShowOwnerList(); };
  }

  document.querySelectorAll('[data-ws-model-status]').forEach(function(sel) {
    sel.onchange = async function() {
      var itemId = sel.dataset.wsModelStatus;
      var newStatus = sel.value;
      try {
        await wsApi('/api/items/' + encodeURIComponent(itemId), {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        await wsLoadWorkspace(ownerName);
        if (typeof load === 'function') await load();
      } catch (err) {
        alert('更新状态失败：' + err.message);
      }
    };
  });

  document.querySelectorAll('[data-ws-note]').forEach(function(btn) {
    btn.onclick = async function() {
      var itemId = btn.dataset.wsNote;
      var note = prompt('请输入备注内容：');
      if (!note || !note.trim()) return;
      try {
        await wsApi('/api/items/' + encodeURIComponent(itemId) + '/logs', {
          method: 'POST',
          body: JSON.stringify({ step: '备注', note: note.trim() })
        });
        await wsLoadWorkspace(ownerName);
        if (typeof load === 'function') await load();
      } catch (err) {
        alert('追加备注失败：' + err.message);
      }
    };
  });

  document.querySelectorAll('[data-ws-task-status]').forEach(function(btn) {
    btn.onclick = async function(e) {
      e.stopPropagation();
      var taskId = btn.dataset.wsTaskStatus;
      var itemId = btn.dataset.wsItemId;
      var newStatus = btn.dataset.status;
      try {
        await wsApi('/api/tasks/' + encodeURIComponent(taskId) + '/status?itemId=' + encodeURIComponent(itemId), {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        await wsLoadWorkspace(ownerName);
        if (typeof load === 'function') await load();
      } catch (err) {
        alert('切换任务状态失败：' + err.message);
      }
    };
  });

  document.querySelectorAll('[data-ws-detail]').forEach(function(el) {
    el.onclick = function(e) {
      e.stopPropagation();
      var id = el.dataset.wsDetail;
      if (typeof showDetailView === 'function') {
        showDetailView();
        if (typeof loadDetail === 'function') loadDetail(id);
      }
    };
  });
}

async function wsLoadOwnerList() {
  try {
    wsOwnerList = await wsApi('/api/owners');
  } catch (err) {
    console.error('加载负责人列表失败:', err);
    wsOwnerList = [];
  }
  wsRenderOwnerList();
}

async function wsLoadWorkspace(ownerName) {
  try {
    wsCurrentWorkspace = await wsApi('/api/owners/' + encodeURIComponent(ownerName));
    wsRenderWorkspace(wsCurrentWorkspace);
  } catch (err) {
    console.error('加载工作台失败:', err);
    var container = document.getElementById('wsWorkspace');
    if (container) {
      container.innerHTML = '<div class="ws-empty"><div class="ws-empty-icon">⚠️</div><div>加载工作台失败</div><div style="font-size:13px;margin-top:4px">' + err.message + '</div></div>';
    }
  }
}

async function initWorkspace(skipRouteCheck) {
  await wsLoadOwnerList();
  if (!skipRouteCheck) {
    var ownerFromPath = wsGetOwnerFromPath();
    if (ownerFromPath) {
      wsShowWorkspace(ownerFromPath);
    }
  }
}

async function refreshWorkspace() {
  if (wsCurrentWorkspace) {
    await wsLoadWorkspace(wsCurrentWorkspace.owner);
  } else {
    await wsLoadOwnerList();
  }
}

window.initWorkspace = initWorkspace;
window.wsLoadOwnerList = wsLoadOwnerList;
window.refreshWorkspace = refreshWorkspace;
window.wsShowOwnerList = wsShowOwnerList;
window.wsShowWorkspace = wsShowWorkspace;
window.wsModelCard = wsModelCard;
window.wsTaskCard = wsTaskCard;
window.wsUpcomingCard = wsUpcomingCard;
window.wsLogCard = wsLogCard;
window.wsOwnerCard = wsOwnerCard;
window.wsSectionHtml = wsSectionHtml;
window._wsGetCurrentWorkspace = function() { return wsCurrentWorkspace; };
window._wsSetInitializing = function(v) { wsInitializing = v; };
window._wsIsInitializing = function() { return wsInitializing; };
