/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
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

it("shows generic Games loading, empty and retryable errors, and never navigates after a failed deletion", async () => {
  const page = await newPage();
  try {
    await page.goto(`${appUrl}#/scorekeeper`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await page.evaluate(`
      import("/scorekeeper/src/data/api/genericGames.ts").then(({ genericGamesApi }) => {
        const original = genericGamesApi.getList;
        const ready = new Promise(resolve => { window.releaseGenericList = resolve; });
        genericGamesApi.getList = async (...args) => {
          genericGamesApi.getList = original;
          await ready;
          return original(...args);
        };
      })
    `);
    await openGames(page);
    await page.locator(".list-shimmer").first().waitFor();
    await page.evaluate("window.releaseGenericList()");
    await page.getByText("No games yet", { exact: true }).waitFor();

    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const player = await playersApi.create({ name: "Dana", color: "Ocean", isFavorite: 0 });
      await genericGamesApi.create({
        players: [player.id],
        settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
      });
    })()`);
    await page.reload();
    await page.getByRole("button", { name: "Dana", exact: true }).waitFor();
    await failNextGameOperation(page, "getList");
    await page.goto(`${appUrl}#/scorekeeper/games`);
    await page.getByRole("alert").filter({ hasText: "Unable to load Games." }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    const active = page.getByRole("link", { name: "Continue game with Dana", exact: true });
    await active.waitFor();

    await failNextGameOperation(page, "delete");
    await page.getByRole("button", { name: "Delete game with Dana", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Temporary storage failure" }).waitFor();
    expect(await active.count()).toBe(1);
    expect(page.url()).toBe(`${appUrl}#/scorekeeper/games`);
    expect(await page.getByRole("dialog").count()).toBe(0);

    await failNextGameOperation(page, "getScoreboard");
    await active.click();
    await page.getByRole("alert").filter({ hasText: "Unable to load this Game." }).waitFor();
    expect(await page.getByRole("table", { name: "Points scoreboard" }).count()).toBe(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
    await page.getByRole("button", { name: "Add Round", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("refreshes cached generic Home, Games and pruned scoreboard data after the twenty-first completion", async () => {
  const page = await newPage();
  try {
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { completedId } = await page.evaluate<{ completedId: string }>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const settings = { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false };
      const old = await playersApi.create({ name: "Elliot", color: "Jam", isFavorite: 0 });
      const history = await playersApi.create({ name: "History", color: "Moss", isFavorite: 0 });
      const dana = await playersApi.create({ name: "Dana", color: "Ocean", isFavorite: 0 });
      const casey = await playersApi.create({ name: "Casey", color: "Jam", isFavorite: 0 });
      let completedId;
      for (let index = 0; index < 20; index++) {
        const playerId = index === 0 ? old.id : history.id;
        const game = await genericGamesApi.create({ players: [playerId], settings });
        await genericRoundsApi.add({ gameId: game.id, mode: "points", scores: [{ playerId, points: "-2" }] });
        await genericGamesApi.finish(game.id);
        if (index === 0) completedId = game.id;
      }
      const active = await genericGamesApi.create({ players: [dana.id], settings });
      await genericRoundsApi.add({
        gameId: active.id, mode: "points", scores: [{ playerId: dana.id, points: "5" }],
      });
      await genericGamesApi.create({ players: [casey.id], settings });
      return { completedId };
    })()`);
    await page.reload();
    await page.getByRole("link", { name: "Go home", exact: true }).click();
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).waitFor();
    expect(await gameLinks(page).count()).toBe(2);
    await openGames(page);
    const oldResult = page.getByRole("link", {
      name: "View Standings for game with Elliot",
      exact: true,
    });
    await oldResult.waitFor();
    expect(await gameLinks(page).count()).toBe(22);
    await oldResult.click();
    await closeStandings(page);
    expect(await page.getByRole("table", { name: "Points scoreboard" }).innerText()).toContain(
      "-2",
    );

    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).click();
    await finishGame(page);
    await closeStandings(page);
    expect(await page.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Casey", exact: true }).waitFor();
    await expect.poll(() => gameLinks(page).count()).toBe(1);
    await openGames(page);
    await page
      .getByRole("link", { name: "View Standings for game with Dana", exact: true })
      .waitFor();
    await expect.poll(() => gameLinks(page).count()).toBe(21);
    expect(await oldResult.count()).toBe(0);

    // Hash-only navigation keeps the completed scoreboard query cached from its first visit.
    await page.evaluate((id) => {
      window.location.hash = `/scorekeeper/game/${id}`;
    }, completedId);
    await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
    expect(await page.getByRole("table", { name: "Points scoreboard" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Open Standings", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("blocks shared Player deletion for Active Games in either Scorekeeper and releases completed references", async () => {
  const page = await newPage();
  try {
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { genericId, phaseId } = await page.evaluate<{ genericId: string; phaseId: string }>(`
      (async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
        const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
        const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
        const cam = await playersApi.create({ name: "Cam", color: "Moss", isFavorite: 0 });
        const generic = await genericGamesApi.create({
          players: [amy.id],
          settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
        });
        await genericRoundsApi.add({
          gameId: generic.id, mode: "points", scores: [{ playerId: amy.id, points: "5" }],
        });
        const phase = await gamesApi.create({
          players: [bob.id, cam.id],
          phaseSet: {
            id: "shared-players", type: "temporary", name: "Two phases",
            phases: ["phase-1", "phase-2"],
          },
          settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 0, sitOutPenalty: 0 },
        });
        await roundsApi.add({
          gameId: phase.id, roundWinnerId: bob.id,
          scores: [
            { playerId: bob.id, phaseStatus: "completed", score: 0 },
            { playerId: cam.id, phaseStatus: "failed", score: 10 },
          ],
        });
        return { genericId: generic.id, phaseId: phase.id };
      })()
    `);
    await page.reload();
    await deletePlayer(page, "Amy");
    await deletionBlocked(page, "Amy");
    expect(page.url()).toBe(`${appUrl}#/scorekeeper/players`);

    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByRole("button", { name: "Bob", exact: true }).waitFor();
    expect(await page.getByRole("alert").count()).toBe(0);
    await deletePlayer(page, "Bob");
    await deletionBlocked(page, "Bob");
    expect(page.url()).toBe(`${appUrl}#/phaseCompan10n/players`);

    await page.goto(`${appUrl}#/scorekeeper/game/${genericId}`);
    await finishGame(page);
    await closeStandings(page);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await deletePlayer(page, "Amy");
    await page.getByRole("button", { name: "Amy", exact: true }).waitFor({ state: "detached" });
    await deletePlayer(page, "Bob");
    await deletionBlocked(page, "Bob");

    await page.goto(`${appUrl}#/phaseCompan10n/game/${phaseId}`);
    await finishGame(page);
    const phaseStandings = page.getByRole("dialog").filter({
      has: page.getByRole("tabpanel", { name: "Standings", exact: true }),
    });
    await expect
      .poll(() => phaseStandings.evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true);
    await phaseStandings.getByRole("tab", { name: "Standings", exact: true }).press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await deletePlayer(page, "Bob");
    await page.getByRole("button", { name: "Bob", exact: true }).waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Cam", exact: true }).count()).toBe(1);
    expect(await page.getByRole("alert").count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  return page;
}

async function openGames(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Games", exact: true }).click();
  await page.waitForURL(`${appUrl}#/scorekeeper/games`);
}

async function finishGame(page: Page) {
  await page.getByRole("button", { name: "Finish Game", exact: true }).click();
  const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
  await finish.waitFor();
  await expect
    .poll(() => finish.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(false);
  const confirm = finish.getByRole("button", { name: "Finish", exact: true });
  await expect.poll(() => confirm.isEnabled()).toBe(true);
  await confirm.click({ trial: true });
  await confirm.press("Enter");
  await page.getByRole("list", { name: "Standings places", exact: true }).waitFor();
  await page
    .getByRole("dialog")
    .evaluate((dialog) =>
      Promise.allSettled(
        dialog.getAnimations({ subtree: true }).map((animation) => animation.finished),
      ),
    );
}

async function deletePlayer(page: Page, name: string) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
}

async function deletionBlocked(page: Page, name: string) {
  await page
    .getByRole("alert")
    .filter({ hasText: "Cannot delete this Player while an Active Game references them." })
    .waitFor();
  expect(await page.getByRole("button", { name, exact: true }).count()).toBe(1);
}

function gameLinks(page: Page) {
  return page.getByRole("link", { name: /^(Continue game with|View Standings for game with)/ });
}

async function closeStandings(page: Page) {
  const standings = page.getByRole("dialog", { name: "Standings", exact: true });
  await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
  await expect
    .poll(() => standings.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await standings.getByRole("button", { name: "Close", exact: true }).press("Enter");
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
}

async function failNextGameOperation(
  page: Page,
  operation: "getList" | "getScoreboard" | "delete",
) {
  await page.evaluate(`
    import("/scorekeeper/src/data/api/genericGames.ts").then(({ genericGamesApi }) => {
      const original = genericGamesApi[${JSON.stringify(operation)}];
      genericGamesApi[${JSON.stringify(operation)}] = async () => {
        genericGamesApi[${JSON.stringify(operation)}] = original;
        throw new Error("Temporary storage failure");
      };
    })
  `);
}
