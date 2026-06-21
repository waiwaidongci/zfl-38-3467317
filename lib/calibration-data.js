import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const calibrationDbPath = join(__dirname, "..", "data", "calibration-rules.json");

const seed = {
  rules: [
    {
      id: "CR-1",
      material: "蜡线",
      scale: "1:48",
      position: "前桅侧支索",
      tensionRange: "正常-偏紧",
      suggestedTension: "正常",
      noteTemplate: "建议张力适中，蜡线受力过紧易断裂，可微调1-2mm观察效果",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    {
      id: "CR-2",
      material: "蜡线",
      scale: "1:48",
      position: "主桅侧支索",
      tensionRange: "正常-偏紧",
      suggestedTension: "偏紧",
      noteTemplate: "主桅承重较大，建议偏紧但不僵直，注意受力均匀",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    {
      id: "CR-3",
      material: "麻绳",
      scale: "1:50",
      position: "前桅升帆索",
      tensionRange: "偏松-正常",
      suggestedTension: "正常",
      noteTemplate: "麻绳伸缩性较强，建议留余量，后期可根据实际情况收紧",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    {
      id: "CR-4",
      material: "棉线",
      scale: "1:60",
      position: "后桅稳索",
      tensionRange: "正常",
      suggestedTension: "正常",
      noteTemplate: "棉线较柔软，调整时注意保持稳定，避免频繁松紧",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    {
      id: "CR-5",
      material: "丝线",
      scale: "1:80",
      position: "单桅侧支索",
      tensionRange: "正常-偏紧",
      suggestedTension: "正常",
      noteTemplate: "丝线精细，轻调即可，注意不要过度用力导致断线",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    }
  ]
};

async function loadCalibrationDb() {
  if (!existsSync(calibrationDbPath)) {
    await mkdir(dirname(calibrationDbPath), { recursive: true });
    await writeFile(calibrationDbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(calibrationDbPath, "utf8"));
}

async function saveCalibrationDb(db) {
  await writeFile(calibrationDbPath, JSON.stringify(db, null, 2));
}

function newRuleId() {
  return "CR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

function getAllRules(db, filters = {}) {
  return db.rules.filter(rule => {
    if (filters.material && rule.material !== filters.material) return false;
    if (filters.scale && rule.scale !== filters.scale) return false;
    if (filters.position && rule.position !== filters.position) return false;
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      const haystack = JSON.stringify(rule).toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

function findRuleById(db, id) {
  return db.rules.find(r => r.id === id);
}

function findMatchingRule(db, material, scale, position) {
  return db.rules.find(r =>
    r.material === material &&
    r.scale === scale &&
    r.position === position
  );
}

function getUniqueMaterials(db) {
  return [...new Set(db.rules.map(r => r.material))].sort();
}

function getUniqueScales(db) {
  return [...new Set(db.rules.map(r => r.scale))].sort();
}

function getUniquePositions(db) {
  return [...new Set(db.rules.map(r => r.position))].sort();
}

async function createRule(db, input) {
  const rule = {
    id: newRuleId(),
    material: input.material || "",
    scale: input.scale || "",
    position: input.position || "",
    tensionRange: input.tensionRange || "",
    suggestedTension: input.suggestedTension || "",
    noteTemplate: input.noteTemplate || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.rules.unshift(rule);
  await saveCalibrationDb(db);
  return rule;
}

async function updateRule(db, id, updates) {
  const rule = findRuleById(db, id);
  if (!rule) {
    throw new Error("rule_not_found");
  }
  const fields = ["material", "scale", "position", "tensionRange", "suggestedTension", "noteTemplate"];
  for (const field of fields) {
    if (updates[field] !== undefined) {
      rule[field] = updates[field];
    }
  }
  rule.updatedAt = new Date().toISOString();
  await saveCalibrationDb(db);
  return rule;
}

async function deleteRule(db, id) {
  const index = db.rules.findIndex(r => r.id === id);
  if (index === -1) {
    throw new Error("rule_not_found");
  }
  db.rules.splice(index, 1);
  await saveCalibrationDb(db);
  return true;
}

export {
  loadCalibrationDb,
  saveCalibrationDb,
  getAllRules,
  findRuleById,
  findMatchingRule,
  getUniqueMaterials,
  getUniqueScales,
  getUniquePositions,
  createRule,
  updateRule,
  deleteRule
};
