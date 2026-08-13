import { z } from "zod";

export const ProjectOriginSchema = z.enum([
  "USER",
  "REAL",
  "TEST",
  "FIXTURE",
  "SYNTHETIC",
  "SMOKE",
  "QA",
  "REVIEW",
  "DEMO",
]);
export type ProjectOrigin = z.infer<typeof ProjectOriginSchema>;

const USER_FACING_PROJECT_ORIGINS = new Set<ProjectOrigin>(["USER", "REAL"]);

export function isUserFacingProjectOrigin(origin: ProjectOrigin) {
  return USER_FACING_PROJECT_ORIGINS.has(origin);
}
