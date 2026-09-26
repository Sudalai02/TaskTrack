// ============================================================
// TASKS — professional filter system.
//
// Top row: due-date chips (Any date · Today · Yesterday · This week
// · This month). Below: Open / Completed / All segmented control,
// then dropdown filters (Project, Status, Priority) and Sort By.
// Everything feeds one pipeline, and pagination works across all
// filter combinations.
// ============================================================

import { icon, priorityLabel, priorityDotClass } from "../dom.js";
import { fmtDue, todayISO, addDays, startOfWeekISO, byDueDate } from "../utils/dates.js";
import { openForm } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";

const PAGE_SIZE = 10;
const ALL_STATUSES = ["Todo", "In Progress", "Blocked", "Overdue", "Completed", "Cancelled"];

// Filter state survives navigation within the session.
const state = {
  dateRange: "all", // all | today | yesterday | week | month
  statusTab: "open", // open | completed | all
  projectId: "all", // all | none | <projectId>
  goalId: "all", // all | none | <goalId>
  status: "all", // all | Todo | In Progress | Blocked | Completed | Cancelled
  priority: "all", // all | Urgent | High | Medium | Low
  sort: "due", // due | priority | created | az | effort
  page: 1,
};

// Due date leads; every other sort falls back to it on ties so equal
// keys never reorder rows into arbitrary document order.
const SORTERS = {
  due: byDueDate,
  priority: (a, b) => b._score - a._score || byDueDate(a, b),
  // descending, but must return 0 on a tie or the dueDate fallback is skipped
  created: (a, b) => {
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    return ca !== cb ? (cb < ca ? -1 : 1) : byDueDate(a, b);
  },
  az: (a, b) => a.title.localeCompare(b.title) || byDueDate(a, b),
  effort: (a, b) => (a.estimatedMinutes || 0) - (b.estimatedMinutes || 0) || byDueDate(a, b),
};

const DATE_CHIPS = [
  { id: "all", label: "Any date" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
];

function dateRangeBounds() {
  const today = todayISO();
  switch (state.dateRange) {
    case "today":
      return [today, today];
    case "yesterday": {
      const y = addDays(today, -1);
      return [y, y];
    }
    case "week": {
      const monday = startOfWeekISO(today);
      return [monday, addDays(monday, 6)];
    }
    case "month": {
      const first = `${today.slice(0, 7)}-01`;
      const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0); // day 0 of next month = last of this
      return [first, `${today.slice(0, 7)}-${String(d.getDate()).padStart(2, "0")}`];
    }
    default:
      return null;
  }
}

function dueClass(t, today) {
  if (t.status === "Completed") return "";
  if (!t.dueDate) return "";
  const d = t.dueDate;
  if (d < today) return "overdue";
  if (d === today) return "today";
  return "";
}

function taskRow(t, today) {
  const done = t.status === "Completed";
  const dClass = dueClass(t, today);
  const prio = t.priority || "Medium";
  const timeRange = t.startTime ? (t.endTime ? `${t.startTime}–${t.endTime}` : t.startTime) : null;
  return `
    <div class="task-row-v2" data-edit="${t.id}" role="button" tabindex="0">
      <button class="check-lg ${done ? "checked" : ""}" data-toggle="${t.id}" aria-label="${done ? "Reopen" : "Complete"} task">
        ${done ? icon("check") : ""}
      </button>
      <span class="priority-dot ${priorityDotClass(t.priority)}"></span>
      <div class="task-row-body">
        <div class="task-row-title ${done ? "done" : ""}">${t.title}</div>
        <div class="task-row-meta">
          ${t.dueDate ? `<span class="task-row-due ${dClass}">${fmtDue(t.dueDate)}</span>` : ""}
          ${timeRange ? `<span class="task-time">${icon("clock")} ${timeRange}</span>` : ""}
          ${t.status === "Blocked" ? `<span class="badge badge-danger">Blocked</span>` : ""}
          ${t.status === "In Progress" ? `<span class="badge badge-focus">In progress</span>` : ""}
        </div>
      </div>
      <div class="task-row-right">
        <span class="task-dur num">${t.estimatedMinutes}m</span>
        <span class="task-prio-badge badge-prio-${prio.toLowerCase()}">${priorityLabel(prio)}</span>
      </div>
    </div>
  `;
}

function paginationHTML(totalPages) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  // windowed page numbers when many pages
  let shown = pages;
  if (totalPages > 9) {
    const p = state.page;
    shown = [...new Set([1, 2, p - 1, p, p + 1, totalPages - 1, totalPages].filter((n) => n >= 1 && n <= totalPages))].sort((a, b) => a - b);
  }
  return `
    <div class="pagination" id="tasks-pagination">
      <button class="page-btn" data-page-nav="prev" ${state.page <= 1 ? "disabled" : ""}>${icon("chevron")}<span class="rot180" style="display:none"></span>Prev</button>
      ${shown
        .map((n, i) =>
          i > 0 && n - shown[i - 1] > 1
            ? `<span class="page-ellipsis">…</span><button class="page-btn num ${n === state.page ? "active" : ""}" data-page-num="${n}">${n}</button>`
            : `<button class="page-btn num ${n === state.page ? "active" : ""}" data-page-num="${n}">${n}</button>`
        )
        .join("")}
      <button class="page-btn" data-page-nav="next" ${state.page >= totalPages ? "disabled" : ""}>Next<span class="nav-icon" style="display:none"></span></button>
    </div>
  `;
}

export async function renderTasks(view, alive = () => true) {
  const [tasks, projects, goals] = await Promise.all([
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;
  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;
  const goalTitleOf = (id) => goals.find((g) => g.id === id)?.title || null;

  function filtered() {
    let list = taskService.decorate(tasks);
    if (state.statusTab === "open") list = list.filter((t) => !["Completed", "Cancelled"].includes(t.status));
    else if (state.statusTab === "completed") list = list.filter((t) => t.status === "Completed");

    if (state.projectId === "none") list = list.filter((t) => !t.projectId);
    else if (state.projectId !== "all") list = list.filter((t) => t.projectId === state.projectId);

    // Goal filter matches direct links AND tasks inside that goal's projects.
    if (state.goalId !== "all") {
      const projectIdsOfGoal = new Set(projects.filter((p) => p.goalId === state.goalId).map((p) => p.id));
      list = list.filter((t) =>
        state.goalId === "none"
          ? !t.goalId && (!t.projectId || !projects.find((p) => p.id === t.projectId)?.goalId)
          : t.goalId === state.goalId || (t.projectId && projectIdsOfGoal.has(t.projectId))
      );
    }

    if (state.status !== "all") {
      if (state.status === "Overdue") {
        const today = todayISO();
        list = list.filter((t) => t.dueDate && t.dueDate < today && !["Completed", "Cancelled"].includes(t.status));
      } else {
        list = list.filter((t) => t.status === state.status);
      }
    }
    if (state.priority !== "all") list = list.filter((t) => t.priority === state.priority);

    const bounds = dateRangeBounds();
    if (bounds) list = list.filter((t) => t.dueDate && t.dueDate >= bounds[0] && t.dueDate <= bounds[1]);

    return [...list].sort(SORTERS[state.sort] || SORTERS.due);
  }

  function draw() {
    const list = filtered();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const pageItems = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const today = todayISO();

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">Tasks</div>
        <div class="page-title-row">
          <h1>Tasks</h1>
          <button class="btn btn-primary btn-sm" id="new-task-btn">${icon("plus")} New task</button>
        </div>
        <div class="sub">Filter, sort, and work through what matters.</div>
      </div>

      <!-- DATE FILTER CHIPS -->
      <div class="date-chip-row">
        <span class="date-chip-label">Due</span>
        ${DATE_CHIPS.map(
          (c) => `<button class="chip ${state.dateRange === c.id ? "active" : ""}" data-range="${c.id}">${c.label}</button>`
        ).join("")}
      </div>

      <div class="task-toolbar">
        <div class="seg-control" id="status-seg">
          <button class="seg-btn ${state.statusTab === "open" ? "active" : ""}" data-status="open">Open</button>
          <button class="seg-btn ${state.statusTab === "completed" ? "active" : ""}" data-status="completed">Completed</button>
          <button class="seg-btn ${state.statusTab === "all" ? "active" : ""}" data-status="all">All</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <label>Project</label>
          <select class="filter-select" id="filter-project">
            <option value="all" ${state.projectId === "all" ? "selected" : ""}>All projects</option>
            ${projects.map((p) => `<option value="${p.id}" ${state.projectId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
            <option value="none" ${state.projectId === "none" ? "selected" : ""}>No project</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Goal</label>
          <select class="filter-select" id="filter-goal">
            <option value="all" ${state.goalId === "all" ? "selected" : ""}>All goals</option>
            ${goals.map((g) => `<option value="${g.id}" ${state.goalId === g.id ? "selected" : ""}>${g.title}</option>`).join("")}
            <option value="none" ${state.goalId === "none" ? "selected" : ""}>No goal</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Status</label>
          <select class="filter-select" id="filter-status">
            <option value="all" ${state.status === "all" ? "selected" : ""}>All statuses</option>
            ${ALL_STATUSES.map((s) => `<option value="${s}" ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Priority</label>
          <select class="filter-select" id="filter-priority">
            <option value="all" ${state.priority === "all" ? "selected" : ""}>All priorities</option>
            ${["Urgent", "High", "Medium", "Low"].map((p) => `<option value="${p}" ${state.priority === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Sort by</label>
          <select class="filter-select" id="sort-by">
            ${[
              ["due", "Due date"],
              ["priority", "Priority score"],
              ["created", "Recently added"],
              ["az", "A → Z"],
              ["effort", "Effort (short first)"],
            ].map(([v, l]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <span class="filter-count">${list.length} task${list.length === 1 ? "" : "s"}</span>
      </div>

      <div class="card card-flush">
        <div class="task-list">
          ${pageItems.length
            ? pageItems.map((t) => taskRow(t, today)).join("")
            : `<div class="empty-state"><h3>Nothing here</h3><p>No tasks match these filters.</p></div>`}
        </div>
      </div>

      ${list.length ? paginationHTML(totalPages) : ""}
    `;

    wire(pageItems);
  }

  function resetPage() {
    state.page = 1;
    draw();
  }

  async function openEditor(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const result = await taskModal(projects, goals, task);
    if (!result) return;
    Object.assign(task, await taskService.updateTask(id, result));
    toast("Task updated");
    draw();
  }

  function wire(pageItems) {
    view.querySelectorAll("[data-range]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.dateRange = btn.dataset.range;
        resetPage();
      })
    );
    view.querySelectorAll("[data-status]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.statusTab = btn.dataset.status;
        resetPage();
      })
    );
    view.querySelector("#filter-project").addEventListener("change", (e) => {
      state.projectId = e.target.value;
      resetPage();
    });
    view.querySelector("#filter-goal").addEventListener("change", (e) => {
      state.goalId = e.target.value;
      resetPage();
    });
    view.querySelector("#filter-status").addEventListener("change", (e) => {
      state.status = e.target.value;
      resetPage();
    });
    view.querySelector("#filter-priority").addEventListener("change", (e) => {
      state.priority = e.target.value;
      resetPage();
    });
    view.querySelector("#sort-by").addEventListener("change", (e) => {
      state.sort = e.target.value;
      resetPage();
    });

    // ---- pagination wiring ----
    const pag = view.querySelector("#tasks-pagination");
    pag?.querySelectorAll("[data-page-num]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.page = Number(btn.dataset.pageNum);
        draw();
      })
    );
    pag?.querySelector('[data-page-nav="prev"]')?.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        draw();
      }
    });
    pag?.querySelector('[data-page-nav="next"]')?.addEventListener("click", () => {
      const total = Math.max(1, Math.ceil(filtered().length / PAGE_SIZE));
      if (state.page < total) {
        state.page += 1;
        draw();
      }
    });

    // ---- complete / reopen ----
    view.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await taskService.toggleComplete(btn.dataset.toggle);
        const idx = tasks.findIndex((t) => t.id === btn.dataset.toggle);
        tasks[idx] = await taskService.getTask(btn.dataset.toggle);
        const t = tasks[idx];
        toast(t.status === "Completed" ? "Task completed" : "Task reopened");
        if (t.goalId) {
          const g = goals.find((x) => x.id === t.goalId);
          if (g) toast(`Goal “${g.title}” progress updated`);
        }
        draw();
      })
    );

    // ---- edit ----
    view.querySelectorAll("[data-edit]").forEach((row) =>
      row.addEventListener("click", () => openEditor(row.dataset.edit))
    );

    // ---- create ----
    view.querySelector("#new-task-btn").addEventListener("click", async () => {
      const result = await taskModal(projects, goals);
      if (!result) return;
      const created = await taskService.createTask(result);
      tasks.push(created);
      toast("Task created");
      resetPage();
    });
  }

  draw();

  const openTaskId = new URLSearchParams(window.location.hash.split("?")[1] || "").get("id");
  if (openTaskId && tasks.find((t) => t.id === openTaskId)) {
    openEditor(openTaskId);
  }
}

// ---------------- task form ----------------

function taskModal(projects, goals, task = null) {
  return openForm({
    title: task ? "Edit task" : "New task",
    eyebrow: "Task",
    extraClass: "wide",
    values: task
      ? {
          title: task.title,
          description: task.description,
          projectId: task.projectId || "",
          goalId: task.goalId || "",
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate || "",
          startTime: task.startTime || "",
          endTime: task.endTime || "",
          estimatedMinutes: task.estimatedMinutes,
        }
      : { priority: "Medium", status: "Todo", estimatedMinutes: 30 },
    fields: [
      { name: "title", label: "Title", required: true, placeholder: "What needs to happen?" },
      { name: "description", label: "Description", type: "textarea", rows: 3, placeholder: "Optional details…" },
      {
        name: "projectId",
        label: "Project",
        type: "select",
        options: [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
      },
      {
        name: "goalId",
        label: "Goal",
        type: "select",
        options: [
          { value: "", label: "No goal" },
          ...goals.filter((g) => g.status !== "Completed").map((g) => ({ value: g.id, label: g.title })),
        ],
        hint: "Completing this task automatically advances the linked goal's progress.",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ALL_STATUSES.map((s) => ({ value: s, label: s })),
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: ["Urgent", "High", "Medium", "Low"].map((p) => ({ value: p, label: p })),
      },
      { name: "dueDate", label: "Due date", type: "date" },
      { name: "startTime", label: "Start time (optional)", type: "time" },
      { name: "endTime", label: "End time (optional)", type: "time" },
      { name: "estimatedMinutes", label: "Estimated duration (minutes)", type: "number", min: 5, max: 600, step: 5 },
    ],
    submitLabel: task ? "Save changes" : "Create task",
  });
}
