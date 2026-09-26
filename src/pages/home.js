// ============================================================
// HOME V2 — your personal productivity command center.
//
// Answers five things instantly:
//   What do I need to do? → Today's progress + briefing
//   What should I do now? → DO THIS NOW card slider
//   What's coming next?   → NEXT UP timeline
//   Am I on track?        → Goals / Projects / Attention radar
//   What should I change? → AI daily insight
//
// Everything is live: any mutation emits "data-changed" and the
// router re-renders this page with fresh numbers immediately.
// ============================================================

import { icon, fmtDate } from "../dom.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as habitsSvc from "../services/habitService.js";
import * as focusService from "../services/focusService.js";
import * as eventService from "../services/eventService.js";
import * as analytics from "../services/analyticsService.js";
import { typeMeta } from "../config/eventTypes.js";
import * as db from "../store/db.js";
import { getProfile } from "../services/settingsService.js";
import { reasonsFor } from "../ai/prioritizer.js";
import { focusSnapshot } from "./focus.js";
import {
  fmtHour,
  minutesToHuman,
  fmtDateLong,
  todayISO,
  addDays,
  byDueDate,
} from "../utils/dates.js";
import { toast } from "../ui/toast.js";

const slider = {
  day: null,
  index: 0,
};

function toFloat(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function buildFlow({ tasks, habitList, todayEvents, logsToday, goals, projects }) {
  const today = todayISO();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const doneHabitIds = new Set(logsToday.filter((l) => l.done && l.date === today).map((l) => l.habitId));
  const OPEN = ["Completed", "Cancelled"];
  const items = [];

  // 1 · Overdue tasks first (they ARE the deadlines), worst breach first
  const overdue = taskService
    .decorate(tasks.filter((t) => t.dueDate && t.dueDate < today && !OPEN.includes(t.status)))
    .sort(byDueDate);
  for (const t of overdue.slice(0, 4)) items.push({ kind: "task", overdue: true, ref: t });

  // 2 · Goal & project deadlines landing within 3 days
  const soonGoals = goals
    .filter((g) => g.targetDate && g.status !== "Completed" && diffDaysSafe(today, g.targetDate) <= 3)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  for (const g of soonGoals.slice(0, 2)) items.push({ kind: "deadline", ref: g });
  const soonProjects = projects
    .filter((p) => p.deadline && !["Completed", "Cancelled"].includes(p.status) && diffDaysSafe(today, p.deadline) <= 3 && !items.some((i) => i.kind === "deadline" && i.ref.id === p.id))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  for (const p of soonProjects.slice(0, 2)) items.push({ kind: "pdeadline", ref: p });

  // 3 · Timed events + scheduled tasks in clock order
  const timed = [];
  for (const e of todayEvents) timed.push({ kind: "event", minute: Math.round(e.startHour * 60), ref: e });
  for (const t of tasks) {
    if (t.dueDate !== today || OPEN.includes(t.status)) continue;
    timed.push({ kind: "task", minute: t.startTime ? minutesOf(t.startTime) : null, overdue: false, ref: t });
  }
  // 4 · Unscheduled habits at their time of day
  const wd = new Date(`${today}T00:00:00`).getDay();
  for (const h of habitList) {
    if (!(h.weekdays || []).includes(wd)) continue;
    if (doneHabitIds.has(h.id)) continue;
    timed.push({ kind: "habit", minute: minutesOf(h.timeOfDay), ref: h, streak: await habitsSvc.streak(h) });
  }
  timed
    .filter((x) => x.minute !== null)
    .sort((a, b) => Math.abs(a.minute - nowMin) - Math.abs(b.minute - nowMin))
    .forEach((x) => items.push(x));

  // 5 · Unscheduled today-tasks by priority score
  taskService
    .decorate(timed.filter((x) => x.minute === null && x.kind === "task").map((x) => x.ref))
    .sort((a, b) => b._score - a._score)
    .slice(0, 8)
    .forEach((t) => items.push({ kind: "task", overdue: false, ref: t }));

  return items;
}

export async function renderHome(view, alive = () => true) {
  const today = todayISO();
  if (slider.day !== today) {
    slider.day = today;
    slider.index = 0;
  }

  const [profile, tasks, projects, goals, habitList, stats, todayEvents, logsToday, week, prevWeek, inboxItems] =
    await Promise.all([
      getProfile(),
      taskService.allTasks(),
      projectService.allProjects(),
      goalService.allGoals(),
      habitsSvc.allHabits(),
      focusService.quickStats(),
      eventService.eventsInRange(today, today),
      db.getAll("habitLogs"),
      analytics.rangeStats(7),
      analytics.rangeStats(7, 7),
      db.getAll("inbox"),
    ]);
  if (!alive()) return;

  const name = profile?.name?.split(" ")[0] || "there";
  const [gProg] = await Promise.all([goalService.progressMap(goals, projects, tasks)]);
  if (!alive()) return;

  const flow = await buildFlow({ tasks, habitList, todayEvents, logsToday, goals, projects });
  slider.index = Math.min(slider.index, Math.max(0, flow.length - 1));
  const current = flow[slider.index] || null;

  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;
  const goalNameOf = (id) => goals.find((g) => g.id === id)?.title || null;

  // ----- Today's progress -----
  const dueToday = tasks.filter((t) => t.dueDate === today && t.status !== "Cancelled");
  const doneToday =
    dueToday.filter((t) => t.status === "Completed").length +
    tasks.filter((t) => t.completedAt?.slice(0, 10) === today && (!t.dueDate || t.dueDate !== today)).length;
  const openTodayCount = Math.max(0, dueToday.length - dueToday.filter((t) => t.status === "Completed").length);
  const progressBase = Math.max(dueToday.length + (doneToday || 0), 1);
  const donePct = pct(doneToday, Math.max(progressBase, 1));
  const importantCount = dueToday.length + todayEvents.length;

  // ----- Needs attention -----
  const OPEN = ["Completed", "Cancelled"];
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < today && !OPEN.includes(t.status));
  const blockedTasks = tasks.filter((t) => t.status === "Blocked");
  const wdToday = new Date(`${today}T00:00:00`).getDay();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const doneHabitIds = new Set(logsToday.filter((l) => l.done && l.date === today).map((l) => l.habitId));
  const missedHabits = habitList.filter(
    (h) => (h.weekdays || []).includes(wdToday) && !doneHabitIds.has(h.id) && minutesOf(h.timeOfDay) < nowMin
  );
  const stalledGoals = goals.filter((g) => {
    if (["Completed", "On Hold"].includes(g.status)) return false;
    const p = gProg[g.id]?.pct ?? 0;
    return p === 0 && diffDaysSafe(today, g.createdAt?.slice(0, 10)) >= 14;
  });
  const inboxPending = inboxItems.filter((i) => !i.processed).length;

  const attention = [];
  if (overdueTasks.length)
    attention.push({
      sev: "red",
      title: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`,
      sub: overdueTasks.slice(0, 3).map((t) => t.title).join(" · "),
      route: "#/tasks",
      label: "Open tasks",
    });
  if (blockedTasks.length)
    attention.push({
      sev: "orange",
      title: `${blockedTasks.length} blocked task${blockedTasks.length > 1 ? "s" : ""}`,
      sub: blockedTasks.slice(0, 3).map((t) => t.title).join(" · "),
      route: "#/tasks",
      label: "Review",
    });
  if (stalledGoals.length)
    attention.push({
      sev: "orange",
      title: `${stalledGoals.length} goal${stalledGoals.length > 1 ? "s" : ""} without progress`,
      sub: stalledGoals.slice(0, 2).map((g) => g.title).join(" · "),
      route: "#/goals",
      label: "Review",
    });
  if (missedHabits.length)
    attention.push({
      sev: "amber",
      title: `${missedHabits.length} habit${missedHabits.length > 1 ? "s" : ""} not logged yet today`,
      sub: missedHabits.map((h) => h.title).join(" · "),
      route: "#/goals",
      label: "Review",
    });
  if (inboxPending)
    attention.push({
      sev: "amber",
      title: `${inboxPending} item${inboxPending > 1 ? "s" : ""} waiting in Inbox`,
      sub: "Capture fast, decide later",
      route: "#/inbox",
      label: "Open",
    });

  // ----- Goals -----
  const activeGoals = goals
    .filter((g) => !["Completed", "On Hold", "Cancelled"].includes(g.status))
    .sort((a, b) => {
      const rank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
      return rank[a.priority] - rank[b.priority];
    })
    .slice(0, 4);

  // ----- Projects snapshot -----
  const pProg = projectService.progressMap(projects, tasks);
  const activeProjects = projects
    .filter((p) => p.status !== "Completed" && p.status !== "Cancelled")
    .sort((a, b) => ((pProg[b.id]?.pct ?? 0) - (pProg[a.id]?.pct ?? 0)))
    .slice(0, 5);

  // ----- Focus -----
  let focusStreakDays = 0;
  {
    const sessionsByDay = new Set();
    for (const s of await db.getAll("focusSessions")) {
      if (s.type === "focus" && (s.durationSeconds || 0) >= 300) sessionsByDay.add((s.startedAt || "").slice(0, 10));
    }
    for (let d = 0; d < 30; d++) {
      const iso = addDays(today, -d);
      if (sessionsByDay.has(iso)) focusStreakDays += 1;
      else if (d > 0) break;
    }
  }

  const snap = focusSnapshot();
  const weeklyGoalMin = 20 * 60;

  // ----- Habits -----
  const scheduledHabits = [];
  for (const hb of habitList) {
    if (!(hb.weekdays || []).includes(wdToday)) continue;
    scheduledHabits.push({ hb, done: doneHabitIds.has(hb.id), streak: await habitsSvc.streak(hb) });
  }
  const habitsDoneCount = scheduledHabits.filter((s) => s.done).length;

  // ----- Briefing (adapts to time of day) -----
  const hourNow = new Date().getHours();
  const tomorrowTasks = tasks.filter(
    (t) => t.dueDate === addDays(today, 1) && !OPEN.includes(t.status)
  );
  const biggestWin = tasks
    .filter((t) => t.completedAt?.slice(0, 10) === today)
    .sort((a, b) => (b.priority === "Urgent" ? 1 : 0) - (a.priority === "Urgent" ? 1 : 0))[0];
  const nextTomorrowsTask = tomorrowTasks[0];
  const briefing =
    hourNow < 12
      ? {
          eyebrow: "☀️ Morning briefing",
          lines: [
            dueToday.length
              ? `<b>${dueToday.length}</b> task${dueToday.length > 1 ? "s" : ""} due today (${dueToday.filter((t) => t.status === "Completed").length} already done)`
              : "No hard deadlines today — good day for deep work.",
            todayEvents.length
              ? `<b>${todayEvents.length}</b> event${todayEvents.length > 1 ? "s" : ""} on the calendar${todayEvents[0] ? `, first at ${fmtHour(todayEvents[0].startHour)}` : ""}`
              : "Calendar is clear today.",
            scheduledHabits.length
              ? `<b>${scheduledHabits.length}</b> habit${scheduledHabits.length > 1 ? "s" : ""} planned`
              : "",
          ].filter(Boolean),
        }
      : hourNow < 18
        ? {
            eyebrow: "🌤️ Midday pulse",
            lines: [
              `<b>${doneToday}</b> task${doneToday === 1 ? "" : "s"} done so far`,
              stats.todayMin ? `<b>${minutesToHuman(stats.todayMin)}</b> focused` : "No focus time banked yet — one session changes that.",
              `${openTodayCount} still open today`,
            ],
          }
        : {
            eyebrow: "🌙 Daily review",
            lines: [
              `<b>${doneToday}</b> task${doneToday === 1 ? "" : "s"} completed today`,
              stats.todayMin ? `<b>${minutesToHuman(stats.todayMin)}</b> of deep work` : "No focus sessions today.",
              biggestWin ? `Biggest win: <b>${escapeHtml(biggestWin.title)}</b>` : "",
              nextTomorrowsTask ? `Tomorrow: ${escapeHtml(nextTomorrowsTask.title)}${tomorrowTasks.length > 1 ? ` +${tomorrowTasks.length - 1} more` : ""}` : "",
            ].filter(Boolean),
          };

  // ----- AI insight -----
  const aiInsight = buildInsight({ week, prevWeek, overdueTasks, activeGoals, gProg, habitsDoneCount, scheduledHabits, stats });

  view.innerHTML = `
    <!-- ================= HERO ================= -->
    <div class="home-hero">
      <div class="home-greet">${greeting()}, ${escapeHtml(name)} 👋</div>
      <div class="home-date">${fmtDateLong(today)}</div>
      <div class="home-tagline">${importantCount ? `You have <b>${importantCount}</b> important thing${importantCount === 1 ? "" : "s"} today. Let's make progress.` : "Your day is wide open — a perfect time for deep work."}</div>

      <div class="hero-progress">
        <div class="hero-progress-top"><span>🎯 Today</span><span class="hero-pct">${donePct}%</span></div>
        <div class="hero-track"><div class="hero-fill" style="width:${donePct}%"></div></div>
        <div class="hero-stats">
          <span class="hero-stat">✅ <b>${doneToday}</b>&nbsp;/&nbsp;${Math.max(progressBase, doneToday)} tasks</span>
          <span class="hero-stat">⏱ <b>${minutesToHuman(stats.todayMin)}</b>&nbsp;focus</span>
          <span class="hero-stat">🔥 <b>${focusStreakDays}</b>&nbsp;day streak</span>
          ${overdueTasks.length ? `<span class="hero-stat hero-stat-warn">⚠ <b>${overdueTasks.length}</b>&nbsp;overdue</span>` : ""}
        </div>
      </div>
    </div>

    <!-- ================= COMMAND GRID ================= -->
    <div class="home-grid-v2">
      <div class="home-col-main">

        <!-- ===== DO THIS NOW ===== -->
        ${
          snap.active
            ? `
        <div class="now-card-v2 now-card" id="flow-card">
          <div class="flow-topline"><span class="flow-type-badge">${snap.phase === "break" ? "☕ Break running" : "🔥 Focus running"}</span><span class="flow-counter num">Live</span></div>
          <div id="flow-stage">
            <div class="flow-eyebrow">${icon("clock")} In progress</div>
            <div class="now-task">${escapeHtml(snap.title)}</div>
            <div class="now-meta-row">
              <span>Time left <span class="num" id="home-focus-left">${secondsClock(snap.secondsLeft)}</span></span>
              <span>${snap.phase === "break" ? "Recharging" : "Deep work"}</span>
            </div>
          </div>
          <div class="now-actions-v2">
            <a class="btn btn-primary" href="#/focus">${icon("play")} Open focus</a>
          </div>
        </div>`
            : current
              ? `
        <div class="now-card-v2 now-card" id="flow-card">
          <div class="flow-topline">
            <span class="flow-type-badge">${flowBadge(current)}</span>
            <span class="flow-counter num">${flow.length}</span>
          </div>
          <div id="flow-stage">${flowBody(current, { projectNameOf, goalNameOf, gProg, pProg, tasks, today })}</div>
          <div class="now-actions-v2">
            ${primaryActionHTML(current)}
            ${(() => { const sec = secondaryAction(current); return sec ? `<a class="btn btn-secondary" href="${sec.href}">${icon("check")} ${sec.label}</a>` : ""; })()}
          </div>
          <div class="flow-nav-v2">
            ${leftNav(current)}
            <span class="flow-dots-v2" id="flow-dots"></span>
            <button class="btn btn-sm btn-ghost" id="flow-next-btn">Next</button>
          </div>
        </div>`
              : `
        <div class="card allcaught-card home-section">
          ${icon("check")}
          <h3>You're all caught up.</h3>
          <p>Nothing actionable right now — add a task or bank an early win.</p>
          <div class="allcaught-actions">
            <a href="#/tasks" class="btn btn-secondary btn-sm">Add tasks</a>
            <a href="#/focus" class="btn btn-primary btn-sm">Start focus</a>
          </div>
        </div>`
        }

        <!-- ===== NEXT UP ===== -->
        <div class="card home-section">
          <div class="section-head">
            <h2>📅 Next up today</h2>
            <button class="link" id="add-event-btn">＋ Add event</button>
          </div>
          ${
            todayEvents.length
              ? timelineHTML(todayEvents, tasks)
              : `<div class="empty-state" style="padding: 20px 8px;"><p>Nothing else scheduled today.</p></div>`
          }
        </div>

        <!-- ===== NEEDS ATTENTION ===== -->
        ${
          attention.length
            ? `
        <div class="card home-section">
          <div class="section-head">
            <h2>⚠️ Needs your attention</h2>
          </div>
          ${attention
            .map(
              (a, i) => `
          <div class="attention-item">
            <span class="attention-sev ${a.sev}"></span>
            <div class="nextup-body">
              <div class="attention-title">${a.title}</div>
              <div class="attention-sub">${escapeHtml(a.sub)}</div>
            </div>
            <button class="btn btn-sm btn-secondary" data-attention="${i}">${a.label}</button>
          </div>`
            )
            .join("")}
        </div>`
            : ""
        }

        <!-- ===== GOALS ===== -->
        <div class="card home-section">
          <div class="section-head">
            <h2>🎯 Your goals</h2>
            <a href="#/goals" class="link">View all</a>
          </div>
          ${
            activeGoals.length
              ? activeGoals
                  .map((g) => {
                    const p = gProg[g.id]?.pct ?? 0;
                    return `
            <div class="goalbar-row">
              <div class="goalbar-top">
                <span class="goalbar-name">${escapeHtml(g.title)}</span>
                <span class="goalbar-meta num">${p}%${g.targetDate ? ` · by ${fmtDate(g.targetDate)}` : ""}</span>
              </div>
              <div class="progress-track goalbar-track"><div class="progress-fill" style="width:${p}%"></div></div>
            </div>`;
                  })
                  .join("")
              : `<div class="empty-state" style="padding:20px;"><p>No active goals yet.</p></div>`
          }
        </div>

        <!-- ===== PROJECTS ===== -->
        ${
          activeProjects.length
            ? `
        <div class="card home-section">
          <div class="section-head">
            <h2>📁 Projects</h2>
            <a href="#/projects" class="link">View all</a>
          </div>
          ${activeProjects
            .map((pr) => {
              const info = pProg[pr.id] || { pct: 0 };
              const health = healthOf(info.pct, pr.status);
              return `
            <div class="proj-snap-row" data-open-project="${pr.id}" role="button" tabindex="0">
              <span class="health-dot" style="background:${health.color};" title="${health.label}"></span>
              <span class="proj-snap-name">${escapeHtml(pr.name)}</span>
              <span class="proj-snap-pct num">${info.pct == null ? "—" : `${info.pct}%`}</span>
            </div>`;
            })
            .join("")}
        </div>`
            : ""
        }
      </div>

      <div class="side-stack">

        <!-- ===== FOCUS ===== -->
        <div class="card home-section">
          <div class="section-head">
            <h2>🧠 Focus</h2>
            <a href="#/focus" class="link">Open</a>
          </div>
          <div class="focus-summary-card">
            <div class="focus-summary-main">
              <div class="focus-big num">${minutesToHuman(stats.todayMin)}</div>
              <div class="focus-sub">focused today · ${minutesToHuman(stats.weekMin)} this week</div>
              <div class="streak-flame">🔥 Current streak: ${focusStreakDays} day${focusStreakDays === 1 ? "" : "s"}</div>
            </div>
            <a href="#/focus" class="btn btn-primary btn-sm">▶ Start focus</a>
          </div>
        </div>

        <!-- ===== HABITS TODAY ===== -->
        <div class="card home-section">
          <div class="section-head">
            <h2>🔄 Today's habits</h2>
            <span class="habit-chip-count num">${habitsDoneCount}/${scheduledHabits.length}</span>
          </div>
          ${
            scheduledHabits.length
              ? `<div class="habit-snap-list">${scheduledHabits
                  .slice(0, 3)
                  .map(
                    (s) => `
              <a class="habit-snap-row" href="#/goals">
                <span class="habit-snap-check ${s.done ? "done" : ""}">${s.done ? "✓" : "○"}</span>
                <span class="habit-snap-name">${escapeHtml(s.hb.title)}</span>
                <span class="habit-snap-meta num">🕐 ${s.hb.timeOfDay} · ${s.hb.durationMinutes}m${!s.done && s.streak > 0 ? ` · ${s.streak}🔥` : ""}</span>
              </a>`.trim()
                  )
                  .join("")}${scheduledHabits.length > 3 ? `<a class="habit-view-all" href="#/goals">View all ${scheduledHabits.length} habits</a>` : ""}</div>`
              : `<div class="empty-state" style="padding:16px 8px;"><p>No habits scheduled today.</p></div>`
          }
        </div>

        <!-- ===== AI DAILY INSIGHT ===== -->
        <div class="ai-insight-banner home-section">
          <div class="ai-insight-head">${icon("spark")} AI insight 💡</div>
          <div class="ai-insight-text">${aiInsight}</div>
          <div class="ai-insight-actions">
            <a href="#/assistant" class="btn btn-sm btn-primary">Plan my day</a>
            <a href="#/insights" class="btn btn-sm btn-secondary">See insights</a>
          </div>
        </div>

        <!-- ===== BRIEFING ===== -->
        <div class="card home-section">
          <div class="eyebrow briefing-eyebrow">${briefing.eyebrow}</div>
          ${briefing.lines.map((l) => `<div class="ai-line"><span class="ai-line-icon">•</span><div class="ai-line-text">${l}</div></div>`).join("")}
        </div>

        <!-- ===== WEEK SNAPSHOT ===== -->
        <div class="card home-section">
          <div class="section-head">
            <h2>📊 This week</h2>
            <a href="#/insights" class="link">Insights</a>
          </div>
          <div class="weeksnap-grid">
            <div class="weeksnap-cell">
              <div class="weeksnap-num">${week.tasksCompleted}<span class="weeksnap-trend ${trendDir(week.tasksCompleted, prevWeek.tasksCompleted)}">${trendArrow(week.tasksCompleted, prevWeek.tasksCompleted)}</span></div>
              <div class="weeksnap-lbl">Tasks</div>
            </div>
            <div class="weeksnap-cell">
              <div class="weeksnap-num">${Math.round(week.focusMinutes / 60)}h<span class="weeksnap-trend ${trendDir(week.focusMinutes, prevWeek.focusMinutes)}">${trendArrow(week.focusMinutes, prevWeek.focusMinutes)}</span></div>
              <div class="weeksnap-lbl">Focus</div>
            </div>
            <div class="weeksnap-cell">
              <div class="weeksnap-num">${habitsDoneCount}/${scheduledHabits.length || "—"}</div>
              <div class="weeksnap-lbl">Habits today</div>
            </div>
            <div class="weeksnap-cell">
              <div class="weeksnap-num">${activeGoals.length}</div>
              <div class="weeksnap-lbl">Active goals</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  // ---------- wiring ----------
  // Home is read-only: every button navigates, nothing mutates data.
  const advance = () => {
    slider.index = flow.length ? (slider.index + 1) % flow.length : 0;
    renderHome(view, alive);
  };

  view.querySelector("#start-focus-btn")?.addEventListener("click", () => {
    if (current?.kind === "task" && current?.ref?.id) sessionStorage.setItem("nexora-focus-task", current.ref.id);
    const route = current?.kind === "habit" || current?.kind === "deadline" ? "#/goals" : "#/focus";
    window.location.hash = route;
  });

  view.querySelector("#reschedule-btn")?.addEventListener("click", () => {
    window.location.hash = "#/tasks";
  });

  view.querySelector("#flow-next-btn")?.addEventListener("click", advance);

  // Render flow dots
  const dotsEl = view.querySelector("#flow-dots");
  if (dotsEl && flow.length > 1) {
    dotsEl.innerHTML = flow.map((_, i) =>
      `<span class="flow-dot-v2 ${i < slider.index ? "passed" : ""} ${i === slider.index ? "active" : ""}"></span>`
    ).join("");
  }

  view.querySelectorAll("[data-attention]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = attention[Number(btn.getAttribute("data-attention"))];
      if (a?.route) window.location.hash = a.route;
    });
  });

  view.querySelectorAll("[data-open-project]").forEach((el) =>
    el.addEventListener("click", () => {
      window.location.hash = `#/projects?id=${el.dataset.openProject}`;
    })
  );

  view.querySelector("#add-event-btn")?.addEventListener("click", async () => {
    const { openForm } = await import("../ui/modal.js");
    const { EVENT_TYPE_OPTIONS } = await import("../config/eventTypes.js");
    const { createEvent } = await import("../services/eventService.js");
    const values = await openForm({
      title: "New event",
      values: { date: today },
      fields: [
        { name: "title", label: "Title", required: true, placeholder: "Team stand-up" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "startHour", label: "Starts", type: "time", required: true },
        { name: "endHour", label: "Ends", type: "time" },
        { name: "type", label: "Type", type: "select", options: EVENT_TYPE_OPTIONS },
      ],
      submitLabel: "Add event",
    });
    if (!values) return;
    const start = toFloat(values.startHour || "09:00");
    let end = values.endHour ? toFloat(values.endHour) : start + 1;
    if (end <= start) end = start + 1;
    await createEvent({ title: values.title, type: values.type, date: values.date, startHour: start, endHour: end });
    toast("Event added — see it in Today's calendar");
  });
}

// ---------- helpers ----------

function secondsClock(s) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function timelineHTML(events, tasks) {
  const rows = [];
  for (const e of events) {
    const tm = typeMeta(e.type);
    rows.push({
      sort: Math.round(e.startHour * 60),
      html: `
      <div class="nextup-row" data-ev-link="${e.id}">
        <span class="nextup-time num">${fmtHour(e.startHour)}</span>
        <span class="nextup-icon" style="background:${tm.soft};">${tm.emoji}</span>
        <div class="nextup-body">
          <div class="nextup-title">${escapeHtml(e.title)}</div>
          <div class="nextup-sub">${tm.label}${e.endHour ? ` · ends ${fmtHour(e.endHour)}` : ""}</div>
        </div>
      </div>`,
    });
  }
  for (const t of tasks) {
    if (t.dueDate !== todayISO() || ["Completed", "Cancelled"].includes(t.status)) continue;
    rows.push({
      sort: t.startTime ? minutesOf(t.startTime) : 24 * 60 + t._score,
      html: `
      <div class="nextup-row" data-task-link="${t.id}">
        <span class="nextup-time num">${t.startTime ? fmtHour(minutesOf(t.startTime) / 60) : "—"}</span>
        <span class="nextup-icon" style="background:var(--ember-soft);">🎯</span>
        <div class="nextup-body">
          <div class="nextup-title">${escapeHtml(t.title)}</div>
          <div class="nextup-sub">${t.priority} priority · ${t.estimatedMinutes}m</div>
        </div>
      </div>`,
    });
  }
  rows.sort((a, b) => a.sort - b.sort);
  return rows.map((r) => r.html).join("");
}

function diffDaysSafe(a, b) {
  if (!b) return 999;
  return Math.round((new Date(a) - new Date(b)) / 86400000);
}

function trendArrow(cur, prev) {
  if (cur > prev) return "↑";
  if (cur < prev) return "↓";
  return "";
}

function trendDir(cur, prev) {
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "";
}

function healthOf(p, status) {
  if (status === "On Hold") return { color: "#5E81AC", label: "On hold" };
  if (p >= 75) return { color: "#3A7D44", label: "On track" };
  if (p >= 40) return { color: "#C99A2E", label: "At risk" };
  return { color: "#C0392B", label: "Behind" };
}

function flowBadge(item) {
  if (item.kind === "task") return item.overdue ? "⏰ Overdue task" : "Task";
  if (item.kind === "event") return "Event";
  if (item.kind === "habit") return "Habit";
  if (item.kind === "deadline") return "Goal";
  if (item.kind === "pdeadline") return "Project";
  return "Item";
}

function primaryLabel(item) {
  if (item.kind === "task") return "Start focus";
  if (item.kind === "habit") return "Start habit";
  if (item.kind === "deadline") return "Continue goal";
  if (item.kind === "pdeadline") return "Open project";
  return "View";
}

function primaryActionHTML(item) {
  if (item.kind === "event") return `<a class="btn btn-primary" href="#/calendar">${icon("calendar")} View in calendar</a>`;
  if (item.kind === "pdeadline") return `<a class="btn btn-primary" href="#/projects?id=${item.ref.id}">${icon("flag")} Open project</a>`;
  return `<button class="btn btn-primary" id="start-focus-btn">${icon("play")} ${primaryLabel(item)}</button>`;
}

function secondaryAction(item) {
  if (item.kind === "task") return { label: "Open task", href: "#/tasks" };
  if (item.kind === "habit") return { label: "Open habits", href: "#/goals" };
  if (item.kind === "deadline") return { label: "View goal", href: "#/goals" };
  if (item.kind === "pdeadline") return { label: "View project", href: `#/projects?id=${item.ref.id}` };
  return null;
}

function leftNav(item) {
  if (item.kind === "task") return `<button class="btn btn-sm btn-ghost" id="reschedule-btn">Reschedule</button>`;
  if (item.kind === "event") return `<a class="btn btn-sm btn-ghost" href="#/calendar">Calendar</a>`;
  if (item.kind === "pdeadline") return `<a class="btn btn-sm btn-ghost" href="#/projects?id=${item.ref.id}">Details</a>`;
  return `<a class="btn btn-sm btn-ghost" href="#/goals">Details</a>`;
}

function fmtEventRange(startH, endH) {
  return `${fmtHour(startH)}${endH ? ` – ${fmtHour(endH)}` : ""}`;
}

function flowBody(item, ctx) {
  const { projectNameOf, goalNameOf, gProg, pProg, tasks, today } = ctx;

  if (item.kind === "task") {
    const t = taskService.decorate([item.ref])[0];
    const reasons = reasonsFor(t, projectNameOf(t.projectId));
    const dueLabel = item.overdue
      ? `<span class="meta-chip overdue">⏰ Overdue</span>`
      : t.dueDate === today
        ? `<span class="meta-chip due">⏰ Due today</span>`
        : t.dueDate
          ? `<span class="meta-chip">Due ${fmtDate(t.dueDate)}</span>`
          : "";
    return `
      <div class="flow-eyebrow">${icon("spark")} Do this now</div>
      <div class="now-task">${escapeHtml(t.title)}</div>
      <div class="now-meta-row">
        ${t.priority ? `<span class="prio-${t.priority.toLowerCase()}">${priorityEmoji(t.priority)} ${t.priority}</span>` : ""}
        ${t.estimatedMinutes ? `<span>⏱ <span class="num">${t.estimatedMinutes}m</span></span>` : ""}
        ${dueLabel}
      </div>
      <div class="now-why">
        <div class="now-why-label">Why now</div>
        <p class="now-reason">${escapeHtml(reasons.slice(0, 3).join(" · "))}</p>
      </div>`;
  }

  if (item.kind === "event") {
    const e = item.ref;
    const tm = typeMeta(e.type);
    return `
      <div class="flow-eyebrow">${tm.emoji} On your calendar</div>
      <div class="now-task">${escapeHtml(e.title)}</div>
      <div class="now-meta-row">
        <span>🕐 <span class="num">${fmtEventRange(e.startHour, e.endHour)}</span></span>
        <span>${tm.label}</span>
        ${e.date === today ? "<span>Today</span>" : `<span>${fmtDate(e.date)}</span>`}
      </div>
      <div class="now-why">
        <div class="now-why-label">Heads-up</div>
        <p class="now-reason">Clear anything that overlaps — be ready when it starts${e.notes ? ` — note: ${escapeHtml(e.notes)}` : ""}.</p>
      </div>`;
  }

  if (item.kind === "habit") {
    const h = item.ref;
    return `
      <div class="flow-eyebrow">${icon("check")} Keep the streak alive</div>
      <div class="now-task">${escapeHtml(h.title)}</div>
      <div class="now-meta-row">
        <span>🕐 <span class="num">${h.timeOfDay}</span></span>
        <span>⏱ <span class="num">${h.durationMinutes} min</span></span>
        ${item.streak > 0 ? `<span>🔥 <span class="num">${item.streak} day streak</span></span>` : ""}
      </div>
      <div class="now-why">
        <div class="now-why-label">Why now</div>
        <p class="now-reason">Scheduled for today and not logged yet — small steps compound.</p>
      </div>`;
  }

  if (item.kind === "deadline" || item.kind === "pdeadline") {
    const r = item.ref;
    const isGoal = item.kind === "deadline";
    const due = isGoal ? r.targetDate : r.deadline;
    const daysLeft = diffDaysSafe(today, due);
    const when = daysLeft <= 0 ? "Due today" : daysLeft === 1 ? "Due tomorrow" : `Due in ${daysLeft} days`;
    const prog = isGoal ? (gProg?.[r.id] || {}) : (pProg?.[r.id] || {});
    const pct = prog.pct ?? 0;
    const remaining = Math.max(0, (prog.total ?? 0) - (prog.done ?? 0));
    return `
      <div class="flow-eyebrow">${icon("flag")} Deadline approaching</div>
      <div class="now-task">${escapeHtml(isGoal ? r.title : r.name)}</div>
      <div class="now-meta-row">
        <span>⏰ <span class="num">${when}</span></span>
        ${isGoal
          ? `<span><span class="num">${pct}%</span> complete</span>`
          : prog.total > 0
            ? `<span><span class="num">${prog.done}</span>/${prog.total} complete</span>`
            : `<span>No tasks yet</span>`}
        ${!isGoal && goalNameOf(r.goalId) ? `<span>🎯 ${escapeHtml(goalNameOf(r.goalId))}</span>` : ""}
      </div>
      <div class="now-why">
        <div class="now-why-label">Why now</div>
        <p class="now-reason">${isGoal ? "The deadline is approaching — a little progress today keeps you on track." : `The deadline is approaching — ${remaining} remaining item${remaining === 1 ? "" : "s"} need attention.`}</p>
      </div>`;
  }

  return "";
}

function priorityEmoji(p) {
  return { Urgent: "🔥", High: "⚡", Medium: "•", Low: "·" }[p] || "•";
}

function buildInsight({ week, prevWeek, overdueTasks, activeGoals, gProg, habitsDoneCount, scheduledHabits, stats }) {
  const bits = [];

  if (week.tasksCompleted > prevWeek.tasksCompleted) {
    bits.push(`<b>${week.tasksCompleted}</b> tasks done this week — up from ${prevWeek.tasksCompleted}. Momentum is real.`);
  } else if (week.tasksCompleted < prevWeek.tasksCompleted) {
    bits.push(`<b>${week.tasksCompleted}</b> tasks this week vs ${prevWeek.tasksCompleted} last week — a small push closes the gap.`);
  } else {
    bits.push(`<b>${week.tasksCompleted}</b> tasks done this week, matching last week's pace.`);
  }

  if (stats.todayMin >= 120) bits.push(`Strong focus day — <b>${minutesToHuman(stats.todayMin)}</b> banked already.`);
  else if (week.focusMinutes >= 120) bits.push(`<b>${minutesToHuman(week.focusMinutes)}</b> of deep work this week.`);
  else if (week.focusMinutes > 0) bits.push(`Only <b>${week.focusMinutes} min</b> of focus this week — protect one block tomorrow.`);
  else bits.push(`No focus sessions yet this week. Even 25 minutes resets your rhythm.`);

  if (scheduledHabits.length > 0 && habitsDoneCount === scheduledHabits.length) bits.push(`All habits checked off today. Streaks intact 🔥`);

  const weakestGoal = activeGoals
    .map((g) => ({ g, p: gProg[g.id]?.pct ?? 0 }))
    .sort((a, b) => a.p - b.p)[0];
  if (weakestGoal && weakestGoal.p <= 25) {
    bits.push(`<b>${escapeHtml(weakestGoal.g.title)}</b> sits at ${weakestGoal.p}% — give it one concrete step today.`);
  }

  if (overdueTasks.length >= 3) bits.push(`<b>${overdueTasks.length} overdue tasks</b> are quietly adding pressure — clear the oldest first.`);

  return bits.slice(0, 3).map((b) => `<p style="margin-bottom:8px;">${b}</p>`).join("");
}
