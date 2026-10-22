import { expect, test } from "@playwright/test";

test("login and manifest provide the installable public shell", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Make room for what matters." }),
  ).toBeVisible();
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
});

test("mobile login remains keyboard accessible", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});
