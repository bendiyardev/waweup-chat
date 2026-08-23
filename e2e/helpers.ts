import { expect, type BrowserContext, type Page } from "@playwright/test";

export const hasSecrets =
  !!process.env.BLOB_READ_WRITE_TOKEN &&
  !!process.env.PUSHER_SECRET &&
  !!process.env.NEXT_PUBLIC_PUSHER_KEY;

export const PASSWORD = "e2e-password-123!";

export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Chat name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Expires after").selectOption("1d");
  await page.getByRole("button", { name: "Create encrypted chat" }).click();
  await expect(page.getByText("Save your owner recovery key")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Continue to chat" }).click();
  await page.getByLabel("Username").fill("Diyar");
  await page.getByRole("button", { name: "Join chat" }).click();
  await expect(page.getByText("No messages yet.")).toBeVisible({
    timeout: 30_000,
  });
  return page.url();
}

export async function joinRoom(
  context: BrowserContext,
  url: string,
  username: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByLabel("Username")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Join chat" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return page;
}

export async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}
