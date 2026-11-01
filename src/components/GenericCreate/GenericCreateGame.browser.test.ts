/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

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

async function createPlayer(page: Page, name: string) {
  await page.getByRole("button", { name: "Add Player", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create new player", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("heading", { name: "New Player", exact: true }).waitFor({
    state: "hidden",
  });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

it("treats zero selected Players as normal setup and can start a Generic Game after reselecting one", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  page.setDefaultNavigationTimeout(60_000);
  try {
    await page.goto(`${appUrl}#/scorekeeper/create`);
    const start = page.getByRole("button", { name: "Start", exact: true });
    await start.waitFor();
    expect(await start.isDisabled()).toBe(true);
    expect(await page.getByRole("alert").count()).toBe(0);

    await createPlayer(page, "Amy");
    await expect.poll(() => start.isEnabled()).toBe(true);
    await createPlayer(page, "Bob");

    await page.getByRole("button", { name: "Remove Amy", exact: true }).click();
    await expect.poll(() => start.isEnabled()).toBe(true);
    const removeBob = page.getByRole("button", { name: "Remove Bob", exact: true });
    await removeBob.click();
    await removeBob.waitFor({ state: "hidden" });
    await expect.poll(() => start.isDisabled()).toBe(true);
    expect(await page.getByRole("alert").count()).toBe(0);

    await page.getByRole("button", { name: "Add Player", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Amy");
    await dialog.getByRole("button", { name: /Amy/ }).click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => start.isEnabled()).toBe(true);
    expect(await page.getByRole("alert").count()).toBe(0);
    await start.click();

    await page.waitForURL(/#\/scorekeeper\/game\/[^/]+$/);
    await page.getByRole("button", { name: "Add Round", exact: true }).waitFor();
    await page.getByRole("cell", { name: "Amy, upcoming Round", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 90_000);

async function openSetup(page: Page, experience = "scorekeeper") {
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(60_000);
  await page.goto(`${appUrl}#/${experience}`);
  await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
  await page.evaluate(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    for (const [name, color] of [["Amy", "Jam"], ["Bob", "Pacific"], ["Cam", "Fairway"]]) {
      await playersApi.create({ name, color, isFavorite: 1 });
    }
  })()`);
  await page.getByRole("link", { name: "Create Game", exact: true }).click();
}

async function enableDealer(page: Page) {
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Dealer", exact: true }).click();
  await page.getByRole("tab", { name: "Players", exact: true }).click();
}

it.each([
  "scorekeeper",
  "phaseCompan10n",
])("keeps the %s First Dealer choice tied to Player identity through keyboard selection, reorder, shuffle and removal", async (experience) => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  try {
    await openSetup(page, experience);
    const dealer = page.getByRole("button", { name: "Choose First Dealer", exact: true });
    if (experience === "scorekeeper") {
      expect(await dealer.count()).toBe(0);
      await enableDealer(page);
    }
    const start = page.getByRole("button", { name: "Start", exact: true });
    expect(await start.isDisabled()).toBe(true);
    await dealer.click();
    expect(await page.getByRole("option").allTextContents()).toEqual(["Random"]);
    expect(
      await page.getByRole("option", { name: "Random", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    expect(await dealer.evaluate((element) => element === document.activeElement)).toBe(true);
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    const shuffle = page.getByRole("button", { name: "Shuffle player order", exact: true });
    const dealerBox = await dealer.boundingBox();
    const shuffleBox = await shuffle.boundingBox();
    if (!dealerBox || !shuffleBox) throw new Error("Missing roster toolbar");
    expect(dealerBox.x).toBeGreaterThanOrEqual(shuffleBox.x + shuffleBox.width);
    expect([dealerBox.width, dealerBox.height, dealerBox.y]).toEqual([
      shuffleBox.width,
      shuffleBox.height,
      shuffleBox.y,
    ]);
    await dealer.focus();
    await page.keyboard.press("Space");
    const options = page.getByRole("option");
    await options.first().waitFor();
    expect(await options.allTextContents()).toEqual(["Random", "Amy", "Bob"]);
    for (const name of ["Amy", "Bob"]) {
      expect(await page.getByRole("option", { name, exact: true }).locator("svg").count()).toBe(2);
      expect(await page.getByRole("option", { name, exact: true }).innerText()).toBe(name);
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const roster = page.getByRole("list", { name: "Seating Order", exact: true });
    const bob = roster.getByRole("listitem").filter({ hasText: "Bob" });
    await bob.getByText("D", { exact: true }).waitFor();
    expect(await roster.getByText("D", { exact: true }).count()).toBe(1);
    expect(
      await bob
        .getByText("Bob", { exact: true })
        .evaluate((element) => element.nextElementSibling?.textContent),
    ).toBe("D");

    await page.getByRole("button", { name: "Reorder Bob", exact: true }).focus();
    await page.keyboard.press("Space");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(() => page.locator("[aria-live]").allTextContents())
      .toContain("Bob moved to position 1 of 2.");
    await page.keyboard.press("Space");
    await dealer.click();
    expect(await options.allTextContents()).toEqual(["Random", "Bob", "Amy"]);
    expect(
      await page.getByRole("option", { name: "Bob", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    await shuffle.click();
    await bob.getByText("D", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    const seatingNames = await roster
      .getByRole("button", { name: /^Remove / })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")?.replace("Remove ", "")),
      );
    await dealer.click();
    expect(await options.allTextContents()).toEqual(["Random", ...seatingNames]);
    await page.getByRole("option", { name: "Random", exact: true }).click();
    await expect.poll(() => roster.getByText("D", { exact: true }).count()).toBe(0);
    await dealer.click();
    await page.getByRole("option", { name: "Bob", exact: true }).click();
    await page.getByRole("button", { name: "Remove Bob", exact: true }).click();
    await dealer.click();
    await expect.poll(() => options.allTextContents()).not.toContain("Bob");
    expect(
      await page.getByRole("option", { name: "Random", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    if (experience === "scorekeeper") {
      await enableDealer(page);
      expect(await dealer.count()).toBe(0);
    }
    expect(await roster.getByText("D", { exact: true }).count()).toBe(0);
    expect(await start.isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  { experience: "scorekeeper", count: 1 },
  { experience: "scorekeeper", count: 3 },
  { experience: "phaseCompan10n", count: 2 },
  { experience: "phaseCompan10n", count: 3 },
])("resolves the default Random choice from the final $count-Player $experience roster only on Start", async ({
  experience,
  count,
}) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await openSetup(page, experience);
    if (experience === "scorekeeper") await enableDealer(page);
    await page.getByRole("button", { name: "Amy", exact: true }).tap();
    expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
      experience === "phaseCompan10n",
    );
    const trigger = page.getByRole("button", { name: "Choose First Dealer", exact: true });
    await trigger.tap();
    expect(
      await page.getByRole("option", { name: "Random", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.getByRole("option", { name: "Random", exact: true }).tap();
    for (const name of ["Bob", "Cam"].slice(0, count - 1)) {
      await page.getByRole("button", { name, exact: true }).tap();
    }
    expect(
      await page
        .getByRole("list", { name: "Seating Order", exact: true })
        .getByText("D", { exact: true })
        .count(),
    ).toBe(0);
    await page.evaluate(() => {
      Math.random = () => 0.999999;
    });
    await page.getByRole("button", { name: "Start", exact: true }).tap();
    await page.waitForURL(new RegExp(`#/${experience}/game/[^/]+$`));
    const name = ["Amy", "Bob", "Cam"][count - 1];
    const dealer =
      experience === "scorekeeper"
        ? page.getByRole("cell", { name: `${name}, upcoming Round: Dealer`, exact: true })
        : page.getByText(`Upcoming Round Dealer: ${name}`, { exact: true });
    await dealer.waitFor({ state: "attached" });
    await page.reload();
    await dealer.waitFor({ state: "attached" });
  } finally {
    await page.close();
  }
}, 60_000);

it("retains the Phase 10 First Dealer choice after a creation storage failure and retries directly onto its scoreboard", async () => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await openSetup(page, "phaseCompan10n");
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).tap();
    }
    await page.getByRole("button", { name: "Choose First Dealer", exact: true }).tap();
    await page.getByRole("option", { name: "Bob", exact: true }).tap();
    await page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.add = add;
          throw new DOMException("Game storage unavailable", "QuotaExceededError");
        }
        return add.call(this, value, key);
      };
    });
    const start = page.getByRole("button", { name: "Start", exact: true });
    await start.tap();
    await page.getByRole("alert").filter({ hasText: "Game storage unavailable" }).waitFor();
    await page
      .getByRole("list", { name: "Seating Order", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "Bob" })
      .getByText("D", { exact: true })
      .waitFor();
    expect(page.url()).toContain("#/phaseCompan10n/create");
    await start.tap();
    await page
      .getByText("Upcoming Round Dealer: Bob", { exact: true })
      .waitFor({ state: "attached" });
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "Points",
  "Single Round Winner",
  "Pass/Fail",
  "Phase 10",
])("starts a touch %s Game with the chosen First Dealer without changing seats", async (mode) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const phase10 = mode === "Phase 10";
    await openSetup(page, phase10 ? "phaseCompan10n" : "scorekeeper");
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).tap();
    }
    if (!phase10) await enableDealer(page);
    if (!phase10 && mode !== "Points") {
      await page.getByRole("tab", { name: "Settings", exact: true }).tap();
      await page.getByLabel("Scoring Mode", { exact: true }).tap();
      await page.getByRole("option", { name: mode, exact: true }).tap();
      await page.getByRole("tab", { name: "Players", exact: true }).tap();
    }
    await page.getByRole("button", { name: "Choose First Dealer", exact: true }).tap();
    await page.getByRole("option", { name: "Bob", exact: true }).tap();
    await page.getByRole("button", { name: "Start", exact: true }).tap();
    await page.waitForURL(/#\/(scorekeeper|phaseCompan10n)\/game\/[^/]+$/);
    const dealer = phase10
      ? page.getByText("Upcoming Round Dealer: Bob", { exact: true })
      : page.getByRole("cell", { name: "Bob, upcoming Round: Dealer", exact: true });
    await dealer.waitFor({ state: "attached" });
    const headers = phase10
      ? page.locator(".scoreboard-cell--sticky-top")
      : page.getByRole("columnheader");
    const offset = phase10 ? 0 : 1;
    expect(await headers.count()).toBe(2 + offset);
    expect(await headers.nth(offset).getByText("Amy", { exact: true }).count()).toBe(1);
    expect(
      await headers
        .nth(offset + 1)
        .getByText("Bob", { exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page.getByRole("button", { name: "Choose First Dealer", exact: true }).count(),
    ).toBe(0);
    await page.reload();
    await dealer.waitFor({ state: "attached" });
    if (phase10) return;
    await page.getByRole("button", { name: "Finish Game", exact: true }).tap();
    await page
      .getByRole("dialog", { name: "Finish Game", exact: true })
      .getByRole("button", { name: "Pause", exact: true })
      .tap();
    await page.getByRole("link", { name: /Continue/ }).tap();
    await dealer.waitFor();
  } finally {
    await page.close();
  }
}, 60_000);
