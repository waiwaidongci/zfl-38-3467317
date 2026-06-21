function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n) && Number(n) >= 0;
}

function normalizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return s;
  }
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let month = parseInt(m[1], 10);
    let day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  m = s.match(/^(\d{4})[年\.](\d{1,2})[月\.](\d{1,2})/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  const d = new Date(s);
  if (d instanceof Date && !isNaN(d)) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  return null;
}

function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return false;
  const normalized = normalizeDate(dateStr);
  if (!normalized) return false;
  const d = new Date(normalized);
  return d instanceof Date && !isNaN(d);
}

function normalizeMastCount(value) {
  if (value === "" || value === null || value === undefined) return { valid: false, value: null, reason: "missing" };
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0 && value <= 10) {
      return { valid: true, value };
    }
    return { valid: false, value, reason: "range" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseInt(trimmed, 10);
    if (/^[1-9]\d*$/.test(trimmed) && parsed > 0 && parsed <= 10) {
      return { valid: true, value: parsed };
    }
    if (/^[零一二三四五六七八九十]+$/.test(trimmed)) {
      const cnMap = { "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
      let total = 0;
      if (trimmed === "十") total = 10;
      else if (trimmed.startsWith("十")) total = 10 + (cnMap[trimmed[1]] || 0);
      else if (trimmed.includes("十")) {
        const [a, b] = trimmed.split("十");
        total = (cnMap[a] || 0) * 10 + (cnMap[b] || 0);
      } else total = cnMap[trimmed] || 0;
      if (total > 0 && total <= 10) return { valid: true, value: total };
    }
    return { valid: false, value, reason: "format" };
  }
  return { valid: false, value, reason: "type" };
}

function validateRow(row, existingCodes, fileDuplicateCodes) {
  const errors = [];
  const warnings = [];
  const normalized = { ...row };
  delete normalized._rowIndex;

  if (!row.code || String(row.code).trim() === "") {
    errors.push({ field: "code", message: "模型编号不能为空" });
  } else {
    const code = String(row.code).trim();
    normalized.code = code;
    if (existingCodes.has(code)) {
      errors.push({ field: "code", message: `模型编号 ${code} 已存在于系统中`, type: "duplicate_system" });
    }
    if (fileDuplicateCodes.has(code)) {
      errors.push({ field: "code", message: `模型编号 ${code} 在导入文件中重复`, type: "duplicate_file" });
    }
  }

  const mastResult = normalizeMastCount(row.mastCount);
  if (!mastResult.valid) {
    if (mastResult.reason === "missing") {
      warnings.push({ field: "mastCount", message: "桅杆数量为空" });
    } else {
      errors.push({ field: "mastCount", message: `桅杆数量格式错误: ${row.mastCount}（应为1-10的正整数）` });
    }
  } else {
    normalized.mastCount = mastResult.value;
  }

  if (!row.dueDate || String(row.dueDate).trim() === "") {
    warnings.push({ field: "dueDate", message: "缺失交付日期" });
  } else {
    const normDate = normalizeDate(String(row.dueDate).trim());
    if (!normDate) {
      errors.push({ field: "dueDate", message: `交付日期格式错误: ${row.dueDate}（应为YYYY-MM-DD）` });
    } else {
      normalized.dueDate = normDate;
    }
  }

  ["shipType", "scale", "riggingMaterial", "owner"].forEach(field => {
    if (row[field] !== undefined && row[field] !== null) {
      normalized[field] = String(row[field]).trim();
    }
  });

  return {
    originalIndex: row._rowIndex,
    normalized,
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

function validateAll(parsedData, existingItems) {
  const existingCodes = new Set(existingItems.map(item => item.code).filter(Boolean));

  const fileCodeCounts = new Map();
  parsedData.data.forEach(row => {
    if (row.code) {
      const code = String(row.code).trim();
      fileCodeCounts.set(code, (fileCodeCounts.get(code) || 0) + 1);
    }
  });
  const fileDuplicateCodes = new Set([...fileCodeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code));

  const results = parsedData.data.map(row => validateRow(row, existingCodes, fileDuplicateCodes));

  const summary = {
    total: results.length,
    valid: results.filter(r => r.valid).length,
    invalid: results.filter(r => !r.valid).length,
    withWarnings: results.filter(r => r.warnings.length > 0 && r.valid).length,
    duplicateSystem: results.filter(r => r.errors.some(e => e.type === "duplicate_system")).length,
    duplicateFile: results.filter(r => r.errors.some(e => e.type === "duplicate_file")).length,
    missingDueDate: results.filter(r => r.warnings.some(w => w.field === "dueDate")).length,
    mastCountErrors: results.filter(r => r.errors.some(e => e.field === "mastCount")).length,
  };

  return {
    headers: parsedData.headers,
    recognizedHeaders: parsedData.recognizedHeaders,
    rows: results,
    summary,
  };
}

export { validateAll, validateRow, normalizeMastCount, isValidDate };
