function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDate(d) {
  if (!d) return "";
  const date = typeof d === "string" ? parseDate(d) : d;
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function daysBetween(date1, date2) {
  const d1 = typeof date1 === "string" ? parseDate(date1) : date1;
  const d2 = typeof date2 === "string" ? parseDate(date2) : date2;
  if (!d1 || !d2) return null;
  const oneDay = 24 * 60 * 60 * 1000;
  const diffTime = d2.getTime() - d1.getTime();
  return Math.round(diffTime / oneDay);
}

function daysFromToday(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return daysBetween(today(), d);
}

function isOverdue(dateStr) {
  const days = daysFromToday(dateStr);
  return days !== null && days < 0;
}

function isWithinDays(dateStr, days) {
  const d = daysFromToday(dateStr);
  return d !== null && d >= 0 && d <= days;
}

function addDays(date, days) {
  const d = typeof date === "string" ? parseDate(date) : new Date(date);
  if (!d || isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function getNextNDates(n, startDate) {
  const dates = [];
  const start = startDate ? parseDate(startDate) : today();
  if (!start) return dates;
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i);
    dates.push(formatDate(d));
  }
  return dates;
}

function getWeekday(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return weekdays[d.getDay()];
}

function isSameDay(date1, date2) {
  const d1 = typeof date1 === "string" ? parseDate(date1) : date1;
  const d2 = typeof date2 === "string" ? parseDate(date2) : date2;
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function getLatestLogTime(item) {
  const logs = item.logs || [];
  const taskLogs = (item.tasks || []).flatMap(t => t.logs || []);
  const allLogs = [...logs, ...taskLogs];
  if (allLogs.length === 0) return null;
  const sorted = allLogs
    .map(l => new Date(l.at))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b - a);
  return sorted.length > 0 ? sorted[0] : null;
}

function daysSinceLastLog(item) {
  const lastLog = getLatestLogTime(item);
  if (!lastLog) return null;
  const diffTime = today().getTime() - lastLog.getTime();
  return Math.floor(diffTime / (24 * 60 * 60 * 1000));
}

export {
  today,
  parseDate,
  formatDate,
  formatDateTime,
  daysBetween,
  daysFromToday,
  isOverdue,
  isWithinDays,
  addDays,
  getNextNDates,
  getWeekday,
  isSameDay,
  getLatestLogTime,
  daysSinceLastLog
};
