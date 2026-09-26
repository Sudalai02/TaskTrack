import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import * as recycle from "./recycleService.js";
import { emit } from "../utils/bus.js";

const DONE = ["Completed", "Cancelled"];

export async function allProjects() {
  return db.getAll("projects");
}

export function progressMap(projects, tasks) {
  const map = {};
  for (const p of projects) {
    map[p.id] = { done: 0, total: 0, pct: 0 };
  }
  for (const t of tasks) {
    if (t.projectId && map[t.projectId]) {
      map[t.projectId].total += 1;
      if (DONE.includes(t.status)) map[t.projectId].done += 1;
    }
  }
  for (const p of projects) {
    const m = map[p.id];
    m.pct = m.total ? Math.round((m.done / m.total) * 100) : null; // null = no tasks yet
  }
  return map;
}

export async function createProject(data) {
  const project = {
    id: uid("p"),
    name: data.name.trim(),
    description: data.description || "",
    goalId: data.goalId || null,
    status: data.status || "Planning",
    deadline: data.deadline || null,
    color: data.color || "#3D5A80",
    createdAt: new Date().toISOString(),
  };
  await db.put("projects", project);
  emit("data-changed", { entity: "projects" });
  return project;
}

export async function updateProject(id, patch) {
  const project = await db.get("projects", id);
  if (!project) throw new Error(`Project ${id} not found`);
  const next = { ...project, ...patch };
  await db.put("projects", next);
  emit("data-changed", { entity: "projects" });
  return next;
}

// Deleting a project keeps its tasks untouched so restoring the
// project brings every relationship back exactly as it was.
export async function removeProject(id) {
  const entry = await recycle.softDelete("projects", id);
  emit("data-changed", { entity: "projects" });
  return entry;
}
