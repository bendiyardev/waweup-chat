import { expect, test } from "@playwright/test";
import { createRoom, hasSecrets, joinRoom, PASSWORD, send } from "./helpers";

/**
 * Desktop end-to-end flows against real Vercel Blob + Pusher credentials.
 * Storage/realtime dependent specs skip explicitly when secrets are absent —
 * they never fake success.
 */

test.describe("room lifecycle", () => {
  test.skip(
    !hasSecrets,
    "Requires BLOB_READ_WRITE_TOKEN and Pusher credentials in the environment",
  );

  test("owner creates, members join and exchange messages, cap enforced", async ({
    page,
    browser,
  }) => {
    const url = await createRoom(page, "e2e room");

    // Second participant joins and both exchange messages in realtime.
    const contextB = await browser.newContext();
    const memberB = await joinRoom(contextB, url, "Ahmet");
    await send(page, "hello from owner");
    await expect(memberB.getByText("hello from owner")).toBeVisible({
      timeout: 15_000,
    });
    await send(memberB, "hi back");
    await expect(page.getByText("hi back")).toBeVisible({ timeout: 15_000 });

    // Reload + reconnect: history survives, password is asked again.
    await memberB.reload();
    await memberB.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await memberB.getByRole("button", { name: "Unlock" }).click();
    await expect(memberB.getByText("hello from owner")).toBeVisible({
      timeout: 30_000,
    });

    // Third member fills the room.
    const contextC = await browser.newContext();
    await joinRoom(contextC, url, "Mehmet");

    // A fourth participant is rejected after entering the right password.
    const contextD = await browser.newContext();
    const pageD = await contextD.newPage();
    await pageD.goto(url);
    await pageD.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await pageD.getByRole("button", { name: "Unlock" }).click();
    await expect(pageD.getByText("This private chat is full.")).toBeVisible({
      timeout: 30_000,
    });

    await contextB.close();
    await contextC.close();
    await contextD.close();
  });

  test("owner removes a member and destroys the room", async ({
    page,
    browser,
  }) => {
    const url = await createRoom(page, "e2e admin room");
    const contextB = await browser.newContext();
    const memberB = await joinRoom(contextB, url, "Ahmet");

    // Owner removes the member from the admin sheet.
    await page.getByRole("button", { name: "Room menu" }).click();
    await page.getByRole("button", { name: "Manage Ahmet" }).click();
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
    await expect(
      memberB.getByText("You were removed from this chat."),
    ).toBeVisible({ timeout: 20_000 });

    // Owner destroys the room with the two-step confirmation.
    await page.getByRole("button", { name: "Destroy chat" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Destroy permanently" }).click();
    await expect(page.getByText("This chat was destroyed.")).toBeVisible({
      timeout: 30_000,
    });

    await contextB.close();
  });

  test("file upload round-trips through encrypted chunks", async ({
    page,
    browser,
  }) => {
    const url = await createRoom(page, "e2e files");
    const contextB = await browser.newContext();
    const memberB = await joinRoom(contextB, url, "Ahmet");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach a file" }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("encrypted file content"),
    });
    await expect(memberB.getByText("notes.txt")).toBeVisible({
      timeout: 60_000,
    });
    await contextB.close();
  });
});

test.describe("error states", () => {
  test("an unknown room shows the gone screen", async ({ page }) => {
    await page.goto("/c/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await expect(page.getByText("This chat no longer exists.")).toBeVisible({
      timeout: 30_000,
    });
  });
});
