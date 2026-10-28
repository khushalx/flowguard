import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const timeout = z.number().int().min(500).max(15_000);
export const locatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("role"),
      value: z.enum([
        "button",
        "link",
        "heading",
        "textbox",
        "checkbox",
        "radio",
        "combobox",
        "option",
        "dialog",
        "alert",
        "status",
        "tab",
        "menuitem",
        "img",
      ]),
      name: text.optional(),
    })
    .strict(),
  ...(["label", "placeholder", "testId", "text", "css"] as const).map((type) =>
    z.object({ type: z.literal(type), value: text }).strict(),
  ),
]);
export type LocatorDefinition = z.infer<typeof locatorSchema>;
const base = { timeoutMs: timeout.default(5_000) };
const locator = { ...base, locator: locatorSchema };
export const valueSchema = z.union([
  z.object({ text: z.string().max(2000) }).strict(),
  z
    .object({
      secret: z
        .string()
        .regex(
          /^FG_TEST_[A-Z0-9_]{1,64}$/,
          "Use an FG_TEST_ runner secret reference.",
        ),
    })
    .strict(),
]);
export const testStepSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("navigate"), path: text }).strict(),
  z.object({ ...locator, action: z.literal("click") }).strict(),
  z
    .object({ ...locator, action: z.literal("fill"), value: valueSchema })
    .strict(),
  z
    .object({
      ...locator,
      action: z.literal("press"),
      key: z
        .string()
        .regex(
          /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:Enter|Tab|Escape|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace|Delete|[a-zA-Z0-9])$/,
        ),
    })
    .strict(),
  z
    .object({ ...locator, action: z.literal("selectOption"), value: text })
    .strict(),
  z.object({ ...locator, action: z.literal("assertVisible") }).strict(),
  z
    .object({
      ...locator,
      action: z.literal("assertText"),
      expected: text,
      exact: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("assertURL"),
      expected: text,
      match: z.enum(["contains", "equals"]).default("contains"),
    })
    .strict(),
  z
    .object({
      ...locator,
      action: z.literal("assertElementCount"),
      count: z.number().int().min(0).max(1000),
    })
    .strict(),
]);
export type TestStep = z.infer<typeof testStepSchema>;
export const journeyDefinitionSchema = z
  .object({
    version: z.literal(1),
    steps: z.array(testStepSchema).min(1).max(30),
    timeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
    captureArtifacts: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.steps.some(
        (s) =>
          s.action.startsWith("assert") &&
          (s.action !== "assertElementCount" || s.count > 0),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Add at least one positive assertion before running this journey.",
        path: ["steps"],
      });
  });
export type JourneyDefinition = z.infer<typeof journeyDefinitionSchema>;
export const failureCategorySchema = z.enum([
  "APPLICATION_FAILURE",
  "SELECTOR_FAILURE",
  "CONFIGURATION_ERROR",
  "INFRASTRUCTURE_ERROR",
  "TIMEOUT",
  "CANCELLED",
]);
export const terminalStatusSchema = z.enum([
  "passed",
  "failed",
  "error",
  "timed_out",
  "cancelled",
]);
export const executionStatusSchema = z.enum([
  "queued",
  "running",
  ...terminalStatusSchema.options,
]);
export const resultStepSchema = z.object({
  name: z.string().max(600),
  detail: z.string().max(2000),
  status: z.enum(["passed", "failed", "skipped"]),
  startedAt: z.string().datetime(),
  duration: z.number().int().min(0).max(150_000),
});
export const executionResultSchema = z
  .object({
    status: terminalStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    duration: z.number().int().min(0).max(180_000),
    failureCategory: failureCategorySchema.nullable(),
    error: z.string().max(4000).nullable(),
    steps: z.array(resultStepSchema).max(31),
    logs: z.array(z.string().max(1000)).max(50),
    assertion: z
      .object({
        expected: z.string().max(1000),
        received: z.string().max(1000),
        locator: z.string().max(600),
        timeout: z.number().int().min(0).max(15_000),
      })
      .optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.status === "passed" &&
      (r.failureCategory ||
        r.error ||
        !r.steps.length ||
        r.steps.some((s) => s.status !== "passed"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Passing results require completed steps without errors.",
      });
    if (r.status !== "passed" && !r.failureCategory)
      ctx.addIssue({
        code: "custom",
        message: "A failure category is required.",
      });
  });
export type ExecutionResult = z.infer<typeof executionResultSchema>;
export const runConfigurationSchema = z
  .object({
    runId: z.string().uuid(),
    name: text,
    targetUrl: z.string().url(),
    startPath: text,
    definition: journeyDefinitionSchema,
  })
  .strict();
export type RunConfiguration = z.infer<typeof runConfigurationSchema>;
