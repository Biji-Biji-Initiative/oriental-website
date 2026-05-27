import { expect, test } from "@playwright/test";

test("renders the Oriental microsite and opens form mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Reimagining/i })).toBeVisible();
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("tab", { name: "Form" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
});
