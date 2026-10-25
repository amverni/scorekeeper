/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";

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

it("saves untouched Players as real zero and resets to a savable all-zero Round", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await add.click();
    expect(await save.isEnabled()).toBe(true);
    expect(await dialog.locator("output").first().innerText()).toBe("0");
    expect(
      await dialog.getByText(/entered|Score entry complete|Score entry incomplete/).count(),
    ).toBe(0);
    for (const tab of await dialog.getByRole("tab").all()) {
      expect(await tab.getAttribute("aria-describedby")).toBeNull();
      expect(await tab.locator("svg.lucide-check").count()).toBe(0);
    }
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    for (const name of ["Maya", "Rowan"]) {
      await page.getByRole("cell", { name: `${name}, Round 1: 0 Points`, exact: true }).waitFor();
    }
    await add.click();
    expect(await save.isEnabled()).toBe(true);
    expect(await dialog.locator("output").first().innerText()).toBe("0");
  } finally {
    await page.close();
  }
}, 60_000);

it("uses a noninteractive Points display with canonical pointer and keyboard entry", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page, ["Maya"]);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    expect(await dialog.getByRole("button", { name: "Maya Points", exact: true }).count()).toBe(0);
    const value = dialog.getByRole("status", { name: "Maya Points", exact: true });
    const sign = dialog.getByRole("button", { name: "Change sign", exact: true });
    const backspace = dialog.getByRole("button", { name: "Backspace", exact: true });
    const zero = dialog.getByRole("button", { name: "0", exact: true });
    expect(await value.innerText()).toBe("0");
    expect(await sign.isDisabled()).toBe(true);
    expect(await backspace.isDisabled()).toBe(true);
    await zero.focus();
    for (const key of ["-", "+", "Backspace", "Delete", "0"]) {
      await page.keyboard.press(key);
      expect(await value.innerText()).toBe("0");
    }
    await zero.click();
    await dialog.getByRole("button", { name: "1", exact: true }).click();
    expect(await value.innerText()).toBe("1");
    await sign.click();
    expect(await value.innerText()).toBe("-1");
    await backspace.click();
    expect(await value.innerText()).toBe("0");
    expect(await sign.isDisabled()).toBe(true);
    expect(await backspace.isDisabled()).toBe(true);
    await zero.focus();
    await page.keyboard.type("012-");
    expect(await value.innerText()).toBe("-12");
    await page.keyboard.press("Backspace");
    expect(await value.innerText()).toBe("-1");
    await page.keyboard.press("Backspace");
    expect(await value.innerText()).toBe("0");
    await page.keyboard.type("9-");
    await page.keyboard.press("+");
    expect(await value.innerText()).toBe("9");
    await page.keyboard.press("Delete");
    expect(await value.innerText()).toBe("0");
    await page.keyboard.type("1.5");
    expect(await value.innerText()).toBe("1.5");
    expect(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await dialog.getByRole("alert").filter({ hasText: "whole number" }).waitFor();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    expect(await value.innerText()).toBe("1");
    expect(await dialog.getByRole("alert").count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("rejects malformed and overflowing entries without losing the draft or saving a partial Round", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page, ["Maya"]);
    await saveRound(page, { Maya: "9007199254740991" });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const field = dialog.getByRole("status", { name: "Maya Points", exact: true });
    const keyboard = dialog.getByRole("button", { name: "0", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    for (const value of ["1.5", "1e2", "9007199254740992"]) {
      await keyboard.focus();
      await page.keyboard.press("Delete");
      await page.keyboard.type(value);
      expect(await field.getAttribute("aria-invalid")).toBe("true");
      expect(await save.isDisabled()).toBe(true);
      expect(await dialog.getByRole("alert").count()).toBeGreaterThan(0);
    }
    await keyboard.focus();
    await page.keyboard.press("Delete");
    await page.keyboard.type("1");
    await save.click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: /total|range|exact/i })
      .waitFor();
    expect(await field.innerText()).toContain("1");
    expect(await save.isEnabled()).toBe(true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(await page.getByRole("button", { name: "Expand Round 2", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    expect(await field.innerText()).toBe("1");
    await keyboard.focus();
    await page.keyboard.press("-");
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await page
      .getByRole("cell", { name: "Maya, Round 1: 9007199254740991 Points", exact: true })
      .waitFor();
    await page.getByRole("cell", { name: "Maya, Round 2: -1 Points", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("retains unsaved session entries through navigation, clears them on reload, and restores focus on close", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page, ["Maya"]);
    // API seeding bypasses Query invalidation; discard the home's cached empty game list.
    await page.reload();
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const standingsButton = await page
      .getByRole("button", { name: "Open Standings", exact: true })
      .boundingBox();
    await add.click();
    expect(await dialog.getAttribute("aria-modal")).toBe("true");
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    if (!standingsButton) throw new Error("Missing Standings control");
    expect(
      await page.evaluate(
        ({ x, y, width, height }) =>
          !!document.elementFromPoint(x + width / 2, y + height / 2)?.closest('[role="dialog"]'),
        standingsButton,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "0", exact: true }).focus();
    // macOS WebKit needs Option-Tab to include buttons when full keyboard access is off.
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    for (const key of [tab, `Shift+${tab}`]) {
      for (let index = 0; index < 18; index++) {
        await page.keyboard.press(key);
        await expect
          .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
          .toBe(true);
      }
    }
    await dialog.getByRole("button", { name: "8", exact: true }).click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await expect
      .poll(() => add.evaluate((element) => element === document.activeElement))
      .toBe(true);
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Maya", exact: true }).click();
    await add.click();
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "8",
    );
    await dialog.getByRole("button", { name: "7", exact: true }).click();
    await page.reload();
    await add.click();
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "0",
    );
    expect(await dialog.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

async function swipeLeft(panel: Locator) {
  await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const y = bounds.y + 40;
    const startX = bounds.x + bounds.width - 30;
    const endX = bounds.x + 20;
    const touch = (clientX: number) => ({
      identifier: 1,
      target: element,
      clientX,
      clientY: y,
    });
    for (const [type, x] of [
      ["touchstart", startX],
      ["touchmove", endX],
      ["touchend", endX],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch(x)] },
        changedTouches: { value: [touch(x)] },
      });
      element.dispatchEvent(event);
    }
  });
}

it.each([
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])("fits circular keypad growth without scrolling and preserves swipe/tabs and sticky cells at $width x $height", async (viewport) => {
  const page = await browser.newPage({ viewport, hasTouch: true });
  try {
    const names = ["Maya", "Rowan", "Lee", "Alexandria", "Christopher"];
    const gameId = await openGame(page, names);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    expect(
      await dialog
        .getByText("Keypad enters Points. Tap a field to switch.", { exact: true })
        .count(),
    ).toBe(0);
    expect(
      await dialog
        .getByText("Whole numbers, including zero and negatives.", { exact: true })
        .count(),
    ).toBe(0);
    expect(await dialog.locator("input,textarea").count()).toBe(0);
    const scroll = dialog.locator("[data-swipe-navigation-root]");
    expect(await scroll.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
    for (const name of ["1", "3", "Change sign", "Backspace"]) {
      const key = dialog.getByRole("button", { name, exact: true });
      const before = await key.boundingBox();
      if (!before) throw new Error("Missing keypad button");
      expect(before.width).toBeGreaterThanOrEqual(24);
      expect(Math.abs(before.width - before.height)).toBeLessThan(1);
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => (await key.boundingBox())?.width ?? 0)
        .toBeGreaterThan(before.width + 1);
      const pressed = await key.boundingBox();
      const bounds = await scroll.boundingBox();
      if (!pressed || !bounds) throw new Error("Missing pressed keypad geometry");
      expect(pressed.x).toBeGreaterThan(bounds.x);
      expect(pressed.x + pressed.width).toBeLessThan(bounds.x + bounds.width);
      expect(pressed.y).toBeGreaterThanOrEqual(bounds.y);
      expect(pressed.y + pressed.height).toBeLessThan(bounds.y + bounds.height - 10);
      await page.mouse.up();
    }
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(0);
    await swipeLeft(dialog.getByRole("tabpanel", { name: "Maya", exact: true }));
    await expect
      .poll(() =>
        dialog.getByRole("tab", { name: "Rowan", exact: true }).getAttribute("aria-selected"),
      )
      .toBe("true");
    await dialog.getByRole("tab", { name: "Rowan", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    expect(
      await dialog.getByRole("tab", { name: "Lee", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    for (const name of names) {
      await dialog.getByRole("tab", { name, exact: true }).click();
      await dialog.getByRole("button", { name: "0", exact: true }).focus();
      await page.keyboard.press("Delete");
      await page.keyboard.type("0");
    }
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const saveBounds = await save.boundingBox();
    if (!saveBounds) throw new Error("Missing Save button");
    expect(saveBounds.y + saveBounds.height).toBeLessThan(viewport.height);
    expect(saveBounds.x + saveBounds.width).toBeLessThan(viewport.width);
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await page.evaluate(`(async () => {
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
        const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
        for (let index = 0; index < 22; index++) {
          await genericRoundsApi.add({ gameId: game.id, mode: "points", scores: game.players.map(playerId => ({ playerId, points: "1" })) });
        }
      })()`);
    await page.reload();
    const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
    await scoreboard.waitFor();
    const header = page.getByRole("columnheader").first();
    const initialHeader = await header.boundingBox();
    await scoreboard.evaluate((element) => {
      element.scrollLeft = 200;
      element.scrollTop = 400;
    });
    const stickyHeader = await header.boundingBox();
    const bounds = await scoreboard.boundingBox();
    const roundColumn = await page.getByRole("rowheader").nth(8).boundingBox();
    if (!initialHeader || !stickyHeader || !bounds || !roundColumn)
      throw new Error("Missing scoreboard geometry");
    expect(Math.abs(stickyHeader.y - initialHeader.y)).toBeLessThan(1);
    expect(Math.abs(stickyHeader.x - initialHeader.x)).toBeLessThan(1);
    expect(Math.abs(roundColumn.x - initialHeader.x)).toBeLessThan(1);
    expect(await scoreboard.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    if (viewport.width < 768) {
      expect(await scoreboard.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    expect(await page.locator("body").evaluate((element) => element.scrollWidth)).toBe(
      viewport.width,
    );
  } finally {
    await page.close();
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openGame(page: Page, names = ["Maya", "Rowan"], dealer = false) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const players = [];
    for (const name of ${JSON.stringify(names)}) {
      players.push(await playersApi.create({ name, color: "Jam", isFavorite: 0 }));
    }
    const game = await genericGamesApi.create({
      players: players.map((player) => player.id),
      settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: ${dealer} },
    });
    return game.id;
  })()`);
  await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
  await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
  return gameId;
}

async function saveRound(page: Page, scores: Record<string, string>) {
  await page.getByRole("button", { name: "Add Round", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
  for (const [name, points] of Object.entries(scores)) {
    await dialog.getByRole("tab", { name, exact: true }).click();
    await dialog.getByRole("button", { name: "0", exact: true }).focus();
    await page.keyboard.type(points.replace(/^-/, ""));
    if (points.startsWith("-")) await page.keyboard.press("-");
  }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
}

it("rotates visible saved and upcoming Dealer markers, including expanded and reopened rounds", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  try {
    await openGame(page, ["Rowan", "Maya"], true);
    for (const [roundNumber, dealer, nextDealer, points] of [
      [1, "Rowan", "Maya", "-9007199254740991"],
      [2, "Maya", "Rowan", "9007199254740991"],
      [3, "Rowan", "Maya", "-9007199254740991"],
    ] as const) {
      await saveRound(page, { Rowan: points, Maya: "0" });
      const markerCell = page.getByRole("cell", {
        name: `${dealer}, Round ${roundNumber}: ${dealer === "Rowan" ? points : "0"} Points, Dealer`,
        exact: true,
      });
      await markerCell.waitFor();
      expect(await markerCell.getByText("D", { exact: true }).isVisible()).toBe(true);
      const markerBounds = await markerCell.getByText("D", { exact: true }).boundingBox();
      const scoreBounds = await markerCell
        .getByText(dealer === "Rowan" ? points : "0", { exact: true })
        .boundingBox();
      if (!markerBounds || !scoreBounds) throw new Error("Missing Dealer/score geometry");
      expect(markerBounds.x + markerBounds.width).toBeLessThanOrEqual(scoreBounds.x);
      expect(
        await page
          .getByRole("cell", { name: `${nextDealer}, upcoming Round: Dealer`, exact: true })
          .count(),
      ).toBe(1);
    }
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    const firstDealer = page.getByRole("cell", {
      name: "Rowan, Round 1: -9007199254740991 Points, Dealer",
      exact: true,
    });
    expect(await firstDealer.innerText()).toContain("Accumulated Points: -9007199254740991");
    expect(await firstDealer.getByText("D", { exact: true }).count()).toBe(1);
    await page.reload();
    await firstDealer.waitFor();
    expect(await page.getByRole("cell", { name: /Points, Dealer$/ }).count()).toBe(3);
    expect(
      await page.getByRole("cell", { name: "Maya, upcoming Round: Dealer", exact: true }).count(),
    ).toBe(1);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(await firstDealer.getByText("D", { exact: true }).count()).toBe(1);
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps solo Dealer markers on every Round and reclaims their layout space when off", async () => {
  const reservedMarkerSpace: number[] = [];
  for (const dealer of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    try {
      await openGame(page, ["Maya"], dealer);
      await saveRound(page, { Maya: "-9007199254740991" });
      await saveRound(page, { Maya: "0" });
      await page.reload();
      const firstScore = page.getByRole("cell", {
        name: `Maya, Round 1: -9007199254740991 Points${dealer ? ", Dealer" : ""}`,
        exact: true,
      });
      await firstScore.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const table = page.getByRole("table", { name: "Points scoreboard" });
      expect(await table.getByText("D", { exact: true }).count()).toBe(dealer ? 3 : 0);
      expect(await page.getByRole("cell", { name: /upcoming Round/ }).count()).toBe(1);
      const groupBounds = await firstScore.locator(":scope > div").first().boundingBox();
      const valueBounds = await firstScore
        .getByText("-9007199254740991", { exact: true })
        .boundingBox();
      if (!groupBounds || !valueBounds) throw new Error("Missing saved Points geometry");
      reservedMarkerSpace.push(groupBounds.width - valueBounds.width);
      expect(valueBounds.x + valueBounds.width / 2).toBeCloseTo(
        groupBounds.x + groupBounds.width / 2,
        1,
      );
      const add = page.getByRole("button", { name: "Add Round", exact: true });
      await page.getByRole("region", { name: "Scoreboard", exact: true }).evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      const addBounds = await add.boundingBox();
      if (!addBounds) throw new Error("Missing Add Round geometry");
      expect(addBounds.x).toBeGreaterThanOrEqual(0);
      expect(addBounds.x + addBounds.width).toBeLessThanOrEqual(320);
      await add.click();
      await page
        .getByRole("dialog", { name: "Add Round", exact: true })
        .getByRole("button", { name: "Save", exact: true })
        .waitFor();
    } finally {
      await page.close();
    }
  }
  expect(reservedMarkerSpace[0]).toBeLessThan(1);
  expect(reservedMarkerSpace[1]).toBeCloseTo(48, 1);
}, 120_000);

it("keeps a modal Points draft on close, saves explicit zero and negatives, and clears after save", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await openGame(page);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    expect(await add.count()).toBe(1);
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    expect(await save.isEnabled()).toBe(true);
    expect(await dialog.locator("input, textarea, [contenteditable=true]").count()).toBe(0);
    await dialog.getByRole("button", { name: "0", exact: true }).tap();
    expect(
      await dialog.getByRole("tab", { name: "Maya", exact: true }).getAttribute("aria-describedby"),
    ).toBeNull();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await add.click();
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "0",
    );
    await dialog.getByRole("tab", { name: "Rowan", exact: true }).click();
    await dialog.getByRole("button", { name: "0", exact: true }).focus();
    await page.keyboard.type("12-");
    await page.keyboard.press("Backspace");
    expect(
      await dialog.getByRole("status", { name: "Rowan Points", exact: true }).innerText(),
    ).toBe("-1");
    expect(await save.isEnabled()).toBe(true);
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await expect
      .poll(() => page.getByRole("cell", { name: "Maya, Round 1: 0 Points", exact: true }).count())
      .toBe(1);
    expect(
      await page.getByRole("cell", { name: "Rowan, Round 1: -1 Points", exact: true }).count(),
    ).toBe(1);
    await add.click();
    expect(await save.isEnabled()).toBe(true);
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "0",
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await page.getByRole("cell", { name: "Rowan, Round 1: -1 Points", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("shows cumulative headers, editable Round details, and shared competition places without changing columns", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page, ["Maya", "Rowan", "Lee"]);
    expect(await page.getByRole("button", { name: "Open Standings", exact: true }).count()).toBe(1);
    await saveRound(page, { Maya: "-10", Rowan: "0", Lee: "5" });
    await saveRound(page, { Maya: "15", Rowan: "-2", Lee: "0" });
    const headers = page.getByRole("columnheader");
    expect(await headers.nth(1).ariaSnapshot()).toContain("Maya");
    expect(await headers.nth(2).ariaSnapshot()).toContain("Rowan");
    expect(await headers.nth(3).ariaSnapshot()).toContain("Lee");
    expect(await headers.nth(1).innerText()).toContain("Total Points: 5");
    expect(await headers.nth(2).innerText()).toContain("Total Points: -2");
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(
      await page.getByRole("cell", { name: "Maya, Round 1: -10 Points", exact: true }).innerText(),
    ).toContain("Accumulated Points: -10");
    expect(await page.getByRole("button", { name: /^Edit Round 1 for / }).count()).toBe(3);
    expect(await page.getByRole("button", { name: /Delete/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    const rows = standings.getByRole("listitem");
    expect(await rows.allTextContents()).toEqual([
      expect.stringContaining("Place 1"),
      expect.stringContaining("Tied for place 1"),
      expect.stringContaining("Place 3"),
    ]);
    expect(await rows.nth(0).innerText()).toContain("Maya");
    expect(await rows.nth(1).innerText()).toContain("Lee");
    expect(await rows.nth(2).innerText()).toContain("Rowan");
    expect(await standings.getByText(/Winner|Phases|Tiebreaker|Graph/).count()).toBe(0);
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "hidden" });
  } finally {
    await page.close();
  }
}, 60_000);
