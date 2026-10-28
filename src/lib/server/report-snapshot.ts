import "server-only";
import { createHash } from "node:crypto";
import { journeyDefinitionSchema } from "../../../packages/runner/src/schema";
import { safeText, safeUrl } from "../investigation/evidence";
import type { Run } from "../model";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function inputLiterals(raw: unknown): string[] {
  const parsed = journeyDefinitionSchema.safeParse(
    (raw as { definition?: unknown })?.definition,
  );
  if (!parsed.success) return [];
  return parsed.data.steps.flatMap((s) =>
    s.action === "fill" && "text" in s.value
      ? [s.value.text]
      : s.action === "selectOption"
        ? [s.value]
        : [],
  );
}
export function attachSnapshot(run: Run, raw: unknown, repository: string) {
  const config = raw as {
    definition?: unknown;
    startPath?: string;
    targetUrl?: string;
  } | null;
  const definition = journeyDefinitionSchema.safeParse(config?.definition);
  if (
    definition.success &&
    typeof config?.startPath === "string" &&
    typeof config.targetUrl === "string"
  ) {
    const { captureArtifacts: _capture, ...behavior } = definition.data;
    void _capture;
    run.snapshot = {
      fingerprint: digest({
        definition: behavior,
        startPath: config.startPath,
      }),
      environmentKey: digest(new URL(config.targetUrl).href),
      target: safeUrl(config.targetUrl),
      repository,
      protectedInputs: definition.data.steps.some(
        (s) => s.action === "fill" && "secret" in s.value,
      ),
      version: definition.data.version,
      stepCount: definition.data.steps.length,
    };
  }
  return run;
}
export function sanitizeRun(run: Run, raw: unknown) {
  const inputs = inputLiterals(raw);
  const clean = (s: string) => safeText(s, inputs);
  return {
    ...run,
    journeyName: clean(run.journeyName),
    environment: safeUrl(run.environment),
    error: run.error ? clean(run.error) : run.error,
    steps: run.steps
      .slice(0, 31)
      .map((s) => ({ ...s, name: clean(s.name), detail: clean(s.detail) })),
    logs: run.logs.slice(0, 50).map(clean),
    assertion: run.assertion
      ? {
          ...run.assertion,
          expected: clean(run.assertion.expected),
          received: clean(run.assertion.received),
          locator: clean(run.assertion.locator),
        }
      : undefined,
  };
}
