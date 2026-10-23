import { expect, test } from "@playwright/test";

test("iPhone and iPad get installation help without a browser install event", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
  });
  for (const route of ["/login", "/sign-up"]) {
    await page.goto(route);
    await page
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    const guide = page.getByRole("dialog");
    await expect(guide).toBeVisible();
    await expect(
      guide.getByRole("heading", { name: "iPhone or iPad" }),
    ).toBeVisible();
    await expect(
      guide.getByText("Open as Web App", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).not.toBeVisible();
  }
  const icon = await request.get("/icons/apple-touch-icon.png");
  expect(icon.ok()).toBeTruthy();
  expect(icon.headers()["content-type"]).toContain("image/png");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
});

test("a dismissed install prompt is consumed and leaves manual installation available", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  await page.evaluate(() => {
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      },
    );
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install on this device" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Installation dismissed",
  );
  await expect(
    page.getByRole("button", { name: "Install on this device" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Install from your browser" }),
  ).toBeVisible();
});

test("standalone mode hides the global install button", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Install app", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
});
