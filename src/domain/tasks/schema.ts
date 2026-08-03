import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, ProjectVersionSchema, UuidSchema } from "../shared/schemas";

export const TaskRoleSchema = z.enum(["lead", "planner-architect", "design", "implementation", "qa-release"]);
export const TaskStatusSchema = z.enum(["pending", "blocked", "ready", "running", "passed", "failed", "cancelled"]);
export const AgentTaskSchema = z.object({ id: UuidSchema, projectId: UuidSchema, projectVersion: ProjectVersionSchema, role: TaskRoleSchema, taskType: NonEmptyStringSchema, title: NonEmptyStringSchema, objective: NonEmptyStringSchema, inputs: z.array(NonEmptyStringSchema), expectedOutputs: z.array(NonEmptyStringSchema), allowedSkills: z.array(NonEmptyStringSchema), allowedTools: z.array(NonEmptyStringSchema), fileScopes: z.array(NonEmptyStringSchema), dependencies: z.array(UuidSchema), status: TaskStatusSchema, attempt: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), createdAt: IsoDateTimeSchema, startedAt: IsoDateTimeSchema.optional(), completedAt: IsoDateTimeSchema.optional(), safeFailureCode: z.string().regex(/^[A-Z0-9_]+$/).optional() }).strict().superRefine((task, context) => {
  if (task.status === "running" && !task.startedAt) context.addIssue({ code: "custom", path: ["startedAt"], message: "Running tasks require startedAt" });
  if (["passed", "failed", "cancelled"].includes(task.status) && !task.completedAt) context.addIssue({ code: "custom", path: ["completedAt"], message: "Completed tasks require completedAt" });
  if (task.attempt > task.maxAttempts) context.addIssue({ code: "custom", path: ["attempt"], message: "Attempt exceeds maxAttempts" });
});
export const TaskGraphSchema = DocumentBaseSchema.extend({ documentType: z.literal("task-graph"), tasks: z.array(AgentTaskSchema) }).strict().superRefine((graph, context) => {
  const ids = new Set<string>();
  const taskIds = new Set(graph.tasks.map((task) => task.id));
  for (const task of graph.tasks) {
    if (ids.has(task.id)) context.addIssue({ code: "custom", path: ["tasks"], message: "Task IDs must be unique" });
    ids.add(task.id);
    if (task.dependencies.includes(task.id)) context.addIssue({ code: "custom", path: ["tasks"], message: "Task cannot depend on itself" });
    for (const dependency of task.dependencies) if (!taskIds.has(dependency)) context.addIssue({ code: "custom", path: ["tasks"], message: "Task dependency does not exist" });
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const task = graph.tasks.find((candidate) => candidate.id === id); const cycle = task?.dependencies.some(visit) ?? false; visiting.delete(id); visited.add(id); return cycle; };
  if (graph.tasks.some((task) => visit(task.id))) context.addIssue({ code: "custom", path: ["tasks"], message: "Task graph contains a dependency cycle" });
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
