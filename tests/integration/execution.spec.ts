import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import http from "node:http";
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
async function journey(page: Page, projectId: string) {
  const saved = await post(page, "/api/workspace", {
    action: "saveJourney",
    input: {
      projectId,
      name: "Heading works",
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
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
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
  const secret = await credential(page, id);
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run 1 journey", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Run 1 journey", exact: true })
    .click();
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
