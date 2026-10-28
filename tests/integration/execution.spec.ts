import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import http from "node:http";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import type { ExecutionResult } from "../../packages/runner/src/schema";
function executeFixture(config: unknown): Promise<{ result: ExecutionResult }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/execute-journey.ts"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) reject(new Error("Fixture runner failed"));
      else {
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(JSON.stringify(config));
  });
}
const origin = "http://127.0.0.1:3010";
const post = (page: Page, path: string, data: unknown) =>
  page.request.post(path, { data, headers: { origin } });
test.beforeEach(async ({ page, request }) => {
  await request.get("http://127.0.0.1:4545/test/reset");
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app");
});
async function project(page: Page, mode = "actions") {
  await page.request.get(`http://127.0.0.1:4545/test/github-mode?mode=${mode}`);
  const connection = await post(page, "/api/github", { action: "discover" });
  expect(connection.ok()).toBe(true);
  const repository = (await connection.json()).repositories.find(
    (r: { fullName: string }) => r.fullName === "alice/repo-456",
  );
  const created = await post(page, "/api/workspace", {
    action: "createProject",
    input: {
      name: "Engine fixture",
      url: "https://1.1.1.1",
      description: "",
      repositoryId: repository.id,
    },
  });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).id;
  return id as string;
}
async function journey(page: Page, projectId: string, name = "Heading works") {
  const saved = await post(page, "/api/workspace", {
    action: "saveJourney",
    input: {
      projectId,
      name,
      path: "/",
      condition: "Structured assertion",
      enabled: true,
      definition: {
        version: 1,
        steps: [
          {
            action: "assertText",
            locator: { type: "role", value: "heading" },
            expected: "Fixture dashboard",
            exact: false,
            timeoutMs: 500,
          },
        ],
        timeoutMs: 10000,
        captureArtifacts: false,
      },
    },
  });
  expect(saved.ok()).toBe(true);
  return (await saved.json()).id as string;
}
async function credential(page: Page, id: string) {
  const response = await post(page, "/api/executions", {
    action: "rotate",
    projectId: id,
  });
  expect(response.ok()).toBe(true);
  const token = (await response.json()).credential;
  expect(/^fg_run_[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
  return token as string;
}

test("mock GitHub dispatch and claim persist real local Chromium outcomes and stop polling at completion", async ({
  page,
}, info) => {
  const id = await project(page);
  await page.goto(`/app/projects/${id}`);
  await page
    .getByRole("button", { name: "Run your first check", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom steps", exact: true }).click();
  await page.getByLabel("Journey name").fill("Heading works");
  await page.getByLabel("Expected value").fill("Fixture dashboard");
  await page.screenshot({
    path: `/tmp/flowguard-engine-${info.project.name}-editor.png`,
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await expect(page.locator(".journey-row")).toContainText("Heading works");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const secret = await credential(page, id);
  await page.getByRole("button", { name: "Run a check", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/executions\/[a-f0-9-]+$/);
  const batchId = new URL(page.url()).pathname.split("/").at(-1)!;
  const claim = await page.request.post("/api/runner/claim", {
    data: { batchId, repositoryId: 456, githubRunId: 555 },
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(claim.status()).toBe(200);
  const claimed = await claim.json();
  const runId = claimed.runs[0].runId as string;
  const scoped = claimed.token as string;
  expect(
    (
      await page.request.post("/api/runner/results", {
        data: {},
        headers: { origin },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/runner/start", {
        data: { batchId, runId },
        headers: { Authorization: `Bearer fg_exec_${"x".repeat(43)}` },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/runner/start", {
        data: { batchId, runId },
        headers: { Authorization: `Bearer ${scoped}` },
      })
    ).status(),
  ).toBe(200);
  // HTTP/Auth/GitHub are fixtures. The browser assertion below really executes;
  // only its network target is replaced by the deterministic local test server.
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<!doctype html><html><body><h1>Fixture dashboard</h1></body></html>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let output: { result: ExecutionResult };
  try {
    output = await executeFixture({
      ...claimed.runs[0],
      targetUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(output.result.status).toBe("passed");
  const body = { batchId, runId, result: output.result };
  const completed = await page.request.post("/api/runner/results", {
    data: body,
    headers: { Authorization: `Bearer ${scoped}` },
  });
  expect(completed.status()).toBe(200);
  const replay = await page.request.post("/api/runner/results", {
    data: body,
    headers: { Authorization: `Bearer ${scoped}` },
  });
  expect((await replay.json()).duplicate).toBe(true);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".run-result-banner")).toContainText("Passed");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  let polls = 0;
  page.on("request", (req) => {
    if (
      req.method() === "GET" &&
      req.url().includes(`/api/executions/${batchId}`)
    )
      polls++;
  });
  await page.waitForTimeout(5500);
  expect(polls).toBe(0);
  await page.getByRole("link", { name: "Heading works", exact: true }).click();
  await expect(page).toHaveURL(`/app/runs/${runId}`);
  await expect(
    page.getByRole("heading", { name: "Open starting path", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".run-result-banner")).toContainText("Passed");
  await page.reload();
  await expect(page.locator(".run-result-banner")).toContainText("Passed");
});
test("missing Actions permission is actionable and dispatch errors are terminal", async ({
  page,
}) => {
  const id = await project(page, "installed");
  await journey(page, id);
  await credential(page, id);
  const setup = await page.request.get(`/api/executions?projectId=${id}`);
  expect((await setup.json()).message).toContain("Actions: write");
  await page.request.get(
    "http://127.0.0.1:4545/test/github-mode?mode=actions-dispatch-failed",
  );
  const dispatch = await post(page, "/api/executions", {
    action: "run",
    projectId: id,
    requestId: crypto.randomUUID(),
  });
  expect(dispatch.status()).toBe(503);
  await page.goto("/app/runs");
  await expect(page.locator(".status-error").first()).toContainText(
    "Execution error",
  );
});
test("workflow completion without callbacks reconciles to error and invalid claims never start runs", async ({
  page,
}) => {
  const id = await project(page);
  await journey(page, id);
  const secret = await credential(page, id);
  const queued = await post(page, "/api/executions", {
    action: "run",
    projectId: id,
    requestId: crypto.randomUUID(),
  });
  expect(queued.ok()).toBe(true);
  const batchId = (await queued.json()).id;
  const spoof = await page.request.post("/api/runner/claim", {
    data: { batchId, repositoryId: 999, githubRunId: 555 },
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(spoof.status()).toBe(403);
  await page.request.get(
    "http://127.0.0.1:4545/test/github-mode?mode=actions-completed",
  );
  const response = await page.request.get(`/api/executions/${batchId}`);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.status).toBe("error");
  expect(result.runs[0].failureCategory).toBe("INFRASTRUCTURE_ERROR");
  await page.goto(`/app/executions/${batchId}`);
  await expect(page.locator(".run-result-banner")).toContainText(
    "Execution error",
  );
});

test("editing preserves exact URL assertions and validates reordered steps before saving", async ({
  page,
}) => {
  const id = await project(page);
  const created = await post(page, "/api/workspace", {
    action: "saveJourney",
    input: {
      projectId: id,
      name: "Navigation check",
      path: "/",
      condition: "Structured navigation",
      enabled: true,
      definition: {
        version: 1,
        steps: [
          { action: "navigate", path: "/next", timeoutMs: 500 },
          {
            action: "assertURL",
            expected: "/next",
            match: "equals",
            timeoutMs: 500,
          },
        ],
        timeoutMs: 10000,
        captureArtifacts: false,
      },
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto(`/app/projects/${id}`);
  await page
    .getByRole("button", { name: "Edit Navigation check", exact: true })
    .click();
  await expect(page.getByLabel("Exact match", { exact: true })).toBeChecked();
  await page
    .getByRole("button", { name: "Move step 2 up", exact: true })
    .click();
  await expect(
    page.locator("fieldset").first().getByLabel("Action", { exact: true }),
  ).toHaveValue("assertURL");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await (await page.request.get("/api/workspace")).json())
    .workspace.journeys[0].definition;
  expect(saved.steps[0].action).toBe("assertURL");
  expect(saved.steps[0].match).toBe("equals");
  await page
    .getByRole("button", { name: "Edit Navigation check", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove step 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Add at least one positive assertion",
  );
  await page
    .getByLabel("Navigation path", { exact: true })
    .fill("https://169.254.169.254/");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Navigation must stay on the approved project origin",
  );
});

test("real assertion failure can be investigated and verified without changing its immutable result", async ({
  page,
}, info) => {
  const id = await project(page),
    journeyId = await journey(page, id),
    secret = await credential(page, id);
  let heading = "Checkout unavailable";
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><body><h1>${heading}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  async function execute(batchId: string) {
    const response = await page.request.post("/api/runner/claim", {
      data: { batchId, repositoryId: 456, githubRunId: 555 },
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(response.status()).toBe(200);
    const claimed = await response.json(),
      runId = claimed.runs[0].runId;
    expect(
      (
        await page.request.post("/api/runner/start", {
          data: { batchId, runId },
          headers: { Authorization: `Bearer ${claimed.token}` },
        })
      ).ok(),
    ).toBe(true);
    const out = await executeFixture({
      ...claimed.runs[0],
      targetUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    });
    expect(
      (
        await page.request.post("/api/runner/results", {
          data: { batchId, runId, result: out.result },
          headers: { Authorization: `Bearer ${claimed.token}` },
        })
      ).ok(),
    ).toBe(true);
    return { id: runId, result: out.result };
  }
  try {
    const queued = await post(page, "/api/executions", {
      action: "run",
      projectId: id,
      requestId: crypto.randomUUID(),
    });
    expect(queued.ok()).toBe(true);
    const failure = await execute((await queued.json()).id);
    expect(failure.result.status).toBe("failed");
    expect(failure.result.failureCategory).toBe("APPLICATION_FAILURE");
    await page.goto(`/app/runs/${failure.id}`);
    await expect(
      page.getByRole("button", { name: "Copy fix prompt", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Analyze failure", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Failure investigation" }),
    ).toContainText("Checkout unavailable");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/flowguard-investigation-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByText("More investigation actions", { exact: true }).click();
    await page
      .getByRole("button", { name: "Preview prompt", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Preserve security");
    const download = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Download Markdown", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/fix.md$/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    const reportResponse = await page.request.get(
      `/api/runs/${failure.id}/report`,
    );
    expect(reportResponse.status()).toBe(200);
    expect(reportResponse.headers()["x-request-id"]).toBeTruthy();
    const before = await reportResponse.json();
    expect(before.prompt).toContain("Checkout unavailable");
    writeFileSync(
      `/tmp/flowguard-investigation-${info.project.name}-metrics.json`,
      JSON.stringify({
        reportTiming: before.timing,
        reportBytes: Buffer.byteLength(JSON.stringify(before)),
        browserLogs: failure.result.logs,
      }),
    );
    await info.attach("investigation-metrics", {
      body: JSON.stringify({
        viewport: info.project.name,
        reportTiming: before.timing,
        reportBytes: Buffer.byteLength(JSON.stringify(before)),
        browserLogs: failure.result.logs,
      }),
      contentType: "application/json",
    });
    const unknown = "99999999-9999-4999-8999-999999999999";
    expect(
      (await page.request.get(`/api/runs/${unknown}/report`)).status(),
    ).toBe(404);
    expect(
      (
        await post(page, `/api/runs/${failure.id}/analysis`, {
          reviewedHash: before.ai.evidenceHash,
        })
      ).status(),
    ).toBe(503);
    const issue = await post(page, `/api/runs/${failure.id}/issue`, {
      action: "check",
    });
    expect(issue.status()).toBe(200);
    expect((await issue.json()).available).toBe(false);
    // Change current editor state. Verification must still execute the saved snapshot.
    const edit = await post(page, "/api/workspace", {
      action: "saveJourney",
      id: journeyId,
      input: {
        projectId: id,
        name: "Edited heading",
        path: "/",
        condition: "Changed test",
        enabled: true,
        definition: {
          version: 1,
          steps: [
            {
              action: "assertText",
              locator: { type: "role", value: "heading" },
              expected: "Different expectation",
              exact: false,
              timeoutMs: 500,
            },
          ],
          timeoutMs: 10000,
          captureArtifacts: false,
        },
      },
    });
    expect(edit.ok()).toBe(true);
    heading = "Fixture dashboard";
    await page.getByRole("button", { name: "Verify fix", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Heading works");
    await page
      .getByRole("button", { name: "Run saved check", exact: true })
      .click();
    await expect(page).toHaveURL(/app\/executions\/[a-f0-9-]+$/);
    const fixed = await execute(
      new URL(page.url()).pathname.split("/").at(-1)!,
    );
    expect(fixed.result.status).toBe("passed");
    const after = await (
      await page.request.get(`/api/runs/${failure.id}/report`)
    ).json();
    expect(after.run.status).toBe("failed");
    expect(
      after.comparison.verifications.find(
        (r: { id: string }) => r.id === fixed.id,
      ).verdict,
      JSON.stringify(after.comparison.verifications),
    ).toBe("resolved");
    await page.goto(`/app/runs/${failure.id}`);
    await page
      .getByRole("button", { name: "Compare runs", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Regression resolved");
    const notifications = await (
      await page.request.get("/api/notifications")
    ).json();
    expect(
      notifications.events.some(
        (e: { kind: string }) => e.kind === "regression_resolved",
      ),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("first check needs no test code and guides the one-time connection without a dead run button", async ({
  page,
}, info) => {
  const id = await project(page, "actions-no-workflow");
  await page.goto(`/app/projects/${id}`);
  await expect(
    page.getByRole("heading", { name: "Start with one page" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent executions" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Latest run" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Run your first check", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "FLOWGUARD_RUNNER_TOKEN",
  );
  await expect(page.getByRole("radio", { name: /Page loads/ })).toBeChecked();
  await expect(page.getByRole("button", { name: /Run 0/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/flowguard-first-check-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your runner", exact: true }),
  ).toBeVisible();
  const editor = new URL(
    (await page
      .getByRole("link", { name: "Open prepared file in GitHub" })
      .getAttribute("href"))!,
  );
  expect(editor.searchParams.get("value")).toContain(
    'FLOWGUARD_URL: "http://127.0.0.1:3010"',
  );
  expect(editor.searchParams.get("value")).not.toContain("vars.FLOWGUARD_");
  expect(editor.searchParams.get("value")).not.toContain("fg_run_");
  const state = (await (await page.request.get("/api/workspace")).json())
    .workspace;
  expect(state.journeys).toHaveLength(1);
  expect(state.journeys[0].name).toBe("Homepage loads");
  expect(state.runs).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `/tmp/flowguard-connect-runner-${info.project.name}.png`,
    fullPage: true,
  });
  // A real installation change is represented by the fixture, never by UI acknowledgement.
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add the runner to your repository" }),
  ).toBeVisible();
  await page.request.get("http://127.0.0.1:4545/test/github-mode?mode=actions");
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate connection key", exact: true })
    .click();
  await expect(page.getByLabel("Connection key — shown once")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(
    page.getByRole("button", { name: "Run check", exact: true }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "I’ve saved the key", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run check", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run check", exact: true }).click();
  await expect(page).toHaveURL(/app\/executions\/[a-f0-9-]+$/);
  const after = await (await page.request.get("/api/workspace")).json();
  expect(after.workspace.journeys).toHaveLength(1);
  expect(after.workspace.runs[0].status).toBe("queued");
});

test("text checks validate expectations and ready projects select at most five checks", async ({
  page,
}) => {
  const id = await project(page);
  await credential(page, id);
  await page.goto(`/app/projects/${id}`);
  await page
    .getByRole("button", { name: "Run your first check", exact: true })
    .click();
  await page.getByRole("radio", { name: /Text is visible/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Enter text",
  );
  await page.getByLabel("Text that should be visible").fill("Welcome back");
  await page.getByLabel("Page to check").fill("https://foreign.example/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "this project's website",
  );
  await page.getByLabel("Page to check").fill("/account");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run check", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  for (let i = 0; i < 6; i++) await journey(page, id, `Saved check ${i + 1}`);
  await page.reload();
  await page.getByRole("button", { name: "Run a check", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run 5 checks", exact: true }),
  ).toBeEnabled();
  const boxes = page.getByRole("dialog").getByRole("checkbox");
  await expect(boxes).toHaveCount(7);
  await expect(boxes.nth(5)).toBeDisabled();
  await boxes.first().uncheck();
  await expect(boxes.nth(5)).toBeEnabled();
  await boxes.nth(5).check();
  await page.getByRole("button", { name: "Run 5 checks", exact: true }).click();
  await expect(page).toHaveURL(/app\/executions\/[a-f0-9-]+$/);
});
