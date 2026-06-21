const TASK_STATUSES = ["待检查", "调整中", "待复核", "完成"];

const STATUS_COLUMN_CLASSES = {
  "待检查": "todo",
  "调整中": "adjusting",
  "待复核": "review",
  "完成": "done"
};

const TENSION_CLASSES = {
  "偏紧": "tension-tight",
  "偏松": "tension-loose",
  "正常": "tension-normal",
  "待检测": "tension-pending"
};

let kanbanTasks = [];
let kanbanFilters = {
  modelId: "",
  owner: "",
  tension: "",
  dueDateStart: "",
  dueDateEnd: ""
};
let kanbanFilterOptions = {
  models: [],
  owners: [],
  tensions: []
};
let draggedTask = null;

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function getTensionClass(tension) {
  return TENSION_CLASSES[tension] || "tension-pending";
}

function getColumnClass(status) {
  return STATUS_COLUMN_CLASSES[status] || "todo";
}

function emptyHtml(icon, title, desc) {
  return `
    <div class="kanban-filters-empty">
      <div class="empty-icon">${icon}</div>
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
  `;
}

function taskCardHtml(task) {
  const overdue = isOverdue(task.modelDueDate) && task.status !== "完成";
  const tensionClass = getTensionClass(task.tension);
  
  return `
    <div class="kanban-task ${task.open ? 'open' : ''}" 
         draggable="true" 
         data-task-id="${task.id}"
         data-item-id="${task.modelId}">
      <div class="kanban-task-actions">
        <button class="kanban-task-action-btn" data-action="log" title="追加备注">📝</button>
        <button class="kanban-task-action-btn" data-action="toggle" title="展开详情">▼</button>
      </div>
      <div class="kanban-task-title">${task.position}</div>
      <div class="kanban-task-meta">
        <span class="kanban-task-badge model">${task.modelCode || ''}</span>
        ${task.modelOwner ? `<span class="kanban-task-badge owner">${task.modelOwner}</span>` : ''}
        <span class="kanban-task-badge ${tensionClass}">${task.tension || '待检测'}</span>
      </div>
      <div class="kanban-task-info">
        <span>${task.modelShipType || ''}</span>
        <span class="kanban-task-due ${overdue ? 'overdue' : ''}">
          ${task.modelDueDate ? '交付: ' + task.modelDueDate : '无交付日期'}
          ${overdue ? ' · 已逾期' : ''}
        </span>
      </div>
      <div class="kanban-task-detail">
        <div class="kanban-task-status-switch">
          <div class="status-label">状态切换</div>
          <div class="status-buttons">
            ${TASK_STATUSES.map(status => `
              <button class="status-btn ${task.status === status ? 'active' : ''}" 
                      data-status="${status}" 
                      data-task-id="${task.id}"
                      data-item-id="${task.modelId}">
                ${status}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="kanban-task-logs">
          ${(task.logs || []).slice(-5).map(log => `
            <div class="kanban-task-log">
              <div class="log-time">${formatDateTime(log.at)}</div>
              <div>${log.note || ''}</div>
            </div>
          `).join('') || '<div class="kanban-task-log">暂无记录</div>'}
        </div>
      </div>
    </div>
  `;
}

function columnHtml(status, tasks) {
  const colClass = getColumnClass(status);
  return `
    <div class="kanban-column ${colClass}" data-status="${status}">
      <div class="kanban-column-header">
        <span>${status}</span>
        <span class="col-count">${tasks.length}</span>
      </div>
      <div class="kanban-tasks">
        ${tasks.length === 0 
          ? '<div class="kanban-tasks-empty">拖拽任务到此处</div>' 
          : tasks.map(task => taskCardHtml(task)).join('')}
      </div>
    </div>
  `;
}

function renderKanbanFilters() {
  const modelSelect = document.getElementById('kanbanModelFilter');
  const ownerSelect = document.getElementById('kanbanOwnerFilter');
  const tensionSelect = document.getElementById('kanbanTensionFilter');
  
  if (modelSelect) {
    modelSelect.innerHTML = '<option value="">全部模型</option>' + 
      kanbanFilterOptions.models.map(m => 
        `<option value="${m.code}" ${kanbanFilters.modelId === m.code ? 'selected' : ''}>${m.code} · ${m.shipType || ''}</option>`
      ).join('');
  }
  
  if (ownerSelect) {
    ownerSelect.innerHTML = '<option value="">全部负责人</option>' + 
      kanbanFilterOptions.owners.map(o => 
        `<option value="${o}" ${kanbanFilters.owner === o ? 'selected' : ''}>${o}</option>`
      ).join('');
  }
  
  if (tensionSelect) {
    tensionSelect.innerHTML = '<option value="">全部松紧</option>' + 
      kanbanFilterOptions.tensions.map(t => 
        `<option value="${t}" ${kanbanFilters.tension === t ? 'selected' : ''}>${t}</option>`
      ).join('');
  }
  
  const startInput = document.getElementById('kanbanDueStart');
  const endInput = document.getElementById('kanbanDueEnd');
  if (startInput) startInput.value = kanbanFilters.dueDateStart;
  if (endInput) endInput.value = kanbanFilters.dueDateEnd;
}

function renderKanbanBoard() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;
  
  let filtered = [...kanbanTasks];
  
  if (kanbanFilters.modelId) {
    filtered = filtered.filter(t => 
      t.modelId === kanbanFilters.modelId || t.modelCode === kanbanFilters.modelId
    );
  }
  if (kanbanFilters.owner) {
    filtered = filtered.filter(t => t.modelOwner === kanbanFilters.owner);
  }
  if (kanbanFilters.tension) {
    filtered = filtered.filter(t => t.tension === kanbanFilters.tension);
  }
  if (kanbanFilters.dueDateStart) {
    filtered = filtered.filter(t => {
      if (!t.modelDueDate) return false;
      return new Date(t.modelDueDate) >= new Date(kanbanFilters.dueDateStart);
    });
  }
  if (kanbanFilters.dueDateEnd) {
    filtered = filtered.filter(t => {
      if (!t.modelDueDate) return false;
      const end = new Date(kanbanFilters.dueDateEnd + "T23:59:59");
      return new Date(t.modelDueDate) <= end;
    });
  }
  
  const totalCount = filtered.length;
  const statsEl = document.getElementById('kanbanStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="kanban-stat"><span class="label">任务总数</span><span class="count">${totalCount}</span></div>
      ${TASK_STATUSES.map(s => {
        const count = filtered.filter(t => t.status === s).length;
        return `<div class="kanban-stat"><span class="label">${s}</span><span class="count">${count}</span></div>`;
      }).join('')}
    `;
  }
  
  if (filtered.length === 0) {
    board.innerHTML = emptyHtml('📋', '暂无匹配的任务', '请调整筛选条件或创建新的帆索任务');
    return;
  }
  
  board.innerHTML = TASK_STATUSES.map(status => {
    const columnTasks = filtered.filter(t => t.status === status);
    return columnHtml(status, columnTasks);
  }).join('');
  
  bindKanbanEvents();
}

function bindKanbanEvents() {
  document.querySelectorAll('.kanban-task').forEach(taskEl => {
    taskEl.ondragstart = handleDragStart;
    taskEl.ondragend = handleDragEnd;
    taskEl.onclick = handleTaskClick;
  });
  
  document.querySelectorAll('.kanban-column').forEach(colEl => {
    colEl.ondragover = handleDragOver;
    colEl.ondragleave = handleDragLeave;
    colEl.ondrop = handleDrop;
  });
  
  document.querySelectorAll('.kanban-task-action-btn').forEach(btn => {
    btn.onclick = function(e) {
      e.stopPropagation();
      const action = btn.dataset.action;
      const taskEl = btn.closest('.kanban-task');
      const taskId = taskEl.dataset.taskId;
      const itemId = taskEl.dataset.itemId;
      
      if (action === 'toggle') {
        taskEl.classList.toggle('open');
        const task = kanbanTasks.find(t => t.id === taskId);
        if (task) task.open = !task.open;
      } else if (action === 'log') {
        addTaskNote(itemId, taskId);
      }
    };
  });
  
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = async function(e) {
      e.stopPropagation();
      const newStatus = btn.dataset.status;
      const taskId = btn.dataset.taskId;
      const itemId = btn.dataset.itemId;
      
      const task = kanbanTasks.find(t => t.id === taskId);
      if (!task || task.status === newStatus) return;
      
      btn.disabled = true;
      try {
        await api(`/api/tasks/${taskId}/status?itemId=${encodeURIComponent(itemId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        task.status = newStatus;
        renderKanbanBoard();
      } catch (err) {
        alert('更新任务状态失败: ' + err.message);
        btn.disabled = false;
      }
    };
  });
}

function handleDragStart(e) {
  draggedTask = {
    id: e.currentTarget.dataset.taskId,
    itemId: e.currentTarget.dataset.itemId,
    element: e.currentTarget
  };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', e.currentTarget.dataset.taskId);
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.classList.remove('drag-over');
  });
  draggedTask = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  
  if (!draggedTask) return;
  
  const newStatus = e.currentTarget.dataset.status;
  const taskId = draggedTask.id;
  const itemId = draggedTask.itemId;
  
  const task = kanbanTasks.find(t => t.id === taskId);
  if (!task || task.status === newStatus) return;
  
  try {
    await api(`/api/tasks/${taskId}/status?itemId=${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    task.status = newStatus;
    renderKanbanBoard();
  } catch (err) {
    alert('更新任务状态失败: ' + err.message);
  }
}

function handleTaskClick(e) {
  if (e.target.closest('.kanban-task-actions')) return;
  
  const taskEl = e.currentTarget;
  const taskId = taskEl.dataset.taskId;
  const task = kanbanTasks.find(t => t.id === taskId);
  if (task) {
    task.open = !task.open;
    taskEl.classList.toggle('open');
  }
}

async function addTaskNote(itemId, taskId) {
  const note = prompt('请输入备注内容：');
  if (!note || !note.trim()) return;
  
  try {
    await api(`/api/tasks/${taskId}/logs?itemId=${encodeURIComponent(itemId)}`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() })
    });
    await loadKanbanTasks();
    renderKanbanBoard();
  } catch (err) {
    alert('添加备注失败: ' + err.message);
  }
}

async function loadKanbanTasks() {
  try {
    kanbanTasks = await api('/api/tasks');
  } catch (err) {
    console.error('加载任务失败:', err);
    kanbanTasks = [];
  }
}

async function loadKanbanFilterOptions() {
  try {
    const data = await api('/api/tasks/filters');
    kanbanFilterOptions = {
      models: data.models || [],
      owners: data.owners || [],
      tensions: data.tensions || []
    };
  } catch (err) {
    console.error('加载筛选选项失败:', err);
  }
}

function initKanbanFilters() {
  const modelFilter = document.getElementById('kanbanModelFilter');
  const ownerFilter = document.getElementById('kanbanOwnerFilter');
  const tensionFilter = document.getElementById('kanbanTensionFilter');
  const dueStart = document.getElementById('kanbanDueStart');
  const dueEnd = document.getElementById('kanbanDueEnd');
  const clearBtn = document.getElementById('kanbanClearFilters');
  
  if (modelFilter) {
    modelFilter.onchange = function() {
      kanbanFilters.modelId = modelFilter.value;
      renderKanbanBoard();
    };
  }
  
  if (ownerFilter) {
    ownerFilter.onchange = function() {
      kanbanFilters.owner = ownerFilter.value;
      renderKanbanBoard();
    };
  }
  
  if (tensionFilter) {
    tensionFilter.onchange = function() {
      kanbanFilters.tension = tensionFilter.value;
      renderKanbanBoard();
    };
  }
  
  if (dueStart) {
    dueStart.onchange = function() {
      kanbanFilters.dueDateStart = dueStart.value;
      renderKanbanBoard();
    };
  }
  
  if (dueEnd) {
    dueEnd.onchange = function() {
      kanbanFilters.dueDateEnd = dueEnd.value;
      renderKanbanBoard();
    };
  }
  
  if (clearBtn) {
    clearBtn.onclick = function() {
      kanbanFilters = {
        modelId: "",
        owner: "",
        tension: "",
        dueDateStart: "",
        dueDateEnd: ""
      };
      renderKanbanFilters();
      renderKanbanBoard();
    };
  }
}

async function initKanban() {
  await loadKanbanFilterOptions();
  await loadKanbanTasks();
  renderKanbanFilters();
  initKanbanFilters();
  renderKanbanBoard();
}

async function refreshKanban() {
  await loadKanbanFilterOptions();
  await loadKanbanTasks();
  renderKanbanFilters();
  renderKanbanBoard();
}

window.initKanban = initKanban;
window.refreshKanban = refreshKanban;
