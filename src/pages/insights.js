// ============================================================
// INSIGHTS — complete rebuild with period-scoped analytics,
// trend graphs, AI analysis, risk center, and forecasts.
// Every number is real data, zero placeholders.
// ============================================================

import { icon } from "../dom.js";
import * as analytics from "../services/analyticsService.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import { todayISO, addDays, diffDays, minutesToHuman, fromISO } from "../utils/dates.js";

// ---- state ----
const PERIODS = [
  { key: "today", label: "Today", days: 1, compare: null },
  { key: "week",  label: "Week",  days: 7, compare: 7 },
  { key: "month", label: "Month", days: 30, compare: 30 },
  { key: "3m",    label: "3M",    days: 90, compare: 90 },
];
let currentPeriod = "week";
const PERIOD_DAYS = { today: 1, week: 7, month: 30, "3m": 90 };

// ---- helpers ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function periodLabel(key) {
  return PERIODS.find((p) => p.key === key)?.label || "Week";
}

function compareLabel(key) {
  if (key === "today") return "vs yesterday";
  if (key === "week") return "vs last week";
  if (key === "month") return "vs last month";
  return "vs last quarter";
}

function scoreLabel(s) {
  if (s >= 85) return "Excellent — On track";
  if (s >= 70) return "Strong — Keep going";
  if (s >= 50) return "Steady — Room to grow";
  if (s >= 30) return "Needs push — Focus here";
  return "Reset time — Start fresh";
}

function scoreClass(s) {
  if (s >= 70) return "good";
  if (s >= 40) return "warn";
  return "bad";
}

function statusColor(pct) {
  if (pct >= 70) return "green";
  if (pct >= 40) return "yellow";
  return "red";
}

function statusIcon(pct) {
  if (pct >= 70) return "🟢";
  if (pct >= 40) return "🟡";
  return "🔴";
}

// ---- compute productivity score (weighted) ----
function computeScore({ stats, prevStats, habitsCons, overdueCount, goalProgressMap, goals }) {
  const focusTarget = Math.max((stats.days || 7) * 45, 60);
  const goalProgVals = goalProgressMap ? Object.values(goalProgressMap).map((g) => g.pct ?? 0) : [];
  const avgGoalProg = goalProgVals.length ? Math.round(goalProgVals.reduce((a, v) => a + v, 0) / goalProgVals.length) : null;
  const habitsAvg = habitsCons.length
    ? Math.round(habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length)
    : null;
  const schedule = analytics.scheduleScore(stats);
  const parts = {
    tasks: stats.completionRate ?? (stats.tasksCompleted > 0 ? 80 : null),
    focus: pct(stats.focusMinutes, focusTarget),
    goals: avgGoalProg,
    habits: habitsAvg,
    schedule,
  };
  const weights = { tasks: 30, focus: 20, goals: 20, habits: 15, schedule: 15 };
  let total = 0, weight = 0;
  const weighted = [];
  for (const k of Object.keys(weights)) {
    if (parts[k] == null) continue;
    weighted.push({ key: k, part: parts[k], weight: weights[k] });
    total += parts[k] * weights[k];
    weight += weights[k];
  }
  const score = weight ? Math.round(total / weight) : 0;

  // Raw inputs so the UI can explain each calculation.
  const breakdown = {
    tasks: {
      completionRate: stats.completionRate,
      tasksCompleted: stats.tasksCompleted,
      fallback: stats.completionRate == null && stats.tasksCompleted > 0,
      part: parts.tasks,
    },
    focus: {
      focusMinutes: stats.focusMinutes,
      focusTarget,
      days: stats.days || 7,
      part: parts.focus,
    },
    goals: {
      avg: avgGoalProg,
      list: goals ? goals.filter((g) => g.status !== "Completed").map((g) => ({ title: g.title, pct: goalProgressMap[g.id]?.pct ?? 0 })) : [],
      part: parts.goals,
    },
    habits: {
      avg: habitsAvg,
      list: habitsCons.map((h) => ({ title: h.habit.title, done: h.done, scheduled: h.scheduled, pct: h.pct })),
      part: parts.habits,
    },
    schedule: {
      completionRate: stats.completionRate,
      focusSessionRate: stats.focusSessionRate,
      onTimeRate: stats.onTimeRate,
      sessionCount: stats.sessionCount,
      part: schedule,
    },
    overall: { score, weighted, totalWeight: weight },
  };

  // Previous period score for delta
  let prevScore = null;
  if (prevStats) {
    const pFocusTarget = Math.max((prevStats.days || 7) * 45, 60);
    const pParts = {
      tasks: prevStats.completionRate,
      focus: pct(prevStats.focusMinutes, pFocusTarget),
    };
    let pT = 0, pW = 0;
    for (const k of ["tasks", "focus"]) {
      if (pParts[k] == null) continue;
      pT += pParts[k] * weights[k];
      pW += weights[k];
    }
    prevScore = pW ? Math.round(pT / pW) : null;
  }

  return { score, prevScore, delta: prevScore == null ? null : score - prevScore, parts, breakdown };
}

// ---- SVG trend chart ----
function trendSVG(pts, w = 480, h = 140) {
  if (!pts.length) return `<div class="empty-state"><p>No data for this period.</p></div>`;
  const pad = { t: 16, r: 8, b: 28, l: 36 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxV = Math.max(...pts.map((p) => p.value), 1);
  const step = pts.length > 1 ? cw / (pts.length - 1) : cw;

  const coords = pts.map((p, i) => ({
    x: pad.l + i * step,
    y: pad.t + ch - (p.value / maxV) * ch,
  }));

  // Smooth curve via catmull-rom → cubic bezier
  let path = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1], cur = coords[i];
    const tension = 0.3;
    const dx = (cur.x - prev.x) * tension;
    path += ` C${prev.x + dx},${prev.y} ${cur.x - dx},${cur.y} ${cur.x},${cur.y}`;
  }

  // Area fill
  const areaPath = path + ` L${coords[coords.length - 1].x},${pad.t + ch} L${coords[0].x},${pad.t + ch} Z`;

  // Y-axis labels (4 ticks)
  const yTicks = [0, 0.33, 0.67, 1].map((f) => ({
    y: pad.t + ch - f * ch,
    label: Math.round(maxV * f),
  }));

  // X-axis labels (show every Nth to avoid crowding)
  const xStep = Math.max(1, Math.floor(pts.length / 6));
  const xLabels = pts.filter((_, i) => i % xStep === 0 || i === pts.length - 1);

  return `
  <div class="trend-point-wrap">
    <svg class="trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--focus)" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="var(--focus)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yTicks.map((t) => `<line x1="${pad.l}" y1="${t.y}" x2="${w - pad.r}" y2="${t.y}" stroke="var(--hairline)" stroke-width="0.5"/><text x="${pad.l - 4}" y="${t.y + 3}" text-anchor="end" fill="var(--graphite-dim)" font-size="9">${t.label}</text>`).join("")}
      <path d="${areaPath}" fill="url(#trend-fill)"/>
      <path d="${path}" fill="none" stroke="var(--focus)" stroke-width="2" stroke-linecap="round"/>
      ${coords.map((c, i) => `
        <g class="trend-point" data-idx="${i}" role="button" tabindex="0" aria-label="${pts[i].label} — ${pts[i].value} productivity">
          <circle cx="${c.x}" cy="${c.y}" r="10" fill="transparent"/>
          <circle cx="${c.x}" cy="${c.y}" r="3.4" fill="var(--paper)" stroke="var(--focus)" stroke-width="1.6"/>
        </g>
      `).join("")}
      ${xLabels.map((p, i) => {
        const idx = pts.indexOf(p);
        return `<text x="${coords[idx].x}" y="${h - 4}" text-anchor="middle" fill="var(--graphite-dim)" font-size="9">${p.label}</text>`;
      }).join("")}
    </svg>
    <div class="trend-popup" role="dialog" aria-live="polite" hidden></div>
  </div>`;
}

// ---- trend point breakdown popup ----
function fmtFocus(min) {
  if (!min) return "0 min";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function pointBreakdownHTML(p, isToday) {
  let rangeLine = "";
  if (p.range) {
    const r = /^\d{4}-\d{2}-\d{2}$/.test(p.range)
      ? fromISO(p.range).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : p.range;
    if (r !== p.label) rangeLine = `<div class="tp-range">${esc(r)}</div>`;
  }
  if (isToday || !p.tasks) {
    return `
      <div class="tp-label">${esc(p.label)}</div>
      ${rangeLine}
      <div class="tp-row"><span>Focus</span><b>${fmtFocus(p.focusMin)}</b></div>
      <div class="tp-note"><b>How it's counted:</b><br/>${fmtFocus(p.focusMin)} of focus = ${p.value} pts.</div>
    `;
  }
  const fromTasks = p.tasks * 30;
  const fromFocus = p.focusMin;
  return `
    <div class="tp-label">${esc(p.label)}</div>
    ${rangeLine}
    <div class="tp-row"><span>Tasks completed</span><b>${p.tasks}</b></div>
    <div class="tp-row"><span>Focus time</span><b>${fmtFocus(p.focusMin)}</b></div>
    <div class="tp-note"><b>How it's counted:</b><br/>${p.tasks} × 30 (tasks) + ${fromFocus} (focus min) = <b>${p.value}</b>.</div>
  `;
}

// ---- Productivity Health calculation popups ----

// Overall score = weighted average across available categories.
function overallBreakdownHTML(o) {
  const titleMap = { tasks: "Tasks", focus: "Focus", goals: "Goals", habits: "Habits", schedule: "Schedule" };
  const rows = o.weighted.map((w) => {
    return `<div class="tp-row"><span>${titleMap[w.key]}</span><b>${w.part}% × ${w.weight}</b></div>`;
  }).join("");
  const sum = o.weighted.reduce((a, w) => a + w.part * w.weight, 0);
  const missing = ["tasks", "focus", "goals", "habits", "schedule"]
    .filter((k) => !o.weighted.find((w) => w.key === k))
    .map((k) => ({ tasks: "Tasks", focus: "Focus", goals: "Goals", habits: "Habits", schedule: "Schedule" }[k]));
  return `
    <div class="tp-label">Overall score ${o.score}/100</div>
    ${rows}
    <div class="tp-note">
      <b>How it's counted:</b><br/>
      Sum ${o.weighted.map((w) => `${w.part}×${w.weight}`).join(" + ")} = ${sum}<br/>
      ${sum} ÷ total weight ${o.totalWeight} = <b>${o.score}</b>.
      ${missing.length ? `<br/>No data for: ${missing.join(", ")} (excluded from the average).` : ""}
    </div>
  `;
}

function catRows(list, fmt) {
  return list.map((x) => `<div class="tp-row"><span>${esc(x.title)}</span><b>${fmt ? fmt(x) : (x.pct != null ? x.pct + "%" : "—")}</b></div>`).join("");
}

// Explained calculation per category, using the exact live numbers.
function categoryBreakdownHTML(key, b, periodRange, periodLabel) {
  const header = `<div class="tp-label">${key[0].toUpperCase() + key.slice(1)}</div><div class="tp-range">${esc(periodRange)}</div>`;
  if (key === "tasks") {
    if (b.fallback) {
      return header + `
        <div class="tp-row"><span>Base score</span><b>${b.part}%</b></div>
        <div class="tp-note">
          <b>How it's counted:</b><br/>
          No tasks were due this period. We use a base ${b.part}% when at least one task was completed.
        </div>`;
    }
    return header + `
      <div class="tp-row"><span>Completion rate</span><b>${b.completionRate != null ? b.completionRate + "%" : "—"}</b></div>
      <div class="tp-note">
        <b>How it's counted:</b><br/>
        % of due tasks that were finished. Here it's <b>${b.completionRate ?? "—"}%</b>.
      </div>`;
  }
  if (key === "focus") {
    return header + `
      <div class="tp-row"><span>Focus time</span><b>${fmtFocus(b.focusMinutes)}</b></div>
      <div class="tp-row"><span>Target (${b.days} days)</span><b>${fmtFocus(b.focusTarget)}</b></div>
      <div class="tp-note">
        <b>How it's counted:</b><br/>
        focus ÷ target × 100 = ${fmtFocus(b.focusMinutes)} ÷ ${fmtFocus(b.focusTarget)} × 100 = <b>${b.part}%</b>.
      </div>`;
  }
  if (key === "goals") {
    return header + `
      ${b.list.length ? catRows(b.list.slice(0, 5)) : `<div class="tp-row"><span>No goals</span><b>—</b></div>`}
      <div class="tp-note">
        <b>How it's counted:</b><br/>
        Average of each goal's progress. Average = <b>${b.avg != null ? b.avg + "%" : "—"}</b>.
      </div>`;
  }
  if (key === "habits") {
    return header + `
      ${b.list.length ? b.list.slice(0, 5).map((h) =>
        `<div class="tp-row"><span>${esc(h.title)}</span><b>${h.done} / ${h.scheduled} (${h.pct}%)</b></div>`).join("") : `<div class="tp-row"><span>No habits</span><b>—</b></div>`}
      <div class="tp-note">
        <b>How it's counted:</b><br/>
        Average of each habit's done ÷ scheduled. Average = <b>${b.avg != null ? b.avg + "%" : "—"}</b>.
      </div>`;
  }
  if (key === "schedule") {
    if (b.completionRate == null) {
      return header + `
        <div class="tp-note"><b>Schedule Score</b><br/>—<br/>No schedule activity yet.</div>`;
    }
    const cr = b.completionRate;
    const fsr = b.focusSessionRate ?? 0;
    const otr = b.onTimeRate ?? 0;
    const allZero = cr === 0 && fsr === 0 && otr === 0;
    const math = `${cr}×0.6 + ${fsr}×0.2 + ${otr}×0.2`;
    return header + `
      <div class="tp-row"><span>Task completion</span><b>${cr}%</b></div>
      <div class="tp-row"><span>Focus sessions</span><b>${fsr}%</b></div>
      <div class="tp-row"><span>On-time tasks</span><b>${otr}%</b></div>
      ${allZero ? `<div class="tp-note">No activity was completed this week.</div>` : ""}
      <div class="tp-note">
        <b>How it's counted:</b><br/>
        ${math} = ${b.part}% (capped at 100).
      </div>`;
  }
  return header;
}

// Shared popup: render content near a target element and close on outside click.
function heroPopupHTML(cat, breakdown, periodRange, periodLabelText) {
  if (cat === "overall") return overallBreakdownHTML(breakdown.overall);
  const b = breakdown[cat];
  return b ? categoryBreakdownHTML(cat, b, periodRange, periodLabelText) : "";
}

function makePopup(sectionEl, anchor, html) {
  const popup = sectionEl.querySelector(".info-popup");
  if (!popup) return;
  popup.innerHTML = html;
  popup.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const srect = sectionEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left - srect.left, srect.width - popup.offsetWidth - 8));
  const above = rect.top - srect.top - popup.offsetHeight - 8;
  popup.style.left = left + "px";
  popup.style.top = (above >= 0 ? above : rect.bottom - srect.top + 8) + "px";
}

function attachClick(sectionEl, selector, handler) {
  sectionEl.querySelectorAll(selector).forEach((el) => {
    const activate = () => {
      const popup = sectionEl.querySelector(".info-popup");
      const open = popup && !popup.hidden && popup.dataset.for === el.getAttribute("data-cat");
      if (open) { popup.hidden = true; popup.dataset.for = ""; return; }
      handler(el);
      const p = sectionEl.querySelector(".info-popup");
      if (p) p.dataset.for = el.getAttribute("data-cat");
    };
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
  });
}

function wireTrend(wrap, pts, isToday) {
  const svg = wrap.querySelector(".trend-svg");
  const popup = wrap.querySelector(".trend-popup");
  const close = () => { popup.hidden = true; };
  const show = (idx) => {
    const c = wrap.querySelectorAll(".trend-point")[idx];
    if (!c) return;
    popup.innerHTML = pointBreakdownHTML(pts[idx], isToday);
    popup.hidden = false;
    const vb = svg.viewBox.baseVal;
    const cw = svg.clientWidth || vb.width;
    const chh = svg.clientHeight || vb.height;
    const px = (+c.dataset.x / vb.width) * cw;
    const py = (+c.dataset.y / vb.height) * chh;
    popup.style.left = Math.max(8, Math.min(px + 14, cw - popup.offsetWidth - 8)) + "px";
    popup.style.top = (py - popup.offsetHeight - 12 < 0 ? py + 14 : py - popup.offsetHeight - 12) + "px";
  };

  svg.querySelectorAll(".trend-point").forEach((g) => {
    const cx = g.querySelector("circle").getAttribute("cx");
    const cy = g.querySelector("circle").getAttribute("cy");
    g.setAttribute("data-x", cx);
    g.setAttribute("data-y", cy);
    const activate = () => {
      const idx = +g.dataset.idx;
      const already = !popup.hidden && popup.dataset.idx === String(idx);
      if (already) { close(); return; }
      popup.dataset.idx = String(idx);
      show(idx);
    };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
  });
  document.addEventListener("click", function onDoc(e) {
    if (!wrap.contains(e.target)) { close(); document.removeEventListener("click", onDoc); }
  });
  return close;
}

// ---- bar chart for tasks + focus stacked ----
function barsHTML(perDay) {
  if (!perDay.length) return "";
  const maxV = Math.max(...perDay.map((d) => d.completed + d.focusMin / 15), 1);
  return `
  <div class="bar-chart">
    ${perDay.map((d) => {
      const hC = Math.round((d.completed / maxV) * 100);
      const hF = Math.round((d.focusMin / 15 / maxV) * 100);
      return `
      <div class="bar-col" title="${d.date}: ${d.completed} tasks · ${d.focusMin}m focus">
        <div class="bar-stack">
          <div class="bar-focus" style="height:${hF}%"></div>
          <div class="bar-task" style="height:${hC}%"></div>
        </div>
        <span class="bar-lbl">${d.date.slice(8)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

// ============================================================
// MAIN RENDER
// ============================================================
export async function renderInsights(view, alive = () => true) {
  view.innerHTML = `<div class="page-loading">${icon("clock")} Crunching your numbers…</div>`;

  const p = PERIODS.find((x) => x.key === currentPeriod) || PERIODS[1];
  const days = p.days;

  // Fetch all data in parallel
  const [stats, habitsCons, risks, streaks, tasksRaw, projects, goals] = await Promise.all([
    analytics.rangeStats(days),
    analytics.habitConsistency(currentPeriod),
    analytics.currentRisks(),
    analytics.computeStreaks(),
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;

  const gProg = await goalService.progressMap(goals, projects, tasksRaw);
  const pProg = projectService.progressMap(projects, tasksRaw);

  // Previous period stats (for delta)
  let prevStats = null;
  if (p.compare) {
    prevStats = await analytics.rangeStats(p.compare, p.compare);
  }

  // Today-only data
  let todayData = null;
  if (currentPeriod === "today") {
    todayData = await analytics.todayFocus();
  }

  const today = todayISO();
  const OPEN = ["Todo", "In Progress", "Blocked"];
  const overdueTasks = currentPeriod === "today"
    ? tasksRaw.filter((t) => t.dueDate === today && OPEN.includes(t.status))
    : tasksRaw.filter((t) => t.dueDate && t.dueDate < today && OPEN.includes(t.status));
  const score = computeScore({ stats, prevStats, habitsCons, overdueCount: overdueTasks.length, goalProgressMap: gProg, goals });

  // Trend data
  const trend = await analytics.trendData(currentPeriod);

  // AI insights
  const aiLines = analytics.aiInsightForPeriod(stats, habitsCons, risks, score);

  // Forecasts for top goals
  const activeGoals = goals.filter((g) => !["Completed", "On Hold", "Cancelled"].includes(g.status));
  const goalForecasts = await Promise.all(
    activeGoals.slice(0, 3).map(async (g) => {
      const daysActive = Math.max(diffDays(g.startDate || today, today), 1);
      const f = await analytics.forecastGoal(g, gProg[g.id], daysActive);
      return { goal: g, ...f, pct: gProg[g.id]?.pct ?? 0 };
    })
  );

  // Task performance stats
  const completedInWindow = stats.tasksCompleted;
  const overdueCount = overdueTasks.length;
  const doneWithDue = tasksRaw.filter(
    (t) => t.status === "Completed" && t.dueDate && t.completedAt && t.completedAt.slice(0, 10) >= stats.start
  );
  const onTimeCount = doneWithDue.filter((t) => t.completedAt.slice(0, 10) <= t.dueDate).length;
  const completionRate = stats.completionRate;
  const onTimeRate = doneWithDue.length ? Math.round((onTimeCount / doneWithDue.length) * 100) : null;

  // Priority breakdown
  const completedTasks = tasksRaw.filter((t) => t.status === "Completed" && t.completedAt?.slice(0, 10) >= stats.start);
  const highP = completedTasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;
  const medP = completedTasks.filter((t) => t.priority === "Medium").length;
  const lowP = completedTasks.filter((t) => t.priority === "Low").length;
  const totalP = highP + medP + lowP || 1;

  // Focus
  const focusMin = currentPeriod === "today" ? (todayData?.minutes ?? stats.focusMinutes) : stats.focusMinutes;
  const deepMin = currentPeriod === "today" ? (todayData?.deepMinutes ?? stats.deepMinutes) : stats.deepMinutes;
  const sessions = currentPeriod === "today" ? (todayData?.sessionCount ?? stats.sessionCount) : stats.sessionCount;
  const avgSession = sessions ? Math.round(focusMin / sessions) : 0;
  const bestWin = analytics.bestWindow(currentPeriod === "today" ? (todayData?.hourBuckets ?? stats.hourBuckets) : stats.hourBuckets);

  // Habit consistency with streaks
  const streakMap = {};
  for (const s of streaks) streakMap[s.habit.id] = s.streak;

  // Period date range shown on the Productivity Health cards.
  const fmtMyDate = (iso) => {
    const d = fromISO(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const periodRange = stats.start && stats.end
    ? (stats.start === stats.end ? fmtMyDate(stats.start) : `${fmtMyDate(stats.start)} – ${fmtMyDate(stats.end)}`)
    : periodLabel(currentPeriod);

  // ==================== RENDER ====================
  view.innerHTML = `
    <!-- HEADER -->
    <div class="insights-header">
      <button class="btn-back" data-nav="home">${icon("arrow-left")}</button>
      <h1 class="page-title">Insights</h1>
    </div>

    <!-- PERIOD TABS -->
    <div class="filter-bar insights-tabs">
      ${PERIODS.map((pp) => `
        <button class="filter-btn ${pp.key === currentPeriod ? "active" : ""}" data-period="${pp.key}">
          ${pp.label}
        </button>
      `).join("")}
      <button class="filter-btn period-custom-btn" id="period-custom-btn" type="button">Custom</button>
    </div>

    <!-- PRODUCTIVITY HEALTH -->
    <section class="card insight-hero">
      <div class="insight-hero-head">
        <div class="eyebrow">PRODUCTIVITY HEALTH</div>
        <div class="eyebrow-range">${periodLabel(currentPeriod)} · ${esc(periodRange)}</div>
      </div>
      <div class="insight-hero-body">
        <div class="score-ring-wrap">
          <div class="score-ring ${scoreClass(score.score)}" style="--p:${score.score};" role="button" tabindex="0" data-cat="overall" aria-label="How the overall score is calculated">
            <span class="score-num">${score.score}</span>
            <span class="score-of">/100</span>
          </div>
          ${score.delta != null && score.delta !== 0
            ? `<span class="score-delta ${score.delta > 0 ? "up" : "down"}">${score.delta > 0 ? "▲" : "▼"} ${Math.abs(score.delta)}% ${compareLabel(currentPeriod)}</span>`
            : `<span class="score-delta flat">— same as before</span>`
          }
        </div>
        <div class="score-meta">
          <div class="score-verdict">${scoreLabel(score.score)}</div>
        </div>
      </div>
      <div class="score-categories">
        ${[
          ["Tasks", score.parts.tasks],
          ["Focus", score.parts.focus],
          ["Goals", score.parts.goals],
          ["Habits", score.parts.habits],
          ["Schedule", score.parts.schedule],
        ].map(([label, val]) => `
          <div class="cat-row" role="button" tabindex="0" data-cat="${label.toLowerCase()}" aria-label="How the ${label} score is calculated">
            <span class="cat-label">${label}</span>
            <div class="cat-bar-track"><div class="cat-bar-fill ${scoreClass(val ?? 0)}" style="width:${val ?? 0}%"></div></div>
            <span class="cat-val">${val != null ? val + "%" : "—"}</span>
          </div>
        `).join("")}
      </div>
      <div class="info-popup" role="dialog" aria-live="polite" hidden></div>
    </section>

    <!-- NEEDS ATTENTION -->
    <section class="card insight-attention">
      <div class="module-head">
        <span class="module-emoji acc-danger">⚠</span>
        <div><h2>Needs Your Attention</h2></div>
        ${risks.length ? `<span class="attention-count">${risks.length}</span>` : ""}
      </div>
      ${risks.length ? `
      <div class="attention-list">
        ${risks.slice(0, 4).map((r) => `
          <div class="attention-item">
            <span class="attention-sev ${r.severity}"></span>
            <div class="attention-info">
              <div class="attention-title">${esc(r.title)}</div>
              <div class="attention-detail">${esc(r.detail)}</div>
            </div>
            <div class="attention-actions">
              ${r.type === "task" ? `
                <button class="btn btn-xs btn-primary" data-action="fix" data-id="${r.taskId}">Fix</button>
                <button class="btn btn-xs btn-secondary" data-action="reschedule" data-id="${r.taskId}">Reschedule</button>
              ` : r.type === "goal" ? `
                <button class="btn btn-xs btn-secondary" data-action="view-goal" data-id="${r.goalId}">View</button>
                <button class="btn btn-xs btn-secondary" data-action="schedule-goal" data-id="${r.goalId}">Schedule</button>
              ` : `
                <button class="btn btn-xs btn-secondary" data-action="view-habit" data-id="${r.habitId}">View</button>
              `}
            </div>
          </div>
        `).join("")}
      </div>
      ${risks.length > 4 ? `<button class="btn btn-sm btn-secondary attention-see-all">See all risks</button>` : ""}
      ` : `
      <div class="empty-state" style="padding:var(--sp-5);">
        <p>All clear — nothing needs your attention right now.</p>
      </div>
      `}
    </section>

    <!-- PRODUCTIVITY TREND -->
    <section class="card insight-trend">
      <div class="module-head">
        <span class="module-emoji acc-focus">📈</span>
        <div><h2>Productivity Trend</h2></div>
      </div>
      <div class="trend-chart-wrap">
        ${trendSVG(trend.pts)}
      </div>
    </section>

    <!-- 3-COLUMN GRID: TASKS | FOCUS | GOALS -->
    <div class="insights-three-col">

      <!-- TASK PERFORMANCE -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji acc-ember">⚡</span>
          <div><h2>Task Performance</h2></div>
        </div>
        <div class="perf-stats">
          <div class="perf-stat"><b class="num">${completedInWindow}</b><span>Completed</span></div>
          <div class="perf-stat"><b class="num">${overdueCount}</b><span>Overdue</span></div>
          <div class="perf-stat"><b class="num">${completionRate != null ? completionRate + "%" : "—"}</b><span>Completion Rate</span></div>
          <div class="perf-stat"><b class="num">${onTimeRate != null ? onTimeRate + "%" : "—"}</b><span>On-Time Rate</span></div>
        </div>
        <div class="priority-bars">
          <div class="pri-bar-row"><span>High</span><div class="pri-bar-track"><div class="pri-bar-fill high" style="width:${Math.round(highP / totalP * 100)}%"></div></div><span>${Math.round(highP / totalP * 100)}%</span></div>
          <div class="pri-bar-row"><span>Med</span><div class="pri-bar-track"><div class="pri-bar-fill med" style="width:${Math.round(medP / totalP * 100)}%"></div></div><span>${Math.round(medP / totalP * 100)}%</span></div>
          <div class="pri-bar-row"><span>Low</span><div class="pri-bar-track"><div class="pri-bar-fill low" style="width:${Math.round(lowP / totalP * 100)}%"></div></div><span>${Math.round(lowP / totalP * 100)}%</span></div>
        </div>
      </section>

      <!-- FOCUS & DEEP WORK -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji acc-sky">⏱</span>
          <div><h2>Focus &amp; Deep Work</h2></div>
        </div>
        <div class="focus-stats">
          <div class="focus-stat"><b class="num">${minutesToHuman(focusMin)}</b><span>${currentPeriod === "today" ? "Today" : periodLabel(currentPeriod)}</span></div>
          <div class="focus-stat"><b class="num">${sessions}</b><span>Sessions</span></div>
          <div class="focus-stat"><b class="num">${avgSession}m</b><span>Avg Session</span></div>
        </div>
        <div class="best-time-row">
          <span class="best-time-label">Best time</span>
          <span class="best-time-val">${String(bestWin.startHour).padStart(2, "0")}:00–${String(bestWin.startHour + 3).padStart(2, "0")}:00</span>
        </div>
        ${currentPeriod !== "today" ? `<div class="module-foot"><a href="#/focus" class="link-subtle">Full focus report →</a></div>` : ""}
      </section>

      <!-- GOALS -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji acc-violet">🎯</span>
          <div><h2>Goals</h2></div>
        </div>
        <div class="goals-list">
          ${activeGoals.slice(0, 4).map((g) => {
            const p = gProg[g.id]?.pct ?? 0;
            return `
            <div class="goal-row">
              <span class="goal-status-icon">${statusIcon(p)}</span>
              <span class="goal-name">${esc(g.title)}</span>
              <span class="goal-pct ${statusColor(p)}">${p}%</span>
            </div>`;
          }).join("")}
          ${!activeGoals.length ? `<div class="empty-state"><p>No active goals.</p></div>` : ""}
        </div>
        ${activeGoals.length > 4 ? `<div class="module-foot"><a href="#/goals" class="link-subtle">View all goals →</a></div>` : ""}
      </section>
    </div>

    <!-- 2-COLUMN GRID: PROJECTS | HABITS -->
    <div class="insights-two-col">

      <!-- PROJECT HEALTH -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji acc-good">📁</span>
          <div><h2>Project Health</h2></div>
        </div>
        <div class="projects-list">
          ${projects.filter((p) => !["Completed", "Cancelled"].includes(p.status)).slice(0, 4).map((p) => {
            const pr = pProg[p.id];
            const pPct = pr?.pct ?? 0;
            const daysLeft = p.deadline ? diffDays(today, p.deadline) : null;
            return `
            <div class="project-row">
              <span class="project-status-icon">${statusIcon(pPct)}</span>
              <span class="project-name">${esc(p.name)}</span>
              <span class="project-pct ${statusColor(pPct)}">${pPct != null ? pPct + "%" : "—"}</span>
            </div>`;
          }).join("")}
          ${!projects.filter((p) => !["Completed", "Cancelled"].includes(p.status)).length
            ? `<div class="empty-state"><p>No active projects.</p></div>`
            : ""}
        </div>
        ${risks.filter((r) => r.type === "goal").length
          ? `<div class="module-foot attention-foot">⚠ ${risks.filter((r) => r.type === "goal").length} project${risks.filter((r) => r.type === "goal").length !== 1 ? "s" : ""} need attention</div>`
          : ""}
      </section>

      <!-- HABIT CONSISTENCY -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji acc-teal">🔄</span>
          <div><h2>Habit Consistency</h2></div>
        </div>
        <div class="habits-list">
          ${[...habitsCons].sort((a, b) => b.pct - a.pct).slice(0, 5).map((h) => {
            const streak = streakMap[h.habit.id] || 0;
            return `
            <div class="habit-row">
              <div class="habit-row-top">
                <span class="habit-name">${esc(h.habit.title)}</span>
                <span class="habit-pct">${h.pct}%</span>
                ${streak >= 3 ? `<span class="habit-streak">🔥 ${streak}-day streak</span>` : ""}
              </div>
              <div class="progress-track"><div class="progress-fill ${h.pct >= 70 ? "" : h.pct >= 40 ? "warn" : "bad"}" style="width:${h.pct}%"></div></div>
            </div>`;
          }).join("")}
          ${!habitsCons.length ? `<div class="empty-state"><p>No scheduled habits in this window.</p></div>` : ""}
        </div>
        <div class="habits-overall">
          <span>Overall consistency</span>
          <b class="num">${habitsCons.length ? Math.round(habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length) : 0}%</b>
        </div>
      </section>
    </div>

    <!-- AI PERSONAL ANALYSIS -->
    <section class="card insight-ai-analysis">
      <div class="module-head">
        <span class="module-emoji acc-focus">🤖</span>
        <div><h2>AI Personal Analysis</h2></div>
      </div>
      <div class="ai-lines">
        ${aiLines.map((l) => `
          <div class="ai-line">
            <span class="ai-line-icon">${l.icon}</span>
            <div class="ai-line-body">
              <span class="ai-line-label">${l.label}</span>
              <span class="ai-line-text">${esc(l.text)}</span>
            </div>
          </div>
        `).join("")}
      </div>
      <!-- Hidden detailed breakdown -->
      <div class="ai-detail" id="ai-detail" style="display:none;">
        <div class="ai-detail-grid">
          <div class="ai-detail-card">
            <div class="ai-detail-head">Score Breakdown</div>
            <div class="ai-detail-body">
              <div class="ai-detail-row"><span>Tasks</span><span>${score.parts.tasks != null ? score.parts.tasks + "%" : "—"}</span></div>
              <div class="ai-detail-row"><span>Focus</span><span>${score.parts.focus != null ? score.parts.focus + "%" : "—"}</span></div>
              <div class="ai-detail-row"><span>Habits</span><span>${score.parts.habits != null ? score.parts.habits + "%" : "—"}</span></div>
              <div class="ai-detail-row"><span>Schedule</span><span>${score.parts.schedule != null ? score.parts.schedule + "%" : "—"}</span></div>
            </div>
          </div>
          <div class="ai-detail-card">
            <div class="ai-detail-head">Risk Summary</div>
            <div class="ai-detail-body">
              ${risks.length ? risks.slice(0, 5).map((r) => `
                <div class="ai-detail-row">
                  <span class="attention-sev ${r.severity}" style="width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;"></span>
                  <span>${esc(r.title)}</span>
                </div>
              `).join("") : '<div class="ai-detail-row"><span>No risks detected</span></div>'}
            </div>
          </div>
          <div class="ai-detail-card">
            <div class="ai-detail-head">Period Stats</div>
            <div class="ai-detail-body">
              <div class="ai-detail-row"><span>Tasks completed</span><span>${stats.tasksCompleted}</span></div>
              <div class="ai-detail-row"><span>Completion rate</span><span>${stats.completionRate != null ? stats.completionRate + "%" : "—"}</span></div>
              <div class="ai-detail-row"><span>Focus time</span><span>${minutesToHuman(stats.focusMinutes)}</span></div>
              <div class="ai-detail-row"><span>Sessions</span><span>${stats.sessionCount}</span></div>
              <div class="ai-detail-row"><span>Avg task</span><span>${stats.avgTaskMinutes ? stats.avgTaskMinutes + "m" : "—"}</span></div>
              <div class="ai-detail-row"><span>Overdue</span><span>${overdueCount}</span></div>
            </div>
          </div>
          <div class="ai-detail-card">
            <div class="ai-detail-head">Habits</div>
            <div class="ai-detail-body">
              ${habitsCons.length ? habitsCons.slice(0, 4).map((h) => `
                <div class="ai-detail-row"><span>${esc(h.habit.title)}</span><span>${h.pct}% (${h.done}/${h.scheduled})</span></div>
              `).join("") : '<div class="ai-detail-row"><span>No habits tracked</span></div>'}
            </div>
          </div>
        </div>
      </div>
      <div class="ai-actions">
        <a href="#/assistant" class="btn btn-primary">Do This Now</a>
        <button class="btn btn-secondary" data-action="schedule-ai">Schedule It</button>
        <button class="btn btn-secondary" data-action="details-ai" id="toggle-ai-detail">View Details</button>
      </div>
    </section>

    <!-- FORECAST -->
    ${goalForecasts.length ? `
    <section class="card insight-forecast">
      <div class="module-head">
        <span class="module-emoji acc-warn">🔮</span>
        <div><h2>Forecast</h2></div>
      </div>
      <div class="forecast-list">
        ${goalForecasts.map((f) => `
          <div class="forecast-row">
            <span class="forecast-name">${esc(f.goal.title)}</span>
            <span class="forecast-prob">${f.probability != null ? f.probability + "% probability of finishing on time" : "Insufficient data"}</span>
            ${f.estDate ? `<span class="forecast-est">Est. ${fromISO(f.estDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>` : ""}
          </div>
        `).join("")}
      </div>
    </section>` : ""}
  `;

  // ---- event listeners ----
  // Period tabs
  view.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPeriod = btn.dataset.period;
      renderInsights(view, alive);
    });
  });

  // Custom period — centered popup date picker
  const customBtn = view.querySelector("#period-custom-btn");
  if (customBtn) {
    customBtn.addEventListener("click", async () => {
      const { openPanel } = await import("../ui/modal.js");
      const result = await openPanel({
        title: "Custom period",
        eyebrow: "PRODUCTIVITY HEALTH",
        extraClass: "modal-vcenter",
        bodyHTML: `
          <div class="period-custom-form">
            <div class="form-field">
              <label>Start date</label>
              <input type="date" id="period-custom-start" aria-label="Start date" required>
            </div>
            <div class="form-field">
              <label>End date</label>
              <input type="date" id="period-custom-end" aria-label="End date" required>
            </div>
            <div class="period-custom-err" hidden></div>
          </div>
        `,
        actions: [{ id: "apply", label: "Apply", class: "btn-primary" }],
      });
      if (result?.action !== "apply") return;
      const start = result.body.querySelector("#period-custom-start").value;
      const end = result.body.querySelector("#period-custom-end").value;
      if (!start || !end) return;
      if (end < start) {
        const err = result.body.querySelector(".period-custom-err");
        err.textContent = "End date must be after start date.";
        err.hidden = false;
        return;
      }
      const customDays = Math.max(diffDays(start, end) + 1, 1);
      const existing = PERIODS.findIndex((p) => p.key === "custom");
      if (existing >= 0) PERIODS.splice(existing, 1);
      PERIODS.push({ key: "custom", label: "Custom", days: customDays, compare: null });
      currentPeriod = "custom";
      renderInsights(view, alive);
    });
  }

  // Back button
  view.querySelector("[data-nav='home']")?.addEventListener("click", () => {
    location.hash = "#/home";
  });

  // Attention action buttons
  view.querySelectorAll("[data-action='fix']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = `#/tasks`; });
  });
  view.querySelectorAll("[data-action='reschedule']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const task = await taskService.getTask(btn.dataset.id);
      if (task) {
        const next = prompt("New due date (YYYY-MM-DD):", addDays(todayISO(), 1));
        if (next) await taskService.updateTask(task.id, { dueDate: next });
        renderInsights(view, alive);
      }
    });
  });
  view.querySelectorAll("[data-action='view-goal']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/goals"; });
  });
  view.querySelectorAll("[data-action='schedule-goal']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/goals"; });
  });
  view.querySelectorAll("[data-action='view-habit']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/focus"; });
  });

  // See all risks button
  view.querySelectorAll(".attention-see-all").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = view.querySelector(".attention-list");
      if (!list) return;
      const hidden = list.querySelectorAll(".attention-item");
      hidden.forEach((el) => el.style.display = "");
      btn.textContent = "All risks shown";
      btn.disabled = true;
      btn.style.opacity = "0.5";
    });
  });

  // Show all risk items initially (collapse to 4)
  view.querySelectorAll(".attention-item").forEach((el, i) => {
    if (i >= 4) el.style.display = "none";
  });

  // AI actions: Schedule It and View Details toggle
  view.querySelectorAll("[data-action='schedule-ai']").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = "#/calendar";
    });
  });
  view.querySelector("#toggle-ai-detail")?.addEventListener("click", () => {
    const detail = view.querySelector("#ai-detail");
    const btn = view.querySelector("#toggle-ai-detail");
    if (!detail) return;
    const open = detail.style.display !== "none";
    detail.style.display = open ? "none" : "";
    btn.textContent = open ? "View Details" : "Hide Details";
  });

  // Trend point breakdown popups
  view.querySelectorAll(".trend-point-wrap").forEach((wrap) => wireTrend(wrap, trend.pts, currentPeriod === "today"));

  // Productivity Health calculation popups
  const hero = view.querySelector(".insight-hero");
  const mkPopup = (el) => makePopup(hero, el, heroPopupHTML(el.getAttribute("data-cat"), score.breakdown, periodRange, periodLabel(currentPeriod)));
  attachClick(hero, ".cat-row", mkPopup);
  attachClick(hero, ".score-ring", mkPopup);
  hero.addEventListener("click", (e) => {
    if (e.target.closest(".info-popup")) return;
    if (!e.target.closest(".cat-row") && !e.target.closest(".score-ring")) {
      const p = hero.querySelector(".info-popup");
      if (p && !p.hidden) p.hidden = true;
    }
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      const p = hero.querySelector(".info-popup");
      if (p) p.hidden = true;
      document.removeEventListener("keydown", onEsc);
    }
  });
}
