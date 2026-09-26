// ============================================================
// GOAL PLANNER — the "describe an outcome → review AI plan →
// confirm" flow. Shared by the Goals page and the Assistant.
// Never creates anything without an explicit Confirm.
// ============================================================

import { openForm, openPanel } from "./modal.js";
import { toast } from "./toast.js";
import { icon } from "../dom.js";
import * as aiService from "../ai/aiService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as taskService from "../services/taskService.js";
import { todayISO, addDays } from "../utils/dates.js";

export async function runGoalPlanner() {
  // 1. Ask for the outcome
  const input = await openForm({
    title: "Plan a goal",
    eyebrow: `${icon("spark")} AI planning`,
    fields: [
      { name: "title", label: "What do you want to achieve?", required: true, placeholder: "e.g. Run a half marathon" },
      { name: "description", label: "Why it matters (helps the plan)", type: "textarea", rows: 2 },
      { name: "targetDate", label: "Target date", type: "date" },
      {
        name: "priority", label: "Priority", type: "select",
        options: ["High", "Medium", "Urgent", "Low"].map((v) => ({ value: v, label: v })),
      },
    ],
    values: { priority: "Medium" },
    submitLabel: "Draft my plan",
  });
  if (!input?.title) return null;

  // 2. Draft with the engine (model or heuristics)
  const plan = await aiService.breakDownGoal({
    title: input.title,
    description: input.description,
    targetDate: input.targetDate,
  });

  const allTasks = plan.milestones.flatMap((m) => m.tasks);

  // 3. Reviewable preview — user picks which tasks to create
  const res = await openPanel({
    title: "Review your plan",
    eyebrow:
      plan.engine === "ollama"
        ? `${icon("spark")} Drafted by local AI`
        : `${icon("spark")} Drafted by smart rules`,
    bodyHTML: `
      <div class="plan-goal-line">${input.title}${input.targetDate ? ` <span class="tag">by ${input.targetDate}</span>` : ""}</div>
      ${plan.milestones
        .map(
          (m, i) => `
        <div class="pp-milestone">
          <div class="pp-ms-label"><span class="num">${i + 1}</span> ${m.label}</div>
          ${m.tasks
            .map(
              (t) => `
            <label class="pp-task">
              <input type="checkbox" checked data-pp-task="${escapeAttr(t)}" />
              <span>${t}</span>
            </label>`
            )
            .join("")}
        </div>`
        )
        .join("")}
      <div class="form-hint" style="margin-top:10px;">Confirming creates the goal, one project to hold the work, and the checked tasks. Nothing is created until you confirm.</div>
    `,
    actions: [{ id: "confirm", label: "Create goal + tasks", class: "btn-primary" }],
  });

  if (!res || res.action !== "confirm") return null;
  const chosen = [...res.body.querySelectorAll("[data-pp-task]:checked")].map((c) => c.dataset.ppTask);

  // 4. Apply through services
  const goal = await goalService.createGoal({
    title: input.title,
    description: input.description,
    category: "Personal",
    priority: input.priority || "Medium",
    startDate: todayISO(),
    targetDate: input.targetDate || "",
  });

  const project = await projectService.createProject({
    name: input.title.length > 40 ? input.title.slice(0, 40) + "…" : input.title,
    color: "#C4622D",
    status: "Planning",
    deadline: input.targetDate || "",
    description: `Auto-created workspace for goal “${input.title}”`,
    goalId: goal.id,
  });

  // Spread checked tasks evenly between today and target date
  const horizon = input.targetDate ? Math.max(chosen.length, 7) : Math.max(chosen.length, 14);
  const created = [];
  for (let i = 0; i < chosen.length; i++) {
    const due = addDays(todayISO(), Math.round(((i + 1) / (chosen.length + 1)) * horizon));
    created.push(
      await taskService.createTask({
        title: chosen[i],
        projectId: project.id,
        goalId: goal.id,
        priority: i === 0 ? "High" : "Medium",
        dueDate: due,
        estimatedMinutes: 45,
        notes: "",
      })
    );
  }

  toast(`Goal created — ${created.length} task${created.length === 1 ? "" : "s"} planned`);
  return { goal, project, tasks: created };
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
