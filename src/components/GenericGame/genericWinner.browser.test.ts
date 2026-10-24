/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";
import type { GenericGame } from "../../types";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
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

async function seedPlayers(page: Page, names = ["Zed", "Amy", "Bob"]) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<string[]>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const ids = [];
    for (const name of ${JSON.stringify(names)}) {
      ids.push((await playersApi.create({ name, color: "Jam", isFavorite: 1 })).id);
    }
    return ids;
  })()`);
}

async function seedGame(page: Page, names: string[]) {
  const players = await seedPlayers(page, names);
  const game = await page.evaluate<GenericGame>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.create({
      players: ${JSON.stringify(players)},
      settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
    });
  })()`);
  await page.reload();
  await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
  await page.getByRole("table", { name: "Rounds Won scoreboard" }).waitFor();
  return game;
}

it("selects the mode in fresh setup and records one winner with reselection, retained draft and accumulated outcomes", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await seedPlayers(page);
    await page.goto(`${appUrl}#/scorekeeper/create`);
    for (const name of ["Zed", "Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const mode = page.getByRole("button", { name: /Scoring Mode/ });
    expect(await mode.innerText()).toContain("Points");
    await page.getByRole("radio", { name: "Low wins", exact: true }).click();
    await page.getByRole("switch", { name: "Dealer", exact: true }).click();
    await mode.click();
    await page.getByRole("option", { name: "Single Round Winner", exact: true }).click();
    expect(await page.getByRole("radiogroup", { name: "Points Direction" }).count()).toBe(0);
    expect(await page.getByText(/Tiebreaker/).count()).toBe(0);
    expect(await page.getByRole("switch", { name: "Dealer", exact: true }).isChecked()).toBe(true);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("table", { name: "Rounds Won scoreboard" }).waitFor();
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    expect(await save.isDisabled()).toBe(true);
    expect(await dialog.getByRole("tab").count()).toBe(0);
    expect(await dialog.getByRole("radio").count()).toBe(3);
    await dialog.getByRole("radio", { name: "Zed", exact: true }).click();
    await dialog.getByRole("radio", { name: "Amy", exact: true }).click();
    expect(await dialog.getByRole("radio", { checked: true }).allTextContents()).toEqual(["Amy"]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await add.click();
    expect(await dialog.getByRole("radio", { name: "Amy", exact: true }).isChecked()).toBe(true);
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("cell", { name: "Amy, Round 1: Won", exact: true }).waitFor();
    expect(
      await page.getByRole("cell", { name: "Zed, Round 1: Lost, Dealer", exact: true }).count(),
    ).toBe(1);
    expect(await page.getByRole("columnheader", { name: /Amy/ }).innerText()).toContain(
      "Total Wins: 1",
    );
    await expectIconColor(
      page.getByRole("cell", { name: "Amy, Round 1: Won", exact: true }).locator("svg"),
      "--color-pt-green-500",
    );
    await expectIconColor(
      page.getByRole("cell", { name: "Bob, Round 1: Lost", exact: true }).locator("svg"),
      "--color-pt-red-500",
    );
    const amyHeader = page.getByRole("columnheader", { name: /Amy/ });
    expect(await amyHeader.getByText("A", { exact: true }).isVisible()).toBe(true);
    expect(await amyHeader.getByText("Amy", { exact: true }).isVisible()).toBe(false);
    await add.click();
    expect(await save.isDisabled()).toBe(true);
    expect(await dialog.getByRole("radio", { checked: true }).count()).toBe(0);
    await dialog.getByRole("radio", { name: "Zed", exact: true }).focus();
    await page.keyboard.press("Space");
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(
      await page.getByRole("cell", { name: "Amy, Round 1: Won", exact: true }).innerText(),
    ).toContain("Accumulated Wins: 1");
    expect(
      await page.getByRole("cell", { name: "Zed, Round 1: Lost, Dealer", exact: true }).innerText(),
    ).toContain("Accumulated Wins: 0");
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    expect(await standings.getByRole("listitem").allTextContents()).toEqual([
      "Place 11ZedTotal Wins: 1",
      "Tied for place 11AmyTotal Wins: 1",
      "Place 33BobTotal Wins: 0",
    ]);
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Finish Game", exact: true })
      .getByRole("button", { name: "Finish", exact: true })
      .click();
    await standings.getByRole("list", { name: "Standings places" }).waitFor();
    const gameId = page.url().split("/").at(-1);
    const completed = await page.evaluate<GenericGame>(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
      await playersApi.update(game.players[0], { name: "Renamed", color: "#123456" });
      await playersApi.delete(game.players[1]);
      return game;
    })()`);
    if (completed.status !== "completed") throw new Error("Expected manual completion");
    expect(completed.winnerIds).toEqual([completed.players[0], completed.players[1]]);
    await page.reload();
    await standings.getByRole("list", { name: "Standings places" }).waitFor();
    expect(await standings.getByRole("listitem").allTextContents()).toEqual([
      "Place 11ZedTotal Wins: 1",
      "Tied for place 11AmyTotal Wins: 1",
      "Place 33BobTotal Wins: 0",
    ]);
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "hidden" });
    expect(await page.getByRole("button", { name: /Add Round|Finish Game|Edit/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Expand Round 2", exact: true }).click();
    expect(
      await page.getByRole("cell", { name: "Zed, Round 2: Won", exact: true }).innerText(),
    ).toContain("Accumulated Wins: 1");
    expect(
      await page.getByRole("cell", { name: "Amy, Round 2: Lost, Dealer", exact: true }).innerText(),
    ).toContain("Accumulated Wins: 1");
    expect(await page.getByRole("columnheader", { name: /Renamed/ }).count()).toBe(0);
    await returnToDashboard(page);
    expect(await page.getByRole("link", { name: /Continue game with/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Games", exact: true }).click();
    await page
      .getByRole("link", { name: "View Standings for game with Zed, Amy, Bob", exact: true })
      .click();
    await standings.getByRole("list", { name: "Standings places" }).waitFor();
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await page.getByRole("button", { name: /Scoring Mode/ }).innerText()).toContain(
      "Points",
    );
    expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
      true,
    );
    expect(await page.getByRole("switch", { name: "Dealer", exact: true }).isChecked()).toBe(false);
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps solo entry explicit, discards drafts on navigation and reload, and finishes only by request", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await seedGame(page, ["Solo"]);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    expect(await finish.getByRole("button", { name: "Finish", exact: true }).count()).toBe(0);
    expect(await finish.getByRole("button", { name: "Delete", exact: true }).isEnabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await finish.waitFor({ state: "hidden" });
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    const solo = entry.getByRole("radio", { name: "Solo", exact: true });
    const save = entry.getByRole("button", { name: "Save", exact: true });
    await add.click();
    expect(await save.isDisabled()).toBe(true);
    await solo.click();
    await page.keyboard.press("Escape");
    await entry.waitFor({ state: "hidden" });
    await expect
      .poll(() => add.evaluate((element) => element === document.activeElement))
      .toBe(true);
    await add.click();
    expect(await solo.isChecked()).toBe(true);
    await page.keyboard.press("Escape");
    await entry.waitFor({ state: "hidden" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Solo", exact: true }).click();
    await add.click();
    expect(await solo.isChecked()).toBe(false);
    await solo.click();
    await page.reload();
    await add.click();
    expect(await solo.isChecked()).toBe(false);
    await solo.click();
    await save.click();
    await entry.waitFor({ state: "hidden" });
    await page.getByRole("cell", { name: "Solo, Round 1: Won", exact: true }).waitFor();
    expect(await page.getByRole("columnheader", { name: /Solo/ }).innerText()).toContain(
      "Total Wins: 1",
    );
    expect(await add.isVisible()).toBe(true);
    expect(await page.getByRole("img", { name: "Dealer" }).count()).toBe(0);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Standings", exact: true })
      .getByRole("list", { name: "Standings places" })
      .waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  { width: 320, height: 480 },
  { width: 768, height: 1024 },
])("keeps the complete winner list scrollable, capsules unclipped on press and keyboard focus visible at $width x $height", async (viewport) => {
  const page = await browser.newPage({ viewport, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const names = Array.from({ length: 14 }, (_, index) => `Player ${index + 1}`);
    await seedGame(page, names);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    const scroll = entry.getByRole("region", { name: "Choose Round Winner", exact: true });
    const radios = entry.getByRole("radio");
    await radios.first().click({ trial: true });
    expect(await radios.count()).toBe(14);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    for (const index of [0, 13]) {
      await scroll.evaluate((element, bottom) => {
        element.scrollTop = bottom ? element.scrollHeight : 0;
      }, index === 13);
      const radio = radios.nth(index);
      const before = await radio.boundingBox();
      if (!before) throw new Error("Missing Player capsule");
      expect(before.height).toBeGreaterThanOrEqual(44);
      expect(
        await radio.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
        ),
      ).toBeGreaterThanOrEqual(before.height / 2);
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => (await radio.boundingBox())?.width ?? 0)
        .toBeGreaterThan(before.width + 1);
      await expectUnclipped(radio, scroll);
      await page.mouse.up();
      expect(await radio.isChecked()).toBe(true);
      expect(await radio.locator("svg.lucide-check").isVisible()).toBe(true);
    }
    await radios.first().focus();
    await page.keyboard.press("ArrowDown");
    expect(await radios.nth(1).isChecked()).toBe(true);
    expect(await radios.first().isChecked()).toBe(false);
    expect(await radios.first().locator("svg.lucide-check").isVisible()).toBe(false);
    await expect
      .poll(() => radios.nth(1).evaluate((element) => getComputedStyle(element).outlineStyle))
      .toBe("solid");
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    for (let index = 0; index < 7; index++) {
      await page.keyboard.press(tab);
      expect(await entry.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    const save = entry.getByRole("button", { name: "Save", exact: true });
    const box = await save.boundingBox();
    if (!box) throw new Error("Missing Save button");
    expect(box.y + box.height).toBeLessThan(viewport.height);
    expect(box.x + box.width).toBeLessThan(viewport.width);
    expect(await page.locator("body").evaluate((element) => element.scrollWidth)).toBe(
      viewport.width,
    );
    await save.click();
    await entry.waitFor({ state: "hidden" });
    await page.getByRole("cell", { name: "Player 2, Round 1: Won", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

async function expectUnclipped(control: Locator, scroll: Locator) {
  const pressed = await control.boundingBox();
  const bounds = await scroll.boundingBox();
  if (!pressed || !bounds) throw new Error("Missing pressed capsule geometry");
  expect(pressed.x).toBeGreaterThan(bounds.x);
  expect(pressed.x + pressed.width).toBeLessThan(bounds.x + bounds.width);
  expect(pressed.y).toBeGreaterThanOrEqual(bounds.y);
  expect(pressed.y + pressed.height).toBeLessThan(bounds.y + bounds.height - 10);
}

async function expectIconColor(icon: Locator, token: string) {
  await expect
    .poll(() =>
      icon.evaluate((element, name) => {
        const reference = document.createElement("span");
        reference.style.color = `var(${name})`;
        document.body.append(reference);
        const expected = getComputedStyle(reference).color;
        reference.remove();
        return getComputedStyle(element).color === expected;
      }, token),
    )
    .toBe(true);
}

it("keeps the mode dropdown and hidden Points direction usable within a narrow setup draft", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Low wins", exact: true }).click();
    const mode = page.getByRole("button", { name: /Scoring Mode/ });
    await mode.focus();
    await page.keyboard.press("Space");
    await page.getByRole("option", { name: "Single Round Winner", exact: true }).waitFor();
    await page.keyboard.type("Single Round Winner");
    await page.keyboard.press("Enter");
    expect(await mode.innerText()).toContain("Single Round Winner");
    await expect
      .poll(() =>
        mode.evaluate((element) => ({
          focused: element === document.activeElement,
          outline: getComputedStyle(element).outlineStyle,
        })),
      )
      .toEqual({ focused: true, outline: "solid" });
    const bounds = await mode.boundingBox();
    if (!bounds) throw new Error("Missing Scoring Mode control");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(await page.locator("body").evaluate((element) => element.scrollWidth)).toBe(320);
    await mode.click();
    await page.getByRole("option", { name: "Points", exact: true }).click();
    expect(await page.getByRole("radio", { name: "Low wins", exact: true }).isChecked()).toBe(true);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await mode.innerText()).toContain("Points");
    expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
      true,
    );
  } finally {
    await page.close();
  }
}, 60_000);
