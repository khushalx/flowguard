import { test, expect } from "@playwright/test";
test("run history paginates and loads evidence for an older run only when opened", async ({
  page,
  request,
}) => {
  await request.get("http://127.0.0.1:4545/test/reset");
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL("/app");
  const seeded = await (
    await request.get("http://127.0.0.1:4545/test/seed-runs")
  ).json();
  await page.goto("/app/runs");
  await expect(page.locator(".run-row")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Load earlier runs", exact: true })
    .click();
  await expect(page.locator(".run-row")).toHaveCount(60);
  await expect(
    page.getByRole("button", { name: "Load earlier runs", exact: true }),
  ).toHaveCount(0);
  await page.goto(`/app/runs/${seeded.id}`);
  await expect(
    page.getByRole("heading", { name: "Fixture page assertion", exact: true }),
  ).toBeVisible();
  const denied = await page.request.get(
    "/api/runs/00000000-0000-4000-8000-000000000099",
  );
  expect(denied.status()).toBe(404);
});
