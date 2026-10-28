import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("mocked GitHub PKCE sign-in creates a real SQL workspace; CRUD persists, import stays explicit, logout protects data", async ({
  page,
  request,
}, testInfo) => {
  await request.get("http://127.0.0.1:4545/test/reset");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/projects");
  await page.evaluate(() =>
    localStorage.setItem(
      "flowguard.workspace.v1",
      JSON.stringify({
        version: 1,
        mode: "local",
        demo: { projects: [], journeys: [], runs: [] },
        local: {
          projects: [
            {
              id: "old-local-project",
              name: "My local app",
              url: "https://local.example.com",
              repository: "text/not-a-connection",
              description: "",
              createdAt: "2026-10-01T00:00:00Z",
            },
          ],
          journeys: [
            {
              id: "old-local-journey",
              projectId: "old-local-project",
              name: "Local journey",
              path: "/",
              condition: "Page visible",
              createdAt: "2026-10-01T00:00:00Z",
            },
          ],
          runs: [],
        },
      }),
    ),
  );
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.screenshot({
    path: `/tmp/flowguard-phase2-${testInfo.project.name}-login.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app/projects");
  await expect(page.locator(".project-row")).toHaveCount(0);
  await page.locator(".workspace-menu summary").click();
  await expect(page.locator(".menu-heading")).toContainText("Alice Developer");
  await expect(page.locator(".menu-heading")).toContainText("@alice");
  await expect(page.locator(".menu-heading")).not.toContainText(
    "editable-not-authorized",
  );
  await page.keyboard.press("Escape");
  await page.goto(
    "/app/projects/new?github=error&message=Installation%20state%20expired.%20Start%20again.",
  );
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "Installation state expired. Start again.",
  );
  await page.goto("/app/projects");
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect repositories", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Project name").fill("Persistent app");
  await page.getByLabel("Target URL").fill("https://persistent.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Persistent app", exact: true }),
  ).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Persistent app", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run your first check", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom steps", exact: true }).click();
  await page.getByLabel("Journey name").fill("Persistent login");
  await page.getByLabel("Start path or URL").fill("/login");
  await page.getByLabel("Expected value").fill("Dashboard is visible");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await expect(page.locator(".journey-row")).toContainText("Persistent login");
  await page.reload();
  await expect(page.locator(".journey-row")).toContainText("Persistent login");
  await page
    .getByRole("button", { name: "Edit Persistent login", exact: true })
    .click();
  await page.getByLabel("Journey name").fill("Updated login");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".journey-row")).toContainText("Updated login");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Project name").fill("Updated app");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated app", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/flowguard-phase2-${testInfo.project.name}-project.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Run a check", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Connect a repository", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run check", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const denied = await page.evaluate(async () => {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createProject",
        input: {
          name: "Stolen repo",
          url: "https://example.com",
          repositoryId: "00000000-0000-4000-8000-000000000099",
        },
      }),
    });
    return response.status;
  });
  expect(denied).toBe(403);
  await page.goto("/app/runs");
  await expect(page.locator(".run-row")).toHaveCount(0);
  await page.goto("/app/connections");
  await page.screenshot({
    path: `/tmp/flowguard-phase2-${testInfo.project.name}-connections.png`,
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Import local projects", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1 projects");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Import projects", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Import local projects", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Import projects", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(projectUrl);
  await page
    .getByRole("button", { name: "Delete Updated login", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".journey-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(page).toHaveURL("/app/projects");
  await expect(page.locator(".project-row")).toHaveCount(1);
  await expect(page.locator(".project-row")).toContainText("My local app");
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(errors).toEqual([]);
});

test("revoked sessions are rejected server-side on the next private navigation", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app");
  await request.get("http://127.0.0.1:4545/test/revoke");
  await page.goto("/app/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator(".project-row")).toHaveCount(0);
});
