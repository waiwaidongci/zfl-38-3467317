import XLSX from "xlsx";

const FIELD_ALIASES = {
  code: ["模型编号", "编号", "code", "modelCode", "模型编码"],
  shipType: ["船型", "船舶类型", "shipType", "type", "型号"],
  scale: ["比例", "比例尺", "scale", "比例尺寸"],
  mastCount: ["桅杆数量", "桅杆数", "mastCount", "masts", "桅数"],
  riggingMaterial: ["帆索材料", "索具材料", "材料", "riggingMaterial", "material"],
  owner: ["负责人", "责任人", "owner", "担当", "负责"],
  dueDate: ["交付日期", "交货日期", "截止日期", "dueDate", "deadline", "交付时间"],
};

const KNOWN_FIELDS = Object.keys(FIELD_ALIASES);

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase().replace(/[\s_/-]/g, "");
}

function matchField(headerName) {
  const normalized = normalizeHeader(headerName);
  for (const field of KNOWN_FIELDS) {
    const aliases = FIELD_ALIASES[field];
    for (const alias of aliases) {
      if (normalizeHeader(alias) === normalized) {
        return field;
      }
    }
  }
  return null;
}

function parseBuffer(buffer, filename = "") {
  const buf = Buffer.from(buffer);
  let workbook;

  const isCSV = filename.toLowerCase().endsWith(".csv") ||
    (buf.length > 0 && buf[0] !== 0x50 && buf[0] !== 0xD0);

  if (isCSV) {
    let text;
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      text = buf.slice(3).toString("utf8");
    } else {
      text = buf.toString("utf8");
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    workbook = XLSX.read(text, { type: "string", cellDates: false, raw: false });
  } else {
    workbook = XLSX.read(buf, { type: "array", cellDates: true });
  }
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (!rows || rows.length === 0) {
    return { headers: [], data: [], fieldMap: {} };
  }

  const rawHeaders = rows[0].map(h => {
    let s = String(h || "").trim();
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s;
  });
  const fieldMap = {};
  const recognizedHeaders = [];

  rawHeaders.forEach((header, idx) => {
    const matched = matchField(header);
    if (matched) {
      fieldMap[idx] = matched;
      recognizedHeaders.push({ header, field: matched, recognized: true });
    } else {
      recognizedHeaders.push({ header, field: null, recognized: false });
    }
  });

  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => cell === "" || cell === null || cell === undefined)) {
      continue;
    }
    const obj = { _rowIndex: i };
    for (let j = 0; j < rawHeaders.length; j++) {
      const field = fieldMap[j];
      if (field) {
        let value = row[j];
        if (value instanceof Date) {
          const y = value.getFullYear();
          const m = String(value.getMonth() + 1).padStart(2, "0");
          const d = String(value.getDate()).padStart(2, "0");
          value = `${y}-${m}-${d}`;
        } else if (typeof value === "string") {
          value = value.trim();
        }
        obj[field] = value;
      }
    }
    data.push(obj);
  }

  return { headers: rawHeaders, recognizedHeaders, data, fieldMap };
}

function generateTaskSummary(row) {
  const mastCount = row.mastCount;
  const tasks = [];
  const standardPositions = ["侧支索", "升帆索", "稳索", "后支索", "前支索"];

  if (typeof mastCount === "number" && mastCount > 0) {
    const mastNames = mastCount >= 3
      ? ["前桅", "主桅", "后桅"]
      : mastCount === 2
        ? ["前桅", "主桅"]
        : ["主桅"];

    for (let i = 0; i < Math.min(mastCount, mastNames.length); i++) {
      for (const pos of standardPositions.slice(0, 3)) {
        tasks.push({
          position: mastNames[i] + pos,
          tension: "待检测",
          status: "待检查",
        });
      }
    }
  }

  return tasks;
}

export { parseBuffer, generateTaskSummary, FIELD_ALIASES, KNOWN_FIELDS };
