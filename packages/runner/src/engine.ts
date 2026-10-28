import {
  chromium,
  expect,
  type Locator,
  type Page,
  type Browser,
} from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { approvedUrl, safeProxy } from "./network.js";
import { sanitizeTrace } from "./trace.js";
import {
  runConfigurationSchema,
  type LocatorDefinition,
  type TestStep,
  type ExecutionResult,
  type RunConfiguration,
} from "./schema.js";

export function resolveLocator(page: Page, l: LocatorDefinition): Locator {
  switch (l.type) {
    case "role":
      return page.getByRole(
        l.value,
        "name" in l && l.name ? { name: l.name, exact: true } : undefined,
      );
    case "label":
      return page.getByLabel(l.value, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(l.value, { exact: true });
    case "testId":
      return page.getByTestId(l.value);
    case "text":
      return page.getByText(l.value, { exact: true });
    case "css":
      return page.locator(l.value);
  }
}
export function redact(value: string, secrets: string[]) {
  let safe = value.replace(/\u001b\[[0-9;]*m/g, "");
  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    safe = safe.split(secret).join("[REDACTED]");
  safe = safe.replace(/(?:https?:\/\/)[^\s<>"']+/g, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}${url.search ? "?[REDACTED]" : ""}`;
    } catch {
      return "[URL]";
    }
  });
  return safe
    .replace(
      /((?:authorization|cookie|password|access_token|refresh_token|api[_-]?key|secret)\s*[:=]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 2000);
}
function stepName(step: TestStep) {
  return `${step.action}${"locator" in step ? ` · ${step.locator.type}: ${step.locator.value}${"name" in step.locator && step.locator.name ? ` (${step.locator.name})` : ""}` : step.action === "navigate" ? ` · ${step.path}` : ""}`.slice(
    0,
    600,
  );
}
type EngineOptions = {
  secrets?: Record<string, string | undefined>;
  artifactDirectory?: string;
  signal?: AbortSignal;
  // Explicit trusted-code seam for loopback fixtures. The CLI never enables it.
  allowPrivateForFixture?: boolean;
};
export type EngineOutput = {
  result: ExecutionResult;
  screenshotPath?: string;
  tracePath?: string;
};

export async function executeJourney(
  input: unknown,
  options: EngineOptions = {},
): Promise<EngineOutput> {
  const started = Date.now();
  const result: ExecutionResult = {
    status: "error",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(started).toISOString(),
    duration: 0,
    failureCategory: "CONFIGURATION_ERROR",
    error: null,
    steps: [],
    logs: [],
  };
  let config: RunConfiguration;
  try {
    config = runConfigurationSchema.parse(input);
    approvedUrl(
      config.startPath,
      config.targetUrl,
      options.allowPrivateForFixture,
    );
    for (const s of config.definition.steps)
      if (s.action === "navigate")
        approvedUrl(s.path, config.targetUrl, options.allowPrivateForFixture);
  } catch {
    result.error =
      "Invalid journey configuration: validate steps, positive assertions and approved navigation URLs.";
    return { result };
  }
  const secretRefs = config.definition.steps
    .filter((s) => s.action === "fill" && "secret" in s.value)
    .map((s) =>
      s.action === "fill" && "secret" in s.value ? s.value.secret : "",
    );
  if (secretRefs.some((ref) => !options.secrets?.[ref])) {
    result.error =
      "A referenced FG_TEST_ credential is missing from the runner environment.";
    return { result };
  }
  const secrets = secretRefs.map((ref) => options.secrets![ref]!);
  const capture =
    config.definition.captureArtifacts &&
    !secrets.length &&
    !!options.artifactDirectory;
  if (config.definition.captureArtifacts && secrets.length)
    result.logs.push(
      "Artifact capture disabled because this journey uses protected test credentials.",
    );
  let browser: Browser | undefined;
  let proxy: Awaited<ReturnType<typeof safeProxy>> | undefined;
  let timedOut = false;
  let current: TestStep | undefined;
  let page: Page | undefined;
  let screenshotPath: string | undefined;
  let tracePath: string | undefined;
  let blockedNavigation = false;
  const cancel = () => {
    void browser?.close().catch(() => {});
  };
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, config.definition.timeoutMs);
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (options.signal?.aborted) throw new Error("Cancelled");
    result.failureCategory = "INFRASTRUCTURE_ERROR";
    proxy = await safeProxy(config.targetUrl, options.allowPrivateForFixture);
    browser = await chromium.launch({
      headless: true,
      timeout: Math.min(config.definition.timeoutMs, 30_000),
      proxy: { server: proxy.server, bypass: "<-loopback>" },
      args: [
        "--disable-quic",
        "--disable-background-networking",
        "--disable-extensions",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    if (timedOut || options.signal?.aborted) throw new Error("Interrupted");
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      viewport: { width: 1280, height: 800 },
      permissions: [],
    });
    await context.route("**/*", (route) => {
      try {
        approvedUrl(
          route.request().url(),
          config.targetUrl,
          options.allowPrivateForFixture,
        );
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    if (capture) {
      await mkdir(options.artifactDirectory!, { recursive: true });
      await context.tracing.start({
        screenshots: false,
        snapshots: false,
        sources: false,
      });
    }
    page = await context.newPage();
    page.on("framenavigated", (frame) => {
      if (frame !== page!.mainFrame()) return;
      try {
        approvedUrl(
          frame.url(),
          config.targetUrl,
          options.allowPrivateForFixture,
        );
      } catch {
        blockedNavigation = true;
        void page!.close().catch(() => {});
      }
    });
    context.on("page", (other) => {
      if (other !== page) void other.close().catch(() => {});
    });
    const log = (message: string) => {
      if (result.logs.length < 50) result.logs.push(redact(message, secrets));
    };
    page.on("console", (m) => {
      if (m.type() === "error")
        log(
          "Browser console error (message content omitted to protect application data).",
        );
    });
    page.on("pageerror", () =>
      log("Uncaught application JavaScript error (content omitted)."),
    );
    page.on("requestfailed", (req) => {
      try {
        log(
          `Network request failed: ${new URL(req.url()).origin} · ${req.failure()?.errorText || "connection failed"}`,
        );
      } catch {
        log("Network request failed.");
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        log(`HTTP ${response.status()} from ${new URL(response.url()).origin}`);
    });
    result.failureCategory = "INFRASTRUCTURE_ERROR";
    const navigateStart = Date.now();
    const initialStep = {
      name: "Open starting path",
      detail: config.startPath,
      status: "passed" as "passed" | "failed",
      startedAt: new Date(navigateStart).toISOString(),
      duration: 0,
    };
    result.steps.push(initialStep);
    try {
      const response = await page.goto(
        approvedUrl(
          config.startPath,
          config.targetUrl,
          options.allowPrivateForFixture,
        ),
        {
          waitUntil: "domcontentloaded",
          timeout: Math.min(15_000, config.definition.timeoutMs),
        },
      );
      approvedUrl(page.url(), config.targetUrl, options.allowPrivateForFixture);
      if (!response || response.status() >= 500)
        throw new Error(
          `Target unavailable${response ? ` (HTTP ${response.status()})` : ""}.`,
        );
    } catch (error) {
      initialStep.status = "failed";
      initialStep.detail = redact(
        error instanceof Error
          ? error.message
          : "Starting page could not be opened",
        secrets,
      );
      throw error;
    } finally {
      initialStep.duration = Date.now() - navigateStart;
    }
    for (const step of config.definition.steps) {
      current = step;
      const stepStart = Date.now();
      const record = {
        name: redact(stepName(step), secrets),
        detail: "",
        status: "passed" as "passed" | "failed",
        startedAt: new Date(stepStart).toISOString(),
        duration: 0,
      };
      result.steps.push(record);
      try {
        const locator =
          "locator" in step ? resolveLocator(page, step.locator) : null;
        const timeout = step.timeoutMs;
        result.failureCategory = step.action.startsWith("assert")
          ? "APPLICATION_FAILURE"
          : "SELECTOR_FAILURE";
        switch (step.action) {
          case "navigate": {
            result.failureCategory = "INFRASTRUCTURE_ERROR";
            const response = await page.goto(
              approvedUrl(
                step.path,
                config.targetUrl,
                options.allowPrivateForFixture,
              ),
              { waitUntil: "domcontentloaded", timeout },
            );
            if (!response || response.status() >= 500)
              throw new Error("Navigation target is unavailable.");
            break;
          }
          case "click":
            await locator!.click({ timeout });
            break;
          case "fill": {
            if (
              "text" in step.value &&
              (await locator!.getAttribute("type", { timeout })) === "password"
            ) {
              result.failureCategory = "CONFIGURATION_ERROR";
              throw new Error(
                "Password fields require an FG_TEST_ secret reference.",
              );
            }
            await locator!.fill(
              "secret" in step.value
                ? options.secrets![step.value.secret]!
                : step.value.text,
              { timeout },
            );
            break;
          }
          case "press":
            await locator!.press(step.key, { timeout });
            break;
          case "selectOption":
            await locator!.selectOption(step.value, { timeout });
            break;
          case "assertVisible":
            await expect(locator!).toBeVisible({ timeout });
            break;
          case "assertText":
            if (step.exact)
              await expect(locator!).toHaveText(step.expected, { timeout });
            else
              await expect(locator!).toContainText(step.expected, { timeout });
            break;
          case "assertURL":
            await expect(page).toHaveURL(
              (url) =>
                step.match === "equals"
                  ? url.href === new URL(step.expected, config.targetUrl).href
                  : url.href.includes(step.expected),
              { timeout },
            );
            break;
          case "assertElementCount":
            await expect(locator!).toHaveCount(step.count, { timeout });
            break;
        }
        approvedUrl(
          page.url(),
          config.targetUrl,
          options.allowPrivateForFixture,
        );
      } catch (error) {
        record.status = "failed";
        record.detail = redact(
          error instanceof Error
            ? error.message.split("Call log:")[0]
            : "Step failed",
          secrets,
        );
        throw error;
      } finally {
        record.duration = Date.now() - stepStart;
      }
    }
    result.status = "passed";
    result.failureCategory = null;
    if (capture) await context.tracing.stop();
  } catch (error) {
    const message = redact(
      error instanceof Error
        ? error.message.split("Call log:")[0]
        : "Browser execution failed",
      secrets,
    );
    result.error = message;
    if (blockedNavigation) {
      result.status = "error";
      result.failureCategory = "CONFIGURATION_ERROR";
      result.error =
        "Main-frame navigation left the approved project origin and was blocked.";
    } else if (timedOut) {
      result.status = "timed_out";
      result.failureCategory = "TIMEOUT";
    } else if (options.signal?.aborted) {
      result.status = "cancelled";
      result.failureCategory = "CANCELLED";
    } else {
      if (
        /(?:Unexpected token|parsing selector|Invalid selector|Unknown engine|Private network blocked|Unapproved destination|Navigation must stay)/i.test(
          message,
        )
      )
        result.failureCategory = "CONFIGURATION_ERROR";
      else if (current && "locator" in current && page && !page.isClosed()) {
        try {
          if ((await resolveLocator(page, current.locator).count()) === 0)
            result.failureCategory = "SELECTOR_FAILURE";
        } catch {
          result.failureCategory = "CONFIGURATION_ERROR";
        }
      }
      result.status = ["APPLICATION_FAILURE", "SELECTOR_FAILURE"].includes(
        result.failureCategory || "",
      )
        ? "failed"
        : "error";
    }
    if (current?.action.startsWith("assert"))
      result.assertion = {
        expected: redact(
          "expected" in current
            ? current.expected
            : current.action === "assertElementCount"
              ? `${current.count} elements`
              : "Element is visible",
          secrets,
        ),
        received: message.slice(0, 1000),
        locator: redact(
          "locator" in current
            ? `${current.locator.type}: ${current.locator.value}`
            : "Page URL",
          secrets,
        ).slice(0, 600),
        timeout: current.timeoutMs,
      };
    if (capture && page && !page.isClosed()) {
      try {
        screenshotPath = join(
          options.artifactDirectory!,
          `${config.runId}.png`,
        );
        await page.screenshot({
          path: screenshotPath,
          mask: [
            page.locator('input[type="password"], [data-flowguard-sensitive]'),
          ],
          timeout: 5000,
        });
      } catch {
        screenshotPath = undefined;
        result.logs.push("Failure screenshot could not be captured.");
      }
      const rawTrace = join(options.artifactDirectory!, `${config.runId}.raw`);
      try {
        tracePath = join(options.artifactDirectory!, `${config.runId}.zip`);
        await page.context().tracing.stop({ path: rawTrace });
        await sanitizeTrace(rawTrace, tracePath);
      } catch {
        if (tracePath) await rm(tracePath, { force: true }).catch(() => {});
        tracePath = undefined;
        result.logs.push("Failure trace could not be captured safely.");
      } finally {
        await rm(rawTrace, { force: true }).catch(() => {});
      }
    }
    const completedSteps = current
      ? config.definition.steps.indexOf(current) + 1
      : 0;
    for (const skipped of config.definition.steps.slice(completedSteps))
      result.steps.push({
        name: redact(stepName(skipped), secrets),
        detail: "Not executed after interruption.",
        status: "skipped",
        startedAt: new Date().toISOString(),
        duration: 0,
      });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    await browser?.close().catch(() => {
      result.logs.push(
        "Browser cleanup failed; job timeout remains the final resource limit.",
      );
    });
    await proxy?.close();
    result.completedAt = new Date().toISOString();
    result.duration = Date.now() - started;
  }
  return { result, screenshotPath, tracePath };
}
