/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Round, RoundScore } from "../../types";
import { makePhaseGraphGame, phaseGraphPlayers } from "../Standings/phaseGraphTestFixtures";

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

function fontSize(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).fontSize);
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Expected a visible typography element");
  return bounds;
}

async function seedGame(page: Page, playerCount = 6, variedResults = false) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    ...phaseGraphPlayers.amy,
    id: `player-${index}`,
    name: `Player ${index}`,
  }));
  const playerIds = players.map((player) => player.id);
  const game = makePhaseGraphGame({
    players: playerIds,
    activePlayers: playerIds,
    phaseSet: {
      id: "typography-phases",
      name: "Typography phases",
      type: "temporary",
      phases: ["phase-1", ...Array.from({ length: 11 }, (_, index) => `phase-${index + 2}`)],
    },
  });
  const rounds: Round[] = Array.from({ length: 10 }, (_, index) => {
    const scores: RoundScore[] = players.map((player, playerIndex) => ({
      playerId: player.id,
      currentPhase: variedResults ? Math.ceil(index / 2) + 1 : index + 1,
      phaseStatus: variedResults
        ? (["completed", "failed", "skipped", "satOut"] as const)[index % 4]
        : "completed",
      score: playerIndex === index % players.length ? 0 : 100,
    }));
    return {
      gameId: game.id,
      scorekeeper: "phase10",
      roundNumber: index + 1,
      roundWinnerId: players[index % players.length].id,
      scores: [scores[0], ...scores.slice(1)],
    } as Round;
  });

  await page.goto(`${appUrl}#/phaseCompan10n/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  await page.evaluate(
    ({ game, players, rounds }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("phase10-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["games", "players", "rounds"], "readwrite");
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.objectStore("games").put(game);
          for (const player of players) transaction.objectStore("players").put(player);
          for (const round of rounds) transaction.objectStore("rounds").put(round);
        };
      }),
    { game, players, rounds },
  );
  await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
  await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

it.each([
  "light",
  "dark",
] as const)("keeps Phase results in a centered, continuously spaced group in %s appearance", async (colorScheme) => {
  for (const playerCount of [1, 2, 6]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      colorScheme,
      hasTouch: true,
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      await seedGame(page, playerCount, true);
      const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
      const round = scoreboard.getByRole("button", { name: /^Round 1(?:, expanded)?$/ });
      const cell = round.locator("xpath=following-sibling::div[1]");
      const phase = cell.getByText("1", { exact: true });
      const dealer = cell.getByText("D", { exact: true });
      const result = cell.locator("svg");
      const positions: Array<{ width: number; separation: number }> = [];
      for (const width of [320, 350, 390, 512, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await scoreboard.evaluate((element) => {
          element.scrollLeft = 0;
          element.scrollTop = 0;
        });
        const bounds = await box(cell);
        const number = await box(phase);
        const glyph = await phase.evaluate((element) => {
          const text = Array.from(element.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
          if (!text) throw new Error("Missing visible Phase number");
          const range = document.createRange();
          range.selectNode(text);
          const bounds = range.getBoundingClientRect();
          return { x: bounds.x, width: bounds.width };
        });
        const badge = await box(dealer);
        const icon = await box(result);
        const center = number.x + number.width / 2;
        const left = badge.x + badge.width / 2;
        const right = icon.x + icon.width / 2;
        expect(Math.abs(center - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(0.6);
        expect(Math.abs(glyph.x + glyph.width / 2 - center)).toBeLessThanOrEqual(0.6);
        expect(center - left).toBeCloseTo(right - center, 1);
        expect(badge.width).toBe(17);
        expect(badge.height).toBe(17);
        expect(icon.width).toBe(14);
        expect(icon.height).toBe(14);
        expect(await fontSize(phase)).toBe("16px");
        expect(bounds.height).toBe(44);
        expect(bounds.width).toBeCloseTo(
          Math.max(70, (Math.min(width, 512) - 32 - 2 - 36) / playerCount),
          1,
        );
        const ring = await box(phase.locator("[aria-hidden]"));
        expect(ring.width).toBe(20);
        expect(ring.x + ring.width / 2).toBeCloseTo(center, 1);
        expect(badge.x + badge.width).toBeLessThan(ring.x);
        expect(ring.x + ring.width).toBeLessThan(icon.x);
        positions.push({ width: bounds.width, separation: right - left });
        if (playerCount === 6) {
          // The ring and symmetric 17px marker positions define the reserved footprints.
          const outer = badge.x - (bounds.x + 2);
          const interior = ring.x - (badge.x + badge.width);
          expect(outer).toBeGreaterThan(0);
          expect(interior).toBeCloseTo(outer * 2, 0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      if (playerCount === 1) {
        expect(positions[2].width).toBeGreaterThan(positions[0].width);
        expect(positions[0].separation).toBeCloseTo(positions[2].separation, 1);
        expect(positions[2].separation).toBeCloseTo(positions[3].separation, 1);
        expect(positions[0].separation).toBeLessThan(100);
      }
      if (playerCount === 2) {
        expect(positions[0].separation).toBeLessThan(positions[1].separation);
        expect(positions[1].separation).toBeLessThan(positions[2].separation);
        expect(positions[2].separation).toBeCloseTo(positions[3].separation, 1);
      }
      for (const [roundNumber, phaseNumber] of [
        [2, 2],
        [3, 2],
        [4, 3],
        [10, 6],
      ]) {
        const control = scoreboard.getByRole("button", {
          name: `Round ${roundNumber}`,
          exact: true,
        });
        const resultCell = control.locator("xpath=following-sibling::div[1]");
        const bounds = await box(resultCell);
        const value = await box(resultCell.getByText(String(phaseNumber), { exact: true }));
        expect(
          Math.abs(value.x + value.width / 2 - (bounds.x + bounds.width / 2)),
        ).toBeLessThanOrEqual(0.6);
        const status = await box(resultCell.locator("svg"));
        expect(status.width).toBe(14);
        expect(status.height).toBe(14);
        expect(value.y).toBeCloseTo((await box(control.locator("span"))).y, 1);
      }
      const upcoming = scoreboard
        .getByRole("button", { name: /^Add round/ })
        .locator("xpath=following-sibling::div[1]");
      const upcomingBounds = await box(upcoming);
      const upcomingValue = await box(upcoming.getByText("6", { exact: true }));
      expect(upcomingValue.x + upcomingValue.width / 2).toBeCloseTo(
        upcomingBounds.x + upcomingBounds.width / 2 - (playerCount === 1 ? 0 : 0.5),
        1,
      );
      expect(await upcoming.locator("svg").count()).toBe(0);
      if (playerCount === 1) {
        expect((await box(upcoming.getByText("D", { exact: true }))).x).toBeCloseTo(
          (await box(dealer)).x,
          1,
        );
      }
      const before = await box(phase);
      await cell.tap();
      await expect
        .poll(() =>
          cell
            .locator(".scoreboard-extras")
            .evaluate((element) => getComputedStyle(element).opacity),
        )
        .toBe("1");
      expect(await box(phase)).toEqual(before);
      expect((await box(cell)).height).toBe(82);
      for (const value of await cell.locator(".scoreboard-extras span:not([aria-hidden])").all()) {
        const detail = await box(value);
        expect(detail.x + detail.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
      }
    } finally {
      await page.close();
    }
  }
}, 60_000);

it("centers header controls together without moving the independent logo across viewport sizes and safe areas", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: "light",
  });
  try {
    await seedGame(page);
    const button = page.getByRole("button", {
      name: "Open Phases Card",
      exact: true,
      includeHidden: true,
    });
    const logo = page.getByRole("img", { name: "Phaze Compan10n" });
    const header = page.locator(".page-shell-header");
    const main = page.locator(".page-shell-main");
    for (const { width, height, logoHeight, top, left } of [
      { width: 320, height: 568, logoHeight: 54.2, top: 0, left: 0 },
      { width: 390, height: 700, logoHeight: 74, top: 0, left: 0 },
      { width: 390, height: 844, logoHeight: 95.6, top: 0, left: 0 },
      { width: 844, height: 390, logoHeight: 27.5, top: 0, left: 0 },
      { width: 1280, height: 900, logoHeight: 100, top: 0, left: 0 },
      { width: 390, height: 844, logoHeight: 95.6, top: 47, left: 44 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.addStyleTag({
        content: `:root { --safe-area-inset-top: ${top}px; --safe-area-inset-left: ${left}px; }`,
      });
      await expect.poll(async () => (await box(logo)).height).toBeCloseTo(logoHeight, 1);
      const logoBounds = await box(logo);
      const buttonBounds = await box(button);
      const headerBounds = await box(header);
      const mainBounds = await box(main);
      const menuBounds = await box(page.getByRole("button", { name: "Menu", exact: true }));
      const standingsBounds = await box(
        page.getByRole("button", { name: "Open Standings", exact: true }),
      );
      const finishBounds = await box(
        page.getByRole("button", { name: "Finish Game", exact: true }),
      );
      expect(buttonBounds.y + buttonBounds.height / 2).toBeCloseTo(
        menuBounds.y + menuBounds.height / 2,
        1,
      );
      expect(buttonBounds.x).toBeCloseTo(standingsBounds.x, 1);
      expect(menuBounds.x + menuBounds.width).toBeCloseTo(finishBounds.x + finishBounds.width, 1);
      if (width <= 390) expect(buttonBounds.x).toBe(left + 16);
      const size = height <= 700 ? 44 : 56;
      expect(buttonBounds.width).toBeGreaterThanOrEqual((48 / 56) * size);
      expect(buttonBounds.height).toBe(size);
      expect(logoBounds.x + logoBounds.width / 2).toBeCloseTo(left + (width - left) / 2, 1);
      expect(headerBounds.height).toBeCloseTo(Math.max(height * 0.15, size + 50 + 20) + top, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

      await button.evaluate((element) => {
        element.setAttribute("hidden", "");
      });
      expect(await box(logo)).toEqual(logoBounds);
      expect(await box(header)).toEqual(headerBounds);
      expect(await box(main)).toEqual(mainBounds);
      await button.evaluate((element) => {
        element.removeAttribute("hidden");
      });
    }
    await button.click();
    await page
      .getByRole("dialog", { name: "Phases Card", exact: true })
      .getByRole("button", { name: "Share Phases Card", exact: true })
      .waitFor();
  } finally {
    await page.close();
  }
}, 30_000);

describe.each([320, 1280])("approved typography at %ipx viewport width", (width) => {
  it("enlarges the Phase Set switch without overflowing its toolbar", async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/create`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const button = page.getByRole("button", { name: "Switch phase set", exact: true });
      await button.waitFor();
      expect(await fontSize(button)).toBe("14px");
      await page.evaluate(() => document.fonts.ready);
      const bounds = await box(button);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await button.click();
      await page
        .getByRole("dialog", { name: "Switch phase set", exact: true })
        .getByPlaceholder(/^Search phase sets/)
        .waitFor();
    } finally {
      await page.close();
    }
  }, 30_000);

  it("preserves scoreboard alignment and hierarchy with larger round numbers and dealer badges", async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    try {
      await seedGame(page);
      const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
      const round = scoreboard.getByRole("button", { name: /^Round 10(?:, expanded)?$/ });
      await round.scrollIntoViewIfNeeded();
      expect.soft(await fontSize(round.locator("span"))).toBe("16px");
      const headers = scoreboard.locator(".scoreboard-cell--sticky-top > div > span:last-child");
      for (const header of await headers.all()) {
        expect.soft(await fontSize(header)).toBe("14px");
        expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      const badges = scoreboard.getByText("D", { exact: true });
      for (const badge of await badges.all()) {
        expect.soft(await fontSize(badge)).toBe("12px");
        const bounds = await box(badge);
        expect.soft(bounds.width).toBe(17);
        expect.soft(bounds.height).toBe(17);
        const phase = badge.locator("..").locator(":scope > span.relative");
        const phaseBounds = await box(phase);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(phaseBounds.x);
        expect(bounds.y + bounds.height / 2).toBeCloseTo(phaseBounds.y + phaseBounds.height / 2, 1);
      }
      const phase = round
        .locator("xpath=following-sibling::div[1]")
        .locator(":scope > div > div > span.relative");
      const roundBounds = await box(round.locator("span"));
      const phaseBounds = await box(phase);
      expect.soft(roundBounds.y).toBeCloseTo(phaseBounds.y, 1);
      expect.soft(roundBounds.height).toBe(phaseBounds.height);
      await round.click();
      const expandedScores = scoreboard.locator(".scoreboard-extras--open").first();
      await expect
        .poll(() => expandedScores.evaluate((element) => getComputedStyle(element).opacity))
        .toBe("1");
      expect(await fontSize(expandedScores.locator("span").first())).toBe("14px");
      expect(await fontSize(expandedScores.locator("span").last())).toBe("12px");
      expect((await box(round.locator("span"))).y).toBeCloseTo((await box(phase)).y, 1);
      expect(await fontSize(page.getByRole("button", { name: "Open Phases Card" }))).toBe("10px");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally {
      await page.close();
    }
  }, 30_000);
});
