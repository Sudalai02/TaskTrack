// ============================================================
// FOCUS — pomodoro engine (v2 design).
//
// Layout: stat cards (Today / This week / Sessions) → mode tabs
// (Focus · Short break · Long break) → big ring timer → controls.
// The ⚙ gear opens pomodoro settings (persisted). History keeps
// ONLY Today + this week; anything older is pruned.
//
// Timing is wall-clock based: instead of decrementing a counter,
// we store an absolute `endsAt` timestamp and derive remaining
// time from Date.now(). Background tabs, sleep, and navigation
// cannot make the timer drift.
// ============================================================

import { icon } from "../dom.js";
import { secondsToClock, todayISO, startOfWeekISO, minutesToHuman } from "../utils/dates.js";
import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as db from "../store/db.js";
import * as focusService from "../services/focusService.js";
import * as taskService from "../services/taskService.js";
import { getSettings, saveSettings } from "../services/settingsService.js";
import { showNative } from "../services/notificationService.js";

const OUTCOMES = ["Completed", "Partial", "Distracted", "Blocked"];

const T = {
  phase: "idle", // idle | focus | offer | break
  breakKind: null, // short | long
  running: false,
  endsAt: null, // absolute ms timestamp while running
  secondsLeft: 0, // frozen remainder while paused
  totalSeconds: 0,
  taskId: null,
  taskTitle: "",
  plannedMinutes: 45,
  sessionsDone: 0, // consecutive completions since app load
  startedAt: null,
  handle: null,
};

export function focusSnapshot() {
  if ((T.phase === "focus" || T.phase === "break") && (T.running || T.secondsLeft > 0)) {
    return {
      active: true,
      phase: T.phase,
      breakKind: T.breakKind,
      title: T.taskTitle || "Deep work",
      secondsLeft: remainingSeconds(),
      totalSeconds: T.totalSeconds,
    };
  }
  return { active: false };
}

function remainingSeconds() {
  if (T.running && T.endsAt) return Math.max(0, Math.ceil((T.endsAt - Date.now()) / 1000));
  return Math.max(0, T.secondsLeft);
}

async function persistSession(outcomeLabel, note = "") {
  const focusedSeconds = T.totalSeconds - remainingSeconds();
  if (focusedSeconds < 5) return;
  await focusService.saveSession({
    taskId: T.taskId,
    taskTitle: T.taskTitle || "Unassigned session",
    type: "focus",
    plannedMinutes: T.plannedMinutes,
    durationSeconds: focusedSeconds,
    outcome: outcomeLabel.toLowerCase(),
    note,
    startedAt: T.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
}

export async function renderFocus(view, alive = () => true) {
  let [settings, tasks] = await Promise.all([getSettings(), taskService.openTasks()]);
  if (!alive()) return;
  const pomo = settings.pomodoro;

  let mode = "focus"; // focus | short | long

  function stopTicker() {
    if (T.handle) clearInterval(T.handle);
    T.handle = null;
  }

  function pause() {
    if (!T.running) return;
    T.secondsLeft = remainingSeconds();
    T.running = false;
    T.endsAt = null;
    stopTicker();
  }

  function arm(seconds) {
    T.secondsLeft = seconds;
    T.endsAt = Date.now() + seconds * 1000;
    T.running = true;
    stopTicker();
    T.handle = setInterval(tick, 500);
  }

  function tick() {
    const left = remainingSeconds();
    T.secondsLeft = left;
    updateDisplay();
    if (left <= 0) {
      stopTicker();
      T.running = false;
      T.endsAt = null;
      if (T.phase === "focus") completeFocus(true);
      else finishBreak();
    }
  }

  async function completeFocus(auto = false) {
    let outcome = auto ? "Completed" : null;
    if (!auto) {
      const res = await openForm({
        title: "How did it go?",
        eyebrow: "Session review",
        values: { outcome: "Completed", note: "" },
        fields: [
          { name: "outcome", label: "Result", type: "select", options: OUTCOMES.map((o) => ({ value: o.toLowerCase(), label: o })) },
          { name: "note", label: "Note (optional)", placeholder: "What happened?" },
        ],
        submitLabel: "Save session",
      });
      if (!res) await persistSession("Partial");
      else {
        outcome = res.outcome;
        await persistSession(res.outcome, res.note);
      }
    } else {
      await persistSession(outcome);
      showNative("Focus complete", `Nice work on “${T.taskTitle || "your session"}”. Time for a break.`);
    }

    T.sessionsDone += 1;
    if (T.taskId) {
      const t = tasks.find((x) => x.id === T.taskId);
      if (t && t.status === "Todo") await taskService.updateTask(T.taskId, { status: "In Progress" });
    }
    T.breakKind = nextBreakKind();
    T.phase = "offer"; // wait for explicit user choice
    draw();
  }

  function nextBreakKind() {
    const n = pomo.sessionsBeforeLongBreak;
    return T.sessionsDone % n === 0 ? "long" : "short";
  }

  function startBreak() {
    T.plannedMinutes = T.breakKind === "long" ? pomo.longBreakMinutes : pomo.shortBreakMinutes;
    T.phase = "break";
    T.totalSeconds = T.plannedMinutes * 60;
    arm(T.totalSeconds);
    draw();
  }

  function skipToIdle(message) {
    T.phase = "idle";
    T.totalSeconds = 0;
    T.secondsLeft = 0;
    draw();
    if (message) toast(message);
  }

  function finishBreak() {
    showNative("Break over", "Ready for another round of deep work?");
    skipToIdle("Break over — ready when you are");
  }

  async function abandon() {
    pause();
    const ok = await confirmModal({
      title: "Abandon session?",
      message: "The minutes you focused will still be saved.",
      confirmLabel: "Abandon",
      danger: true,
    });
    if (!ok) {
      arm(T.secondsLeft);
      updateToggle();
      return;
    }
    await persistSession("Distracted");
    T.phase = "idle";
    T.totalSeconds = 0;
    T.secondsLeft = 0;
    draw();
  }

  function updateDisplay() {
    const disp = view.querySelector("#timer-display");
    if (!disp) return;
    disp.textContent = secondsToClock(remainingSeconds());
    paintRing();
  }

  function paintRing() {
    const ring = view.querySelector(".focus-ring-v2");
    if (!ring) return;
    const deg = T.totalSeconds ? Math.round(((T.totalSeconds - remainingSeconds()) / T.totalSeconds) * 360) : 0;
    const color = T.phase === "break" ? "var(--good)" : T.phase === "focus" ? "var(--focus)" : "var(--graphite-dim)";
    if (T.phase === "idle") {
      ring.style.background = "conic-gradient(var(--hairline-strong) 0deg 360deg)";
    } else {
      ring.style.background = `conic-gradient(${color} ${deg}deg, var(--hairline) ${deg}deg 360deg)`;
    }
  }

  function updateToggle() {
    const btn = view.querySelector("#toggle-btn");
    if (btn) btn.innerHTML = icon(T.running ? "pause" : "play");
  }

  async function draw() {
    if (!alive()) return;
    if (T.phase === "offer") return renderOffer();
    if (T.phase === "break") return renderBreak();

    const sessions = await focusService.allSessions();
    if (!alive()) return;

    if (T.phase === "idle") renderIdle(sessions);
    else renderRunning();
  }

  // ---- break OFFER screen ----
  function renderOffer() {
    const mins = T.breakKind === "long" ? pomo.longBreakMinutes : pomo.shortBreakMinutes;
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">Session done</div>
        <h1>Take ${mins} minutes?</h1>
      </div>
      <div class="focus-v2">
        <div class="focus-ring-v2">
          <div style="position:relative; text-align:center;">
            <div class="focus-time-v2 num">${String(mins).padStart(2, "0")}:00</div>
            <div class="focus-session-label-v2">${T.breakKind === "long" ? "Long break earned" : "Short break"}</div>
          </div>
        </div>
        <p style="font-size:14px;color:var(--graphite);margin-bottom:var(--sp-5); text-align:center;">
          Next up: ${escapeHtml(T.taskTitle || "your next task")}
        </p>
        <div class="focus-controls-v2">
          <button class="btn btn-primary" id="start-break-btn">Start break</button>
          <button class="btn btn-secondary" id="skip-break-btn">Skip</button>
        </div>
      </div>
    `;
    view.querySelector("#start-break-btn").addEventListener("click", startBreak);
    view.querySelector("#skip-break-btn").addEventListener("click", () => skipToIdle("Skipped — jump back in anytime"));
    paintRing();
  }

  // ---- active break ----
  function renderBreak() {
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">${T.breakKind === "long" ? "Long break" : "Short break"} · in progress</div>
        <h1>Recharge</h1>
      </div>
      <div class="focus-v2">
        <div class="focus-ring-v2">
          <div style="position:relative; text-align:center;">
            <div class="focus-time-v2 num" id="timer-display">${secondsToClock(remainingSeconds())}</div>
            <div class="focus-session-label-v2">${T.plannedMinutes}m break</div>
          </div>
        </div>
        <div class="focus-controls-v2">
          <button class="icon-round-btn" id="break-pause-btn" aria-label="${T.running ? "Pause" : "Resume"}">${icon(T.running ? "pause" : "play")}</button>
          <button class="focus-btn-main-v2 break" id="end-break-btn" aria-label="End break">${icon("check")}</button>
        </div>
        <div class="focus-hint">End early to jump back into deep work.</div>
      </div>
    `;
    view.querySelector("#break-pause-btn").addEventListener("click", (e) => {
      if (T.running) pause();
      else arm(T.secondsLeft);
      e.currentTarget.innerHTML = icon(T.running ? "pause" : "play");
    });
    view.querySelector("#end-break-btn").addEventListener("click", () => {
      stopTicker();
      T.running = false;
      T.endsAt = null;
      skipToIdle();
    });
    updateDisplay();
  }

  // ---- main screen (idle / running) ----
  function statsRow(stats, weekSessions) {
    return `
      <div class="focus-stats-row">
        <div class="focus-stat-card"><div class="focus-stat-icon">◷</div><div class="focus-stat-label">Today</div><div class="focus-stat-value num">${minutesToHuman(stats.todayMin)}</div></div>
        <div class="focus-stat-card"><div class="focus-stat-icon">♨</div><div class="focus-stat-label">This week</div><div class="focus-stat-value num">${minutesToHuman(stats.weekMin)}</div></div>
        <div class="focus-stat-card"><div class="focus-stat-icon">◴</div><div class="focus-stat-label">Sessions</div><div class="focus-stat-value num">${stats.weekSessions}</div></div>
      </div>
    `;
  }

  async function renderIdle(sessions) {
    const { pruned } = await pruneOldSessions(sessions);
    sessions = pruned;

    const stats = await focusService.quickStats();
    if (!alive()) return;

    const groups = groupSessions(sessions);
    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">Focus</div>
        <div class="page-title-row"><h1>Deep work</h1></div>
      </div>
      <div class="focus-v2">
        ${statsRow(stats)}
        <div class="focus-mode-bar">
          <div class="focus-mode-tabs" id="mode-tabs">
            <button class="focus-mode-tab active" data-mode="focus">◎ Focus</button>
            <button class="focus-mode-tab" data-mode="short">☕ Short break</button>
            <button class="focus-mode-tab" data-mode="long">☕ Long break</button>
          </div>
          <button class="icon-round-btn" id="pomo-settings-btn" aria-label="Pomodoro settings">${icon("settings")}</button>
        </div>

        <div class="focus-ring-v2">
          <div style="position:relative; text-align:center;">
            <div class="focus-time-v2 num" id="timer-display">${secondsToClock(modeMinutes(mode) * 60)}</div>
            <div class="focus-session-label-v2" id="session-label">Session ${Math.min(T.sessionsDone + 1, pomo.sessionsBeforeLongBreak)} of ${pomo.sessionsBeforeLongBreak}</div>
          </div>
        </div>

        <div class="focus-task-chip" id="task-chip" role="button" tabindex="0" title="Choose task">
          ${icon("tasks")} <span id="task-title-display">${escapeHtml(T.taskTitle || tasks[0]?.title || "Pick a task to focus on")}</span>
          <span class="focus-task-chevron">›</span>
        </div>

        <div class="focus-controls-v2">
          <button class="focus-btn-main-v2" id="start-btn" aria-label="Start">${icon("play")}</button>
        </div>

        ${
          mode === "focus"
            ? `<div class="focus-dur-row" id="dur-row">
                <button class="dur-chip" data-min="25">25m</button>
                <button class="dur-chip ${pomo.focusMinutes === 45 ? "active" : ""}" data-min="${pomo.focusMinutes}">${pomo.focusMinutes}m</button>
                <button class="dur-chip" data-min="50">50m</button>
                <button class="dur-chip" data-min="90">90m</button>
              </div>`
            : ""
        }

        ${historyHTML(groups)}
      </div>
    `;
    wireIdle();
    wireHistory();
    paintRing();

    function modeMinutes(m) {
      return m === "short" ? pomo.shortBreakMinutes : m === "long" ? pomo.longBreakMinutes : pomo.focusMinutes;
    }

    function wireIdle() {
      let selectedMode = "focus";

      view.querySelectorAll(".focus-mode-tab").forEach((tab) =>
        tab.addEventListener("click", () => {
          selectedMode = tab.dataset.mode;
          view.querySelectorAll(".focus-mode-tab").forEach((t) => t.classList.toggle("active", t === tab));
          const disp = view.querySelector("#timer-display");
          disp.textContent = secondsToClock(modeMinutes(selectedMode) * 60);
          view.querySelector("#dur-row")?.classList.toggle("hidden-dur", selectedMode !== "focus");
          paintRing();
        })
      );

      view.querySelectorAll(".dur-chip").forEach((chip) =>
        chip.addEventListener("click", () => {
          view.querySelectorAll(".dur-chip").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          const disp = view.querySelector("#timer-display");
          if (disp) disp.textContent = secondsToClock(Number(chip.dataset.min) * 60);
        })
      );

      view.querySelector("#task-chip").addEventListener("click", pickTask);

      view.querySelector("#start-btn").addEventListener("click", () => {
        const disp = view.querySelector("#timer-display");
        const mins = Math.round(secondsToClockToSecs(disp.textContent) / 60);
        T.plannedMinutes = mins;
        T.startedAt = new Date().toISOString();
        if (selectedMode === "focus") {
          if (!T.taskTitle) {
            T.taskTitle = tasks[0]?.title || "";
            T.taskId = tasks[0]?.id || null;
          }
          T.phase = "focus";
        } else {
          T.phase = "break";
          T.breakKind = selectedMode;
        }
        T.totalSeconds = mins * 60;
        arm(mins * 60);
        draw();
      });

      view.querySelector("#pomo-settings-btn").addEventListener("click", openPomoSettings);
    }

    function secondsToClockToSecs(clock) {
      const [m, s] = String(clock).split(":").map(Number);
      return m * 60 + (s || 0);
    }

    async function pickTask() {
      if (!tasks.length) {
        toast("No open tasks — create one first");
        return;
      }
      const res = await openForm({
        title: "Choose a task",
        eyebrow: "Focus target",
        values: { taskId: T.taskId || tasks[0].id },
        fields: [
          {
            name: "taskId",
            label: "Open tasks (sorted by priority)",
            type: "select",
            options: tasks.slice(0, 25).map((t) => ({ value: t.id, label: `${t.title} · ${t.priority}` })),
          },
        ],
        submitLabel: "Set task",
      });
      if (!res) return;
      const t = tasks.find((x) => x.id === res.taskId);
      T.taskId = t?.id || null;
      T.taskTitle = t?.title || "";
      const el = view.querySelector("#task-title-display");
      if (el) el.textContent = T.taskTitle || "";
      else view.querySelector("#task-chip span").textContent = T.taskTitle || "";
    }

    async function openPomoSettings() {
      const res = await openForm({
        title: "Pomodoro settings",
        eyebrow: "Focus",
        extraClass: "wide",
        values: { ...pomo },
        fields: [
          { name: "focusMinutes", label: "Focus", type: "number", min: 5, max: 180, step: 1 },
          { name: "shortBreakMinutes", label: "Short break", type: "number", min: 1, max: 30, step: 1 },
          { name: "longBreakMinutes", label: "Long break", type: "number", min: 5, max: 60, step: 1 },
          { name: "sessionsBeforeLongBreak", label: "Sessions per block", type: "number", min: 2, max: 10, step: 1 },
        ],
        submitLabel: "Save settings",
      });
      if (!res) return;
      const merged = { ...pomo, ...res };
      await saveSettings({ pomodoro: merged });
      Object.assign(pomo, merged);
      settings = { ...settings, pomodoro: merged };
      toast("Pomodoro settings saved");
      draw();
    }
  }

  function renderRunning() {
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">${T.phase === "break" ? "Break" : "Focus"} · in progress</div>
        <h1>Deep work</h1>
      </div>
      <div class="focus-v2">
        <div class="focus-task-chip" style="cursor:default;">${icon("tasks")} <span>${escapeHtml(T.taskTitle || "Deep work")}</span></div>
        <div class="focus-ring-v2">
          <div style="position:relative; text-align:center;">
            <div class="focus-time-v2 num" id="timer-display">${secondsToClock(remainingSeconds())}</div>
            <div class="focus-session-label-v2">${T.phase === "break" ? `${T.plannedMinutes}m break` : `Pomodoro · ${T.plannedMinutes}m`}</div>
          </div>
        </div>
        <div class="focus-controls-v2">
          <button class="btn btn-secondary" id="abandon-btn">Abandon</button>
          <button class="focus-btn-main-v2" id="toggle-btn" aria-label="Pause / resume">${icon(T.running ? "pause" : "play")}</button>
          <button class="btn btn-primary" id="complete-btn">Complete</button>
        </div>
      </div>
    `;
    wireTimerControls();
    view.querySelector("#complete-btn").addEventListener("click", () => {
      pause();
      completeFocus(false);
    });
    view.querySelector("#abandon-btn").addEventListener("click", abandon);
    updateDisplay();
  }

  // ---------- history: Today + this week ONLY ----------
  async function pruneOldSessions(all) {
    const weekStart = startOfWeekISO(todayISO());
    const stale = all.filter((s) => (s.startedAt || "").slice(0, 10) < weekStart);
    for (const s of stale) {
      await db.del("focusSessions", s.id);
    }
    if (stale.length) console.info(`[focus] pruned ${stale.length} session(s) older than this week`);
    return { pruned: all.filter((s) => (s.startedAt || "").slice(0, 10) >= weekStart) };
  }

  function groupSessions(sessions) {
    const today = todayISO();
    const dayOf = (s) => (s.startedAt || "").slice(0, 10);
    const sorted = [...sessions].sort((a, b) => ((a.startedAt || "") < (b.startedAt || "") ? 1 : -1));
    return {
      today: sorted.filter((s) => dayOf(s) === today),
      week: sorted.filter((s) => dayOf(s) !== today),
    };
  }

  function historyHTML(groups) {
    if (!groups.today.length && !groups.week.length) {
      return `
        <section class="focus-history">
          <div class="section-head"><h3>Session history</h3></div>
          <div class="empty-state" style="padding:var(--sp-6);"><h3>No sessions yet</h3><p>Press play to bank your first focused minutes.</p></div>
        </section>`;
    }
    const section = (title, list, open) =>
      list.length
        ? `
        <details class="session-group" ${open ? "open" : ""}>
          <summary>${title} <span class="count num">${list.length}</span></summary>
          <div class="session-group-body">${list.map(sessionRow).join("")}</div>
        </details>`
        : "";
    return `
      <section class="focus-history">
        <div class="section-head"><h3>Session history</h3></div>
        ${section("Today", groups.today, true)}
        ${section("This week", groups.week, true)}
      </section>
    `;
  }

  function sessionRow(s) {
    const d = new Date(s.startedAt);
    const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const dotClass = s.outcome === "completed" ? "completed" : s.outcome === "partial" ? "partial" : s.outcome;
    return `
      <div class="session-row">
        <span class="session-dot ${dotClass}"></span>
        <div class="session-main">
          <div class="session-title-v2">${escapeHtml(s.taskTitle || "Unassigned session")}</div>
          <div class="session-sub-v2">${dateStr} · ${timeStr}${s.outcome !== "completed" ? ` · ${s.outcome}` : ""}</div>
        </div>
        <span class="session-mins-v2 num">${Math.round((s.durationSeconds || 0) / 60)}m</span>
        <button class="session-del" data-del="${s.id}" aria-label="Delete session">${icon("x")}</button>
      </div>
    `;
  }

  function wireHistory() {
    view.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await focusService.removeSession(btn.dataset.del);
        toast("Session removed");
        draw();
      })
    );
  }

  function wireTimerControls() {
    view.querySelector("#toggle-btn").addEventListener("click", () => {
      if (T.running) {
        pause();
        updateToggle();
      } else {
        arm(T.secondsLeft);
        updateToggle();
      }
    });
    wireHistory();
  }

  // A running timer survives navigation: the old ticker's closure
  // points at a detached DOM, so always re-arm it against this view.
  if (T.running && (T.phase === "focus" || T.phase === "break")) {
    T.secondsLeft = remainingSeconds();
    arm(T.secondsLeft);
  }

  await draw();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
