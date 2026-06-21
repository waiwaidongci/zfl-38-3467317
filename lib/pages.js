function importPage() {
  return '<!doctype html>\n\
<html lang="zh-CN">\n\
<head>\n\
  <meta charset="utf-8">\n\
  <meta name="viewport" content="width=device-width, initial-scale=1">\n\
  <title>批量导入 - 古船模型帆索校准</title>\n\
  <style>\n\
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#4a7c3a; --warn-bg:#fdf1ec; --ok-bg:#edf4e8; }\n\
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }\n\
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }\n\
    .header-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }\n\
    .back-btn { text-decoration:none; color:var(--muted); font-weight:600; padding:6px 12px; border:1px solid var(--line); border-radius:6px; background:transparent; cursor:pointer; }\n\
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0 0 8px; font-size:15px; }\n\
    main { padding:22px 28px; max-width:1200px; margin:0 auto; }\n\
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:20px; margin-bottom:16px; }\n\
    .steps { display:flex; gap:8px; margin-bottom:20px; align-items:center; }\n\
    .step { display:flex; align-items:center; gap:8px; padding:8px 16px; border-radius:8px; border:1px solid var(--line); background:#fff; color:var(--muted); font-weight:600; font-size:14px; }\n\
    .step.active { border-color:var(--accent); color:var(--accent); background:var(--ok-bg); }\n\
    .step.done { color:var(--ok); }\n\
    .step-num { width:24px; height:24px; border-radius:50%; background:var(--line); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; }\n\
    .step.active .step-num, .step.done .step-num { background:var(--accent); }\n\
    .arrow { color:var(--muted); font-size:18px; }\n\
    .upload-zone { border:2px dashed var(--line); border-radius:12px; padding:60px 20px; text-align:center; transition:all .2s; cursor:pointer; background:var(--bg); }\n\
    .upload-zone:hover, .upload-zone.dragover { border-color:var(--accent); background:var(--ok-bg); }\n\
    .upload-icon { font-size:48px; margin-bottom:12px; }\n\
    .upload-hint { color:var(--muted); margin-top:8px; font-size:13px; }\n\
    input[type=file] { display:none; }\n\
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 16px; font-weight:700; cursor:pointer; font-size:14px; }\n\
    button.secondary { background:#69736a; }\n\
    button.danger { background:var(--warn); }\n\
    button:disabled { opacity:.5; cursor:not-allowed; }\n\
    .btn-row { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }\n\
    .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }\n\
    .stat-card { background:var(--bg); border-radius:8px; padding:14px; }\n\
    .stat-card strong { display:block; font-size:24px; font-weight:800; }\n\
    .stat-card.ok strong { color:var(--ok); }\n\
    .stat-card.warn strong { color:var(--warn); }\n\
    .stat-card .label { color:var(--muted); font-size:13px; }\n\
    .field-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }\n\
    .field-item { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:6px; font-size:13px; }\n\
    .field-item.ok { background:var(--ok-bg); color:var(--ok); }\n\
    .field-item.bad { background:var(--warn-bg); color:var(--warn); }\n\
    .badge { font-size:18px; }\n\
    table { width:100%; border-collapse:collapse; font-size:13px; }\n\
    th, td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--line); }\n\
    th { background:var(--bg); color:var(--muted); font-weight:600; position:sticky; top:0; }\n\
    .row-valid { background:var(--ok-bg); }\n\
    .row-invalid { background:var(--warn-bg); }\n\
    .tag { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; }\n\
    .tag-ok { background:var(--ok-bg); color:var(--ok); }\n\
    .tag-warn { background:var(--warn-bg); color:var(--warn); }\n\
    .tag-err { background:var(--warn-bg); color:var(--warn); }\n\
    .errors-col { max-width:280px; }\n\
    .error-item { margin:2px 0; font-size:12px; }\n\
    .tasks-preview { background:var(--bg); padding:8px; border-radius:6px; margin-top:4px; font-size:12px; }\n\
    .task-chip { display:inline-block; background:#fff; border:1px solid var(--line); border-radius:4px; padding:2px 6px; margin:2px; font-size:11px; }\n\
    .scroll-box { max-height:500px; overflow:auto; border:1px solid var(--line); border-radius:6px; }\n\
    .tabs { display:flex; gap:0; margin-bottom:16px; border-bottom:1px solid var(--line); }\n\
    .tab { padding:10px 20px; cursor:pointer; font-weight:600; color:var(--muted); border-bottom:2px solid transparent; margin-bottom:-1px; }\n\
    .tab.active { color:var(--ink); border-bottom-color:var(--accent); }\n\
    .result-panel { display:none; }\n\
    .result-panel.active { display:block; }\n\
    .success-banner { background:var(--ok-bg); border:1px solid var(--accent); color:var(--ok); padding:16px; border-radius:8px; margin-bottom:16px; }\n\
    .error-banner { background:var(--warn-bg); border:1px solid var(--warn); color:var(--warn); padding:16px; border-radius:8px; margin-bottom:16px; }\n\
    .result-item { padding:8px 0; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; }\n\
    .result-item:last-child { border-bottom:none; }\n\
    .spinner { display:inline-block; width:16px; height:16px; border:2px solid var(--line); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px; }\n\
    @keyframes spin { to { transform:rotate(360deg); } }\n\
    .template-link { color:var(--accent); text-decoration:underline; cursor:pointer; }\n\
  </style>\n\
</head>\n\
<body>\n\
  <header>\n\
    <div class="header-left">\n\
      <a href="/" class="back-btn">← 返回列表</a>\n\
      <div><h1>批量导入模型</h1><div style="color:var(--muted); font-size:13px;">工作室Excel/CSV校准清单导入</div></div>\n\
    </div>\n\
  </header>\n\
  <main>\n\
    <div class="steps">\n\
      <div class="step active" id="step1"><span class="step-num">1</span>上传文件</div><span class="arrow">→</span>\n\
      <div class="step" id="step2"><span class="step-num">2</span>预览校验</div><span class="arrow">→</span>\n\
      <div class="step" id="step3"><span class="step-num">3</span>导入结果</div>\n\
    </div>\n\n\
    <div id="pageUpload" class="panel">\n\
      <h2>上传校准清单</h2>\n\
      <p style="color:var(--muted); margin:0 0 16px;">支持 Excel (.xlsx, .xls) 和 CSV 格式。可识别的字段：模型编号、船型、比例、桅杆数量、帆索材料、负责人、交付日期。</p>\n\
      <div class="upload-zone" id="dropZone">\n\
        <div class="upload-icon">📤</div>\n\
        <div style="font-weight:700;">点击或拖拽文件到此处上传</div>\n\
        <div class="upload-hint">没有模板？<span class="template-link" id="downloadTpl">下载示例模板</span></div>\n\
        <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">\n\
      </div>\n\
      <div id="uploading" style="display:none; margin-top:16px;"><span class="spinner"></span>正在解析文件...</div>\n\
    </div>\n\n\
    <div id="pagePreview" style="display:none;">\n\
      <div class="panel">\n\
        <h2>字段识别结果</h2>\n\
        <div class="field-list" id="fieldList"></div>\n\
      </div>\n\n\
      <div class="panel">\n\
        <h2>导入摘要</h2>\n\
        <div class="summary-grid" id="summaryGrid"></div>\n\
      </div>\n\n\
      <div class="panel">\n\
        <div class="tabs">\n\
          <div class="tab active" data-tab="all">全部 (<span id="countAll">0</span>)</div>\n\
          <div class="tab" data-tab="valid">通过 (<span id="countValid">0</span>)</div>\n\
          <div class="tab" data-tab="invalid">有错误 (<span id="countInvalid">0</span>)</div>\n\
          <div class="tab" data-tab="warn">有警告 (<span id="countWarn">0</span>)</div>\n\
        </div>\n\
        <div class="result-panel active" id="panelAll">\n\
          <div class="scroll-box">\n\
            <table id="previewTable">\n\
              <thead><tr>\n\
                <th style="width:50px;">行号</th>\n\
                <th>模型编号</th>\n\
                <th>船型</th>\n\
                <th>桅杆数</th>\n\
                <th>交付日期</th>\n\
                <th>帆索任务</th>\n\
                <th class="errors-col">错误/警告</th>\n\
                <th style="width:80px;">状态</th>\n\
              </tr></thead>\n\
              <tbody id="previewBody"></tbody>\n\
            </table>\n\
          </div>\n\
        </div>\n\
      </div>\n\n\
      <div class="btn-row">\n\
        <button id="reUpload" class="secondary">重新选择文件</button>\n\
        <button id="cancelBtn" class="secondary">取消</button>\n\
        <button id="confirmImport" disabled>确认导入（<span id="importCount">0</span>条）</button>\n\
      </div>\n\
    </div>\n\n\
    <div id="pageResult" style="display:none;">\n\
      <div class="panel" id="resultBanner"></div>\n\
      <div class="panel">\n\
        <h2>导入结果明细</h2>\n\
        <div class="tabs">\n\
          <div class="tab active" data-rtab="created">成功导入 (<span id="rc">0</span>)</div>\n\
          <div class="tab" data-rtab="skipped">跳过/失败 (<span id="rs">0</span>)</div>\n\
        </div>\n\
        <div class="result-panel active" id="rpanelCreated">\n\
          <div id="createdList"></div>\n\
        </div>\n\
        <div class="result-panel" id="rpanelSkipped">\n\
          <div id="skippedList"></div>\n\
        </div>\n\
      </div>\n\
      <div class="btn-row">\n\
        <a href="/" class="back-btn" style="display:inline-block;">返回模型列表</a>\n\
        <button id="importMore" class="secondary">继续导入</button>\n\
      </div>\n\
    </div>\n\
  </main>\n\
  <script>\n\
    const KNOWN_LABELS = { code:"模型编号", shipType:"船型", scale:"比例", mastCount:"桅杆数量", riggingMaterial:"帆索材料", owner:"负责人", dueDate:"交付日期" };\n\
    let currentPreview = null;\n\n\
    async function api(path, options) {\n\
      const res = await fetch(path, options && options.body ? { ...options, headers:{\'Content-Type\': options.body instanceof FormData ? {} : \'application/json\' } } : options);\n\
      const data = await res.json();\n\
      if (!res.ok) throw new Error(data.error || \'请求失败\');\n\
      return data;\n\
    }\n\n\
    function setStep(n) {\n\
      [1,2,3].forEach(function(i) {\n\
        const el = document.getElementById(\'step\'+i);\n\
        el.classList.toggle(\'active\', i === n);\n\
        el.classList.toggle(\'done\', i < n);\n\
      });\n\
      document.getElementById(\'pageUpload\').style.display = n === 1 ? \'\' : \'none\';\n\
      document.getElementById(\'pagePreview\').style.display = n === 2 ? \'\' : \'none\';\n\
      document.getElementById(\'pageResult\').style.display = n === 3 ? \'\' : \'none\';\n\
    }\n\n\
    document.getElementById(\'downloadTpl\').onclick = function() {\n\
      const csv = "模型编号,船型,比例,桅杆数量,帆索材料,负责人,交付日期\\nMR-101,福船,1:48,3,蜡线,张三,2026-07-15\\nMR-102,广船,1:60,2,棉线,李四,2026-08-01\\n";\n\
      const blob = new Blob(["\\ufeff" + csv], {type:\'text/csv;charset=utf-8\'});\n\
      const a = document.createElement(\'a\');\n\
      a.href = URL.createObjectURL(blob);\n\
      a.download = \'古船模型导入模板.csv\';\n\
      a.click();\n\
    };\n\n\
    const dropZone = document.getElementById(\'dropZone\');\n\
    const fileInput = document.getElementById(\'fileInput\');\n\
    dropZone.onclick = function() { fileInput.click(); };\n\
    dropZone.ondragover = function(e) { e.preventDefault(); dropZone.classList.add(\'dragover\'); };\n\
    dropZone.ondragleave = function() { dropZone.classList.remove(\'dragover\'); };\n\
    dropZone.ondrop = function(e) { e.preventDefault(); dropZone.classList.remove(\'dragover\'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); };\n\
    fileInput.onchange = function() { if (fileInput.files.length) handleFile(fileInput.files[0]); };\n\n\
    function handleFile(file) {\n\
      document.getElementById(\'uploading\').style.display = \'\';\n\
      const fd = new FormData();\n\
      fd.append(\'file\', file);\n\
      api(\'/api/import/preview\', { method:\'POST\', body: fd }).then(function(data) {\n\
        currentPreview = data;\n\
        renderPreview(data);\n\
        setStep(2);\n\
      }).catch(function(err) {\n\
        alert(\'上传失败: \' + err.message);\n\
      }).finally(function() {\n\
        document.getElementById(\'uploading\').style.display = \'none\';\n\
      });\n\
    }\n\n\
    function renderPreview(data) {\n\
      const fl = document.getElementById(\'fieldList\');\n\
      fl.innerHTML = data.recognizedHeaders.map(function(h) {\n\
        const cls = h.recognized ? \'ok\' : \'bad\';\n\
        const icon = h.recognized ? \'✓\' : \'✗\';\n\
        const label = h.recognized ? (KNOWN_LABELS[h.field] || h.field) : \'未识别\';\n\
        return \'<div class="field-item \' + cls + \'"><span>\' + icon + \'</span><b>\' + (h.header || \'(空列名)\') + \'</b> → \' + label + \'</div>\';\n\
      }).join(\'\');\n\n\
      const s = data.summary;\n\
      document.getElementById(\'summaryGrid\').innerHTML = \n\
        \'<div class="stat-card"><div class="label">总行数</div><strong>\' + s.total + \'</strong></div>\' +\n\
        \'<div class="stat-card ok"><div class="label">可导入</div><strong>\' + s.valid + \'</strong></div>\' +\n\
        \'<div class="stat-card warn"><div class="label">有错误</div><strong>\' + s.invalid + \'</strong></div>\' +\n\
        \'<div class="stat-card"><div class="label">含警告</div><strong>\' + s.withWarnings + \'</strong></div>\' +\n\
        \'<div class="stat-card warn"><div class="label">重复编号(系统)</div><strong>\' + s.duplicateSystem + \'</strong></div>\' +\n\
        \'<div class="stat-card warn"><div class="label">重复编号(文件)</div><strong>\' + s.duplicateFile + \'</strong></div>\' +\n\
        \'<div class="stat-card warn"><div class="label">缺失交付日期</div><strong>\' + s.missingDueDate + \'</strong></div>\' +\n\
        \'<div class="stat-card warn"><div class="label">桅杆数量错误</div><strong>\' + s.mastCountErrors + \'</strong></div>\';\n\n\
      document.getElementById(\'countAll\').textContent = s.total;\n\
      document.getElementById(\'countValid\').textContent = s.valid;\n\
      document.getElementById(\'countInvalid\').textContent = s.invalid;\n\
      document.getElementById(\'countWarn\').textContent = s.withWarnings;\n\
      document.getElementById(\'importCount\').textContent = s.valid;\n\
      document.getElementById(\'confirmImport\').disabled = s.valid === 0;\n\n\
      renderRows(\'all\');\n\n\
      document.querySelectorAll(\'.tab[data-tab]\').forEach(function(t) {\n\
        t.onclick = function() {\n\
          document.querySelectorAll(\'.tab[data-tab]\').forEach(function(x) { x.classList.remove(\'active\'); });\n\
          t.classList.add(\'active\');\n\
          renderRows(t.dataset.tab);\n\
        };\n\
      });\n\
    }\n\n\
    function renderRows(filter) {\n\
      const body = document.getElementById(\'previewBody\');\n\
      const rows = currentPreview.rows;\n\
      const filtered = rows.filter(function(r) {\n\
        if (filter === \'valid\') return r.valid;\n\
        if (filter === \'invalid\') return !r.valid;\n\
        if (filter === \'warn\') return r.warnings.length > 0 && r.valid;\n\
        return true;\n\
      });\n\n\
      body.innerHTML = filtered.map(function(r) {\n\
        const n = r.normalized;\n\
        const cls = r.valid ? (r.warnings.length > 0 ? \'\' : \'row-valid\') : \'row-invalid\';\n\
        const statusTag = r.valid\n\
          ? (r.warnings.length > 0 ? \'<span class="tag tag-warn">有警告</span>\' : \'<span class="tag tag-ok">通过</span>\')\n\
          : \'<span class="tag tag-err">错误</span>\';\n\
        const issues = r.errors.map(function(e) { return \'<div class="error-item" style="color:var(--warn)">✗ \' + e.message + \'</div>\'; }).concat(\n\
          r.warnings.map(function(w) { return \'<div class="error-item" style="color:#b8860b">⚠ \' + w.message + \'</div>\'; })).join(\'\');\n\
        const taskChips = (r._taskPreview || []).map(function(t) { return \'<span class="task-chip">\' + t.position + \'</span>\'; }).join(\'\');\n\
        const tasksHtml = taskChips ? \'<div class="tasks-preview">\' + taskChips + \'</div>\' : \'<span style="color:var(--muted)">无</span>\';\n\
        return \'<tr class="\' + cls + \'>\' +\n\
          \'<td>\' + r.originalIndex + \'</td>\' +\n\
          \'<td><b>\' + (n.code || \'\') + \'</b></td>\' +\n\
          \'<td>\' + (n.shipType || \'\') + \'</td>\' +\n\
          \'<td>\' + (n.mastCount || \'\') + \'</td>\' +\n\
          \'<td>\' + (n.dueDate || \'\') + \'</td>\' +\n\
          \'<td>\' + tasksHtml + \'</td>\' +\n\
          \'<td class="errors-col">\' + (issues || \'<span style="color:var(--muted)">无</span>\') + \'</td>\' +\n\
          \'<td>\' + statusTag + \'</td>\' +\n\
        \'</tr>\';\n\
      }).join(\'\');\n\
    }\n\n\
    document.getElementById(\'reUpload\').onclick = function() { fileInput.value = \'\'; setStep(1); };\n\
    document.getElementById(\'cancelBtn\').onclick = function() { if (confirm(\'取消导入？\')) location.href = \'/\'; };\n\n\
    document.getElementById(\'confirmImport\').onclick = function() {\n\
      if (!currentPreview) return;\n\
      const validRows = currentPreview.rows.filter(function(r) { return r.valid; });\n\
      if (validRows.length === 0) { alert(\'没有可导入的数据行\'); return; }\n\
      if (!confirm(\'确认导入 \' + validRows.length + \' 条数据？\')) return;\n\
      document.getElementById(\'confirmImport\').disabled = true;\n\
      document.getElementById(\'confirmImport\').innerHTML = \'<span class="spinner"></span>导入中...\';\n\
      api(\'/api/import/commit\', { method:\'POST\', body: JSON.stringify({ rows: validRows }) })\n\
        .then(function(res) {\n\
          renderResult(res);\n\
          setStep(3);\n\
        })\n\
        .catch(function(err) {\n\
          alert(\'导入失败: \' + err.message);\n\
          document.getElementById(\'confirmImport\').disabled = false;\n\
          document.getElementById(\'confirmImport\').innerHTML = \'确认导入（<span id="importCount">0</span>条）\';\n\
        });\n\
    };\n\n\
    function renderResult(res) {\n\
      const banner = document.getElementById(\'resultBanner\');\n\
      if (res.created > 0) {\n\
        banner.className = \'success-banner\';\n\
        banner.innerHTML = \'<h3>✅ 导入成功</h3><div>成功导入 <b>\' + res.created + \'</b> 条，跳过 <b>\' + res.skipped + \'</b> 条</div>\';\n\
      } else {\n\
        banner.className = \'error-banner\';\n\
        banner.innerHTML = \'<h3>⚠ 导入完成</h3><div>无数据被导入，跳过 <b>\' + res.skipped + \'</b> 条</div>\';\n\
      }\n\n\
      document.getElementById(\'rc\').textContent = res.createdItems.length;\n\
      document.getElementById(\'rs\').textContent = res.skippedItems.length;\n\n\
      const cList = document.getElementById(\'createdList\');\n\
      cList.innerHTML = res.createdItems.length\n\
        ? res.createdItems.map(function(i) { return \'<div class="result-item"><span><b>\' + i.code + \'</b> · 行 \' + i.originalIndex + \' · 创建 \' + i.taskCount + \' 个帆索任务</span><span class="tag tag-ok">成功</span></div>\'; }).join(\'\')\n\
        : \'<div style="color:var(--muted); padding:20px; text-align:center;">无成功导入的数据</div>\';\n\n\
      const sList = document.getElementById(\'skippedList\');\n\
      sList.innerHTML = res.skippedItems.length\n\
        ? res.skippedItems.map(function(i) { return \'<div class="result-item"><span><b>\' + i.code + \'</b> · 行 \' + i.originalIndex + \'</span><span class="tag tag-warn">\' + i.message + \'</span></div>\'; }).join(\'\')\n\
        : \'<div style="color:var(--muted); padding:20px; text-align:center;">无跳过数据</div>\';\n\n\
      document.querySelectorAll(\'.tab[data-rtab]\').forEach(function(t) {\n\
        t.onclick = function() {\n\
          document.querySelectorAll(\'.tab[data-rtab]\').forEach(function(x) { x.classList.remove(\'active\'); });\n\
          t.classList.add(\'active\');\n\
          document.getElementById(\'rpanelCreated\').classList.toggle(\'active\', t.dataset.rtab === \'created\');\n\
          document.getElementById(\'rpanelSkipped\').classList.toggle(\'active\', t.dataset.rtab === \'skipped\');\n\
        };\n\
      });\n\
    }\n\n\
    document.getElementById(\'importMore\').onclick = function() { fileInput.value = \'\'; currentPreview = null; setStep(1); };\n\
  <\/script>\n\
</body>\n\
</html>';
}

export { importPage };
