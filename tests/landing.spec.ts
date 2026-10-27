import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public homepage has real navigation and a usable investigation preview", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Catch broken deployments before your\s*users do\./,
  );
  await expect(
    page.getByText("Interactive sample", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Welcome back, Alex", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Step 1: Open the sign-in page", exact: true })
    .click();
  await expect(page.locator(".selected-step-detail")).toContainText(
    "GET /login returned 200",
  );
  await expect(
    page.getByRole("button", { name: "Previous step", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.locator(".selected-step-detail")).toContainText(
    "Enter account details",
  );
  await page
    .getByRole("button", {
      name: "Return to the failed assertion",
      exact: false,
    })
    .click();
  await expect(
    page.getByText("Your session could not be created", { exact: true }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "Execution logs" }).click();
  await expect(page.getByLabel("Execution log output")).toContainText(
    "POST /api/session → 401",
  );
  await page
    .getByRole("button", { name: "Expand screenshot fixture", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "not a screenshot from a real test",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: "How it works", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(
    page.getByRole("heading", { name: "Connect your project.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".landing-nav")).toHaveAttribute(
    "data-scrolled",
    "true",
  );
  await page
    .getByRole("link", { name: "Explore the demo", exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.locator(".workspace-mode")).toHaveText("Demo");
  await expect(page.locator(".demo-notice, .app-footer")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("public preview never changes an existing local workspace", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: /^Local workspace/ }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem("flowguard.workspace.v1"),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Step 2: Enter account details", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Explore the demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first project starts here" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("flowguard.workspace.v1")),
  ).toBe(before);
});

test("public homepage passes accessibility checks and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  expect(
    await page
      .locator(".sculpture-turn")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
});

test("public and application screens fit narrow phones, tablets, and laptops", async ({
  page,
}) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/demo",
      "/demo/projects",
      "/demo/runs/run-1038",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
    }
  }
});
