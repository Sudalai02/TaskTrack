import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as db from "../store/db.js";
import { getProfile, saveProfile, getSettings, saveSettings, DEFAULT_SETTINGS } from "../services/settingsService.js";
import { logout } from "../services/authService.js";

const sections = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "screens", label: "Screens" },
  { id: "focus", label: "Focus & Pomodoro" },
  { id: "ai", label: "AI & automation" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy & data" },
  { id: "workspace", label: "Workspace" },
];

let active = "account";

export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("dark");
  if (theme === "dark") {
    root.classList.add("dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000000");
  } else if (theme === "system") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000000");
    } else {
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FAFAF9");
    }
  } else {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FAFAF9");
  }
}

function switchEl(id, on, label, desc) {
  return `
    <div class="settings-row">
      <div>
        <div class="settings-row-label">${label}</div>
        ${desc ? `<div class="settings-row-desc">${desc}</div>` : ""}
      </div>
      <button class="switch ${on ? "on" : ""}" data-switch="${id}" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${label}"></button>
    </div>
  `;
}

function rowHTML(label, desc, right) {
  return `
    <div class="settings-row">
      <div>
        <div class="settings-row-label">${label}</div>
        ${desc ? `<div class="settings-row-desc">${desc}</div>` : ""}
      </div>
      <div>${right}</div>
    </div>
  `;
}

function inputHTML(type, attrs, style) {
  const s = style || "width:200px; max-width:100%; padding:6px 10px; border:1px solid var(--hairline-strong); border-radius:8px; font-size:13px;";
  if (type === "select") return `<select ${attrs} style="${s}"></select>`;
  return `<input type="${type}" ${attrs} style="${s}" />`;
}

export async function renderSettings(view, alive = () => true) {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!alive()) return;

  function sectionBody(id) {
    if (id === "account") {
      return `
        <div class="settings-section">
          <h3>Profile</h3>
          <div class="sub">Your details, used across the app.</div>
          ${rowHTML("Name", null, `
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="settings-row-desc">${esc(profile?.name || "—")}</span>
              <button class="btn btn-ghost btn-sm" data-edit-profile>Edit</button>
            </div>
          `)}
          ${rowHTML("Email", null, `<span class="settings-row-desc">${esc(profile?.email || "—")}</span>`)}
          ${rowHTML("Workspace", null, `<span class="settings-row-desc">${esc(profile?.workspace || "Personal workspace")}</span>`)}
        </div>
        <div class="settings-section">
          <h3>Session</h3>
          <div class="sub">Manage your current session on this device.</div>
          <div style="padding:var(--sp-4) 0;">
            <button class="btn btn-secondary btn-sm" id="logout-btn">Log out</button>
          </div>
        </div>
      `;
    }

    if (id === "appearance") {
      return `
        <div class="settings-section">
          <h3>Theme</h3>
          <div class="sub">Choose how the app looks on this device.</div>
          ${rowHTML("Appearance", "Changes the color scheme across all screens.", `
            <select data-theme="theme" style="padding:6px 10px; border:1px solid var(--hairline-strong); border-radius:8px; font-size:13px;">
              <option value="light" ${settings.theme === "light" ? "selected" : ""}>Light</option>
              <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>Dark</option>
              <option value="system" ${settings.theme === "system" ? "selected" : ""}>System</option>
            </select>
          `)}
        </div>
      `;
    }

    if (id === "screens") {
      const s = settings.screens || {};
      const screenNames = [
        ["home", "Home", "Daily dashboard and briefing"],
        ["tasks", "Tasks", "Task list with priorities and deadlines"],
        ["projects", "Projects", "Group tasks into projects"],
        ["goals", "Goals", "Long-term goals with linked projects"],
        ["calendar", "Calendar", "Schedule and events view"],
        ["focus", "Focus", "Pomodoro timer and focus sessions"],
        ["notes", "Notes", "Quick notes and documents"],
        ["inbox", "Inbox", "Capture ideas and quick items"],
        ["insights", "Insights", "Analytics and productivity report"],
        ["assistant", "AI Assistant", "Chat with your productivity copilot"],
        ["recycleBin", "Recycle Bin", "Recover deleted items"],
      ];
      return `
        <div class="settings-section">
          <h3>Visible Screens</h3>
          <div class="sub">Choose which screens appear in navigation. Disabled screens are hidden from the sidebar and bottom bar.</div>
          ${screenNames.map(([key, label, desc]) => switchEl(`screen-${key}`, s[key] !== false, label, desc)).join("")}
        </div>
      `;
    }

    if (id === "focus") {
      const p = settings.pomodoro;
      return `
        <div class="settings-section">
          <h3>Pomodoro Timer</h3>
          <div class="sub">Defaults for the Focus page timer. Changes apply to new sessions.</div>
          ${rowHTML("Focus length", "How long each focus session lasts.", inputHTML("number", `min="5" max="120" step="5" value="${p.focusMinutes}" data-pomo="focusMinutes"`))}
          ${rowHTML("Short break", "Rest between focus sessions.", inputHTML("number", `min="1" max="30" value="${p.shortBreakMinutes}" data-pomo="shortBreakMinutes"`))}
          ${rowHTML("Long break", "Longer rest after multiple sessions.", inputHTML("number", `min="5" max="60" value="${p.longBreakMinutes}" data-pomo="longBreakMinutes"`))}
          ${rowHTML("Sessions before long break", "How many focus sessions before a long break.", inputHTML("number", `min="2" max="8" value="${p.sessionsBeforeLongBreak}" data-pomo="sessionsBeforeLongBreak"`))}
          <div style="padding-top:var(--sp-4);">
            <button class="btn btn-primary btn-sm" id="save-pomo">Save focus settings</button>
          </div>
        </div>
      `;
    }

    if (id === "ai") {
      const ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) };
      return `
        <div class="settings-section">
          <h3>AI Features</h3>
          <div class="sub">Control what AI can do across the app.</div>
          ${switchEl("ai-recommendations", ai.recommendations !== false, "AI recommendations", "Personalized suggestions based on your patterns and productivity data")}
          ${switchEl("ai-smartPlanning", ai.smartPlanning !== false, "Smart task planning", "AI helps break down goals into phases and actionable tasks")}
          ${switchEl("ai-autoBreakdown", ai.autoBreakdown !== false, "Automatic task breakdown", "Automatically create subtasks when you add complex tasks")}
        </div>
        <div class="settings-section">
          <h3>Automation</h3>
          <div class="sub">Control what the system can do without asking.</div>
          ${switchEl("autoSchedule", settings.autoSchedule, "Automatic rescheduling", "Move missed tasks to the next suitable available time")}
        </div>
        <div class="settings-section">
          <h3>AI & Privacy</h3>
          <div class="sub" style="line-height:1.6;">Your AI features use the data available in your TaskTrack account to provide personalized recommendations. All data is processed locally. No information is sent to external servers.</div>
        </div>
        <div style="padding-top:var(--sp-2);">
          <button class="btn btn-primary btn-sm" id="save-ai-btn">Save Settings</button>
        </div>
      `;
    }

    if (id === "notifications") {
      const n = settings.notifications;
      return `
        <div class="settings-section">
          <h3>Alerts</h3>
          <div class="sub">Choose which notifications you want to receive.</div>
          ${switchEl("n-deadline", n.deadline, "Deadline alerts", "Get notified when tasks are due or overdue")}
          ${switchEl("n-habit", n.habit, "Habit reminders", "Daily reminders for your scheduled habits")}
          ${switchEl("n-morning", n.morning, "Morning briefing", "Start your day with a summary of what's ahead")}
          ${switchEl("n-evening", n.evening, "Evening review", "End-of-day recap of what you accomplished")}
          ${switchEl("n-risk", n.risk, "Goal risk alerts", "Warning when a goal is falling behind its target")}
        </div>
      `;
    }

    if (id === "privacy") {
      return `
        <div class="settings-section">
          <h3>Your Data</h3>
          <div class="sub">Everything is stored locally on this device. Nothing is sent anywhere until you connect Firebase.</div>
          ${rowHTML("Export all data", "Download a JSON backup of all your tasks, projects, goals, habits, and notes.", `<button class="btn btn-secondary btn-sm" id="export-btn">Export JSON</button>`)}
          ${rowHTML("Import data", "Restore from a previously exported JSON backup file.", `<button class="btn btn-secondary btn-sm" id="import-btn">Import JSON</button>`)}
          <input type="file" id="import-file" accept=".json" style="display:none;" />
        </div>
        <div class="settings-section">
          <h3>Danger Zone</h3>
          <div class="sub">Permanent actions. These cannot be undone.</div>
          ${rowHTML("Clear all data", "Delete everything: tasks, projects, goals, habits, notes, and settings. The app will reset to its initial state.", `<button class="btn btn-danger btn-sm" id="clear-data-btn">Clear All Data</button>`)}
        </div>
      `;
    }

    if (id === "workspace") {
      return `
        <div class="settings-section">
          <h3>Workspace</h3>
          <div class="sub">Manage your workspace settings.</div>
          ${rowHTML("Workspace name", "Used as the label across the app.", `
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="settings-row-desc">${esc(profile?.workspace || "Personal workspace")}</span>
              <button class="btn btn-ghost btn-sm" data-edit-workspace>Edit</button>
            </div>
          `)}
          ${rowHTML("Type", null, `<span class="settings-row-desc">Personal</span>`)}
          ${rowHTML("Storage", "Where your data lives.", `<span class="settings-row-desc">Local (IndexedDB)</span>`)}
        </div>
      `;
    }

    return "";
  }

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function draw() {
    view.innerHTML = `
      <div class="page-header">
        <h1>Settings</h1>
      </div>
      <div class="settings-layout">
        <div class="settings-nav">
          ${sections.map((s) => `<button class="settings-nav-item ${active === s.id ? "active" : ""}" data-section="${s.id}">${s.label}</button>`).join("")}
        </div>
        <div>${sectionBody(active)}</div>
      </div>
    `;
    wire();
  }

  function wire() {
    view.querySelectorAll("[data-section]").forEach((btn) =>
      btn.addEventListener("click", () => {
        active = btn.dataset.section;
        draw();
      })
    );

    // Persisted switches
    view.querySelectorAll("[data-switch]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.classList.toggle("on");
        const on = btn.classList.contains("on");
        btn.setAttribute("aria-checked", String(on));
        const key = btn.dataset.switch;

        if (key === "autoSchedule") {
          await saveSettings({ autoSchedule: on });
        } else if (key.startsWith("n-")) {
          const map = { "n-deadline": "deadline", "n-habit": "habit", "n-morning": "morning", "n-evening": "evening", "n-risk": "risk" };
          const notifications = { ...DEFAULT_SETTINGS.notifications, ...settings.notifications, [map[key]]: on };
          settings.notifications = notifications;
          await saveSettings({ notifications });
        } else if (key.startsWith("ai-")) {
          const map = { "ai-recommendations": "recommendations", "ai-smartPlanning": "smartPlanning", "ai-autoBreakdown": "autoBreakdown" };
          const ai = { ...DEFAULT_SETTINGS.ai, ...settings.ai, [map[key]]: on };
          settings.ai = ai;
          await saveSettings({ ai });
        } else if (key.startsWith("screen-")) {
          const screenKey = key.replace("screen-", "");
          const screens = { ...DEFAULT_SETTINGS.screens, ...settings.screens, [screenKey]: on };
          settings.screens = screens;
          await saveSettings({ screens });
          toast(on ? `${screenKey} visible` : `${screenKey} hidden`);
          window.dispatchEvent(new CustomEvent("screens-changed"));
        }
        toast(on ? "Enabled" : "Disabled");
      })
    );

    // Theme select
    view.querySelector('[data-theme="theme"]')?.addEventListener("change", async (e) => {
      settings.theme = e.target.value;
      await saveSettings({ theme: e.target.value });
      applyTheme(e.target.value);
      toast("Theme updated");
    });

    // Pomodoro save
    view.querySelector("#save-pomo")?.addEventListener("click", async () => {
      const read = (k) => Number(view.querySelector(`[data-pomo="${k}"]`).value);
      const pomodoro = {
        focusMinutes: Math.min(120, Math.max(5, read("focusMinutes"))),
        shortBreakMinutes: Math.min(30, Math.max(1, read("shortBreakMinutes"))),
        longBreakMinutes: Math.min(60, Math.max(5, read("longBreakMinutes"))),
        sessionsBeforeLongBreak: Math.min(8, Math.max(2, read("sessionsBeforeLongBreak"))),
      };
      Object.assign(settings.pomodoro, pomodoro);
      await saveSettings({ pomodoro });
      toast("Focus settings saved");
    });

    // Profile edit
    view.querySelector("[data-edit-profile]")?.addEventListener("click", async () => {
      const res = await openForm({
        title: "Edit profile",
        values: { name: profile?.name || "", email: profile?.email || "", workspace: profile?.workspace || "" },
        fields: [
          { name: "name", label: "Name", required: true },
          { name: "email", label: "Email" },
          { name: "workspace", label: "Workspace name" },
        ],
      });
      if (!res) return;
      Object.assign(profile, await saveProfile(res));
      toast("Profile updated");
      draw();
    });

    // Workspace edit
    view.querySelector("[data-edit-workspace]")?.addEventListener("click", async () => {
      const res = await openForm({
        title: "Edit workspace",
        values: { workspace: profile?.workspace || "Personal workspace" },
        fields: [
          { name: "workspace", label: "Workspace name", required: true },
        ],
      });
      if (!res?.workspace) return;
      Object.assign(profile, await saveProfile({ workspace: res.workspace }));
      toast("Workspace updated");
      draw();
    });

    // Log out
    view.querySelector("#logout-btn")?.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Log out?",
        message: "You'll be logged out of this device. Your local data will remain stored until you clear it.",
        confirmLabel: "Log out",
      });
      if (!ok) return;
      await logout();
    });

    // AI settings save
    view.querySelector("#save-ai-btn")?.addEventListener("click", async () => {
      const ai = { ...DEFAULT_SETTINGS.ai, ...settings.ai };
      await saveSettings({ ai });
      toast("AI settings saved");
    });

    // Export
    view.querySelector("#export-btn")?.addEventListener("click", async () => {
      const dump = {};
      for (const store of db.STORES) dump[store] = await db.getAll(store);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nexora-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Export downloaded");
    });

    // Import
    view.querySelector("#import-btn")?.addEventListener("click", () => {
      view.querySelector("#import-file")?.click();
    });
    view.querySelector("#import-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const ok = await confirmModal({
          title: "Import data?",
          message: `This will import data from "${file.name}". Existing data in the same stores will be overwritten. Continue?`,
          confirmLabel: "Import",
        });
        if (!ok) return;
        let count = 0;
        for (const store of db.STORES) {
          if (data[store] && Array.isArray(data[store])) {
            await db.bulkPut(store, data[store]);
            count += data[store].length;
          }
        }
        toast(`Imported ${count} items from ${file.name}`);
        window.dispatchEvent(new CustomEvent("data-changed"));
      } catch (err) {
        toast("Import failed: invalid JSON file");
      }
      e.target.value = "";
    });

    // Clear all data
    view.querySelector("#clear-data-btn")?.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Clear all data?",
        message: "This will permanently delete all tasks, projects, goals, habits, notes, events, and settings. This cannot be undone.",
        confirmLabel: "Clear everything",
      });
      if (!ok) return;
      for (const store of db.STORES) {
        await db.clear(store);
      }
      toast("All data cleared. Reloading\u2026");
      setTimeout(() => location.reload(), 800);
    });
  }

  draw();
}
