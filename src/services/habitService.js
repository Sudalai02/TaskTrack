import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { todayISO, weekdayOf, addDays } from "../utils/dates.js";
import * as recycle from "./recycleService.js";
import { emit } from "../utils/bus.js";

const WD_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function allHabits() {
  const habits = await db.getAll("habits");
  return habits.filter((h) => !h.archived);
}

export async function createHabit(data) {
  const habit = {
    id: uid("h"),
    title: data.title.trim(),
    timeOfDay: data.timeOfDay || "08:00",
    durationMinutes: Number(data.durationMinutes) || 30,
    weekdays: (data.weekdays && data.weekdays.length ? data.weekdays : [1, 2, 3, 4, 5]).slice().sort(),
    color: data.color || "#3D5A80",
    archived: false,
    createdAt: new Date().toISOString(),
  };
  await db.put("habits", habit);
  emit("data-changed", { entity: "habits" });
  return habit;
}

export async function updateHabit(id, patch) {
  const h = await db.get("habits", id);
  if (!h) throw new Error(`Habit ${id} not found`);
  const next = await db.put("habits", { ...h, ...patch });
  emit("data-changed", { entity: "habits" });
  return next;
}

export async function removeHabit(id) {
  // Habit logs stay in place so a restore brings the full history back.
  const entry = await recycle.softDelete("habits", id);
  emit("data-changed", { entity: "habits" });
  return entry;
}

export function weekdayLabel(wd) {
  return WD_NAMES[wd];
}

// ---------- Logs ----------
export async function logsForDate(iso) {
  const logs = await db.getAll("habitLogs");
  return new Set(logs.filter((l) => l.date === iso && l.done).map((l) => l.habitId));
}

export function scheduledOn(habit, iso) {
  return (habit.weekdays || []).includes(weekdayOf(iso));
}

export async function toggleLog(habitId, iso = todayISO()) {
  const id = `${habitId}:${iso}`;
  const existing = await db.get("habitLogs", id);
  if (existing?.done) {
    await db.del("habitLogs", id);
    emit("data-changed", { entity: "habitLogs" });
    return false;
  }
  await db.put("habitLogs", { id, habitId, date: iso, done: true });
  emit("data-changed", { entity: "habitLogs" });
  return true;
}

export async function isDone(habitId, iso = todayISO()) {
  const row = await db.get("habitLogs", `${habitId}:${iso}`);
  return Boolean(row?.done);
}

// Current streak: consecutive *scheduled* days completed, walking back
// from today (today counts only if already done).
export async function streak(habit) {
  let count = 0;
  for (let d = 0; d < 365; d++) {
    const iso = addDays(todayISO(), -d);
    if (!scheduledOn(habit, iso)) continue;
    if (await isDone(habit.id, iso)) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

// Longest ever streak of completed scheduled days.
export async function bestStreak(habit) {
  const logs = (await db.getAll("habitLogs")).filter((l) => l.habitId === habit.id && l.done);
  if (!logs.length) return 0;
  const doneSet = new Set(logs.map((l) => l.date));
  let best = 0;
  // walk back from today and also from the earliest log to catch old runs
  const candidates = [todayISO(), logs.map((l) => l.date).sort()[0]];
  for (const start of candidates) {
    let count = 0;
    let cursor = start;
    // step back until we leave a streak, bounded by two years
    for (let i = 0; i < 730; i++) {
      const prev = addDays(cursor, -1);
      if (!scheduledOn(habit, prev)) {
        cursor = prev;
        continue; // rest days don't break the chain
      }
      if (!doneSet.has(prev)) break;
      count += 1;
      cursor = prev;
    }
    best = Math.max(best, count + (doneSet.has(start) ? 1 : 0));
  }
  return best;
}

// done/scheduled ratio over the last N days
export async function consistency(habits, days = 30) {
  const logs = await db.getAll("habitLogs");
  const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
  const perHabit = {};
  for (const h of habits) {
    let sched = 0,
      done = 0;
    for (let d = 1; d <= days; d++) {
      const iso = addDays(todayISO(), -d);
      if (!scheduledOn(h, iso)) continue;
      sched += 1;
      if (doneSet.has(`${h.id}:${iso}`)) done += 1;
    }
    perHabit[h.id] = { scheduled: sched, done, pct: sched ? Math.round((done / sched) * 100) : null };
  }
  return perHabit;
}
