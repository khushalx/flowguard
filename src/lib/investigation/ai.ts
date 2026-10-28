import { z } from "zod";
import { classify, safeText } from "./evidence";
import type { Run } from "../model";
export const analysisSchema = z.object({
  summary: z.string(),
  hypotheses: z.array(
    z.object({
      cause: z.string(),
      evidenceIds: z.array(z.string()),
      investigation: z.string(),
    }),
  ),
  verification: z.array(z.string()),
});
export type Analysis = z.infer<typeof analysisSchema>;
export function analysisEvidence(run: Run) {
  const failed = run.steps.findIndex((s) => s.status === "failed");
  // Allowlist, not a dump of run/configuration: no input values, source, screenshots,
  // trace archives, selectors, URLs, identifiers, account data or arbitrary log lines.
  return [
    { id: "status", text: `Recorded ${run.status}; category ${classify(run)}` },
    {
      id: "step",
      text:
        failed < 0
          ? "No failed browser step recorded"
          : `Browser step ${failed + 1} failed; action ${run.steps[failed].name
              .split(/[ ·:]/)[0]
              .replace(/[^a-zA-Z]/g, "")
              .slice(0, 40)}`,
    },
    {
      id: "expected",
      text: safeText(run.assertion?.expected || "Not recorded", [], 600),
    },
    {
      id: "observed",
      text: safeText(
        run.assertion?.received || run.error || "Not recorded",
        [],
        1200,
      ),
    },
    {
      id: "coverage",
      text: `${run.steps.filter((s) => s.status === "passed").length} passed steps; ${run.steps.filter((s) => s.status === "skipped").length} skipped; browser ${safeText(run.browser, [], 40)}`,
    },
    ...run.logs
      .filter((s) => /^HTTP [45]\d{2} from |^Network request failed:/.test(s))
      .slice(0, 5)
      .map((s, i) => ({ id: `network${i + 1}`, text: safeText(s, [], 200) })),
  ];
}
export function validateAnalysis(
  raw: unknown,
  evidence: ReturnType<typeof analysisEvidence>,
): Analysis {
  const parsed = analysisSchema.parse(raw),
    ids = new Set(evidence.map((e) => e.id));
  if (
    parsed.summary.length > 1500 ||
    parsed.hypotheses.length > 4 ||
    parsed.verification.length > 6 ||
    parsed.hypotheses.some(
      (h) =>
        !h.evidenceIds.length ||
        h.evidenceIds.some((id) => !ids.has(id)) ||
        h.cause.length > 1000 ||
        h.investigation.length > 1000,
    )
  )
    throw new Error("Invalid grounded analysis");
  return {
    summary: safeText(parsed.summary),
    hypotheses: parsed.hypotheses.map((h) => ({
      ...h,
      cause: safeText(h.cause),
      investigation: safeText(h.investigation),
    })),
    verification: parsed.verification.map((s) => safeText(s, [], 600)),
  };
}
export function aiConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const model = env.FLOWGUARD_AI_MODEL || "gpt-5.4-mini";
  const inputPrice = Number(
    env.FLOWGUARD_AI_INPUT_USD_PER_MILLION ??
      (model === "gpt-5.4-mini" ? "0.75" : "NaN"),
  );
  const outputPrice = Number(
    env.FLOWGUARD_AI_OUTPUT_USD_PER_MILLION ??
      (model === "gpt-5.4-mini" ? "4.5" : "NaN"),
  );
  const enabled =
    !!env.OPENAI_API_KEY &&
    Number.isFinite(inputPrice) &&
    inputPrice > 0 &&
    Number.isFinite(outputPrice) &&
    outputPrice > 0 &&
    /^[a-zA-Z0-9._:-]{1,100}$/.test(model);
  return { enabled, model, inputPrice, outputPrice, maxOutput: 1200 };
}
