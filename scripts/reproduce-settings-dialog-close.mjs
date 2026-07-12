import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  await page.route("**/api/settings/memory", async (route) => {
    const entries = route.request().method() === "DELETE"
      ? []
      : [{
          id: "regression-memory",
          category: "preference",
          content: "Regression test memory",
          createdAt: Date.now(),
          relevance: 1,
        }];

    await route.fulfill({ json: { entries } });
  });
  await page.route("**/api/settings/sessions", (route) => {
    const sessions = route.request().method() === "DELETE"
      ? []
      : [{
          id: "regression-session",
          title: "Regression test session",
          summary: "Checks nested settings dialogs",
          updatedAt: Date.now(),
        }];

    return route.fulfill({ json: { sessions } });
  });

  await page.goto("http://localhost:3010");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Memories" }).click();
  const memoriesHeader = page.getByRole("heading", { name: "Long-Term Memories" });
  const clearMemoriesButton = memoriesHeader.locator("..").getByRole("button", { name: "Clear All" });
  await clearMemoriesButton.click();

  let confirmation = page.getByRole("dialog").filter({ hasText: "Clear Memories" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();

  const settingsDialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: "Preferences" });
  await page.waitForTimeout(300);
  let settingsDialogExists = await settingsDialog.count() > 0;
  if (!settingsDialogExists || await settingsDialog.getAttribute("data-state") !== "open") {
    throw new Error("Settings dialog closed after cancelling Clear Memories");
  }

  await clearMemoriesButton.click();
  confirmation = page.getByRole("dialog").filter({ hasText: "Clear Memories" });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/settings/memory")
      && response.request().method() === "DELETE"
    ),
    confirmation.getByRole("button", { name: "Clear All" }).click(),
  ]);

  await page.waitForTimeout(300);
  settingsDialogExists = await settingsDialog.count() > 0;
  if (!settingsDialogExists || await settingsDialog.getAttribute("data-state") !== "open") {
    throw new Error("Settings dialog closed after confirming Clear Memories");
  }

  const sessionsHeader = page.getByRole("heading", { name: "Past Sessions" });
  await sessionsHeader.locator("..").getByRole("button", { name: "Clear All" }).click();
  confirmation = page.getByRole("dialog").filter({ hasText: "Clear Sessions" });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/settings/sessions")
      && response.request().method() === "DELETE"
    ),
    confirmation.getByRole("button", { name: "Clear All" }).click(),
  ]);

  await page.waitForTimeout(300);
  settingsDialogExists = await settingsDialog.count() > 0;
  if (!settingsDialogExists || await settingsDialog.getAttribute("data-state") !== "open") {
    throw new Error("Settings dialog closed after confirming Clear Sessions");
  }

  await page.getByRole("tab", { name: "Advanced" }).click();
  await page.getByRole("button", { name: "Add Provider" }).click();
  const providerDialog = page.getByRole("dialog").filter({ hasText: "Add Provider" });
  await providerDialog.getByRole("button", { name: "Close" }).click();

  await page.waitForTimeout(300);
  settingsDialogExists = await settingsDialog.count() > 0;
  if (!settingsDialogExists || await settingsDialog.getAttribute("data-state") !== "open") {
    throw new Error("Settings dialog closed after dismissing Add Provider");
  }

  console.log("Settings dialog remained open after nested dialogs were cancelled, confirmed, and dismissed");
} finally {
  await browser.close();
}