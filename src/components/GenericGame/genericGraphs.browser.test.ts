/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";
import { swipeTabPanel } from "../../test/swipeTabPanel";
import { setVisibleViewport } from "../../test/visualViewport";
import type { GenericGameSettings } from "../../types";

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

async function openGraphGame(page: Page, settings: GenericGameSettings, playerCount = 2) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const maya = await playersApi.create({ name: "Maya", color: "#123456", isFavorite: 0 });
    const rowan = await playersApi.create({ name: "Rowan", color: "#abcdef", isFavorite: 0 });
    const players = [maya, rowan];
    for (let index = 2; index < ${playerCount}; index++) {
      players.push(await playersApi.create({
        name: "Player with a long name " + index, color: "#123456", isFavorite: 0,
      }));
    }
    const settings = ${JSON.stringify(settings)};
    const game = await genericGamesApi.create({ players: players.map(player => player.id), settings });
    for (let round = 0; round < 2; round++) {
      await genericRoundsApi.add({
        gameId: game.id,
        mode: settings.mode,
        scores: players.map((player, index) => settings.mode === "points"
          ? {
              playerId: player.id,
              points: String(index === 0 ? [-10, 4][round] : index === 1 ? [0, -6][round] : 0),
              tiebreaker: String(index === 0 ? [2, -5][round] : index === 1 ? [-4, 1][round] : 0),
            }
          : settings.mode === "singleRoundWinner"
            ? { playerId: player.id, won: index === round }
            : { playerId: player.id, passed: round === 0 }),
      });
    }
    return game.id;
  })()`);
  await page.reload();
  await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
  await page.getByRole("button", { name: "Open Standings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Standings", exact: true });
  await dialog.getByRole("button", { name: "Close", exact: true }).waitFor();
  return { dialog, gameId };
}

async function expectValues(dialog: Locator, metric: string, rows: string[][]) {
  const table = dialog.getByRole("table", { name: `${metric} progress details`, exact: true });
  expect(await table.getByRole("columnheader").allTextContents()).toEqual([
    "Player",
    "Start",
    "Round 1",
    "Round 2",
  ]);
  expect(
    await table
      .locator("tbody tr")
      .evaluateAll((elements) =>
        elements.map((row) => Array.from(row.children, (cell) => cell.textContent)),
      ),
  ).toEqual(rows);
}

it.each([
  ["low", "high"],
  ["high", "low"],
  ["high", "high"],
  ["low", "low"],
] as const)(
  "shows signed cumulative Points (%s) and an independent Tiebreaker (%s)",
  async (pointsDirection, tiebreakerDirection) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      const { dialog } = await openGraphGame(page, {
        mode: "points",
        pointsDirection,
        tiebreaker: { direction: tiebreakerDirection },
        dealer: false,
      });
      expect(await dialog.getByRole("tab").allTextContents()).toEqual([
        "Standings",
        "Points",
        "Tiebreaker",
      ]);
      await dialog.getByRole("tab", { name: "Points", exact: true }).click();
      await expectValues(dialog, "Points", [
        ["Maya", "0", "-10", "-6"],
        ["Rowan", "0", "0", "-6"],
      ]);
      await dialog.getByRole("img", { name: "Latest -6: Maya, Rowan", exact: true }).waitFor();
      const pointsPanel = dialog.getByRole("tabpanel", { name: "Points", exact: true });
      const min = await pointsPanel.getByText("-10", { exact: true }).last().boundingBox();
      const max = await pointsPanel
        .locator("span[aria-hidden]")
        .filter({ hasText: /^0$/ })
        .boundingBox();
      if (!min || !max) throw new Error("Missing numeric axis labels");
      expect(pointsDirection === "low" ? min.y < max.y : min.y > max.y).toBe(true);
      await dialog.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
      await expectValues(dialog, "Tiebreaker", [
        ["Maya", "0", "2", "-3"],
        ["Rowan", "0", "-4", "-3"],
      ]);
      expect(await dialog.innerText()).not.toMatch(/Phases|Finished|Wilds/);
    } finally {
      await page.close();
    }
  },
  60_000,
);

it.each([
  "points",
  "singleRoundWinner",
  "passFail",
] as const)("shows mode-appropriate %s totals and omits unsupported secondary tabs", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const settings: GenericGameSettings =
      mode === "points"
        ? { mode, pointsDirection: "high", tiebreaker: null, dealer: false }
        : { mode, tiebreaker: null, dealer: false };
    const { dialog } = await openGraphGame(page, settings);
    const metric =
      mode === "points" ? "Points" : mode === "singleRoundWinner" ? "Rounds Won" : "Passes";
    expect(await dialog.getByRole("tab").allTextContents()).toEqual(["Standings", metric]);
    await dialog.getByRole("tab", { name: metric, exact: true }).click();
    await expectValues(
      dialog,
      metric,
      mode === "points"
        ? [
            ["Maya", "0", "-10", "-6"],
            ["Rowan", "0", "0", "-6"],
          ]
        : [
            ["Maya", "0", "1", "1"],
            ["Rowan", "0", mode === "passFail" ? "1" : "0", "1"],
          ],
    );
    expect(await dialog.getByRole("tab", { name: "Tiebreaker", exact: true }).count()).toBe(0);
    expect(await dialog.getByRole("tab", { name: "Phases", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  { width: 320, height: 568, colorScheme: "light" },
  { width: 320, height: 568, colorScheme: "dark" },
  { width: 844, height: 390, colorScheme: "light" },
  { width: 844, height: 390, colorScheme: "dark" },
  { width: 1280, height: 900, colorScheme: "light" },
  { width: 1280, height: 900, colorScheme: "dark" },
] as const)("keeps graph controls, labels and long Standings usable at $width x $height in $colorScheme", async ({
  width,
  height,
  colorScheme,
}) => {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { dialog } = await openGraphGame(
      page,
      {
        mode: "points",
        pointsDirection: "high",
        tiebreaker: { direction: "low" },
        dealer: false,
      },
      24,
    );
    await page.addStyleTag({
      content:
        ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 16px; --safe-area-inset-right: 16px; }",
    });
    const surface = dialog.locator(".dialog-panel");
    await expect
      .poll(() => surface.evaluate((element) => element.getBoundingClientRect().y))
      .toBe(36);
    const surfaceBounds = await surface.boundingBox();
    if (!surfaceBounds) throw new Error("Missing Standings workspace");
    expect(surfaceBounds.height).toBe(height - 86);
    expect(surfaceBounds.width).toBe(Math.min(576, width - 64));
    expect(surfaceBounds.x).toBeGreaterThanOrEqual(32);
    expect(surfaceBounds.x + surfaceBounds.width).toBeLessThanOrEqual(width - 32);
    expect(await surface.getAttribute("data-dialog-scroll")).toBe("body");
    expect(await surface.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
      "none",
    );
    expect(
      await dialog
        .locator(".dialog-backdrop")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    expect(await close.count()).toBe(1);
    const before = await close.boundingBox();
    if (!before) throw new Error("Missing Close geometry");
    expect(before.width).toBe(44);
    expect(before.height).toBe(44);
    expect(before.y).toBeGreaterThanOrEqual(36);
    const scroll = dialog.getByRole("region", { name: "Points Standings", exact: true });
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await scroll.focus();
    await page.keyboard.press("End");
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    const last = scroll.getByRole("listitem").last();
    const lastBounds = await last.boundingBox();
    const scrollBounds = await scroll.boundingBox();
    if (!lastBounds || !scrollBounds) throw new Error("Missing Standings scroll geometry");
    expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
      scrollBounds.y + scrollBounds.height,
    );
    await dialog.getByRole("tab", { name: "Points", exact: true }).click();
    const graph = dialog.getByRole("img", { name: "Points progress by round", exact: true });
    const bounds = await graph.boundingBox();
    if (!bounds) throw new Error("Missing graph geometry");
    expect(bounds.width).toBeGreaterThan(180);
    expect(bounds.height).toBeGreaterThan(70);
    const panel = dialog.getByRole("tabpanel", { name: "Points", exact: true });
    const labels = await panel.locator("span[aria-hidden]").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent,
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          fontSize: parseFloat(getComputedStyle(element).fontSize),
        };
      }),
    );
    expect(labels.some((label) => label.text === "-10")).toBe(true);
    for (const label of labels) {
      expect(label.fontSize).toBeGreaterThanOrEqual(14);
      expect(label.x).toBeGreaterThanOrEqual(16);
      expect(label.right).toBeLessThanOrEqual(width - 16);
      expect(label.y).toBeGreaterThanOrEqual(before.y + before.height);
      expect(label.bottom).toBeLessThanOrEqual(height - 50);
    }
    expect(await close.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await close.click();
    await dialog.waitFor({ state: "detached" });
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps large signed axis labels inside the graph while exposing exact cumulative totals", async () => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { gameId } = await openGraphGame(page, {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: { direction: "low" },
      dealer: false,
    });
    await page.evaluate(`(async () => {
          const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
          const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
          const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
          await genericRoundsApi.add({
            gameId: game.id,
            mode: "points",
            scores: [
              { playerId: game.players[0], points: "-9007199254740985", tiebreaker: "9007199254740991" },
              { playerId: game.players[1], points: "9007199254740991", tiebreaker: "-9007199254740988" },
            ],
          });
        })()`);
    await page.reload();
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Standings", exact: true });
    for (const [metric, totals] of [
      ["Points", ["-9007199254740991", "9007199254740985"]],
      ["Tiebreaker", ["9007199254740988", "-9007199254740991"]],
    ] as const) {
      await dialog.getByRole("tab", { name: metric, exact: true }).click();
      const panel = dialog.getByRole("tabpanel", { name: metric, exact: true });
      const table = panel.getByRole("table", { name: `${metric} progress details`, exact: true });
      expect(await table.locator("tbody tr td:last-child").allTextContents()).toEqual(totals);
      const plot = await panel
        .getByRole("img", { name: `${metric} progress by round`, exact: true })
        .boundingBox();
      if (!plot) throw new Error("Missing graph geometry");
      const labels = await panel.locator("span[aria-hidden]").evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, right: bounds.right };
        }),
      );
      for (const label of labels) {
        expect(label.x).toBeGreaterThanOrEqual(plot.x);
        expect(label.right).toBeLessThanOrEqual(plot.x + plot.width);
      }
      const paths = await panel
        .locator("svg path")
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("d")));
      expect(paths.join(" ")).not.toMatch(/NaN|Infinity/);
    }
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "no-preference",
  "reduce",
] as const)("preserves keyboard, swipe, focus restoration and reopen navigation with %s motion", async (reducedMotion) => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    reducedMotion,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { dialog } = await openGraphGame(page, {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: { direction: "low" },
      dealer: false,
    });
    const standings = dialog.getByRole("tab", { name: "Standings", exact: true });
    const points = dialog.getByRole("tab", { name: "Points", exact: true });
    const tiebreaker = dialog.getByRole("tab", { name: "Tiebreaker", exact: true });
    await standings.focus();
    await page.keyboard.press("ArrowRight");
    expect(await points.evaluate((element) => document.activeElement === element)).toBe(true);
    expect(await points.getAttribute("aria-selected")).toBe("true");
    expect(await dialog.getByRole("table", { name: "Tiebreaker progress details" }).count()).toBe(
      0,
    );
    await page.keyboard.press("End");
    expect(await tiebreaker.evaluate((element) => document.activeElement === element)).toBe(true);
    await page.keyboard.press("ArrowRight");
    expect(await standings.getAttribute("aria-selected")).toBe("true");
    await swipeTabPanel(dialog.getByRole("list", { name: "Standings places" }), "left");
    await expect.poll(() => points.getAttribute("aria-selected")).toBe("true");
    await swipeTabPanel(
      dialog.getByRole("img", { name: "Points progress by round", exact: true }),
      "left",
    );
    await expect.poll(() => tiebreaker.getAttribute("aria-selected")).toBe("true");
    await swipeTabPanel(
      dialog.getByRole("img", { name: "Tiebreaker progress by round", exact: true }),
      "right",
    );
    await expect.poll(() => points.getAttribute("aria-selected")).toBe("true");
    await setVisibleViewport(page, { width: 320, height: 180, offsetTop: 60, offsetLeft: 0 });
    const surface = dialog.locator(".dialog-panel");
    await expect.poll(() => surface.getAttribute("data-dialog-scroll")).toBe("whole");
    const plot = dialog.getByRole("img", { name: "Points progress by round", exact: true });
    expect((await plot.boundingBox())?.height).toBeGreaterThan(70);
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    await close.focus();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const cramped = await surface.boundingBox();
    const closeBounds = await close.boundingBox();
    if (!cramped || !closeBounds) throw new Error("Missing cramped Standings controls");
    expect(closeBounds.y).toBeGreaterThanOrEqual(cramped.y);
    expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(cramped.y + cramped.height);
    await setVisibleViewport(page, { width: 320, height: 568, offsetTop: 0, offsetLeft: 0 });
    await expect.poll(() => surface.getAttribute("data-dialog-scroll")).toBe("body");
    expect(await surface.evaluate((element) => element.scrollTop)).toBe(0);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const open = page.getByRole("button", { name: "Open Standings", exact: true });
    await expect
      .poll(() => open.evaluate((element) => document.activeElement === element))
      .toBe(true);
    await open.click();
    await standings.waitFor();
    expect(await standings.getAttribute("aria-selected")).toBe("true");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: /Maya.*Rowan/ }).click();
    await open.click();
    expect(await standings.getAttribute("aria-selected")).toBe("true");
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "high",
  "low",
] as const)("spaces mixed-sign numeric axis labels in the %s direction", async (direction) => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { gameId } = await openGraphGame(page, {
      mode: "points",
      pointsDirection: direction,
      tiebreaker: { direction },
      dealer: false,
    });
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
      await genericRoundsApi.add({
        gameId: game.id,
        mode: "points",
        scores: [
          { playerId: game.players[0], points: "-994", tiebreaker: "-997" },
          { playerId: game.players[1], points: "7", tiebreaker: "4" },
        ],
      });
    })()`);
    await page.reload();
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Standings", exact: true });
    for (const metric of ["Points", "Tiebreaker"]) {
      await dialog.getByRole("tab", { name: metric, exact: true }).click();
      const panel = dialog.getByRole("tabpanel", { name: metric, exact: true });
      const labels = await panel.locator("span[aria-hidden]").evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom };
        }),
      );
      for (let index = 0; index < labels.length; index++) {
        for (const other of labels.slice(index + 1)) {
          const label = labels[index];
          expect(
            label.right <= other.x ||
              other.right <= label.x ||
              label.bottom <= other.y ||
              other.bottom <= label.y,
          ).toBe(true);
        }
      }
    }
  } finally {
    await page.close();
  }
}, 60_000);

it("uses live graph names/colors, then snapshots after completion and saved-Player deletion", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { gameId } = await openGraphGame(page, {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: { direction: "low" },
      dealer: false,
    });
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
      await playersApi.update(game.players[0], { name: "Maya captured", color: "#fedcba" });
    })()`);
    await page.reload();
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Standings", exact: true });
    await dialog.getByRole("tab", { name: "Points", exact: true }).click();
    await expectValues(dialog, "Points", [
      ["Maya captured", "0", "-10", "-6"],
      ["Rowan", "0", "0", "-6"],
    ]);
    expect(
      await dialog
        .getByRole("img", { name: "Points progress by round", exact: true })
        .locator("path")
        .first()
        .getAttribute("stroke"),
    ).toBe("#fedcba");
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const game = await genericGamesApi.finish(${JSON.stringify(gameId)});
      for (const id of game.players) {
        await playersApi.update(id, { name: "Changed " + id, color: "#000000" });
        await playersApi.delete(id);
      }
    })()`);
    await page.reload();
    await dialog.getByRole("tab", { name: "Points", exact: true }).click();
    await expectValues(dialog, "Points", [
      ["Maya captured", "0", "-10", "-6"],
      ["Rowan", "0", "0", "-6"],
    ]);
    expect(
      await dialog
        .getByRole("img", { name: "Points progress by round", exact: true })
        .locator("path")
        .first()
        .getAttribute("stroke"),
    ).toBe("#fedcba");
    await dialog.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
    await expectValues(dialog, "Tiebreaker", [
      ["Maya captured", "0", "2", "-3"],
      ["Rowan", "0", "-4", "-3"],
    ]);
    expect(
      await dialog
        .getByRole("img", { name: "Tiebreaker progress by round", exact: true })
        .locator("path")
        .first()
        .getAttribute("stroke"),
    ).toBe("#fedcba");
  } finally {
    await page.close();
  }
}, 60_000);
