// ============================================================
// BELL PANEL — the in-app notification center.
//
// Anchored under the topbar bell. Lists real alerts produced by
// notificationService (morning briefing, task times, overdue,
// events, habits, goal deadlines, evening review). Clicking an
// alert jumps to its route. Includes an "Enable notifications"
// CTA when browser permission hasn't been granted yet.
// ============================================================

import { icon } from "../dom.js";
import * as notif from "../services/notificationService.js";

let panel = null;
let isOpen = false;

function ago(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TYPE_ICON = {
  briefing: "home",
  task: "tasks",
  deadline: "alert",
  event: "calendar",
  habit: "check",
  goal: "flag",
  review: "spark",
};

export async function updateBellBadge() {
  const btn = document.getElementById("notif-btn");
  if (!btn) return;
  const n = await notif.unreadCount();
  const dot = btn.querySelector(".dot");
  if (!dot) return;
  dot.style.display = n ? "" : "none";
}

function itemHTML(a) {
  return `
    <div class="bell-item-wrap">
      <div class="bell-clear-bg">Clear ✕</div>
      <button class="bell-item ${a.read ? "" : "unread"}" data-route="${a.route || ""}" data-alert="${a.id}">
        <span class="bell-item-icon">${icon(TYPE_ICON[a.type] || "alert")}</span>
        <span class="bell-item-body">
          <span class="bell-item-title">${a.title}</span>
          ${a.body ? `<span class="bell-item-text">${a.body}</span>` : ""}
          <span class="bell-item-ago">${ago(a.createdAt)}</span>
        </span>
        ${a.read ? "" : '<span class="bell-unread-dot"></span>'}
      </button>
      <button class="bell-clear-btn" data-clear-alert="${a.id}" aria-label="Clear notification">${icon("x")}</button>
    </div>
  `;
}

async function renderPanel() {
  if (!panel) return;
  const [alerts, unread] = await Promise.all([notif.allAlerts(30), notif.unreadCount()]);
  const perm = notif.permissionState();

  panel.innerHTML = `
    <div class="bell-head">
      <div>
        <strong>Notifications</strong>
        <span class="bell-count">${unread ? `${unread} new` : "All caught up"}</span>
      </div>
      <div class="bell-head-actions">
        ${alerts.length ? `<button class="btn btn-ghost btn-sm" id="bell-markread">Mark read</button>
        <button class="btn btn-ghost btn-sm" id="bell-clear">Clear</button>` : ""}
      </div>
    </div>
    ${
      perm === "default"
        ? `<div class="bell-perm">
             <div>Turn on desktop notifications so nothing slips while you're in another tab.</div>
             <button class="btn btn-primary btn-sm" id="bell-enable">Enable notifications</button>
           </div>`
        : ""
    }
    <div class="bell-list">
      ${
        alerts.length
          ? alerts.map(itemHTML).join("")
          : `<div class="bell-empty">Quiet for now.<br /><small>Briefings, reminders and deadline alerts will land here.</small></div>`
      }
    </div>
    ${alerts.length ? `<div class="bell-hint">← Swipe a notification to clear it</div>` : ""}
    <a class="bell-foot" href="#/settings">Notification settings</a>
  `;

  panel.querySelector("#bell-markread")?.addEventListener("click", () => notif.markAllRead());
  panel.querySelector("#bell-clear")?.addEventListener("click", () => notif.clearAlerts());

  panel.querySelector("#bell-enable")?.addEventListener("click", async () => {
    const res = await notif.requestPermission();
    if (res === "granted") {
      await notif.runCheck(); // fire anything already due right now
      renderPanel();
    } else {
      renderPanel();
    }
  });

  panel.querySelectorAll(".bell-item").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.swiped === "1") return; // ignore click right after a swipe
      notif.markAllRead();
      closeBell();
      const route = item.dataset.route;
      if (route) window.location.hash = route;
    });
    attachSwipeToClear(item);
  });

  panel.querySelectorAll("[data-clear-alert]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".bell-item-wrap");
      if (wrap) {
        wrap.style.transition = "opacity 0.2s ease, max-height 0.2s ease";
        wrap.style.opacity = "0";
        wrap.style.maxHeight = "0";
        wrap.style.overflow = "hidden";
      }
      await notif.removeAlert(btn.dataset.clearAlert);
    });
  });

  // ---- swipe-to-clear: drag a notification left to dismiss it ----
  function attachSwipeToClear(item) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    const THRESHOLD = 96;

    item.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      dragging = true;
      item.classList.add("swiping");
    }, { passive: true });

    item.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      // vertical scrolling wins if the gesture is mostly vertical
      if (Math.abs(my) > Math.abs(mx)) {
        dragging = false;
        item.classList.remove("swiping");
        item.style.transform = "";
        return;
      }
      dx = Math.min(0, mx); // left only
      item.style.transform = `translateX(${dx}px)`;
    }, { passive: true });

    const settle = () => {
      if (!dragging) return;
      dragging = false;
      item.classList.remove("swiping");
      if (dx < -THRESHOLD) {
        item.style.transform = "translateX(-110%)";
        item.style.opacity = "0";
        setTimeout(async () => {
          await notif.removeAlert(item.dataset.alert);
        }, 160);
      } else {
        item.style.transform = "";
      }
    };
    item.addEventListener("touchend", settle);
    item.addEventListener("touchcancel", settle);
  }
}

export function closeBell() {
  if (!panel || !isOpen) return;
  isOpen = false;
  panel.classList.remove("open");
}

export function initBellPanel() {
  const btn = document.getElementById("notif-btn");
  if (!btn || panel) return;

  panel = document.createElement("div");
  panel.className = "bell-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notifications");
  document.body.appendChild(panel);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? closeBell() : openBell();
  });

  // click-outside + Esc
  document.addEventListener("click", (e) => {
    if (isOpen && !panel.contains(e.target) && !btn.contains(e.target)) closeBell();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeBell());

  // live updates from the notification service
  document.addEventListener("nexora:alerts-changed", () => {
    updateBellBadge();
    if (isOpen) renderPanel();
  });

  updateBellBadge();
}

export async function openBell() {
  if (!panel) return;
  isOpen = true;
  panel.classList.add("open");
  // Opening the center counts as reading everything — clears the red
  // unread dots so the list doesn't stay flooded.
  await notif.markAllRead();
  await renderPanel();
  position();
}

function position() {
  if (!panel || !isOpen) return;
  const btn = document.getElementById("notif-btn");
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  panel.style.width = `${width}px`;
  panel.style.top = `${r.bottom + 10}px`;
  panel.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
}

window.addEventListener("resize", () => isOpen && position());
