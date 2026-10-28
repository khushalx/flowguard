import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY = "flowguard.workspace.v1";
async function chooseWorkspace(page: Page, name: "Local" | "Demo") {
  await page.locator(".workspace-menu > summary").click();
  await page
    .getByRole("button", { name: new RegExp(`^${name} workspace`) })
    .click();
}

test("failure evidence is inspectable and run actions never fabricate results", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /View evidence/ }).click();
  await expect(page).toHaveURL(/\/demo\/runs\/run-1038$/);
  await expect(page.getByText("Run failed", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Failure investigation" })
      .getByText("Thank you for your purchase", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Failure investigation" })
      .getByText("Payment could not be processed", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".timeline-step")).toHaveCount(5);
  await page.getByText("Assertion details", { exact: true }).click();
  await expect(page.locator(".technical-details code")).toContainText(
    "getByRole",
  );
  await page.getByRole("button", { name: "Expand screenshot fixture" }).click();
  await expect(
    page.getByRole("dialog", { name: "Screenshot fixture", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page.getByRole("button", { name: "Run again", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No test was started");
  await page.getByRole("button", { name: "Got it" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});

test("run filters expose passed, failed, running and unknown fixtures", async ({
  page,
}) => {
  await page.goto("/demo/runs");
  await expect(page.locator(".run-row")).toHaveCount(10);
  for (const [name, count] of [
    ["Failed", 1],
    ["Passed", 7],
    ["Running", 1],
    ["No result", 1],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".run-row")).toHaveCount(count);
  }
  await page.locator(".run-row").click();
  await expect(page.getByText("Result unknown", { exact: true })).toBeVisible();
  await page.goto("/demo/runs/run-1030");
  await expect(
    page.getByText("Running · sample state", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Static demo record. No test is currently being executed."),
  ).toBeVisible();
  await page.goto("/demo/runs/run-1037");
  await expect(page.getByText("Run passed", { exact: true })).toBeVisible();
  await expect(page.locator(".failure-evidence")).toHaveCount(0);
});

test("local project and journey lifecycle persists and stays separate from demo", async ({
  page,
}) => {
  await page.goto("/demo");
  await chooseWorkspace(page, "Local");
  await expect(
    page.getByRole("heading", { name: "Your first project starts here" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Create a project", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Enter a project name.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("My storefront");
  await page
    .getByLabel("Target URL", { exact: true })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Enter a complete http:// or https:// URL."),
  ).toBeVisible();
  await page
    .getByLabel("Target URL", { exact: true })
    .fill("https://store.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Sign in to connect a GitHub repository."),
  ).toBeVisible();
  await page.getByLabel("Repository", { exact: false }).fill("team/store");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".review-list")).toContainText("My storefront");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Repository", { exact: false })).toHaveValue(
    "team/store",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My storefront", exact: true }),
  ).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My storefront", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run a check", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Run your first check");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: /Journeys 0/ }).click();
  await page
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await expect(page.getByText("Give this journey a name.")).toBeVisible();
  await page.getByLabel("Journey name", { exact: true }).fill("Place an order");
  await page.getByLabel("Start path or URL").fill("/checkout");
  await page
    .getByLabel("Success condition")
    .fill("Order confirmation is visible.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Place an order", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".journey-row")).toContainText("Not run");
  await page
    .getByRole("button", { name: "Edit Place an order", exact: true })
    .click();
  await page
    .getByLabel("Journey name", { exact: true })
    .fill("Complete an order");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Storefront v2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await chooseWorkspace(page, "Demo");
  await expect(
    page.getByRole("heading", { name: "This project isn’t in this workspace" }),
  ).toBeVisible();
  await chooseWorkspace(page, "Local");
  await expect(
    page.getByRole("heading", { name: "Storefront v2", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Complete an order", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Complete an order", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".journey-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete Complete an order", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".journey-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/projects$/);
  await expect(
    page.getByRole("heading", { name: "A place for your projects" }),
  ).toBeVisible();
  await page.goto(projectUrl);
  await expect(
    page.getByRole("heading", { name: "This project isn’t in this workspace" }),
  ).toBeVisible();
});

test("search and filter empty states are recoverable", async ({ page }) => {
  await page.goto("/demo/projects");
  await page.getByLabel("Search projects").fill("no-such-project");
  await expect(
    page.getByRole("heading", { name: "No projects found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".project-row")).toHaveCount(3);
  await page.getByLabel("Search projects").fill("formkit.example.com");
  await expect(page.locator(".project-row")).toHaveCount(1);
  await page.locator(".project-row").click();
  await expect(
    page.getByRole("heading", { name: "Formkit", exact: true }),
  ).toBeVisible();
  await page.goto("/demo/runs");
  await page.getByLabel("Search runs").fill("not-a-commit");
  await expect(
    page.getByRole("heading", { name: "No matching runs" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".run-row")).toHaveCount(10);
});

test("corrupted storage offers an explicit recovery flow", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "invalid JSON");
  }, KEY);
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Your workspace couldn’t be loaded" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset browser workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    "invalid JSON",
  );
  await page
    .getByRole("button", { name: "Reset browser workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("storage write failures do not report successful mutations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.goto("/demo");
  await chooseWorkspace(page, "Local");
  await expect(page.locator(".toast-error")).toContainText(
    "Changes could not be saved",
  );
  await expect(page.locator(".project-row")).toHaveCount(3);
  await expect(page.locator(".workspace-mode")).toHaveText("Demo");
});

test("dialog supports Escape and restores keyboard focus", async ({ page }) => {
  await page.goto("/demo/projects/ledger");
  const trigger = page.getByRole("button", {
    name: "Run a check",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("save and delete errors remain accessible inside modal dialogs", async ({
  page,
}) => {
  await page.goto("/demo/projects/ledger");
  await expect(
    page.getByRole("heading", { name: "Ledger", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Unsaved name");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Changes could not be saved",
  );
  await expect(
    page.getByRole("heading", { name: "Ledger", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Changes could not be saved",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await page
    .getByLabel("Journey name", { exact: true })
    .fill("Unsaved journey");
  await page.getByLabel("Success condition").fill("A confirmation is visible.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Changes could not be saved",
  );
  await expect(page.locator(".journey-row")).toHaveCount(3);
});

test("journey dialogs are accessible and keep keyboard focus contained", async ({
  page,
}) => {
  await page.goto("/demo/projects/ledger/journeys");
  await page
    .getByRole("button", { name: "Create journey", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "Create journey", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector("dialog")?.contains(document.activeElement),
    ),
  ).toBe(true);
});

test("workspace switches synchronize across tabs", async ({
  page,
  context,
}) => {
  await page.goto("/demo");
  const second = await context.newPage();
  await second.goto("/demo/projects");
  await expect(second.locator(".project-row")).toHaveCount(3);
  await chooseWorkspace(page, "Local");
  await expect(
    second.getByRole("heading", { name: "A place for your projects" }),
  ).toBeVisible();
  await chooseWorkspace(second, "Demo");
  await expect(page.locator(".project-row")).toHaveCount(3);
});

test("unknown IDs and routes have useful exits", async ({ page }) => {
  await page.goto("/demo/runs/missing");
  await expect(
    page.getByRole("heading", { name: "This run isn’t in this workspace" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to runs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Runs", exact: true }),
  ).toBeVisible();
  await page.goto("/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});

for (const path of [
  "/demo",
  "/demo/projects",
  "/demo/projects/ledger",
  "/demo/projects/ledger/journeys",
  "/demo/projects/new",
  "/demo/runs",
  "/demo/runs/run-1038",
]) {
  test(`accessible, responsive screen: ${path}`, async ({ page }) => {
    await page.goto(path);
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
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}
