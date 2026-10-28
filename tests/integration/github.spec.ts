import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ request, page }) => {
  await request.get("http://127.0.0.1:4545/test/reset");
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app");
});
test("existing installation appears automatically; repository creation persists and access changes reconcile", async ({
  page,
  request,
}, testInfo) => {
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=installed");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let discoveries = 0;
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/github") &&
      r.postDataJSON()?.action === "discover"
    )
      discoveries++;
  });
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Manage repository access" }),
  ).toHaveAttribute("href", "https://github.com/settings/installations/123");
  await expect(page.locator("#repository-picker option")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Connect repositories", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search repositories").fill("repo-456");
  await expect(page.locator("#repository-picker option")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Repository Optional", exact: true })
    .selectOption({ label: "alice/repo-456 · Private" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("repo-456");
  await page.getByLabel("Target URL").fill("https://repository.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "repo-456", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("alice/repo-456", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=updated");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.locator("#repository-picker option").filter({ hasText: "repo-456" }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Repository Optional", exact: true })
    .selectOption({ label: "alice/repo-458" });
  await page.screenshot({
    path: `/tmp/flowguard-stability-${testInfo.project.name}-repositories.png`,
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("alice/repo-458", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=limited");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "rate limiting" }),
  ).toBeVisible();
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=removed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Installation removed", { exact: true }),
  ).toBeVisible();
  expect(discoveries).toBeLessThanOrEqual(4); // Bounded mount checks, no render loop.
  expect(errors).toEqual([]);
});

test("first installation verifies callback state and restores the original draft", async ({
  page,
  request,
}) => {
  await page.goto("/app/projects/new");
  await expect(
    page.getByRole("button", { name: "Connect repositories", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Project name").fill("Preserved draft");
  await page.getByLabel("Target URL").fill("https://draft.example.com");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  let callback = "";
  await page.route(
    "https://github.com/apps/fixture-flowguard/installations/new?**",
    async (route) => {
      const state = new URL(route.request().url()).searchParams.get("state")!;
      await request.get(
        "http://127.0.0.1:4545/test/github-mode?mode=installed",
      );
      callback = `/api/github/setup?installation_id=123&setup_action=install&state=${encodeURIComponent(state)}`;
      await route.fulfill({
        status: 302,
        headers: { Location: `http://127.0.0.1:3010${callback}` },
      });
    },
  );
  await page
    .getByRole("button", { name: "Connect repositories", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/projects\/new\?github=connected/);
  await expect(page.locator("#repository-picker option")).toHaveCount(3);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Preserved draft");
  await expect(page.getByLabel("Target URL")).toHaveValue(
    "https://draft.example.com",
  );
  await page.goto(callback);
  await expect(page).toHaveURL(/\/app\/connections\?github=error/);
  await expect(page.getByText(/Installation state expired/)).toBeVisible();
});

test("denied installation is recoverable; spoofed callbacks never grant access", async ({
  page,
}) => {
  await page.goto("/app/projects/new");
  await expect(
    page.getByRole("button", { name: "Connect repositories", exact: true }),
  ).toBeEnabled();
  await page.route(
    "https://github.com/apps/fixture-flowguard/installations/new?**",
    async (route) => {
      const state = new URL(route.request().url()).searchParams.get("state")!;
      await route.fulfill({
        status: 302,
        headers: {
          Location: `http://127.0.0.1:3010/api/github/setup?setup_action=cancel&state=${encodeURIComponent(state)}`,
        },
      });
    },
  );
  await page
    .getByRole("button", { name: "Connect repositories", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/projects\/new\?github=error/);
  await expect(
    page.getByText(/No repository access was granted/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect repositories", exact: true }),
  ).toBeEnabled();
  await page.goto("/api/github/setup?installation_id=999&state=spoofed");
  await expect(page).toHaveURL(/\/app\/connections\?github=error/);
  await expect(
    page.getByRole("link", { name: "Manage repository access" }),
  ).toHaveCount(0);
});

test("settings updates ignore untrusted installation IDs and independently refresh existing access", async ({
  page,
  request,
}) => {
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=installed");
  await page.goto("/app/projects/new");
  await expect(page.locator("#repository-picker option")).toHaveCount(3);
  await request.get("http://127.0.0.1:4545/test/github-mode?mode=updated");
  await page.goto("/api/github/setup?setup_action=update&installation_id=999");
  await expect(page).toHaveURL("/app/connections?github=check");
  await expect(
    page.getByRole("link", { name: "Manage repository access" }),
  ).toHaveAttribute("href", "https://github.com/settings/installations/123");
  await page.goto("/app/projects/new");
  await expect(
    page.locator("#repository-picker option").filter({ hasText: "repo-458" }),
  ).toHaveCount(1);
});
