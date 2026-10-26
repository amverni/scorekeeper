/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { touchGesture } from "../../test/touchGesture";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  appUrl = `http://127.0.0.1:${address.port}/scorekeeper/`;
  await server.environments.client.warmupRequest("/src/main.tsx");
  await server.environments.client.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openGame(page: Page, kind: "generic" | "phase10", playerCount = 2, roundCount = 2) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
    const players = [];
    for (let index = 0; index < ${playerCount}; index++) {
      players.push(await playersApi.create({ name: "Player " + index, color: "Jam", isFavorite: 0 }));
    }
    const game = ${JSON.stringify(kind)} === "generic"
      ? await genericGamesApi.create({
          players: players.map(player => player.id),
          settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
        })
      : await gamesApi.create({
          players: players.map(player => player.id),
          phaseSet: { id: "short", type: "temporary", name: "Short", phases: Array(10).fill("classic-1") },
          settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
        });
    for (let round = 1; round <= ${roundCount}; round++) {
      if (${JSON.stringify(kind)} === "generic") {
        await genericRoundsApi.add({
          gameId: game.id, mode: "points",
          scores: players.map(player => ({ playerId: player.id, points: String(round * 5) })),
        });
      } else {
        await roundsApi.add({
          gameId: game.id, roundWinnerId: null,
          scores: players.map(player => ({
            playerId: player.id, phaseStatus: "failed", score: 50 + (round % 10) * 5,
            pointsCardBreakdown: { p5: 10 - (round % 10), p10: round % 10, skipCard: 0, wild: 0 },
          })),
        });
      }
    }
    return game.id;
  })()`);
  const route = kind === "generic" ? "scorekeeper" : "phaseCompan10n";
  await page.goto(`${appUrl}#/${route}/game/${gameId}`);
  await roundControl(page, kind).waitFor();
  return gameId;
}

function roundControl(page: Page, kind: "generic" | "phase10", round = 1) {
  return page.getByRole("button", {
    name: kind === "generic" ? `Expand Round ${round}` : `Round ${round}`,
    exact: true,
  });
}

function readRounds(page: Page, kind: "generic" | "phase10", gameId: string) {
  return page.evaluate<{ roundNumber: number; id: string }[]>(`(async () => {
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    return ${JSON.stringify(kind)} === "generic"
      ? genericRoundsApi.getByGameId(${JSON.stringify(gameId)})
      : (await gamesApi.getView(${JSON.stringify(gameId)})).rounds.map(round => round.source);
  })()`);
}

async function dragMouse(page: Page, target: Locator, distance: number, release = true) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Missing Round target");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 6 });
  if (release) await page.mouse.up();
}

it.each([
  "generic",
  "phase10",
] as const)("reveals mirrored %s mouse actions without overflow and confirms deletion only on release", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const cell =
      kind === "generic"
        ? page.getByRole("cell", { name: "Player 0, Round 1: 5 Points, Dealer", exact: true })
        : scroller.locator(".scoreboard-entry__phase").first();
    expect(await scroller.evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(
      true,
    );
    await dragMouse(page, cell, 55);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await trash.waitFor();
    const first = await trash.boundingBox();
    const bounds = await scroller.boundingBox();
    expect(Math.abs((first?.x ?? 0) - (bounds?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(first?.width).toBeGreaterThanOrEqual(44);
    expect(first?.height).toBeGreaterThanOrEqual(44);
    await trash.focus();
    await page.keyboard.press("Escape");
    await trash.waitFor({ state: "detached" });
    await expect
      .poll(() =>
        roundControl(page, kind).evaluate((element) => element === document.activeElement),
      )
      .toBe(true);
    await dragMouse(page, cell, 55);
    await trash.click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation
      .getByText("Delete Round 1? This cannot be undone.", { exact: true })
      .waitFor();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    expect(await readRounds(page, kind, gameId)).toEqual(before);
    await dragMouse(page, cell, -150, false);
    expect(await confirmation.count()).toBe(0);
    await page.mouse.up();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([{ ...before[1], roundNumber: 1 }]);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("requires a fresh %s edge drag after scrolling columns and preserves vertical navigation and editing", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind, 8, 20);
    const before = await readRounds(page, kind, gameId);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const control = roundControl(page, kind);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth - 30;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await dragMouse(page, control, -100);
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollWidth - element.clientWidth - element.scrollLeft,
        ),
      )
      .toBeLessThanOrEqual(1);
    expect(await trash.count()).toBe(0);
    const roundBounds = await control.boundingBox();
    await dragMouse(page, control, -55);
    await trash.waitFor();
    const trashBounds = await trash.boundingBox();
    const bounds = await scroller.boundingBox();
    expect(
      Math.abs(
        (trashBounds?.x ?? 0) + (trashBounds?.width ?? 0) - (bounds?.x ?? 0) - (bounds?.width ?? 0),
      ),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await scroller.hover();
    await page.mouse.wheel(0, 250);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^Delete Round/ }).count()).toBe(0);
    const header = scroller.locator(".scoreboard-cell--sticky-corner");
    expect((await header.boundingBox())?.y).toBeCloseTo((bounds?.y ?? 0) + 1, 0);
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect.poll(() => control.boundingBox()).toEqual(roundBounds);
    await touchGesture(control, [
      { x: 100, y: 100, time: 0 },
      { x: 102, y: 150, time: 100 },
      { x: 102, y: 150, time: 200 },
    ]);
    expect(await trash.count()).toBe(0);
    await control.click();
    await page
      .getByRole("button", { name: "Edit Round 1 for Player 0", exact: true })
      .press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await readRounds(page, kind, gameId)).toEqual(before);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "generic",
  "phase10",
] as const)("rejects stale %s row deletion and blocks duplicate submissions while surfacing storage failure", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const control = roundControl(page, kind);
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    async function reveal() {
      await dragMouse(page, control, 55);
      await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    }
    await reveal();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Row deletion storage failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    const remove = confirmation.getByRole("button", { name: "Delete", exact: true });
    await remove.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => remove.isDisabled()).toBe(true);
    expect(
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(await confirmation.locator(".dialog-panel").isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await confirmation
      .getByRole("alert")
      .filter({ hasText: "Row deletion storage failed" })
      .waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual(before);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });

    await reveal();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      if (${JSON.stringify(kind)} === "generic") {
        const editor = await genericRoundsApi.getEditor(${JSON.stringify(gameId)}, ${JSON.stringify(before[1].id)});
        await genericRoundsApi.delete({ gameId: editor.round.gameId, roundId: editor.round.id, version: editor.version });
      } else {
        const editor = await gamesApi.getRoundEditor(${JSON.stringify(gameId)}, 2);
        await gamesApi.deleteRound({ gameId: editor.game.id, roundId: editor.round.id, version: editor.version });
      }
    })()`);
    await remove.click();
    await confirmation.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([before[0]]);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([before[0]]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("does not retarget a stale Phase 10 row to the Round that inherited its number", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, "phase10");
    const before = await readRounds(page, "phase10", gameId);
    await page.evaluate(`(async () => {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const editor = await gamesApi.getRoundEditor(${JSON.stringify(gameId)}, 1);
      await gamesApi.deleteRound({ gameId: editor.game.id, roundId: editor.round.id, version: editor.version });
    })()`);
    await dragMouse(page, roundControl(page, "phase10"), 55);
    await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    expect(await confirmation.getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await roundControl(page, "phase10").waitFor();
    expect(await readRounds(page, "phase10", gameId)).toEqual([{ ...before[1], roundNumber: 1 }]);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  { kind: "generic", width: 320 },
  { kind: "phase10", width: 320 },
  { kind: "generic", width: 390 },
  { kind: "phase10", width: 390 },
  { kind: "generic", width: 768 },
  { kind: "phase10", width: 768 },
] as const)("supports mirrored touch actions, retreat and cancellation in $kind at $width px", async ({
  kind,
  width,
}) => {
  const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const control = roundControl(page, kind);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const bounds = await scroller.boundingBox();
    if (!bounds) throw new Error("Missing scoreboard");
    const travel = bounds.width * 0.5;
    for (const direction of [-1, 1]) {
      await touchGesture(control, [
        { x: 200, y: 150, time: 0 },
        { x: 200 + direction * 55, y: 150, time: 100 },
        { x: 200 + direction * 55, y: 150, time: 200 },
      ]);
      await trash.waitFor();
      const box = await trash.boundingBox();
      if (!box) throw new Error("Missing trash action");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeCloseTo((await control.boundingBox())?.y ?? 0, 0);
      expect(
        Math.abs(
          (direction === 1 ? box.x : box.x + box.width) -
            (direction === 1 ? bounds.x : bounds.x + bounds.width),
        ),
      ).toBeLessThanOrEqual(1);
      if (width === 320) await trash.tap();
      else await trash.press("Enter");
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      await confirmation.waitFor({ state: "detached" });

      await touchGesture(
        control,
        [
          { x: 200, y: 150, time: 0 },
          { x: 200 + direction * travel, y: 150, time: 100 },
        ],
        null,
      );
      expect(await confirmation.count()).toBe(0);
      await control.dispatchEvent("touchcancel");
      await touchGesture(control, [
        { x: 200, y: 150, time: 0 },
        { x: 200 + direction * travel, y: 150, time: 100 },
        { x: 200 + direction * 30, y: 150, time: 200 },
        { x: 200 + direction * 30, y: 150, time: 300 },
      ]);
      expect(await confirmation.count()).toBe(0);
      await page.keyboard.press("Escape");
      await trash.waitFor({ state: "detached" });
    }
    await touchGesture(
      control,
      [
        { x: 200, y: 150, time: 0 },
        { x: 200 + travel, y: 150, time: 100 },
        { x: 200 + travel, y: 150, time: 200 },
      ],
      "touchcancel",
    );
    expect(await confirmation.count()).toBe(0);
    expect(await trash.count()).toBe(0);
    expect(await control.getAttribute("aria-expanded")).toBe("false");
    await touchGesture(control, [
      { x: 200, y: 150, time: 0 },
      { x: 200 + travel, y: 150, time: 100 },
      { x: 200 + travel, y: 150, time: 200 },
    ]);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await confirmation
      .getByRole("button", { name: width === 390 ? "Delete" : "Cancel", exact: true })
      .click();
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual(
      width === 390 ? [{ ...before[1], roundNumber: 1 }] : before,
    );
  } finally {
    await page.close();
  }
}, 45_000);
