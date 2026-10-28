import { z } from "zod";
import { journeyDefinitionSchema } from "../../packages/runner/src/schema";

export const statusSchema = z.enum([
  "passed",
  "failed",
  "running",
  "unknown",
  "queued",
  "error",
  "timed_out",
  "cancelled",
]);
export type RunStatus = z.infer<typeof statusSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  url: z.string().url().refine(validTarget, "Use an HTTP or HTTPS URL."),
  repository: z.string().max(160),
  repositoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(240),
  createdAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof projectSchema>;

export const journeySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(100),
  path: z
    .string()
    .min(1)
    .max(500)
    .refine(validPath, "Use a start path or HTTP(S) URL."),
  condition: z.string().min(1).max(500),
  definition: journeyDefinitionSchema.optional(),
  enabled: z.boolean().optional(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Journey = z.infer<typeof journeySchema>;

export const stepSchema = z.object({
  name: z.string(),
  detail: z.string(),
  status: z.enum(["passed", "failed", "running", "skipped"]),
  duration: z.number().nullable(),
});
export type Step = z.infer<typeof stepSchema>;

export const runSchema = z.object({
  id: z.string(),
  number: z.number(),
  projectId: z.string(),
  journeyId: z.string(),
  journeyName: z.string(),
  status: statusSchema,
  startedAt: z.string().datetime({ offset: true }),
  duration: z.number().nullable(),
  branch: z.string(),
  commit: z.string(),
  commitMessage: z.string(),
  environment: z.string(),
  browser: z.string(),
  steps: z.array(stepSchema),
  logs: z.array(z.string()),
  assertion: z
    .object({
      expected: z.string(),
      received: z.string(),
      locator: z.string(),
      timeout: z.number(),
    })
    .optional(),
  screenshot: z.string().optional(),
  batchId: z.string().uuid().optional(),
  failureCategory: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  githubUrl: z.string().url().optional(),
  analysisAvailable: z.boolean().optional(),
  verificationOf: z.string().uuid().optional(),
  snapshot: z
    .object({
      fingerprint: z.string(),
      environmentKey: z.string(),
      target: z.string(),
      protectedInputs: z.boolean().optional(),
      repository: z.string(),
      stepCount: z.number(),
      version: z.number(),
    })
    .optional(),
});
export type Run = z.infer<typeof runSchema>;

export const workspaceSchema = z.object({
  projects: z.array(projectSchema),
  journeys: z.array(journeySchema),
  runs: z.array(runSchema),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const storageSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["demo", "local"]),
  demo: workspaceSchema,
  local: workspaceSchema,
});
export type Storage = z.infer<typeof storageSchema>;

export function latestRun(runs: Run[], projectId: string, journeyId?: string) {
  return runs
    .filter(
      (r) =>
        r.projectId === projectId && (!journeyId || r.journeyId === journeyId),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}

export function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function relativeTime(date: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function duration(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function validTarget(value: string) {
  try {
    const url = new URL(value);
    const domain =
      url.hostname === "localhost" ||
      url.hostname.startsWith("[") ||
      (url.hostname.includes(".") &&
        url.hostname
          .split(".")
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
          ));
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !!url.hostname &&
      !/[\s\\\u0000-\u001f]/.test(value) &&
      domain
    );
  } catch {
    return false;
  }
}

export function validPath(value: string) {
  return (
    (value.startsWith("/") &&
      !value.startsWith("//") &&
      !/[\\\s\u0000-\u001f]/.test(value)) ||
    validTarget(value)
  );
}
