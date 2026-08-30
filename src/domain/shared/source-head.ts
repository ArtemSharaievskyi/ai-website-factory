import { z } from "zod";

export const SourceHeadSchema = z.string().regex(/^[a-f0-9]{40}$/i, "source head must be a full Git commit SHA.");
export type SourceHead = z.infer<typeof SourceHeadSchema>;

export function parseSourceHead(value: unknown): SourceHead {
  return SourceHeadSchema.parse(value).toLowerCase();
}

export function isSourceHead(value: unknown): value is SourceHead {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

export type SourceCurrentness = {
  head: SourceHead;
  trackedWorktreeClean: boolean;
  disallowedPaths?: readonly string[];
};

export type SourceCurrentnessPort = {
  read(): Promise<SourceCurrentness>;
};
