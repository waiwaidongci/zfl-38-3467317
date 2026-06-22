let backups = [];
let currentDiffBackup = null;
let currentRestoreBackup = null;

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function emptyHtml(icon, title, desc) {
  return '<div class="empty"><div class="empty-icon">' + icon + '</div><h3>' + title + '</h3><div class="meta">' + desc + '</div></div>';
}

function renderStats() {
  const total = backups.length;
  const valid = backups.filter(b => b.valid).length;
  const invalid = total - valid;
  const latestModelCount = backups[0]?.modelCount || 0;
  const latestTaskCount = backups[0]?.taskCount || 0;

  document.getElementById('statsSummary').innerHTML =
    '<div class="stats" style="margin:0; grid-template-columns:repeat(4,minmax(120px,1fr));">' +
      '<div class="stat"><span>备份总数</span><strong>' + total + '</strong></div>' +
      '<div class="stat"><span>有效备份</span><strong style="color:var(--accent)">' + valid + '</strong></div>' +
      '<div class="stat"><span>最新模型数</span><strong>' + latestModelCount + '</strong></div>' +
      '<div class="stat"><span>最新任务数</span><strong>' + latestTaskCount + '</strong></div>' +
    '</div>';
}

function backupCardHtml(backup) {
  const statusPill = backup.valid
    ? '<span class="pill valid">✓ 有效</span>'
    : '<span class="pill invalid">✕ 已损坏</span>';

  const remarkHtml = backup.remark
    ? '<div class="meta"><b>备注</b> ' + escapeHtml(backup.remark) + '</div>'
    : '<div class="meta" style="font-style:italic">（无备注）</div>';

  const errorHtml = !backup.valid && backup.validationError
    ? '<div class="meta" style="color:var(--warn)"><b>错误</b> ' + escapeHtml(backup.validationError) + '</div>'
    : '';

  const actions = backup.valid
    ? '<div class="card-actions">' +
        '<button class="secondary" data-diff="' + backup.id + '">🔍 预览差异</button>' +
        '<button data-download="' + backup.id + '">⬇️ 下载</button>' +
        '<button class="warn" data-restore="' + backup.id + '" title="先预览差异再恢复">↩️ 预览差异并恢复</button>' +
      '</div>'
    : '<div class="card-actions">' +
        '<button class="secondary" disabled>🔍 预览差异</button>' +
        '<button disabled>⬇️ 下载</button>' +
        '<button class="warn" disabled title="备份已损坏">↩️ 预览差异并恢复</button>' +
      '</div>';

  return '<article class="card">' +
    '<div class="card-header">' +
      '<div>' +
        '<h3 style="margin:0; font-family:monospace;">' + backup.id + '</h3>' +
        '<div class="meta">创建于 ' + formatDateTime(backup.createdAt) + '</div>' +
      '</div>' +
      statusPill +
    '</div>' +
    remarkHtml +
    '<div class="meta"><b>模型数量</b> <span class="pill">' + backup.modelCount + '</span></div>' +
    '<div class="meta"><b>任务数量</b> <span class="pill">' + backup.taskCount + '</span></div>' +
    '<div class="meta"><b>操作人</b> ' + escapeHtml(backup.operator || 'system') + '</div>' +
    '<div class="file-size">文件大小：' + formatFileSize(backup.fileSize || 0) + '</div>' +
    errorHtml +
    actions +
  '</article>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderBackupList() {
  const grid = document.getElementById('backupGrid');
  if (backups.length === 0) {
    grid.innerHTML = emptyHtml('📦', '暂无备份', '点击「创建新备份」创建第一个数据快照');
    return;
  }
  grid.innerHTML = backups.map(backupCardHtml).join('');
  bindCardEvents();
}

function bindCardEvents() {
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.onclick = () => showDiffModal(btn.dataset.diff);
  });
  document.querySelectorAll('[data-download]').forEach(btn => {
    btn.onclick = () => downloadBackup(btn.dataset.download);
  });
  document.querySelectorAll('[data-restore]').forEach(btn => {
    btn.onclick = () => {
      showDiffModal(btn.dataset.restore);
    };
  });
}

async function loadBackups() {
  try {
    backups = await api('/api/backups');
    renderStats();
    renderBackupList();
  } catch (e) {
    alert('加载备份列表失败：' + e.message);
  }
}

async function createBackup(remark) {
  try {
    const backup = await api('/api/backups', {
      method: 'POST',
      body: JSON.stringify({ remark })
    });
    alert('备份创建成功！\n备份ID：' + backup.id);
    await loadBackups();
    return backup;
  } catch (e) {
    alert('创建备份失败：' + e.message);
    return null;
  }
}

async function downloadBackup(backupId) {
  try {
    const res = await fetch('/api/backups/' + encodeURIComponent(backupId) + '/download');
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '下载失败');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = backupId + '.json';
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match) filename = decodeURIComponent(match[1]);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('下载失败：' + e.message);
  }
}

async function showDiffModal(backupId) {
  currentDiffBackup = backups.find(b => b.id === backupId);
  if (!currentDiffBackup) return;

  document.getElementById('diffModal').style.display = '';
  document.getElementById('diffContent').innerHTML =
    '<div style="text-align:center; padding:40px;"><div class="loading"></div><p class="meta">正在计算差异...</p></div>';

  try {
    const diff = await api('/api/backups/' + encodeURIComponent(backupId) + '/diff');
    renderDiffContent(diff);
  } catch (e) {
    document.getElementById('diffContent').innerHTML =
      '<div class="warn-box"><strong>加载差异失败：</strong>' + escapeHtml(e.message) + '</div>';
  }
}

function renderDiffContent(diff) {
  const s = diff.summary;
  let html = '<div class="diff-section">';

  html += '<h3>差异摘要</h3>';
  html += '<div class="diff-summary">';
  html += '<div class="diff-item"><strong>' + s.models.backup + '</strong><span class="meta">备份模型数</span></div>';
  html += '<div class="diff-item"><strong>' + s.models.current + '</strong><span class="meta">当前模型数</span></div>';
  html += '<div class="diff-item added"><strong>' + s.models.added + '</strong><span class="meta">新增模型</span></div>';
  html += '<div class="diff-item removed"><strong>' + s.models.removed + '</strong><span class="meta">删除模型</span></div>';
  html += '<div class="diff-item modified"><strong>' + s.models.modified + '</strong><span class="meta">修改模型</span></div>';
  html += '<div class="diff-item"><strong>' + s.tasks.backup + '</strong><span class="meta">备份任务数</span></div>';
  html += '<div class="diff-item"><strong>' + s.tasks.current + '</strong><span class="meta">当前任务数</span></div>';
  html += '</div>';

  if (!s.hasChanges) {
    html += '<div class="panel" style="background:var(--calendar-bg); text-align:center; padding:30px;">';
    html += '<div style="font-size:48px; margin-bottom:10px;">✅</div>';
    html += '<h3>当前数据与备份完全一致</h3>';
    html += '<div class="meta">无需恢复操作</div>';
    html += '</div>';
    html += '</div>';
    document.getElementById('diffContent').innerHTML = html;
    return;
  }

  const hasModelChanges = s.models.added > 0 || s.models.removed > 0 || s.models.modified > 0;
  if (hasModelChanges) {
    html += '<h3 style="margin-top:20px;">模型变更详情</h3>';
    html += '<div class="diff-detail"><table><thead><tr><th>变更类型</th><th>模型编号</th><th>船型</th><th>变更内容</th></tr></thead><tbody>';

    for (const item of diff.models.added) {
      html += '<tr class="row-added">';
      html += '<td><span class="change-badge added">新增</span></td>';
      html += '<td>' + escapeHtml(item.item.code || item.item.id || item.key) + '</td>';
      html += '<td>' + escapeHtml(item.item.shipType || '') + '</td>';
      html += '<td>当前存在，备份中无此模型</td>';
      html += '</tr>';
    }

    for (const item of diff.models.removed) {
      html += '<tr class="row-removed">';
      html += '<td><span class="change-badge removed">删除</span></td>';
      html += '<td>' + escapeHtml(item.item.code || item.item.id || item.key) + '</td>';
      html += '<td>' + escapeHtml(item.item.shipType || '') + '</td>';
      html += '<td>备份存在，当前已删除</td>';
      html += '</tr>';
    }

    for (const item of diff.models.modified) {
      const changeDesc = item.changes.map(c => {
        if (c.field === 'tasks' && c.type === 'count') {
          return `任务数：${c.backup} → ${c.current}`;
        }
        if (c.field === 'logs' && c.type === 'count') {
          return `日志数：${c.backup} → ${c.current}`;
        }
        return `${c.field}：${escapeHtml(String(c.backup ?? ''))} → ${escapeHtml(String(c.current ?? ''))}`;
      }).join('；');
      html += '<tr class="row-modified">';
      html += '<td><span class="change-badge modified">修改</span></td>';
      html += '<td>' + escapeHtml(item.current.code || item.current.id || item.key) + '</td>';
      html += '<td>' + escapeHtml(item.current.shipType || '') + '</td>';
      html += '<td>' + escapeHtml(changeDesc) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table></div>';
  }

  const hasRuleChanges = s.rules.added > 0 || s.rules.removed > 0 || s.rules.modified > 0;
  if (hasRuleChanges) {
    html += '<h3 style="margin-top:20px;">校准规则变更</h3>';
    html += '<div class="diff-summary">';
    html += '<div class="diff-item added"><strong>' + s.rules.added + '</strong><span class="meta">新增规则</span></div>';
    html += '<div class="diff-item removed"><strong>' + s.rules.removed + '</strong><span class="meta">删除规则</span></div>';
    html += '<div class="diff-item modified"><strong>' + s.rules.modified + '</strong><span class="meta">修改规则</span></div>';
    html += '</div>';
  }

  html += '<div class="modal-footer" style="margin-top:20px;">';
  html += '<button class="ghost" id="diffCloseBtn">关闭</button>';
  if (currentDiffBackup && currentDiffBackup.valid) {
    html += '<button class="warn" id="diffRestoreBtn">从该备份恢复</button>';
  }
  html += '</div>';

  html += '</div>';
  document.getElementById('diffContent').innerHTML = html;

  document.getElementById('diffCloseBtn').onclick = closeDiffModal;
  const restoreBtn = document.getElementById('diffRestoreBtn');
  if (restoreBtn) {
    restoreBtn.onclick = () => {
      const backupId = currentDiffBackup.id;
      closeDiffModal();
      showRestoreModal(backupId);
    };
  }
}

function closeDiffModal() {
  document.getElementById('diffModal').style.display = 'none';
  currentDiffBackup = null;
}

async function showRestoreModal(backupId) {
  currentRestoreBackup = backups.find(b => b.id === backupId);
  if (!currentRestoreBackup) return;
  if (!currentRestoreBackup.valid) {
    alert('该备份已损坏，无法恢复');
    return;
  }

  const content = document.getElementById('restoreContent');
  content.innerHTML =
    '<div class="warn-box">' +
      '<strong>⚠️ 此操作将覆盖当前所有数据！</strong>' +
      '<p style="margin:8px 0 0;">恢复后，当前的模型、任务、校准规则等所有数据将被替换为备份时的状态。</p>' +
    '</div>' +
    '<div class="panel" style="background:var(--calendar-bg);">' +
      '<h3 style="margin:0 0 10px;">备份信息</h3>' +
      '<div class="meta"><b>备份ID</b> <span style="font-family:monospace;">' + currentRestoreBackup.id + '</span></div>' +
      '<div class="meta"><b>创建时间</b> ' + formatDateTime(currentRestoreBackup.createdAt) + '</div>' +
      '<div class="meta"><b>备注</b> ' + escapeHtml(currentRestoreBackup.remark || '（无）') + '</div>' +
      '<div class="meta"><b>模型数量</b> ' + currentRestoreBackup.modelCount + '</div>' +
      '<div class="meta"><b>任务数量</b> ' + currentRestoreBackup.taskCount + '</div>' +
    '</div>' +
    '<p style="margin-top:16px;">请输入 <strong style="color:var(--warn);">CONFIRM RESTORE</strong> 以确认恢复操作：</p>' +
    '<input type="text" id="restoreConfirmInput" placeholder="请输入确认文字">' +
    '<p id="restoreConfirmHint" class="meta" style="margin-top:6px;"></p>';

  document.getElementById('restoreModal').style.display = '';
  document.getElementById('confirmRestoreBtn').disabled = true;

  const input = document.getElementById('restoreConfirmInput');
  const hint = document.getElementById('restoreConfirmHint');
  input.oninput = () => {
    const valid = input.value.trim() === 'CONFIRM RESTORE';
    document.getElementById('confirmRestoreBtn').disabled = !valid;
    hint.textContent = valid ? '✓ 确认文字正确' : '';
    hint.style.color = valid ? 'var(--accent)' : 'var(--muted)';
  };
}

function closeRestoreModal() {
  document.getElementById('restoreModal').style.display = 'none';
  currentRestoreBackup = null;
}

async function confirmRestore() {
  if (!currentRestoreBackup) return;

  const input = document.getElementById('restoreConfirmInput');
  if (input.value.trim() !== 'CONFIRM RESTORE') {
    alert('请输入正确的确认文字');
    return;
  }

  try {
    const btn = document.getElementById('confirmRestoreBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading" style="border-color:rgba(255,255,255,.3); border-top-color:#fff; vertical-align:middle; margin-right:6px;"></span>恢复中...';

    const result = await api('/api/backups/' + encodeURIComponent(currentRestoreBackup.id) + '/restore', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true })
    });

    alert('恢复成功！\n\n恢复前：' + result.before.modelCount + ' 个模型，' + result.before.taskCount + ' 个任务\n' +
          '恢复后：' + result.after.modelCount + ' 个模型，' + result.after.taskCount + ' 个任务\n\n' +
          '页面将刷新以显示最新数据。');

    closeRestoreModal();
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    alert('恢复失败：' + e.message);
    document.getElementById('confirmRestoreBtn').disabled = false;
    document.getElementById('confirmRestoreBtn').textContent = '确认恢复';
  }
}

function showCreateModal() {
  document.getElementById('backupRemark').value = '';
  document.getElementById('createModal').style.display = '';
  setTimeout(() => document.getElementById('backupRemark').focus(), 100);
}

function closeCreateModal() {
  document.getElementById('createModal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  loadBackups();

  document.getElementById('createBackupBtn').onclick = showCreateModal;
  document.getElementById('refreshBtn').onclick = loadBackups;

  document.getElementById('closeCreateModal').onclick = closeCreateModal;
  document.getElementById('cancelCreateBtn').onclick = closeCreateModal;
  document.getElementById('createBackupForm').onsubmit = async (e) => {
    e.preventDefault();
    const remark = document.getElementById('backupRemark').value.trim();
    closeCreateModal();
    await createBackup(remark);
  };

  document.getElementById('closeDiffModal').onclick = closeDiffModal;
  document.getElementById('closeRestoreModal').onclick = closeRestoreModal;
  document.getElementById('cancelRestoreBtn').onclick = closeRestoreModal;
  document.getElementById('confirmRestoreBtn').onclick = confirmRestore;

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        closeCreateModal();
        closeDiffModal();
        closeRestoreModal();
      }
    };
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCreateModal();
      closeDiffModal();
      closeRestoreModal();
    }
  });
});
