import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { executeJourney } from "./engine.js";
import { executionResultSchema } from "./schema.js";
import { z } from "zod";
class DeliveryError extends Error {
  constructor(public status: number) {
    super(`FlowGuard API returned HTTP ${status}.`);
  }
}

async function main() {
  const base = new URL(process.env.FLOWGUARD_URL || "");
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error(
      "FLOWGUARD_URL must be the canonical HTTPS application origin.",
    );
  const batchId = z.string().uuid().parse(process.env.FLOWGUARD_BATCH_ID);
  const repositoryId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(process.env.GITHUB_REPOSITORY_ID);
  const githubRunId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(process.env.GITHUB_RUN_ID);
  const credential = process.env.FLOWGUARD_RUNNER_TOKEN;
  if (!credential || !/^fg_run_[A-Za-z0-9_-]{43}$/.test(credential))
    throw new Error(
      "Configure FLOWGUARD_RUNNER_TOKEN in repository Actions secrets.",
    );
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  const deadline = setTimeout(() => controller.abort(), 14 * 60_000);
  async function request(
    path: string,
    body: unknown,
    token: string,
    retry = false,
  ) {
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
      const started = performance.now();
      try {
        const response = await fetch(new URL(path, base), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        console.log(
          `FlowGuard delivery ${path.split("/").at(-1)}: HTTP ${response.status}, ${Math.round(performance.now() - started)}ms, attempt ${attempt + 1}`,
        );
        if (response.ok) return await response.json();
        if (response.status < 500 || attempt === (retry ? 2 : 0))
          throw new DeliveryError(response.status);
      } catch (error) {
        if (
          !retry ||
          attempt === 2 ||
          (error instanceof DeliveryError && error.status < 500)
        )
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error("Result delivery exhausted its retry limit.");
  }
  try {
    const claimed = await request(
      "/api/runner/claim",
      { batchId, repositoryId, githubRunId },
      credential,
    );
    const token = z
      .string()
      .regex(/^fg_exec_[A-Za-z0-9_-]{43}$/)
      .parse(claimed.token);
    const runs = z
      .array(z.object({ runId: z.string().uuid() }).passthrough())
      .min(1)
      .max(5)
      .parse(claimed.runs);
    const secrets = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^FG_TEST_[A-Z0-9_]+$/.test(key),
      ),
    );
    let unsuccessful = false;
    for (const run of runs) {
      if (controller.signal.aborted) break;
      await request(
        "/api/runner/start",
        { batchId, runId: run.runId },
        token,
        true,
      );
      const browserStarted = performance.now();
      const output = await executeJourney(run, {
        secrets,
        artifactDirectory: resolve("artifacts"),
        signal: controller.signal,
      });
      console.log(
        `FlowGuard browser execution: ${Math.round(performance.now() - browserStarted)}ms (includes browser startup)`,
      );
      if (output.screenshotPath)
        try {
          const size = (await stat(output.screenshotPath)).size;
          if (size > 2097152)
            throw new Error("Screenshot exceeds the 2 MiB limit.");
          const upload = await request(
            "/api/runner/artifacts",
            { action: "prepare", batchId, runId: run.runId, bytes: size },
            token,
          );
          const uploadUrl = new URL(z.string().url().parse(upload.url));
          if (uploadUrl.protocol !== "https:")
            throw new Error("Invalid private upload destination.");
          const bytes = await readFile(output.screenshotPath);
          const response = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: new Uint8Array(bytes),
            signal: AbortSignal.timeout(20_000),
            redirect: "error",
          });
          if (!response.ok)
            throw new Error("Private screenshot upload failed.");
          await request(
            "/api/runner/artifacts",
            { action: "confirm", batchId, runId: run.runId, bytes: size },
            token,
          );
        } catch {
          if (output.result.logs.length < 50)
            output.result.logs.push(
              "Private screenshot upload did not complete. Step and assertion results are still available.",
            );
        }
      if (output.tracePath && output.result.logs.length < 50)
        output.result.logs.push(
          "Sanitized action trace is retained in the GitHub Actions failure artifact.",
        );
      const result = executionResultSchema.parse(output.result);
      await request(
        "/api/runner/results",
        { batchId, runId: run.runId, result },
        token,
        true,
      );
      console.log(`FlowGuard ${run.runId}: ${result.status}`);
      unsuccessful ||= result.status !== "passed";
    }
    if (controller.signal.aborted || unsuccessful) process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
main().catch((error) => {
  if (error instanceof DeliveryError)
    console.error(`FlowGuard API returned HTTP ${error.status}.`);
  console.error(
    "FlowGuard runner stopped. Check configuration, credentials, and network access. Unsubmitted runs will be reconciled as errors or timeouts.",
  );
  process.exitCode = 1;
});
