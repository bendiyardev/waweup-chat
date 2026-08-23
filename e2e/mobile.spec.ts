import { expect, test } from "@playwright/test";
import { createRoom, hasSecrets, send } from "./helpers";

/** Runs only in the "mobile" Playwright project (Pixel 7 viewport). */

test("home renders without horizontal overflow and the form is usable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create encrypted chat" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
});

test("full mobile chat flow", async ({ page }) => {
  test.skip(!hasSecrets, "Requires storage + realtime secrets");
  await createRoom(page, "mobile room");
  await send(page, "mobile hello");
  await expect(page.getByText("mobile hello")).toBeVisible({
    timeout: 15_000,
  });
  // Composer stays visible in the viewport.
  await expect(page.getByLabel("Message", { exact: true })).toBeInViewport();
});
