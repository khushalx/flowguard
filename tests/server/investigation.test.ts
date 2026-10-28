import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  classify,
  explain,
  fixPrompt,
  safeText,
  compareHistory,
  comparable,
  failureSignature,
  verification,
} from "../../src/lib/investigation/evidence";
import {
  aiConfiguration,
  analysisEvidence,
  validateAnalysis,
} from "../../src/lib/investigation/ai";
import {
  attachSnapshot,
  sanitizeRun,
  digest,
} from "../../src/lib/server/report-snapshot";
import { scrubEvent, telemetryEvent } from "../../src/lib/monitoring";
import type { Run, Project } from "../../src/lib/model";
const project: Project = {
  id: "p",
  name: "Checkout",
  url: "https://shop.example.com",
  repository: "alice/shop",
  description: "",
  createdAt: new Date().toISOString(),
};
const config = {
  name: "Checkout",
  targetUrl: project.url,
  startPath: "/",
  definition: {
    version: 1,
    steps: [
      {
        action: "assertText",
        locator: { type: "role", value: "heading" },
        expected: "Confirmed",
        exact: true,
        timeoutMs: 1000,
      },
    ],
    timeoutMs: 10000,
    captureArtifacts: false,
  },
};
function run(patch: Partial<Run> = {}): Run {
  return attachSnapshot(
    {
      id: randomUUID(),
      number: 1,
      projectId: "p",
      journeyId: "j",
      journeyName: "Checkout",
      status: "failed",
      startedAt: "2026-10-28T08:00:00.000Z",
      duration: 1000,
      branch: "main",
      commit: "b".repeat(40),
      commitMessage: "",
      environment: project.url,
      browser: "Chromium",
      steps: [
        {
          name: "Open starting path",
          detail: "/",
          duration: 1,
          status: "passed",
        },
        {
          name: "assertText · role: heading",
          detail: "Expected Confirmed",
          duration: 999,
          status: "failed",
        },
      ],
      logs: ["HTTP 503 from https://shop.example.com"],
      failureCategory: "APPLICATION_FAILURE",
      error: "Assertion mismatch",
      assertion: {
        expected: "Confirmed",
        received: "Pending",
        locator: "role: heading",
        timeout: 1000,
      },
      ...patch,
    },
    config,
    "alice/shop",
  );
}
for (const [name, patch, category] of [
  ["failed assertion", {}, "assertion"],
  [
    "selector error",
    { failureCategory: "SELECTOR_FAILURE", assertion: undefined },
    "selector",
  ],
  [
    "network error",
    {
      failureCategory: "INFRASTRUCTURE_ERROR",
      error: "net::ERR_CONNECTION_REFUSED",
      assertion: undefined,
    },
    "network",
  ],
  ["timeout", { status: "timed_out", failureCategory: "TIMEOUT" }, "timeout"],
  [
    "configuration",
    {
      status: "error",
      failureCategory: "CONFIGURATION_ERROR",
      assertion: undefined,
    },
    "configuration",
  ],
  [
    "infrastructure",
    {
      status: "error",
      failureCategory: "INFRASTRUCTURE_ERROR",
      assertion: undefined,
    },
    "infrastructure",
  ],
  [
    "interruption",
    { status: "cancelled", failureCategory: "CANCELLED" },
    "cancelled",
  ],
] as const)
  test(`${name} produces an evidence-based fix prompt`, () => {
    const r = run(patch);
    const prompt = fixPrompt(r, project)!;
    assert.equal(classify(r), category);
    assert.ok(prompt.includes(`Category: ${category}`));
    assert.ok(prompt.includes("Preserve security"));
    assert.ok(prompt.includes("Reproduce the failure"));
    assert.ok(!prompt.includes("root cause is"));
  });
test("missing evidence is explicit, including legacy snapshots", () => {
  const r = run({ steps: [], logs: [], assertion: undefined });
  delete r.snapshot;
  assert.equal(explain(r).missing.length, 4);
  assert.match(fixPrompt(r, project)!, /No logs were recorded/);
});
test("passing, queued and unknown runs offer no fix prompt", () => {
  for (const status of ["passed", "queued", "running", "unknown"] as const)
    assert.equal(fixPrompt(run({ status }), project), null);
});
test("redaction removes headers, credentials, test inputs, tokens, email and URL paths", () => {
  const raw =
    "Bearer tokenvalue\nCookie: session=private\npassword: private\nhttps://user:pass@example.com/token/private?key=value#secret\nsk-proj-fixturesecret\nghp_fixturesecret\nalice@example.com";
  const clean = safeText(raw);
  for (const secret of [
    "tokenvalue",
    "session=private",
    "user:pass",
    "/token/private",
    "key=value",
    "fixturesecret",
    "alice@example.com",
  ])
    assert.ok(!clean.includes(secret), secret);
  const r = run({ error: "echo secretLiteral", logs: ["secretLiteral"] });
  const c = {
    ...config,
    definition: {
      ...config.definition,
      steps: [
        {
          action: "fill",
          locator: { type: "label", value: "Email" },
          value: { text: "secretLiteral" },
          timeoutMs: 500,
        },
        ...config.definition.steps,
      ],
    },
  };
  assert.ok(!JSON.stringify(sanitizeRun(r, c)).includes("secretLiteral"));
});
test("large logs are bounded and never smuggled into AI evidence", () => {
  const r = run({
    logs: Array.from({ length: 1000 }, () => "x".repeat(100000)),
  });
  assert.ok(fixPrompt(r, project)!.length < 16000);
  assert.ok(JSON.stringify(analysisEvidence(r)).length < 4000);
});
test("fingerprints include behavior and inputs but exclude artifact opt-in and key ordering", () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  const a = run(),
    b = attachSnapshot(
      run(),
      {
        ...config,
        definition: { ...config.definition, captureArtifacts: true },
      },
      "alice/shop",
    );
  assert.ok(comparable(a, b).equal);
  attachSnapshot(b, { ...config, startPath: "/changed" }, "alice/shop");
  assert.ok(!comparable(a, b).equal);
});
test("last passing comparison uses matching immutable versions, not a changed check", () => {
  const failure = run();
  const old = run({
    id: "old",
    status: "passed",
    startedAt: "2026-10-28T06:00:00.000Z",
    duration: 500,
    commit: "a".repeat(40),
    steps: failure.steps.map((s) => ({ ...s, status: "passed" })),
    assertion: undefined,
  });
  const changed = run({
    id: "changed",
    status: "passed",
    startedAt: "2026-10-28T07:00:00.000Z",
  });
  changed.snapshot!.fingerprint = "different";
  const result = compareHistory(failure, [old, changed]);
  assert.equal(result.passing?.id, "old");
  assert.equal(result.firstFailure?.id, failure.id);
  assert.equal(result.durationDelta, 500);
  assert.match(result.commitUrl!, /compare\/a+\.\.\.b+/);
  assert.ok(compareHistory(failure, [changed]).warning.includes("definition"));
});
test("changed target, browser, branch, repository and missing snapshots are inconclusive", () => {
  const a = run();
  for (const patch of [
    { browser: "Firefox" },
    { branch: "preview" },
    { snapshot: undefined },
    { snapshot: { ...a.snapshot!, environmentKey: "changed" } },
    { snapshot: { ...a.snapshot!, repository: "other/repo" } },
  ]) {
    const b = run(patch);
    if ("snapshot" in patch) b.snapshot = patch.snapshot;
    assert.ok(!comparable(a, b).equal);
  }
});
test("fix verification resolves only the identical failed positive assertion", () => {
  const original = run();
  const fixed = run({
    status: "passed",
    verificationOf: original.id,
    steps: original.steps.map((s) => ({ ...s, status: "passed" })),
    failureCategory: null,
    error: null,
  });
  assert.equal(verification(original, fixed).status, "resolved");
  for (const status of ["cancelled", "error", "timed_out", "running"] as const)
    assert.equal(
      verification(original, { ...fixed, status }).status,
      "inconclusive",
    );
  assert.equal(
    verification(original, { ...fixed, steps: fixed.steps.slice(1) }).status,
    "inconclusive",
  );
  assert.equal(
    verification(original, { ...fixed, verificationOf: undefined }).status,
    "inconclusive",
  );
  assert.equal(
    verification(
      run({ failureCategory: "INFRASTRUCTURE_ERROR", assertion: undefined }),
      fixed,
    ).status,
    "inconclusive",
  );
});
test("failure grouping requires matching specific evidence and is independently inspectable", () => {
  const a = run(),
    b = run({ id: "repeat", startedAt: "2026-10-28T09:00:00.000Z" });
  assert.equal(failureSignature(a), failureSignature(b));
  const result = compareHistory(a, [b]);
  assert.equal(result.group?.count, 2);
  assert.equal(failureSignature(run({ steps: [] })), null);
  const other = run();
  other.assertion!.expected = "Other";
  assert.notEqual(failureSignature(a), failureSignature(other));
});
test("AI is disabled without a server key and nondefault pricing must be explicit", () => {
  assert.equal(aiConfiguration({}).enabled, false);
  assert.equal(
    aiConfiguration({ OPENAI_API_KEY: "fixture", FLOWGUARD_AI_MODEL: "other" })
      .enabled,
    false,
  );
  assert.equal(aiConfiguration({ OPENAI_API_KEY: "fixture" }).enabled, true);
});
test("AI structured results must cite real evidence IDs and remain bounded", () => {
  const evidence = analysisEvidence(run());
  assert.throws(() =>
    validateAnalysis(
      {
        summary: "Guess",
        hypotheses: [
          { cause: "Cause", evidenceIds: ["invented"], investigation: "Check" },
        ],
        verification: [],
      },
      evidence,
    ),
  );
  assert.throws(() => validateAnalysis(null, evidence));
  const valid = validateAnalysis(
    {
      summary: "Hypothesis",
      hypotheses: [
        {
          cause: "Could be unavailable",
          evidenceIds: ["observed"],
          investigation: "Reproduce",
        },
      ],
      verification: ["Rerun"],
    },
    evidence,
  );
  assert.equal(valid.hypotheses.length, 1);
});
test("platform telemetry is an allowlist and discards private exception data", () => {
  const id = randomUUID();
  const dirty = {
    ...telemetryEvent("database_failure", id, 503, 12),
    exception: { values: [{ value: "token private" }] },
    request: { headers: { authorization: "private" } },
    user: { email: "secret@example.com" },
    breadcrumbs: ["private"],
    tags: { request_id: id, sql: "private" },
  };
  const clean = JSON.stringify(scrubEvent(dirty));
  assert.ok(!clean.includes("private"));
  assert.ok(!clean.includes("email"));
  assert.ok(clean.includes(id));
});

test("protected credential rotation is not assumed comparable", () => {
  const a = run(),
    b = run();
  b.snapshot!.protectedInputs = true;
  assert.equal(comparable(a, b).equal, false);
  assert.match(comparable(a, b).reason, /credential/);
});

test("equivalent canonical URLs remain comparable", () => {
  const a = run();
  const b = attachSnapshot(
    run(),
    { ...config, targetUrl: config.targetUrl + "/" },
    "alice/shop",
  );
  assert.equal(comparable(a, b).equal, true);
});

test("truncated private keys and numeric observations stay safe", () => {
  assert.equal(
    safeText("-----BEGIN RSA PRIVATE KEY-----\nprivate-body-without-footer"),
    "[REDACTED KEY]",
  );
  const r = run();
  r.assertion!.received = "Expected: 2\nReceived: 1";
  assert.equal(explain(r).observed, "1");
});

test("infrastructure failures with partial assertion payloads cannot resolve regressions", () => {
  const original = run({
    status: "error",
    failureCategory: "INFRASTRUCTURE_ERROR",
  });
  const next = run({
    status: "passed",
    verificationOf: original.id,
    steps: original.steps.map((s) => ({ ...s, status: "passed" })),
  });
  assert.equal(classify(original), "infrastructure");
  assert.equal(verification(original, next).status, "inconclusive");
});
