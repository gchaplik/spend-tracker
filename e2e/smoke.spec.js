import { test, expect } from "@playwright/test";

// Helpers for modals that appear on a fresh DB
async function handleTosModal(page) {
  const modal = page.locator("text=Terms of Service & Privacy Policy");
  if (!(await modal.isVisible({ timeout: 3000 }).catch(() => false))) return;

  // Scroll the terms body to the bottom so the checkbox unlocks
  const scrollable = page.locator("div").filter({ hasText: "1. Acceptance of Terms" }).first();
  await scrollable.evaluate(el => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await page.locator('input[type="checkbox"]').check();
  await page.getByText("Accept & Continue").click();
  await modal.waitFor({ state: "hidden", timeout: 5000 });
}

async function handleTutorialModal(page) {
  const close = page.locator("button").filter({ hasText: /skip|close|got it|dismiss/i });
  if (await close.isVisible({ timeout: 2000 }).catch(() => false)) {
    await close.first().click();
  }
}

test("smoke: add expense → appears in history", async ({ page }) => {
  await page.goto("/");

  // Handle first-run modals
  await handleTosModal(page);
  await handleTutorialModal(page);

  // Wait for the app shell to be ready (sidebar should be visible)
  await page.locator('[data-tutorial="dashboard"]').waitFor({ timeout: 10000 });

  // Navigate to Add Expense via sidebar
  await page.locator('[data-tutorial="manual"]').click();
  await expect(page.getByText("Add Expense").first()).toBeVisible({ timeout: 5000 });

  // Fill in the expense form
  const merchantInput = page.locator('input[placeholder*="Walmart"]');
  await merchantInput.fill("Playwright Test Store");

  const amountInput = page.locator('input[placeholder="0.00"]').first();
  await amountInput.fill("42.00");

  // Click the submit button
  await page.locator("button").filter({ hasText: "Add Expense" }).click();

  // After submit, app navigates to History
  await page.locator('[data-tutorial="history"]').waitFor({ state: "attached", timeout: 5000 });

  // Verify the transaction appears in the history list
  await expect(page.getByText("Playwright Test Store")).toBeVisible({ timeout: 5000 });
});
