import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("every private route redirects unauthenticated visitors and preserves an internal destination", async ({
  page,
}) => {
  for (const route of [
    "/app",
    "/app/projects",
    "/app/projects/new",
    "/app/projects/ledger",
    "/app/projects/ledger/journeys",
    "/app/runs",
    "/app/runs/run-1038",
    "/app/connections",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(
      new RegExp(
        "/login\\?next=" + encodeURIComponent(route).replaceAll("%", "%") + "$",
      ),
    );
    await expect(
      page.getByRole("heading", { name: "Sign in to FlowGuard" }),
    ).toBeVisible();
    await expect(page.locator(".project-row")).toHaveCount(0);
  }
});
test("login is accessible, public, and does not pretend to work without configuration", async ({
  page,
}) => {
  await page.goto("/login?next=https://evil.example");
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Authentication isn’t configured on this instance.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator("input[name=next]")).toHaveValue("/app");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Explore the local demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.locator(".workspace-mode")).toHaveText("Demo");
});
test("OAuth callback without a valid PKCE exchange fails safely", async ({
  page,
}) => {
  await page.goto("/auth/callback?code=invalid&next=https://evil.example");
  await expect(page).toHaveURL(/\/login\?error=callback_failed$/);
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "Sign-in could not be completed",
  );
});
test("private APIs never expose demo records and reject unconfigured or cross-origin mutations", async ({
  request,
}) => {
  const response = await request.get("/api/workspace");
  expect(response.status()).toBe(503);
  expect(await response.json()).not.toHaveProperty("workspace");
  const mutation = await request.post("/api/workspace", {
    headers: { Origin: "https://evil.example" },
    data: { action: "deleteProject", id: "ledger" },
  });
  expect([403, 503]).toContain(mutation.status());
  const webhook = await request.post("/api/github/webhook", {
    data: { installation: { id: 123 } },
  });
  expect(webhook.status()).toBe(503);
});
