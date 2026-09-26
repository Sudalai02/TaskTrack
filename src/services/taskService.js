// ============================================================
// TASKS — CRUD + automatic progress rollup.
//
// Completing/reopening a task instantly recomputes:
//   • its project's progress and status (all tasks done ⇒ project
//     is auto-marked Completed; reopening flips it back to Active)
//   • its goal's progress and status (all projects + directly
//     linked tasks done ⇒ goal auto-marked Completed)
// Every mutation emits "data-changed" so open screens refresh
// immediately.
// ============================================================

import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { computeScore, tierOf } from "../ai/prioritizer.js";
import { byDueDate } from "../utils/dates.js";
import { emit } from "../utils/bus.js";
import * as recycle from "./recycleService.js";

const OPEN = ["Todo", "In Progress", "Blocked"];
const DONE_STATUSES = ["Completed", "Cancelled"];

export async function allTasks() {
  return db.getAll("tasks");
}

export async function getTask(id) {
  return db.get("tasks", id);
}

export function decorate(tasks) {
  // adds computed fields without mutating the store
  return tasks.map((t) => ({ ...t, _score: computeScore(t), _tier: tierOf(t) }));
}

export async function openTasks() {
  const decorated = decorate(await allTasks());
  // byDueDate breaks score ties so the focus picker never lists tasks in
  // arbitrary document order.
  return decorated.filter((t) => OPEN.includes(t.status)).sort((a, b) => b._score - a._score || byDueDate(a, b));
}

export async function createTask(data) {
  const now = new Date().toISOString();
  const task = {
    id: uid("t"),
    title: data.title.trim(),
    description: data.description || "",
    projectId: data.projectId || null,
    goalId: data.goalId || null,
    status: data.status || "Todo",
    priority: data.priority || "Medium",
    estimatedMinutes: Number(data.estimatedMinutes) || 30,
    actualMinutes: null,
    dueDate: data.dueDate || null,
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    tags: [],
    energy: "Medium",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await db.put("tasks", task);
  await syncRollups(task.projectId, task.goalId);
  emit("data-changed", { entity: "tasks" });
  return task;
}

export async function updateTask(id, patch) {
  const task = await db.get("tasks", id);
  if (!task) throw new Error(`Task ${id} not found`);
  const next = { ...task, ...patch, updatedAt: new Date().toISOString() };
  if (patch.status === "Completed" && !task.completedAt) {
    next.completedAt = new Date().toISOString();
    next.actualMinutes = next.actualMinutes ?? next.estimatedMinutes;
  }
  if (patch.status && patch.status !== "Completed") next.completedAt = null;
  await db.put("tasks", next);
  // roll up both the old and new parents (links may have changed)
  await syncRollups(task.projectId, task.goalId);
  await syncRollups(next.projectId, next.goalId);
  emit("data-changed", { entity: "tasks" });
  return next;
}

export async function removeTask(id) {
  const task = await db.get("tasks", id);
  const entry = await recycle.softDelete("tasks", id);
  if (task) {
    await syncRollups(task.projectId, task.goalId);
    emit("data-changed", { entity: "tasks" });
  }
  return entry;
}

export async function toggleComplete(id) {
  const task = await db.get("tasks", id);
  if (!task) return null;
  return updateTask(id, {
    status: task.status === "Completed" ? "Todo" : "Completed",
  });
}

// ---------- progress & completion rollups ----------

async function syncRollups(projectId, goalId) {
  if (projectId) await syncProject(projectId);
  if (goalId) await syncGoal(goalId);
  // an auto-completed project can complete its own goal
  if (projectId && !goalId) {
    const project = await db.get("projects", projectId);
    if (project?.goalId) await syncGoal(project.goalId);
  }
}

// Project status follows its tasks. Cancelled projects are left alone.
export async function syncProject(projectId) {
  const project = await db.get("projects", projectId);
  if (!project || project.status === "Cancelled") return;
  const tasks = (await db.getAll("tasks")).filter((t) => t.projectId === projectId);
  const total = tasks.length;
  const done = tasks.filter((t) => DONE_STATUSES.includes(t.status)).length;
  let status = project.status;
  if (total > 0 && done === total && project.status !== "Completed") status = "Completed";
  else if (done < total && project.status === "Completed") status = "Active";
  if (status !== project.status) await db.put("projects", { ...project, status });
}

// Goal status follows its projects + directly linked tasks.
// Goals with no linked work are never touched.
export async function syncGoal(goalId) {
  const goal = await db.get("goals", goalId);
  if (!goal || goal.status === "On Hold" || goal.status === "Cancelled") return;

  const [tasks, projects] = await Promise.all([db.getAll("tasks"), db.getAll("projects")]);
  const directTasks = tasks.filter((t) => t.goalId === goalId);
  const linkedProjectIds = new Set(projects.filter((p) => p.goalId === goalId).map((p) => p.id));
  const projectTasks = tasks.filter((t) => t.projectId && linkedProjectIds.has(t.projectId));

  const total = directTasks.length + projectTasks.length;
  const done =
    directTasks.filter((t) => DONE_STATUSES.includes(t.status)).length +
    projectTasks.filter((t) => DONE_STATUSES.includes(t.status)).length;

  let status = goal.status;
  if (total > 0 && done === total && goal.status !== "Completed") status = "Completed";
  else if (done < total && goal.status === "Completed") status = "In Progress";

  if (status !== goal.status) await db.put("goals", { ...goal, status });
}
