import type { Page } from "playwright";

export async function returnToDashboard(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Games", exact: true }).click();
  await page.getByRole("link", { name: "Go home", exact: true }).click();
  await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
}
