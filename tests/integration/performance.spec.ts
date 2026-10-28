import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("production navigation and saves remain bounded without bootstrap writes or background request loops", async ({
  page,
  request,
}, testInfo) => {
  await request.get("http://127.0.0.1:4545/test/reset");
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app");
  await page.addInitScript(() => {
    const metrics = { lcp: 0, longTasks: 0, eventDurations: [] as number[] };
    (window as unknown as { fgMetrics: typeof metrics }).fgMetrics = metrics;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.longTasks += entry.duration;
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (
          (entry as PerformanceEntry & { interactionId: number }).interactionId
        )
          metrics.eventDurations.push(entry.duration);
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
  const results: Record<string, unknown>[] = [];
  for (const path of ["/app", "/app/projects/new", "/app/runs"]) {
    await request.get("http://127.0.0.1:4546/measure/reset");
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      const scripts = performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("/_next/") && e.name.endsWith(".js"))
        .map((e) => ({
          path: new URL(e.name).pathname,
          encodedBytes: (e as PerformanceResourceTiming).encodedBodySize,
          decodedBytes: (e as PerformanceResourceTiming).decodedBodySize,
        }));
      return {
        ttfbMs: Math.round(navigation.responseStart),
        domInteractiveMs: Math.round(navigation.domInteractive),
        ...(
          window as unknown as {
            fgMetrics: {
              lcp: number;
              longTasks: number;
              eventDurations: number[];
            };
          }
        ).fgMetrics,
        scripts,
      };
    });
    const backend = (await (
      await request.get("http://127.0.0.1:4546/measure/results")
    ).json()) as { path: string }[];
    expect(
      backend.filter((r) => r.path.includes("bootstrap_workspace")),
    ).toHaveLength(0);
    expect(backend.length).toBeLessThan(20);
    // A generous byte budget, independent of machine timing and compression variance.
    expect(
      metrics.scripts.reduce((n, s) => n + s.encodedBytes, 0),
    ).toBeLessThan(240_000);
    results.push({ operation: path, ...metrics, backend });
  }
  await page.goto("/app/projects");
  await page.waitForLoadState("networkidle");
  await request.get("http://127.0.0.1:4546/measure/reset");
  let start = Date.now();
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New project", exact: true }),
  ).toBeVisible();
  results.push({
    operation: "client navigation projects to new project",
    totalMs: Date.now() - start,
    backend: await (
      await request.get("http://127.0.0.1:4546/measure/results")
    ).json(),
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Project name").fill("After benchmark");
  await page.getByLabel("Target URL").fill("https://benchmark.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await request.get("http://127.0.0.1:4546/measure/reset");
  start = Date.now();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "After benchmark", exact: true }),
  ).toBeVisible();
  const totalMs = Date.now() - start;
  const backend = (await (
    await request.get("http://127.0.0.1:4546/measure/results")
  ).json()) as { path: string; method: string }[];
  expect(
    backend.filter((r) => r.path.includes("bootstrap_workspace")),
  ).toHaveLength(0);
  expect(
    backend.filter(
      (r) => r.path === "/rest/v1/projects" && r.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    backend.filter((r) => r.path === "/rest/v1/projects" && r.method === "GET"),
  ).toHaveLength(0);
  results.push({
    operation: "create project without repository",
    totalMs,
    backend,
    eventDurations: await page.evaluate(
      () =>
        (window as unknown as { fgMetrics: { eventDurations: number[] } })
          .fgMetrics.eventDurations,
    ),
  });
  writeFileSync(
    `/tmp/flowguard-performance-after-${testInfo.project.name}.json`,
    JSON.stringify(results, null, 2),
  );
});
