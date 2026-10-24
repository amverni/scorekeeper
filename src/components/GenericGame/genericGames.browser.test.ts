/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  appUrl = `http://127.0.0.1:${address.port}/scorekeeper/`;
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function createPlayerInSetup(page: Page, name: string) {
  await page.getByRole("button", { name: "Add Player", exact: true }).click();
  await page.getByRole("button", { name: "Create new player", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("switch", { name: "Favorite", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const search = page
    .getByRole("dialog", { name: "Add player", exact: true })
    .getByPlaceholder(/Search players/);
  await search.waitFor();
  await page.keyboard.press("Escape");
  await search.waitFor({ state: "hidden" });
}

async function seedSharedPlayers(page: Page) {
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  await page.evaluate(`
    import("/scorekeeper/src/data/api/players.ts").then(async ({ playersApi }) => {
      for (const name of ["Maya", "Rowan", "Lee"]) {
        await playersApi.create({ name, color: "Jam", isFavorite: 1 });
      }
    })
  `);
  await page.reload();
}

function setupPlayerOrder(page: Page) {
  return page
    .getByRole("button", { name: /^Reorder / })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.replace("Reorder ", "") ?? ""),
    );
}

async function expectScoreboardOrder(page: Page, names: string[]) {
  const columns = page.getByRole("columnheader");
  expect(await columns.count()).toBe(names.length + 1);
  expect(await columns.first().innerText()).toBe("Round");
  for (const [index, name] of names.entries()) {
    expect(
      await columns
        .nth(index + 1)
        .getByText(name, { exact: true })
        .count(),
    ).toBe(1);
  }
}

describe("generic Points Games", () => {
  it("creates a solo Game and reopens its genuine empty scoreboard after reload", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${appUrl}#/scorekeeper/create`);
      await expect.poll(() => page.getByRole("tab", { name: "Players" }).count()).toBe(1);
      expect(await page.getByRole("tab").allTextContents()).toEqual(["Players", "Settings"]);
      expect(await page.locator(".card-background").count()).toBe(0);
      expect(await page.getByRole("button", { name: /Info|Tips/i }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
        true,
      );
      expect(await page.getByRole("switch", { name: "Dealer", exact: true }).isChecked()).toBe(
        false,
      );
      expect(await page.getByRole("combobox").count()).toBe(0);
      await page.getByRole("tab", { name: "Players", exact: true }).click();
      await createPlayerInSetup(page, "Maya");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
      const gameUrl = page.url();
      expect(gameUrl).toMatch(/#\/scorekeeper\/game\/[^/]+$/);
      await page.reload();
      await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
      expect(await page.getByRole("columnheader", { name: /Maya/ }).count()).toBe(1);
      expect(await page.getByText("No rounds yet.", { exact: true }).count()).toBe(0);
      expect(
        await page.getByRole("cell", { name: "Maya, upcoming Round", exact: true }).innerText(),
      ).toBe("");
      expect(await page.getByRole("button", { name: /Settings|Players/ }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(1);
      expect(await page.getByText(/Phase|Dealer|Tiebreaker/).count()).toBe(0);
      await returnToDashboard(page);
      const resume = page.getByRole("link", { name: "Continue game with Maya", exact: true });
      await resume.waitFor();
      expect(await resume.getAttribute("href")).toContain("#/scorekeeper/game/");
      await resume.click();
      expect(page.url()).toBe(gameUrl);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps multi-Player order and Low wins fixed, starts fresh, and deletes only the chosen Game", async () => {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    try {
      await seedSharedPlayers(page);
      await page.goto(`${appUrl}#/scorekeeper/create`);
      for (const name of ["Maya", "Rowan", "Lee"]) {
        await page.getByRole("button", { name, exact: true }).click();
      }
      await page.evaluate(() =>
        Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
      );
      const reorder = page.getByRole("button", { name: "Reorder Lee", exact: true });
      await reorder.focus();
      await page.keyboard.press("Space");
      // The keyboard sensor attaches its listeners after the initiating key event.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const dragAnnouncement = await page.locator("[aria-live]").innerText();
      await page.keyboard.press("ArrowUp");
      await expect.poll(() => page.locator("[aria-live]").innerText()).not.toBe(dragAnnouncement);
      await page.keyboard.press("Space");
      await expect.poll(() => setupPlayerOrder(page)).toEqual(["Maya", "Lee", "Rowan"]);
      await page.evaluate(() => {
        Math.random = () => 0;
      });
      await page.getByRole("button", { name: "Shuffle player order", exact: true }).click();
      const order = await setupPlayerOrder(page);
      expect(order).not.toEqual(["Maya", "Lee", "Rowan"]);
      expect([...order].sort()).toEqual(["Lee", "Maya", "Rowan"]);
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      const high = page.getByRole("radio", { name: "High wins", exact: true });
      await high.focus();
      await page.keyboard.press("ArrowRight");
      expect(await page.getByRole("radio", { name: "Low wins", exact: true }).isChecked()).toBe(
        true,
      );
      const direction = await page
        .getByRole("radiogroup", { name: "Points Direction" })
        .boundingBox();
      if (!direction) throw new Error("Missing Points Direction control");
      expect(direction.x).toBeGreaterThanOrEqual(0);
      expect(direction.x + direction.width).toBeLessThanOrEqual(320);
      const dealer = page.getByRole("switch", { name: "Dealer", exact: true });
      expect(await dealer.isChecked()).toBe(false);
      await dealer.focus();
      await page.keyboard.press("Space");
      expect(await dealer.isChecked()).toBe(true);
      await page.getByRole("tab", { name: "Players", exact: true }).click();
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await dealer.isChecked()).toBe(true);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
      const gameUrl = page.url();
      await expectScoreboardOrder(page, order);
      expect(
        await page
          .getByRole("cell", { name: `${order[0]}, upcoming Round: Dealer`, exact: true })
          .count(),
      ).toBe(1);
      await page.reload();
      await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
      await expectScoreboardOrder(page, order);
      expect(
        await page
          .getByRole("cell", { name: `${order[0]}, upcoming Round: Dealer`, exact: true })
          .count(),
      ).toBe(1);
      const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
      await expect.poll(() => scoreboard.count()).toBe(1);
      await scoreboard.focus();
      expect(await scoreboard.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(
        await scoreboard.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(await page.getByRole("button", { name: /Reorder|Remove|Settings/ }).count()).toBe(0);
      await returnToDashboard(page);
      await page.getByRole("link", { name: "Create Game", exact: true }).click();
      expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
        true,
      );
      expect(await page.getByRole("switch", { name: "Dealer", exact: true }).isChecked()).toBe(
        false,
      );
      await page.getByRole("link", { name: "Cancel", exact: true }).click();
      const deleteButton = page.getByRole("button", {
        name: `Delete game with ${order.join(", ")}`,
        exact: true,
      });
      await deleteButton.click();
      await page.getByText("No active games yet", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("No active games yet", { exact: true }).waitFor();
      await page.goto(gameUrl);
      await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
      await returnToDashboard(page);
      expect(page.url()).toBe(`${appUrl}#/scorekeeper`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("shares live Player edits and deletion protection without mixing scorekeeper Games", async () => {
    const page = await browser.newPage();
    try {
      await seedSharedPlayers(page);
      await page.goto(`${appUrl}#/phaseCompan10n/create`);
      await page.getByRole("button", { name: "Maya", exact: true }).click();
      expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole("button", { name: "Rowan", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("button", { name: "Open Standings", exact: true }).waitFor();
      const phaseUrl = page.url();
      await page.goto(`${appUrl}#/scorekeeper/create`);
      await page.getByRole("button", { name: "Lee", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
      const genericUrl = page.url();
      await returnToDashboard(page);
      await page.getByRole("link", { name: "Continue game with Lee", exact: true }).waitFor();
      expect(await page.getByRole("link", { name: /^Continue game with / }).count()).toBe(1);
      await page.goto(`${appUrl}#/phaseCompan10n`);
      await page
        .getByRole("link", { name: "Continue game with Maya, Rowan", exact: true })
        .waitFor();
      expect(await page.getByRole("link", { name: /^Continue game with / }).count()).toBe(1);
      await page.goto(`${appUrl}#/phaseCompan10n/players`);
      await page.getByRole("button", { name: "Lee", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit player", exact: true });
      await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Lee Updated");
      await editor.getByRole("radio", { name: "Select color Rose", exact: true }).check();
      await editor.getByRole("switch", { name: "Favorite", exact: true }).click();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete Lee Updated", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Active Game" }).waitFor();
      await page.goto(`${appUrl}#/scorekeeper`);
      await page.getByRole("link", { name: "Continue game with Lee Updated", exact: true }).click();
      await page.getByRole("columnheader", { name: /Lee Updated/ }).waitFor();
      await returnToDashboard(page);
      await page.getByRole("link", { name: "Create Game", exact: true }).click();
      await page.getByRole("button", { name: "Maya", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Lee Updated", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      await page.getByRole("button", { name: "Lee Updated", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Reorder Lee Updated", exact: true }).waitFor();
      await page.getByRole("link", { name: "Cancel", exact: true }).click();
      await page.goto(phaseUrl.replace("/phaseCompan10n/game/", "/scorekeeper/game/"));
      await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
      expect(await page.getByRole("table").count()).toBe(0);
      await page.goto(genericUrl.replace("/scorekeeper/game/", "/phaseCompan10n/game/"));
      await page.getByText("This Game is no longer available.", { exact: true }).waitFor();
      await returnToDashboard(page);
      await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
      expect(page.url()).toBe(`${appUrl}#/phaseCompan10n`);
      await page.goto(`${appUrl}#/scorekeeper`);
      await page.getByRole("button", { name: "Delete game with Lee Updated", exact: true }).click();
      await page.getByText("No active games yet", { exact: true }).waitFor();
      await page.goto(`${appUrl}#/scorekeeper/players`);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete Lee Updated", exact: true }).click();
      await expect
        .poll(() => page.getByRole("button", { name: "Lee Updated", exact: true }).count())
        .toBe(0);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete Maya", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Active Game" }).waitFor();
    } finally {
      await page.close();
    }
  }, 60_000);

  it("shows actionable storage errors instead of an empty success state", async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = () => {
          throw new DOMException("Storage temporarily unavailable", "UnknownError");
        };
        window.addEventListener("restore-test-storage", () => {
          IDBFactory.prototype.open = open;
        });
      });
      await page.goto(`${appUrl}#/scorekeeper`);
      await page.getByRole("alert").filter({ hasText: "Unable to load Active Games." }).waitFor();
      expect(await page.getByText("No active games yet", { exact: true }).count()).toBe(0);
      await page.evaluate(() => window.dispatchEvent(new Event("restore-test-storage")));
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByText("No active games yet", { exact: true }).waitFor();
      await page.goto(`${appUrl}#/scorekeeper/game/missing`);
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "Unable to load this Game." }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event("restore-test-storage")));
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
      await returnToDashboard(page);
      expect(page.url()).toBe(`${appUrl}#/scorekeeper`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps setup recoverable when a selected Player is deleted before Start", async () => {
    const page = await browser.newPage();
    try {
      await seedSharedPlayers(page);
      await page.goto(`${appUrl}#/scorekeeper/create`);
      await page.getByRole("button", { name: "Maya", exact: true }).click();
      await page.evaluate(`
        import("/scorekeeper/src/data/api/players.ts").then(async ({ playersApi }) => {
          const [maya] = await playersApi.getAll({ name: "Maya" });
          await playersApi.delete(maya.id);
        })
      `);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Player no longer exists" }).waitFor();
      expect(page.url()).toBe(`${appUrl}#/scorekeeper/create`);
      await page.getByRole("button", { name: "Remove Maya", exact: true }).click();
      await page.getByRole("button", { name: "Rowan", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("columnheader", { name: /Rowan/ }).waitFor();
      await returnToDashboard(page);
      await page.getByRole("link", { name: "Continue game with Rowan", exact: true }).waitFor();
      expect(await page.getByRole("link", { name: /^Continue game with / }).count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);
});
