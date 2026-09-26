// ============================================================
// ANALYTICS — every number answers a real question.
// Range stats, per-day series, productive hours, habit consistency.
// ============================================================

import { todayISO, addDays, diffDays, fromISO, byDueDate } from "../utils/dates.js";
import * as db from "../store/db.js";

// ---- Goal progress helper (shared) ----
async function computeGoalProgress(goals, projects, tasks) {
  const doneSet = ["Completed", "Cancelled"];
  const projProg = {};
  for (const p of projects) projProg[p.id] = { done: 0, total: 0 };
  for (const t of tasks) {
    if (t.projectId && projProg[t.projectId]) {
      projProg[t.projectId].total += 1;
      if (doneSet.includes(t.status)) projProg[t.projectId].done += 1;
    }
  }
  const map = {};
  for (const g of goals) {
    const linked = projects.filter((p) => p.goalId === g.id);
    const directTasks = tasks.filter((t) => t.goalId === g.id);
    let done = 0, total = 0;
    for (const p of linked) { done += projProg[p.id]?.done || 0; total += projProg[p.id]?.total || 0; }
    for (const t of directTasks) { total += 1; if (doneSet.includes(t.status)) done += 1; }
    const taskPct = total > 0 ? Math.round((done / total) * 100) : null;
    map[g.id] = { pct: g.status === "Completed" ? 100 : taskPct, taskPct, taskDone: done, taskTotal: total };
  }
  return map;
}

// ---- helpers ----
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---- Today's focus (fast — queries only today) ----
export async function todayFocus() {
  const today = todayISO();
  const sessions = await db.getAll("focusSessions");
  let minutes = 0, deepMinutes = 0, count = 0;
  const hourBuckets = new Array(24).fill(0);
  for (const s of sessions) {
    if (s.type !== "focus") continue;
    if (s.startedAt.slice(0, 10) !== today) continue;
    const mins = Math.round((s.durationSeconds || 0) / 60);
    minutes += mins;
    count++;
    if ((s.plannedMinutes || 0) >= 45) deepMinutes += mins;
    const h = new Date(s.startedAt).getHours();
    hourBuckets[h] += mins;
  }
  return { minutes, deepMinutes, sessionCount: count, hourBuckets };
}

// ---- Trend data points with period-appropriate granularity ----
const PERIOD_DAYS = { today: 1, week: 7, month: 30, "3m": 90 };

export async function trendData(period) {
  const days = PERIOD_DAYS[period] || 7;
  const stats = await rangeStats(days);
  const pts = [];

  const fmtShort = (iso) => {
    const dt = fromISO(iso);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  if (period === "today") {
    for (let h = 0; h < 24; h++) {
      if (stats.hourBuckets[h]) pts.push({ label: `${h}:00`, value: stats.hourBuckets[h], tasks: 0, focusMin: stats.hourBuckets[h], date: stats.end, range: stats.end });
    }
  } else if (period === "week") {
    for (const d of stats.perDay) {
      const dt = fromISO(d.date);
      pts.push({ label: dt.toLocaleDateString(undefined, { weekday: "short" }), value: d.completed * 30 + d.focusMin, tasks: d.completed, focusMin: d.focusMin, date: d.date, range: d.date });
    }
  } else if (period === "month") {
    for (let i = 0; i < stats.perDay.length; i += 7) {
      const chunk = stats.perDay.slice(i, i + 7);
      const tasks = chunk.reduce((a, d) => a + (d.completed || 0), 0);
      const focusMin = chunk.reduce((a, d) => a + (d.focusMin || 0), 0);
      const first = chunk[0]?.date, last = chunk[chunk.length - 1]?.date;
      pts.push({ label: `Wk ${Math.floor(i / 7) + 1}`, value: tasks * 30 + focusMin, tasks, focusMin, date: first, range: first && last ? `${fmtShort(first)} – ${fmtShort(last)}` : first });
    }
  } else {
    for (let i = 0; i < stats.perDay.length; i += 14) {
      const chunk = stats.perDay.slice(i, i + 14);
      const tasks = chunk.reduce((a, d) => a + (d.completed || 0), 0);
      const focusMin = chunk.reduce((a, d) => a + (d.focusMin || 0), 0);
      const first = chunk[0]?.date, last = chunk[chunk.length - 1]?.date;
      const start = chunk[0]?.date?.slice(5) || "";
      pts.push({ label: start, value: tasks * 30 + focusMin, tasks, focusMin, date: first, range: first && last ? `${fmtShort(first)} – ${fmtShort(last)}` : first });
    }
  }
  return { pts, stats };
}

// ---- Risks (ALWAYS current, not period-scoped) ----
export async function currentRisks() {
  const today = todayISO();
  const [tasks, goals, projects, habits] = await Promise.all([
    db.getAll("tasks"), db.getAll("goals"), db.getAll("projects"), db.getAll("habits"),
  ]);
  const OPEN = ["Todo", "In Progress", "Blocked"];
  const risks = [];

  // Overdue tasks — worst breach first, so the top 3 are the real emergencies
  const overdue = tasks
    .filter((t) => t.dueDate && t.dueDate < today && OPEN.includes(t.status))
    .sort(byDueDate);
  for (const t of overdue.slice(0, 3)) {
    const daysOver = diffDays(t.dueDate, today);
    risks.push({ type: "task", severity: "red", title: t.title, detail: `${Math.abs(daysOver)} day${Math.abs(daysOver) !== 1 ? "s" : ""} overdue`, taskId: t.id });
  }

  // Stalled goals (no progress in 5+ days)
  const goalProg = await computeGoalProgress(goals, projects, tasks);
  for (const g of goals.filter((g) => g.status !== "Completed" && g.status !== "Cancelled")) {
    const p = goalProg[g.id]?.pct ?? 0;
    if (p > 0 && p < 30) {
      risks.push({ type: "goal", severity: "orange", title: g.title, detail: `At ${p}% — needs attention`, goalId: g.id });
    }
  }

  // Weak habits (below 50% consistency)
  const cons = await habitConsistency(7);
  for (const h of cons.filter((h) => h.pct < 50 && h.scheduled >= 3)) {
    risks.push({ type: "habit", severity: "yellow", title: `${h.habit.title} habit`, detail: `${h.pct}% consistency this week`, habitId: h.habit.id });
  }

  return risks;
}

// ---- Streaks per habit ----
export async function computeStreaks() {
  const habits = (await db.getAll("habits")).filter((h) => !h.archived);
  const logs = await db.getAll("habitLogs");
  const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
  const today = todayISO();

  return habits.map((h) => {
    let streak = 0;
    for (let d = 0; d <= 365; d++) {
      const dt = new Date(`${today}T00:00:00`);
      dt.setDate(dt.getDate() - d);
      const wd = dt.getDay();
      if (!(h.weekdays || []).includes(wd)) continue; // skip non-scheduled days
      const key = `${h.id}:${dt.toISOString().slice(0, 10)}`;
      if (doneSet.has(key)) { streak++; } else { break; }
    }
    return { habit: h, streak };
  });
}

// ---- Goal completion forecast ----
export async function forecastGoal(goal, goalProg, daysActive) {
  const pct = goalProg?.pct ?? 0;
  const remaining = 100 - pct;
  if (remaining <= 0) return { probability: 100, estDate: null };
  if (daysActive <= 0) return { probability: null, estDate: null };
  const velocity = pct / daysActive;
  if (velocity <= 0) return { probability: 0, estDate: null };
  const daysNeeded = remaining / velocity;
  const estDate = addDays(todayISO(), Math.ceil(daysNeeded));
  // Probability: how likely to finish given velocity (capped at 95%)
  const probability = clamp(Math.round(pct / Math.max(daysNeeded, 1) * 12), 5, 95);
  return { probability, estDate };
}

// ---- AI insight text for a given period ----
export function aiInsightForPeriod(stats, habitsCons, risks, score) {
  const lines = [];
  const completedRate = stats.completionRate ?? 0;
  const focusH = Math.round(stats.focusMinutes / 60);

  // Working
  if (completedRate >= 70) lines.push({ icon: "🟢", label: "Working", text: `You completed ${completedRate}% of due tasks this period. Strong execution.` });
  else if (stats.tasksCompleted >= 5) lines.push({ icon: "🟢", label: "Working", text: `${stats.tasksCompleted} tasks completed — solid volume for this period.` });

  // Hurting
  const overdueCount = risks.filter((r) => r.type === "task").length;
  if (overdueCount >= 3) lines.push({ icon: "🔴", label: "Hurting", text: `${overdueCount} overdue tasks — ${risks.filter((r) => r.type === "task" && r.detail.includes("60")).length || overdueCount} are long-standing.` });
  else if (overdueCount) lines.push({ icon: "🔴", label: "Hurting", text: `${overdueCount} overdue task${overdueCount !== 1 ? "s" : ""} need rescheduling or deletion.` });

  // Attention
  const stalledGoals = risks.filter((r) => r.type === "goal");
  if (stalledGoals.length) lines.push({ icon: "🟡", label: "Attention", text: `"${stalledGoals[0].title}" has stalled — consider a focused sprint or explicit pause.` });
  else if (habitsCons.length && habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length < 60)
    lines.push({ icon: "🟡", label: "Attention", text: `Habit consistency is below 60%. Small adjustments beat willpower.` });

  // Recommendation
  if (focusH < 7) lines.push({ icon: "💡", label: "Recommendation", text: `Only ${focusH}h of focus this period. Book one 90-minute block tomorrow morning.` });
  else lines.push({ icon: "💡", label: "Recommendation", text: `Focus volume is solid (${focusH}h). Protect your best hours from meetings.` });

  // Next step
  if (overdueCount) lines.push({ icon: "🚀", label: "Best next step", text: `Clear the ${overdueCount} overdue item${overdueCount !== 1 ? "s" : ""} before adding new work.` });
  else if (stalledGoals.length) lines.push({ icon: "🚀", label: "Best next step", text: `Spend 30 minutes on "${stalledGoals[0].title}" to rebuild momentum.` });
  else lines.push({ icon: "🚀", label: "Best next step", text: `Raise your focus target by 10% — you have capacity.` });

  return lines;
}

// ---- Schedule score estimate ----
// Schedule Score = (Completion Rate × 0.6) + (Focus Session Rate × 0.2) + (On-Time Rate × 0.2)
// All components are 0–100 percentages; the result is capped at 100.
export function scheduleScore(stats) {
  if (stats.completionRate == null) return null;
  const focus = stats.focusSessionRate ?? 0;
  const onTime = stats.onTimeRate ?? 0;
  return clamp(Math.round(stats.completionRate * 0.6 + focus * 0.2 + onTime * 0.2), 0, 100);
}

export async function rangeStats(days, offset = 0) {
  const today = todayISO();
  const end = addDays(today, -offset);
  const start = addDays(end, -(days - 1));

  const tasks = await db.getAll("tasks");
  const sessions = await db.getAll("focusSessions");
  const habits = await db.getAll("habits");

  // Tasks completed within the window
  const completedIn = tasks.filter(
    (t) => t.status === "Completed" && t.completedAt && t.completedAt.slice(0, 10) >= start && t.completedAt.slice(0, 10) <= end
  );

  // Completion rate: of tasks that were due inside the window, how many are done?
  const dueInWindow = tasks.filter((t) => t.dueDate && t.dueDate >= start && t.dueDate <= end);
  const doneOfDue = dueInWindow.filter(
    (t) => t.status === "Completed" || t.status === "Cancelled"
  );

  // Focus time
  let focusMinutes = 0;
  let deepMinutes = 0;
  let sessionCount = 0;
  const hourBuckets = new Array(24).fill(0); // minutes per start-hour
  const focusDays = new Set();
  for (const s of sessions) {
    if (s.type !== "focus") continue;
    const day = s.startedAt.slice(0, 10);
    if (day < start || day > end) continue;
    const mins = Math.round((s.durationSeconds || 0) / 60);
    focusMinutes += mins;
    sessionCount += 1;
    focusDays.add(day);
    if ((s.plannedMinutes || 0) >= 45) deepMinutes += mins;
    const h = new Date(s.startedAt).getHours();
    hourBuckets[h] += mins;
  }

  // Focus session rate: % of days in the window with at least one focus session.
  const focusSessionRate = days ? Math.round((focusDays.size / days) * 100) : null;

  // On-time rate: of tasks completed inside the window that had a due date,
  // how many were finished on or before their due date.
  const completedWithDue = completedIn.filter((t) => t.dueDate);
  const onTime = completedWithDue.filter((t) => t.completedAt.slice(0, 10) <= t.dueDate).length;
  const onTimeRate = completedWithDue.length ? Math.round((onTime / completedWithDue.length) * 100) : null;

  // Avg task duration from actuals
  const withActual = completedIn.filter((t) => t.actualMinutes);
  const avgTaskMinutes = withActual.length
    ? Math.round(withActual.reduce((a, t) => a + t.actualMinutes, 0) / withActual.length)
    : null;

  // Per-day series
  const perDay = [];
  for (let d = days - 1; d >= 0; d--) {
    const iso = addDays(end, -d);
    const completed = completedIn.filter((t) => t.completedAt.slice(0, 10) === iso).length;
    const focusMin = sessions
      .filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) === iso)
      .reduce((a, s) => a + Math.round((s.durationSeconds || 0) / 60), 0);
    perDay.push({ date: iso, completed, focusMin });
  }

  return {
    days,
    start,
    end,
    tasksCompleted: completedIn.length,
    completionRate: dueInWindow.length ? Math.round((doneOfDue.length / dueInWindow.length) * 100) : null,
    focusMinutes,
    deepMinutes,
    sessionCount,
    focusSessionRate,
    onTimeRate,
    avgTaskMinutes,
    perDay,
    hourBuckets,
    habits,
  };
}

// Best working windows — returns top consecutive 3h window label + data
export function bestWindow(hourBuckets) {
  let bestStart = 8;
  let bestSum = -1;
  for (let h = 5; h <= 20; h++) {
    const sum = hourBuckets[h] + hourBuckets[h + 1] + hourBuckets[h + 2];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = h;
    }
  }
  return { startHour: bestStart, totalMinutes: Math.max(0, bestSum) };
}

export async function habitConsistency(periodOrDays = 30) {
  const habits = (await db.getAll("habits")).filter((h) => !h.archived);
  const logs = await db.getAll("habitLogs");
  const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
  const today = todayISO();

  const perHabit = habits.map((h) => {
    let scheduled = 0;
    let done = 0;

    function checkDay(iso) {
      const wd = fromISO(iso).getDay();
      if ((h.weekdays || []).includes(wd)) {
        scheduled += 1;
        if (doneSet.has(`${h.id}:${iso}`)) done += 1;
      }
    }

    if (periodOrDays === "today") {
      checkDay(today);
    } else if (periodOrDays === "week") {
      // Calendar week: Monday through today
      const todayDate = fromISO(today);
      const dayOfWeek = todayDate.getDay();
      const mondayOffset = (dayOfWeek + 6) % 7;
      for (let d = mondayOffset; d >= 0; d--) {
        const date = new Date(todayDate);
        date.setDate(date.getDate() - d);
        checkDay(date.toISOString().slice(0, 10));
      }
    } else if (periodOrDays === "month") {
      // Last 30 days including today
      for (let d = 30 - 1; d >= 0; d--) {
        const date = new Date(`${today}T00:00:00`);
        date.setDate(date.getDate() - d);
        checkDay(date.toISOString().slice(0, 10));
      }
    } else {
      // Custom or numeric: last N days including today
      const days = typeof periodOrDays === "number" ? periodOrDays : 30;
      for (let d = days - 1; d >= 0; d--) {
        const date = new Date(`${today}T00:00:00`);
        date.setDate(date.getDate() - d);
        checkDay(date.toISOString().slice(0, 10));
      }
    }

    return { habit: h, scheduled, done, pct: scheduled ? Math.round((done / scheduled) * 100) : null };
  });

  return perHabit.filter((x) => x.scheduled > 0);
}

