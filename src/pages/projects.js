// ============================================================
// PROJECTS — paginated list with Status / Linked goal / Sort By
// filters, plus per-project task filters (Priority, Status, Sort)
// inside the detail view.
// ============================================================

import { icon, fmtDate, priorityDotClass } from "../dom.js";
import { byDueDate } from "../utils/dates.js";
import { openForm, confirm } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import * as taskService from "../services/taskService.js";

const STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
const PIPELINE = ["Planning", "Active", "On Hold", "Completed"];
const PAGE_SIZE = 9;
const TASK_PAGE_SIZE = 8;

const listState = {
  status: "all",
  goalId: "all", // all | none | <goalId>
  sort: "manual", // manual (goal-grouped) | name | progress | deadline | newest
  page: 1,
};

const detailState = {
  priority: "all",
  status: "all",
  sort: "due",
  page: 1,
};

function slug(s) {
  return s.toLowerCase().replace(/\s+/g, "");
}

function statusBadge(status) {
  const map = {
    Planning: "neutral",
    Active: "focus",
    "On Hold": "warn",
    Completed: "good",
    Cancelled: "danger",
  };
  return `<span class="badge badge-${map[status] || "neutral"}">${status}</span>`;
}

function pipelineHTML(status) {
  const idx = PIPELINE.indexOf(status);
  if (status === "Cancelled") {
    return `<div class="pipeline">${PIPELINE.map((s) => `<div class="pipeline-step c-${slug(s)}"></div>`).join("")}<div class="pipeline-step c-cancelled done"></div></div>`;
  }
  return `<div class="pipeline">${PIPELINE.map((s, i) => `<div class="pipeline-step c-${slug(s)} ${i <= idx ? "done" : ""}"></div>`).join("")}</div>`;
}

function projectModal(goals, p = null) {
  return openForm({
    title: p ? "Edit project" : "New project",
    eyebrow: "Project",
    extraClass: "wide",
    values: p
      ? { name: p.name, description: p.description, goalId: p.goalId || "", status: p.status, deadline: p.deadline || "", color: p.color }
      : { status: "Planning", color: "#0F7A4F" },
    fields: [
      { name: "name", label: "Project name", required: true, placeholder: "e.g. Mobile app v1" },
      { name: "description", label: "Description", type: "textarea", rows: 2 },
      {
        name: "goalId",
        label: "Linked goal",
        type: "select",
        options: [{ value: "", label: "No goal (standalone)" }, ...goals.map((g) => ({ value: g.id, label: g.title }))],
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: STATUSES.map((s) => ({ value: s, label: s })),
      },
      { name: "deadline", label: "Deadline", type: "date" },
      {
        name: "color",
        label: "Folder color",
        type: "select",
        options: [
          { value: "#0F7A4F", label: "Green" },
          { value: "#2F6FB5", label: "Blue" },
          { value: "#B0521F", label: "Ember" },
          { value: "#966507", label: "Amber" },
          { value: "#B03A5B", label: "Rose" },
        ],
      },
    ],
  });
}

export async function renderProjects(view, alive = () => true) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const detailId = params.get("id");

  const [projects, tasks, goals] = await Promise.all([
    projectService.allProjects(),
    taskService.allTasks(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;
  const prog = projectService.progressMap(projects, tasks);

  // ================= DETAIL VIEW =================
  if (detailId && projects.find((p) => p.id === detailId)) {
    renderDetail(view, alive, { projects, tasks, goals, prog, detailId });
    return;
  }

  // ================= LIST VIEW =================
  function card(p) {
    const m = prog[p.id];
    const pctVal = m.pct ?? 0;
    const goal = goals.find((g) => g.id === p.goalId);
    const goalTruncated = goal ? goal.title.length > 30 ? goal.title.slice(0, 30) + "…" : goal.title : null;
    return `
      <div class="card project-card" data-open="${p.id}">
        <div class="project-card-color" style="background:${p.color};"></div>
        <div class="project-card-top">
          <div class="project-card-name-wrap">
            <div class="project-name">${p.name}</div>
            ${goalTruncated ? `<div class="project-goal-link">${icon("goals")} ${goalTruncated}</div>` : `<div class="project-goal-link">No linked goal</div>`}
          </div>
          <div class="project-card-top-right">
            ${statusBadge(p.status)}
            <button class="icon-btn project-card-menu" data-menu="${p.id}" aria-label="Project actions">${icon("dots")}</button>
          </div>
        </div>
        ${pipelineHTML(p.status)}
        <div class="project-progress-row-v2">
          <div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:${pctVal}%"></div></div>
          <span class="project-progress-pct-inline num">${m.pct == null ? "—" : `${pctVal}%`}</span>
        </div>
        <div class="project-card-footer">
          <span>${m.done}/${m.total} tasks</span>
          <span>${p.deadline ? `Due ${fmtDate(p.deadline)}` : "No deadline"}</span>
        </div>
      </div>
    `;
  }

  function filteredSorted() {
    let list = [...projects];
    if (listState.status !== "all") list = list.filter((p) => p.status === listState.status);
    if (listState.goalId === "none") list = list.filter((p) => !p.goalId);
    else if (listState.goalId !== "all") list = list.filter((p) => p.goalId === listState.goalId);

    switch (listState.sort) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "progress":
        list.sort((a, b) => ((prog[b.id]?.pct ?? -1) - (prog[a.id]?.pct ?? -1)));
        break;
      case "deadline":
        list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
        break;
      case "newest":
        list.sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
        break;
      default:
        break; // manual = grouped-by-goal order below
    }
    return list;
  }

  function groupsHTML(list) {
    if (!projects.length) {
      return `<div class="empty-state"><h3>No projects yet</h3><p>Create your first project to organize work.</p></div>`;
    }
    if (listState.sort === "manual") {
      const linked = list.filter((p) => p.goalId);
      const standalone = list.filter((p) => !p.goalId);
      let html = "";
      const seenGoals = new Set();
      for (const p of linked) {
        if (seenGoals.has(p.goalId)) continue;
        seenGoals.add(p.goalId);
        const goal = goals.find((g) => g.id === p.goalId);
        html += `<div class="project-group-head">${icon("goals")} ${goal?.title || "Goal"}</div>
                 <div class="project-grid">${linked.filter((x) => x.goalId === p.goalId).map(card).join("")}</div>`;
      }
      if (standalone.length) {
        html += `<div class="project-group-head">${icon("projects")} Standalone projects</div>
                 <div class="project-grid">${standalone.map(card).join("")}</div>`;
      }
      return html;
    }
    return `<div class="project-grid">${list.map(card).join("")}</div>`;
  }

  function draw() {
    const filtered = filteredSorted();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    listState.page = Math.min(listState.page, totalPages);
    const pageItems = filtered.slice((listState.page - 1) * PAGE_SIZE, listState.page * PAGE_SIZE);

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${projects.length} projects</div>
        <div class="page-title-row">
          <h1>Projects</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-project-btn">${icon("plus")} New project</button>
        </div>
        <div class="sub">Everything you're actively building — progress is real, computed from your tasks.</div>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <label>Status</label>
          <select class="filter-select" id="proj-filter-status">
            <option value="all" ${listState.status === "all" ? "selected" : ""}>All statuses</option>
            ${STATUSES.map((s) => `<option value="${s}" ${listState.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Linked goal</label>
          <select class="filter-select" id="proj-filter-goal">
            <option value="all" ${listState.goalId === "all" ? "selected" : ""}>All goals</option>
            ${goals.map((g) => `<option value="${g.id}" ${listState.goalId === g.id ? "selected" : ""}>${g.title}</option>`).join("")}
            <option value="none" ${listState.goalId === "none" ? "selected" : ""}>Standalone only</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Sort by</label>
          <select class="filter-select" id="proj-sort">
            ${[
              ["manual", "Grouped by goal"],
              ["name", "Name A → Z"],
              ["progress", "Progress (high first)"],
              ["deadline", "Deadline"],
              ["newest", "Newest first"],
            ].map(([v, l]) => `<option value="${v}" ${listState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <span class="filter-count">${filtered.length} project${filtered.length === 1 ? "" : "s"}</span>
      </div>

      ${groupsHTML(pageItems)}

      ${
        filtered.length > PAGE_SIZE
          ? `
      <div class="pagination">
        <button class="page-btn" id="pp-prev" ${listState.page <= 1 ? "disabled" : ""}>Prev</button>
        <span class="page-info num">Page ${listState.page} of ${totalPages}</span>
        <button class="page-btn" id="pp-next" ${listState.page >= totalPages ? "disabled" : ""}>Next</button>
      </div>`
          : ""
      }

      <button class="btn btn-primary btn-block only-mobile" id="new-project-btn-m" style="margin-top: var(--sp-5);">${icon("plus")} New project</button>
      <div class="menu-pop" id="proj-menu"></div>
    `;

    wire(filtered);
  }

  function wire() {
    view.querySelector("#proj-filter-status").addEventListener("change", (e) => {
      listState.status = e.target.value;
      listState.page = 1;
      draw();
    });
    view.querySelector("#proj-filter-goal").addEventListener("change", (e) => {
      listState.goalId = e.target.value;
      listState.page = 1;
      draw();
    });
    view.querySelector("#proj-sort").addEventListener("change", (e) => {
      listState.sort = e.target.value;
      listState.page = 1;
      draw();
    });

    view.querySelector("#pp-prev")?.addEventListener("click", () => {
      if (listState.page > 1) {
        listState.page -= 1;
        draw();
      }
    });
    view.querySelector("#pp-next")?.addEventListener("click", () => {
      listState.page += 1;
      draw();
    });

    view.querySelector("#new-project-btn")?.addEventListener("click", createFlow);
    view.querySelector("#new-project-btn-m")?.addEventListener("click", createFlow);

    view.querySelectorAll("[data-open]").forEach((cardEl) =>
      cardEl.addEventListener("click", () => {
        window.location.hash = `#/projects?id=${cardEl.dataset.open}`;
      })
    );

    view.querySelectorAll("[data-menu]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenu(btn.dataset.menu, e.clientX, e.clientY);
      })
    );

    function openMenu(id, x, y) {
      const menu = view.querySelector("#proj-menu");
      const p = projects.find((x2) => x2.id === id);
      menu.innerHTML = `
        <button class="menu-item" data-edit>${icon("settings")} Edit</button>
        <button class="menu-item" data-complete>${icon("check")} Mark completed</button>
        <button class="menu-item danger" data-delete>${icon("x")} Delete</button>
      `;
      menu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
      menu.style.top = `${y + 8}px`;
      menu.classList.add("open");

      const closeMenu = () => menu.classList.remove("open");
      document.addEventListener("click", closeMenu, { once: true });

      menu.querySelector("[data-edit]").addEventListener("click", async () => {
        closeMenu();
        const result = await projectModal(goals, p);
        if (!result) return;
        Object.assign(p, await projectService.updateProject(p.id, result));
        toast("Project updated");
        draw();
      });
      menu.querySelector("[data-complete]").addEventListener("click", async () => {
        closeMenu();
        Object.assign(p, await projectService.updateProject(p.id, { status: "Completed" }));
        toast("Project completed");
        draw();
      });
      menu.querySelector("[data-delete]").addEventListener("click", async () => {
        closeMenu();
        const ok = await confirm({
          title: "Delete project?",
          message: `“${p.name}” moves to the Recycle Bin and is kept for 15 days. Its tasks stay exactly where they are — restoring brings everything back.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await projectService.removeProject(p.id);
        projects.splice(projects.indexOf(p), 1);
        toast("Moved to Recycle Bin");
        draw();
      });
    }
  }

  async function createFlow() {
    const result = await projectModal(goals);
    if (!result) return;
    const created = await projectService.createProject(result);
    projects.push(created);
    toast("Project created");
    draw();
  }

  draw();
}

// ================= PROJECT DETAIL =================

async function renderDetail(view, alive, ctx) {
  const { projects, tasks, goals, prog, detailId } = ctx;
  const p = projects.find((x) => x.id === detailId);

  // reset detail filters when opening a different project
  if (detailState.projectId !== detailId) {
    detailState.projectId = detailId;
    detailState.priority = "all";
    detailState.status = "all";
    detailState.sort = "due";
    detailState.page = 1;
  }

  function filteredTasks() {
    let list = taskService.decorate(tasks.filter((t) => t.projectId === p.id));
    if (detailState.priority !== "all") list = list.filter((t) => t.priority === detailState.priority);
    if (detailState.status !== "all") list = list.filter((t) => t.status === detailState.status);
    switch (detailState.sort) {
      case "due":
        list.sort(byDueDate);
        break;
      case "az":
        list.sort((a, b) => a.title.localeCompare(b.title) || byDueDate(a, b));
        break;
      case "created":
        list.sort((a, b) => {
          const ca = a.createdAt || "";
          const cb = b.createdAt || "";
          return ca !== cb ? (cb < ca ? -1 : 1) : byDueDate(a, b);
        });
        break;
      default:
        list.sort((a, b) => b._score - a._score || byDueDate(a, b));
    }
    return list;
  }

  function draw() {
    const goal = goals.find((g) => g.id === p.goalId);
    const all = taskService.decorate(tasks.filter((t) => t.projectId === p.id));
    const open = all.filter((t) => !["Completed", "Cancelled"].includes(t.status)).length;
    const m = prog[p.id];
    const pct = m.pct === null ? "—" : `${m.pct}%`;

    const filtered = filteredTasks();
    const totalPages = Math.max(1, Math.ceil(filtered.length / TASK_PAGE_SIZE));
    detailState.page = Math.min(detailState.page, totalPages);
    const pageItems = filtered.slice((detailState.page - 1) * TASK_PAGE_SIZE, detailState.page * TASK_PAGE_SIZE);

    view.innerHTML = `
      <a href="#/projects" class="back-link">${icon("chevron")} All projects</a>
      <div class="page-header">
        <div class="eyebrow">Project</div>
        <div class="page-title-row">
          <h1>${p.name}</h1>
          ${statusBadge(p.status)}
          <button class="btn btn-secondary btn-sm" id="edit-project-btn">Edit</button>
        </div>
        <div class="sub">${p.description || "No description."}</div>
      </div>

      <div style="margin-bottom: var(--sp-5);">${pipelineHTML(p.status)}</div>

      <div class="detail-stats">
        <div class="stat-box"><div class="stat-value num">${pct}</div><div class="stat-label">${m.done}/${m.total} tasks</div></div>
        <div class="stat-box"><div class="stat-value num">${open}</div><div class="stat-label">Open tasks</div></div>
        <div class="stat-box"><div class="stat-value num">${p.deadline ? fmtDate(p.deadline) : "—"}</div><div class="stat-label">Deadline</div></div>
        <div class="stat-box"><div class="stat-value num" style="font-size:14px;">${goal ? goal.title.slice(0, 22) : "None"}</div><div class="stat-label">Linked goal</div></div>
      </div>

      <div class="section-head">
        <h2>Tasks</h2>
        <button class="btn btn-secondary btn-sm" id="add-task-btn">${icon("plus")} Add task</button>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <label>Priority</label>
          <select class="filter-select" id="dt-filter-priority">
            <option value="all" ${detailState.priority === "all" ? "selected" : ""}>All priorities</option>
            ${["Urgent", "High", "Medium", "Low"].map((x) => `<option value="${x}" ${detailState.priority === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Status</label>
          <select class="filter-select" id="dt-filter-status">
            <option value="all" ${detailState.status === "all" ? "selected" : ""}>All statuses</option>
            ${["Todo", "In Progress", "Blocked", "Completed", "Cancelled"].map((s) => `<option value="${s}" ${detailState.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Sort by</label>
          <select class="filter-select" id="dt-sort">
            ${[
              ["due", "Due date"],
              ["priority", "Priority score"],
              ["created", "Recently added"],
              ["az", "A → Z"],
            ].map(([v, l]) => `<option value="${v}" ${detailState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <span class="filter-count">${filtered.length} task${filtered.length === 1 ? "" : "s"}</span>
      </div>

      <div class="card card-flush">
        <div class="task-list">
          ${pageItems.length
            ? pageItems
                .map(
                  (t) => `
            <div class="task-row">
              <button class="check ${t.status === "Completed" ? "checked" : ""}" data-toggle="${t.id}">
                ${t.status === "Completed" ? icon("check") : ""}
              </button>
              <span class="priority-dot ${priorityDotClass(t.priority)}"></span>
              <div class="task-row-body">
                <div class="task-row-title ${t.status === "Completed" ? "done" : ""}">${t.title}</div>
                <div class="task-row-meta">
                  ${t.dueDate ? `<span class="task-row-due">${fmtDate(t.dueDate)}</span>` : ""}
                  ${t.status === "In Progress" ? `<span class="badge badge-focus">In progress</span>` : ""}
                </div>
              </div>
              <span class="badge badge-neutral">${t.priority}</span>
              <span class="num" style="font-size:12px;color:var(--graphite-dim);">${t.estimatedMinutes}m</span>
            </div>`
                )
                .join("")
            : `<div class="empty-state"><h3>No tasks match</h3><p>Add the first task or adjust filters.</p></div>`}
        </div>
      </div>

      ${filtered.length > TASK_PAGE_SIZE ? paginationHTML(totalPages) : ""}
    `;

    wire();
  }

  function paginationHTML(totalPages) {
    return `
      <div class="pagination">
        <button class="page-btn" id="dtp-prev" ${detailState.page <= 1 ? "disabled" : ""}>Prev</button>
        <span class="page-info num">Page ${detailState.page} of ${totalPages}</span>
        <button class="page-btn" id="dtp-next" ${detailState.page >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;
  }

  function wire() {
    view.querySelector("#edit-project-btn").addEventListener("click", async () => {
      const result = await projectModal(goals, p);
      if (!result) return;
      Object.assign(p, await projectService.updateProject(p.id, result));
      toast("Project updated");
      draw();
    });

    view.querySelector("#dt-filter-priority").addEventListener("change", (e) => {
      detailState.priority = e.target.value;
      detailState.page = 1;
      draw();
    });
    view.querySelector("#dt-filter-status").addEventListener("change", (e) => {
      detailState.status = e.target.value;
      detailState.page = 1;
      draw();
    });
    view.querySelector("#dt-sort").addEventListener("change", (e) => {
      detailState.sort = e.target.value;
      detailState.page = 1;
      draw();
    });

    view.querySelector("#dtp-prev")?.addEventListener("click", () => {
      if (detailState.page > 1) {
        detailState.page -= 1;
        draw();
      }
    });
    view.querySelector("#dtp-next")?.addEventListener("click", () => {
      detailState.page += 1;
      draw();
    });

    view.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await taskService.toggleComplete(btn.dataset.toggle);
        const idx = tasks.findIndex((t) => t.id === btn.dataset.toggle);
        tasks[idx] = await taskService.getTask(btn.dataset.toggle);
        toast("Updated");
        renderDetail(view, alive, ctx); // recompute progress + goal sync
      })
    );

    view.querySelector("#add-task-btn").addEventListener("click", async () => {
      const result = await openForm({
        title: "New task",
        eyebrow: `In ${p.name}`,
        values: { priority: "Medium", estimatedMinutes: 30 },
        fields: [
          { name: "title", label: "Title", required: true },
          {
            name: "priority",
            label: "Priority",
            type: "select",
            options: ["Urgent", "High", "Medium", "Low"].map((v) => ({ value: v, label: v })),
          },
          { name: "dueDate", label: "Due date", type: "date" },
          { name: "startTime", label: "Start time (optional)", type: "time" },
          { name: "endTime", label: "End time (optional)", type: "time" },
          { name: "estimatedMinutes", label: "Estimated minutes", type: "number", min: 5, step: 5 },
        ],
      });
      if (!result) return;
      await taskService.createTask({ ...result, projectId: p.id });
      toast("Task added");
      renderProjects(view, alive);
    });
  }

  draw();
}
