// ============================================================
// DATE HELPERS — everything uses local dates, ISO "yyyy-mm-dd"
// ============================================================

export function todayISO() {
  return toISO(new Date());
}

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromISO(iso) {
  return new Date(`${iso}T00:00:00`);
}

export function addDays(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function diffDays(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

// Sortable number for a due date. Missing or unparseable values become
// Infinity so undated tasks sink to the bottom instead of poisoning the
// comparison with NaN.
function dueKey(iso) {
  if (!iso) return Infinity;
  const t = fromISO(String(iso).slice(0, 10)).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

// Canonical task ordering: ascending by real due date, earliest first,
// undated last. Equal dates break on creation time then id, so the order
// stays stable across renders instead of falling back to the arbitrary
// document order the store returns. Always returns -1, 0 or 1.
export function byDueDate(a, b) {
  const ka = dueKey(a.dueDate);
  const kb = dueKey(b.dueDate);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

// 0 = Sunday … 6 = Saturday
export function weekdayOf(iso) {
  return fromISO(iso).getDay();
}

export function startOfWeekISO(iso = todayISO()) {
  const d = fromISO(iso);
  const shift = (d.getDay() + 6) % 7; // week starts Monday
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

export function fmtDue(iso) {
  if (!iso) return "No date";
  const delta = diffDays(todayISO(), iso);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta < -1) return `${Math.abs(delta)}d overdue`;
  if (delta < 7) return fromISO(iso).toLocaleDateString(undefined, { weekday: "long" });
  return fromISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDayShort(iso) {
  return fromISO(iso).toLocaleDateString(undefined, { weekday: "short" });
}

export function fmtDateLong(iso) {
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export function minutesToHuman(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function secondsToClock(s) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}
