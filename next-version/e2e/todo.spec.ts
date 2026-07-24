/**
 * TODO feature e2e tests (Playwright, browser-driven).
 *
 * Local development only, like test/test_nextjs_api.test.ts — not part of
 * ./run_tests.sh. Requires the full stack running (docker compose up
 * --build) and is run via:
 *
 *   cd next-version && npx playwright test
 */

import { test, expect, type Page } from "@playwright/test";

async function registerAndLogin(page: Page, username: string, password: string) {
  await page.goto("/register");
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Register" }).click();
  await page.waitForURL("**/login");

  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Submit" }).click();
  await page.waitForURL("**/namu");
}

function saoPauloEndOfDay(offsetDays = 0): string {
  // Take today's calendar date in São Paulo, then add the offset in UTC (no
  // DST edge cases at UTC), matching endOfDayOffsetLocalValue in the browser.
  const todaySP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${todaySP}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return `${d.toISOString().slice(0, 10)}T23:59`;
}

function todaySaoPauloEndOfDay(): string {
  return saoPauloEndOfDay(0);
}

test("TODO form: due-date timezone, edit pre-fill, blank default, Today button", async ({
  page,
}) => {
  const username = `todo_test_${Date.now()}`;
  await registerAndLogin(page, username, "TestPass123!");

  await page.goto("/namu/user/todo");
  const dialog = page.locator("dialog[open]");

  await test.step("first Create-form open: leave transient, unsaved state behind", async () => {
    await page.getByRole("button", { name: "+ Add To Do" }).click();
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder("What needs to be done?").fill("Throwaway");

    // Create the category we'll use for the real item, via the "+ New
    // category..." flow, while we're in here.
    await dialog.locator("select").first().selectOption({ label: "+ New category..." });
    await dialog.getByPlaceholder("New category name").fill("TestCat");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog.locator("select").first()).toHaveValue("TestCat");

    await dialog.getByRole("button", { name: "High", exact: true }).click();
    await dialog.locator('input[type="datetime-local"]').fill("2026-01-01T10:00");

    // Cancel without submitting — TodoForm stays mounted with this state.
    await dialog.getByText("✕").click();
    await expect(dialog).toBeHidden();
  });

  await test.step("reopening Create must not leak the previous session's state", async () => {
    await page.getByRole("button", { name: "+ Add To Do" }).click();
    await expect(dialog).toBeVisible();

    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("");
    await expect(dialog.locator('input[type="datetime-local"]')).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Medium", exact: true })).toHaveClass(
      /bg-amber-500/
    );
  });

  await test.step("create the real item with a specific due date", async () => {
    await dialog.getByPlaceholder("What needs to be done?").fill("Target Item");
    await dialog.locator("select").first().selectOption({ label: "TestCat" });
    await dialog.getByPlaceholder("Add details...").fill("desc text");
    await dialog.getByRole("button", { name: "Low", exact: true }).click();
    await dialog.locator('input[type="datetime-local"]').fill("2026-07-07T13:54");

    await dialog.getByRole("button", { name: "Create To Do" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("due date displayed in the list is not shifted by timezone parsing", async () => {
    await expect(page.getByText("Due: Jul 7, 01:54 PM")).toBeVisible();
  });

  await test.step("Edit pre-populates all fields from the item being edited", async () => {
    await page.locator('button[title="Edit"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Edit To Do")).toBeVisible();

    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("Target Item");
    await expect(dialog.locator("select").first()).toHaveValue("TestCat");
    await expect(dialog.getByPlaceholder("Add details...")).toHaveValue("desc text");
    await expect(dialog.locator('input[type="datetime-local"]')).toHaveValue("2026-07-07T13:54");
    await expect(dialog.getByRole("button", { name: "Low", exact: true })).toHaveClass(
      /bg-blue-500/
    );

    await dialog.getByText("✕").click();
    await expect(dialog).toBeHidden();
  });

  await test.step("Create after an Edit session is still blank, and Today fills end-of-day", async () => {
    await page.getByRole("button", { name: "+ Add To Do" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("");
    await expect(dialog.locator('input[type="datetime-local"]')).toHaveValue("");

    await dialog.getByRole("button", { name: "Today" }).click();
    await expect(dialog.locator('input[type="datetime-local"]')).toHaveValue(
      todaySaoPauloEndOfDay()
    );
  });

  await test.step("date preset chips fill end-of-day; No date clears and disables Repeat", async () => {
    const dueInput = dialog.locator('input[type="datetime-local"]');
    const repeat = dialog.locator("select").nth(1);

    await dialog.getByRole("button", { name: "Tomorrow" }).click();
    await expect(dueInput).toHaveValue(saoPauloEndOfDay(1));

    await dialog.getByRole("button", { name: "Next week" }).click();
    await expect(dueInput).toHaveValue(saoPauloEndOfDay(7));

    // With a due date set, Repeat is enabled...
    await expect(repeat).toBeEnabled();
    await dialog.getByRole("button", { name: "No date" }).click();
    await expect(dueInput).toHaveValue("");
    // ...and clearing it disables Repeat again.
    await expect(repeat).toBeDisabled();
  });

  await test.step("new Create form defaults to the last-used category and priority", async () => {
    // The last successful create used category "TestCat" and Low priority.
    await expect(dialog.locator("select").first()).toHaveValue("TestCat");
    await expect(dialog.getByRole("button", { name: "Low", exact: true })).toHaveClass(
      /bg-blue-500/
    );

    await dialog.getByText("✕").click();
    await expect(dialog).toBeHidden();
  });

  await test.step("pressing 'n' opens a fresh Create form", async () => {
    await page.keyboard.press("n");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Create To Do" })).toBeVisible();
  });
});
