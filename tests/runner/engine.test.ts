import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, stat, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeJourney, redact } from "../../packages/runner/src/engine";
import { approvedUrl, publicAddress } from "../../packages/runner/src/network";
import {
  journeyDefinitionSchema,
  type TestStep,
} from "../../packages/runner/src/schema";
import { unzipSync, strFromU8 } from "fflate";
import { pageCheck } from "../../src/lib/check-presets";

let server: http.Server, target: string, directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "flowguard-engine-"));
  server = http.createServer((req, res) => {
    if (req.url === "/unavailable") {
      res.writeHead(503, { "Content-Type": "text/html" });
      res.end("<html><body>Service unavailable</body></html>");
      return;
    }
    if (req.url === "/redirect-private") {
      res.writeHead(302, {
        location: "http://169.254.169.254/latest/meta-data/",
      });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html><body><h1>Fixture dashboard</h1><label>Email<input id="email"></label><label>Password<input type="password"></label><button id="submit">Sign in</button><button id="broken">Broken checkout</button><select aria-label="Plan"><option value="free">Free</option><option value="team">Team</option></select><p role="status">Not signed in</p><a href="/other">Navigation</a><script>document.querySelector('#submit').onclick=()=>document.querySelector('[role=status]').textContent='Welcome '+document.querySelector('#email').value;document.querySelector('#broken').onclick=()=>document.querySelector('[role=status]').textContent='Checkout unavailable';</script></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const role = (value: "heading" | "button" | "status", name?: string) => ({
  type: "role" as const,
  value,
  ...(name ? { name } : {}),
});
const step = (
  s: Omit<Extract<TestStep, { action: "assertVisible" }>, "timeoutMs">,
) => ({ ...s, timeoutMs: 500 });
function config(steps: unknown[], captureArtifacts = false) {
  return {
    runId: randomUUID(),
    name: "Fixture journey",
    targetUrl: target,
    startPath: "/",
    definition: { version: 1, steps, timeoutMs: 10_000, captureArtifacts },
  };
}
const fixtureOptions = () => ({
  allowPrivateForFixture: true,
  artifactDirectory: directory,
});

test("the no-code page preset runs real Chromium and never passes an HTTP error page", async () => {
  for (const [path, status] of [
    ["/", "passed"],
    ["/unavailable", "error"],
  ] as const) {
    const check = pageCheck(target, path);
    const { result } = await executeJourney(
      { ...config(check.definition.steps), startPath: check.path },
      fixtureOptions(),
    );
    if (status === "passed") assert.equal(result.status, "passed");
    else {
      assert.notEqual(result.status, "passed");
      assert.match(result.error || "", /503/);
    }
  }
});

test("real Chromium navigation and positive heading assertion pass", async () => {
  const { result } = await executeJourney(
    config([
      step({
        action: "assertVisible",
        locator: role("heading", "Fixture dashboard"),
      }),
    ]),
    fixtureOptions(),
  );
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.failureCategory, null);
  assert.equal(result.steps.length, 2);
});
test("fill, click, select, press, URL, text and count use actual browser outcomes", async () => {
  const { result } = await executeJourney(
    config([
      {
        action: "fill",
        locator: { type: "label", value: "Email" },
        value: { text: "developer@example.com" },
        timeoutMs: 500,
      },
      {
        action: "selectOption",
        locator: { type: "label", value: "Plan" },
        value: "team",
        timeoutMs: 500,
      },
      {
        action: "press",
        locator: { type: "label", value: "Email" },
        key: "Tab",
        timeoutMs: 500,
      },
      { action: "click", locator: role("button", "Sign in"), timeoutMs: 500 },
      {
        action: "assertText",
        locator: role("status"),
        expected: "Welcome developer@example.com",
        exact: true,
        timeoutMs: 500,
      },
      {
        action: "assertElementCount",
        locator: role("button"),
        count: 2,
        timeoutMs: 500,
      },
      { action: "navigate", path: "/other", timeoutMs: 500 },
      {
        action: "assertURL",
        expected: "/other",
        match: "contains",
        timeoutMs: 500,
      },
    ]),
    fixtureOptions(),
  );
  assert.equal(result.status, "passed", JSON.stringify(result));
});
test("missing element fails with actual assertion, screenshot and sanitized trace", async () => {
  const out = await executeJourney(
    config(
      [
        {
          action: "assertVisible",
          locator: role("heading", "Missing heading"),
          timeoutMs: 500,
        },
      ],
      true,
    ),
    fixtureOptions(),
  );
  assert.equal(out.result.status, "failed");
  assert.equal(out.result.failureCategory, "SELECTOR_FAILURE");
  assert.ok(out.result.assertion?.received.includes("visible"));
  assert.ok(out.screenshotPath);
  assert.ok((await stat(out.screenshotPath)).size > 0);
  assert.ok(out.tracePath);
  assert.ok((await stat(out.tracePath)).size > 0);
  const archive = unzipSync(await readFile(out.tracePath));
  assert.ok(Object.keys(archive).some((name) => name.endsWith(".trace")));
  for (const [name, bytes] of Object.entries(archive)) {
    assert.ok(name.endsWith(".trace") || name.endsWith(".network"));
    if (name.endsWith(".network")) assert.equal(bytes.length, 0);
    else
      for (const line of strFromU8(bytes).trim().split("\n")) {
        const event = JSON.parse(line);
        assert.ok(["context-options", "before", "after"].includes(event.type));
        if (event.type === "before") assert.deepEqual(event.params, {});
        for (const key of [
          "headers",
          "cookies",
          "snapshot",
          "console",
          "url",
          "result",
          "attachments",
        ])
          assert.equal(event[key], undefined);
      }
  }
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".raw")));
});
test("invalid CSS is a configuration error and private redirects cannot pass", async () => {
  const css = await executeJourney(
    config([
      {
        action: "assertVisible",
        locator: { type: "css", value: "[" },
        timeoutMs: 500,
      },
    ]),
    fixtureOptions(),
  );
  assert.equal(css.result.status, "error");
  assert.equal(css.result.failureCategory, "CONFIGURATION_ERROR");
  const redirect = await executeJourney(
    {
      ...config([
        { action: "assertVisible", locator: role("heading"), timeoutMs: 500 },
      ]),
      startPath: "/redirect-private",
    },
    fixtureOptions(),
  );
  assert.equal(redirect.result.status, "error");
  assert.equal(redirect.result.steps[0].status, "failed");
  assert.equal(redirect.result.failureCategory, "CONFIGURATION_ERROR");
});
test("known application regression fails with expected and received evidence", async () => {
  const out = await executeJourney(
    config(
      [
        {
          action: "click",
          locator: role("button", "Broken checkout"),
          timeoutMs: 500,
        },
        {
          action: "assertText",
          locator: role("status"),
          expected: "Order confirmed",
          exact: false,
          timeoutMs: 500,
        },
      ],
      true,
    ),
    fixtureOptions(),
  );
  assert.equal(out.result.status, "failed");
  assert.equal(out.result.failureCategory, "APPLICATION_FAILURE");
  assert.equal(out.result.assertion?.expected, "Order confirmed");
  assert.match(out.result.assertion!.received, /Checkout unavailable/);
});
test("invalid configuration and missing credentials produce configuration errors", async () => {
  const invalid = await executeJourney(
    config([{ action: "click", locator: role("button"), timeoutMs: 500 }]),
    fixtureOptions(),
  );
  assert.equal(invalid.result.failureCategory, "CONFIGURATION_ERROR");
  assert.equal(invalid.result.status, "error");
  const missing = await executeJourney(
    config([
      {
        action: "fill",
        locator: { type: "label", value: "Password" },
        value: { secret: "FG_TEST_PASSWORD" },
        timeoutMs: 500,
      },
      { action: "assertVisible", locator: role("heading"), timeoutMs: 500 },
    ]),
    fixtureOptions(),
  );
  assert.equal(missing.result.failureCategory, "CONFIGURATION_ERROR");
});
test("protected credentials are resolved only in runner and artifacts are disabled", async () => {
  const secret = "never-return-this-password";
  const out = await executeJourney(
    config(
      [
        {
          action: "fill",
          locator: { type: "label", value: "Password" },
          value: { secret: "FG_TEST_PASSWORD" },
          timeoutMs: 500,
        },
        {
          action: "assertVisible",
          locator: role("heading", "Absent"),
          timeoutMs: 500,
        },
      ],
      true,
    ),
    { ...fixtureOptions(), secrets: { FG_TEST_PASSWORD: secret } },
  );
  assert.equal(out.result.status, "failed");
  assert.ok(!JSON.stringify(out).includes(secret));
  assert.equal(out.screenshotPath, undefined);
  assert.equal(out.tracePath, undefined);
  assert.equal(redact(`password=${secret}`, [secret]), "password=[REDACTED]");
});
test("overall timeout and deliberate cancellation never pass", async () => {
  const c = config([
    {
      action: "assertVisible",
      locator: role("heading", "Absent"),
      timeoutMs: 5000,
    },
  ]);
  c.definition.timeoutMs = 1000;
  const timed = await executeJourney(c, fixtureOptions());
  assert.equal(timed.result.status, "timed_out");
  assert.equal(timed.result.failureCategory, "TIMEOUT");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeJourney(c, {
    ...fixtureOptions(),
    signal: controller.signal,
  });
  assert.equal(cancelled.result.status, "cancelled");
});
test("hosted network policy rejects private IPs, metadata, unsafe URLs and origin escapes", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "http://169.254.169.254/",
    "//evil.example/",
    "javascript:alert(1)",
    "http://user:pass@public.example/",
    "https://public.example:8443/",
  ])
    assert.throws(() => approvedUrl(url, "https://public.example"));
  const realPolicy = await executeJourney({
    ...config([
      { action: "assertVisible", locator: role("heading"), timeoutMs: 500 },
    ]),
    targetUrl: "http://127.0.0.1",
  });
  assert.notEqual(realPolicy.result.status, "passed");
  assert.equal(
    journeyDefinitionSchema.safeParse({
      version: 1,
      steps: [
        {
          action: "assertElementCount",
          locator: { type: "text", value: "Nothing" },
          count: 0,
        },
      ],
    }).success,
    false,
  );
});

test("literal test input is removed from assertion evidence and suppresses artifacts", async () => {
  const input = "confidential-customer-input";
  const out = await executeJourney(
    config(
      [
        {
          action: "fill",
          locator: { type: "label", value: "Email" },
          value: { text: input },
          timeoutMs: 500,
        },
        { action: "click", locator: role("button", "Sign in"), timeoutMs: 500 },
        {
          action: "assertText",
          locator: role("status"),
          expected: "Other customer",
          exact: true,
          timeoutMs: 500,
        },
      ],
      true,
    ),
    fixtureOptions(),
  );
  assert.equal(out.result.status, "failed");
  assert.ok(!JSON.stringify(out).includes(input));
  assert.match(out.result.assertion!.received, /REDACTED/);
  assert.equal(out.screenshotPath, undefined);
  assert.equal(out.tracePath, undefined);
});
