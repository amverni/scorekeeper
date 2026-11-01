/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GameId, GenericScoringMode } from "../../types";

type TestMode = "phase10" | GenericScoringMode;

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;
const playerNames = ["Zoe Lee", "Amy Kim", "Riley Jones", "Jo Park"];
const highlightClass = "scoreboard-cell--upcoming-dealer";

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

describe.each(["light", "dark"] as const)("Dealer headers in %s mode", (colorScheme) => {
  it.each<TestMode>([
    "phase10",
    "points",
    "singleRoundWinner",
    "passFail",
  ])("highlights the upcoming %s Dealer without moving or widening Player headers", async (mode) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      hasTouch: true,
    });
    page.setDefaultTimeout(5_000);
    try {
      const id = await openGame(page, mode);
      const scoreboard = page.locator('section[aria-label="Scoreboard"]');
      const headers = scoreboard.locator(".scoreboard-cell--sticky-top");
      const avatars = headers.locator('span[style*="background-color"]:visible');
      const initialAvatarBounds = await avatarBounds(avatars);

      expect(await headers.count()).toBe(4);
      const scoreboardBounds = await box(scoreboard);
      expect(scoreboardBounds.width).toBe(358);
      for (const header of await headers.all()) {
        const bounds = await box(header);
        expect(bounds.x).toBeGreaterThanOrEqual(scoreboardBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          scoreboardBounds.x + scoreboardBounds.width,
        );
      }

      for (let savedRounds = 0; savedRounds <= 4; savedRounds++) {
        const dealerIndex = savedRounds % playerNames.length;
        const highlighted = headers.filter({ has: page.getByText(/Upcoming Round Dealer/) });
        expect(await scoreboard.locator(`.${highlightClass}`).count()).toBe(1);
        expect(await highlighted.count()).toBe(1);
        expect(await headers.nth(dealerIndex).getAttribute("class")).toContain(highlightClass);
        expect(await highlighted.ariaSnapshot()).toContain(playerNames[dealerIndex]);
        expect(await highlighted.ariaSnapshot()).toContain("Upcoming Round Dealer");
        expect(await headers.getByText("D", { exact: true }).count()).toBe(0);
        expect(await scoreboard.getByText("D", { exact: true }).count()).toBe(savedRounds + 1);
        for (const [index, avatar] of (await avatarBounds(avatars)).entries()) {
          expect(avatar.x).toBeCloseTo(initialAvatarBounds[index].x, 1);
          expect(avatar.y).toBe(initialAvatarBounds[index].y);
          expect(avatar.width).toBe(initialAvatarBounds[index].width);
          expect(avatar.height).toBe(initialAvatarBounds[index].height);
        }
        for (let index = 0; index < 4; index++) {
          const header = await box(headers.nth(index));
          const rightBorder = await headers
            .nth(index)
            .evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRightWidth));
          const avatar = initialAvatarBounds[index];
          expect(avatar.x + avatar.width / 2).toBeCloseTo(
            header.x + (header.width - rightBorder) / 2,
            1,
          );
        }

        const style = await highlighted.evaluate((element) => {
          const computed = getComputedStyle(element);
          return {
            background: computed.backgroundColor,
            shadow: computed.boxShadow,
            position: computed.position,
            animation: computed.animationName,
          };
        });
        const plainBackground = await headers
          .nth((dealerIndex + 1) % playerNames.length)
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(style.background).not.toBe(plainBackground);
        expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(style.shadow).toContain("rgb(250, 199, 117)");
        expect(style.shadow).toContain("inset");
        expect(style.position).toBe("sticky");
        expect(style.animation).toBe("none");

        if (savedRounds < 4) {
          await saveRound(page, mode, id);
          await reloadScoreboard(page);
        }
      }

      const headerTop = (await box(headers.first())).y;
      await scoreboard.evaluate((element) => {
        element.style.maxHeight = "160px";
        element.scrollTop = element.scrollHeight;
      });
      expect(await scoreboard.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect((await box(headers.first())).y).toBe(headerTop);

      const api = mode === "phase10" ? "games" : "genericGames";
      await page.evaluate(`(async () => {
          const { ${api}Api } = await import("/scorekeeper/src/data/api/${api}.ts");
          await ${api}Api.finish(${JSON.stringify(id)});
        })()`);
      await reloadScoreboard(page);
      expect(await scoreboard.locator(`.${highlightClass}`).count()).toBe(0);
      expect(await headers.getByText(/Upcoming Round Dealer/).count()).toBe(0);
      expect(await scoreboard.getByText("D", { exact: true }).count()).toBe(4);
    } finally {
      await page.close();
    }
  }, 30_000);
});

it.each<GenericScoringMode>([
  "points",
  "singleRoundWinner",
  "passFail",
])("does not highlight %s headers when Dealer tracking is disabled", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const id = await openGame(page, mode, false);
    await saveRound(page, mode, id);
    await reloadScoreboard(page);
    const scoreboard = page.locator('section[aria-label="Scoreboard"]');
    expect(await scoreboard.locator(`.${highlightClass}`).count()).toBe(0);
    expect(await scoreboard.getByText(/Upcoming Round Dealer/).count()).toBe(0);
    expect(await scoreboard.getByText("D", { exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30_000);

async function openGame(page: Page, mode: TestMode, dealer = true) {
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  const id = await page.evaluate<GameId>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const players = [];
    for (const name of ${JSON.stringify(playerNames)}) {
      players.push((await playersApi.create({ name, color: "Spearmint", isFavorite: 0 })).id);
    }
    if (${JSON.stringify(mode)} === "phase10") {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      return (await gamesApi.create({
        scorekeeper: "phase10", players,
        firstDealer: { type: "player", playerId: players[0] },
        phaseSet: { id: "dealer-phases", type: "temporary", name: "Dealer phases",
          phases: Array.from({ length: 10 }, (_, index) => "phase-" + (index + 1)) },
        settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 }
      })).id;
    }
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return (await genericGamesApi.create({ players,
      firstDealer: { type: "player", playerId: players[0] },
      settings: { mode: ${JSON.stringify(mode)}, dealer: ${dealer}, tiebreaker: null,
        ...(${JSON.stringify(mode)} === "points" ? { pointsDirection: "low" } : {}) }
    })).id;
  })()`);
  const route = mode === "phase10" ? "phaseCompan10n/game" : "scorekeeper/game";
  await page.goto(`${appUrl}#/${route}/${id}`);
  await page.locator('section[aria-label="Scoreboard"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return id;
}

function saveRound(page: Page, mode: TestMode, id: GameId) {
  return page.evaluate(`(async () => {
    if (${JSON.stringify(mode)} === "phase10") {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
      const game = await gamesApi.getById(${JSON.stringify(id)});
      await roundsApi.add({ gameId: game.id, roundWinnerId: game.players[1],
        scores: game.players.map((playerId, index) => ({
          playerId, phaseStatus: index === 1 ? "completed" : "failed", score: index === 1 ? 0 : 5
        }))
      });
    } else {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(id)});
      const mode = game.settings.mode;
      await genericRoundsApi.add({ gameId: game.id, mode,
        scores: game.players.map((playerId, index) => mode === "points"
          ? { playerId, points: index === 1 ? "0" : "5" }
          : mode === "passFail" ? { playerId, passed: index === 1 }
          : { playerId, won: index === 1 })
      });
    }
  })()`);
}

async function reloadScoreboard(page: Page) {
  await page.reload();
  await page.locator('section[aria-label="Scoreboard"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

function avatarBounds(avatars: Locator) {
  return avatars.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Expected visible scoreboard content");
  return bounds;
}
