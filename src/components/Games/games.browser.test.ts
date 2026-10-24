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

it("browses mixed Games with distinct actions and snapshot avatars, opens Standings and deletes independently", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await seedGames(page);
    await page.goto(`${appUrl}#/phaseCompan10n`);
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).waitFor();
    expect(await gameLinks(page).allTextContents()).toHaveLength(2);
    await openGames(page);
    const completed = page.getByRole("link", {
      name: "View Standings for game with Amy, Bob",
      exact: true,
    });
    await completed.waitFor({ timeout: 5_000 });
    expect(
      await gameLinks(page).evaluateAll((links) => links.map((link) => link.ariaLabel)),
    ).toEqual([
      "Continue game with Dana",
      "View Standings for game with Amy, Bob",
      "Continue game with Casey",
    ]);
    expect(await completed.locator("svg.lucide-chart-no-axes-column").count()).toBe(1);
    expect(await completed.locator("svg.lucide-play").count()).toBe(0);
    expect(
      await completed
        .locator('span[style*="background-color"]')
        .evaluateAll((avatars) =>
          avatars.map((avatar) => getComputedStyle(avatar).backgroundColor),
        ),
    ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)"]);
    const active = page.getByRole("link", { name: "Continue game with Dana", exact: true });
    expect(await active.locator("svg.lucide-play").count()).toBe(1);

    await completed.focus();
    await page.keyboard.press("Enter");
    const standings = page.getByRole("dialog").filter({
      has: page.getByRole("tab", { name: "Standings", exact: true }),
    });
    await standings.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    expect(await standings.innerText()).toContain("Amy");
    expect(await standings.innerText()).toContain("Bob");
    expect(await standings.innerText()).not.toContain("Amelia");
    await page.keyboard.press("Escape");
    await standings.waitFor({ state: "hidden" });
    await openGames(page);
    await completed.waitFor();
    expect(await gameLinks(page).first().getAttribute("aria-label")).toBe(
      "Continue game with Dana",
    );
    const destination = await completed.getAttribute("href");
    await page.getByRole("button", { name: "Delete game with Amy, Bob", exact: true }).click();
    await completed.waitFor({ state: "detached" });
    expect(page.url()).toBe(`${appUrl}#/phaseCompan10n/games`);
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.reload();
    await active.waitFor();
    expect(await gameLinks(page).count()).toBe(2);
    if (!destination) throw new Error("Missing Game link");
    await page.goto(new URL(destination, appUrl).href);
    await page.getByText("This Game is no longer available.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await page.getByRole("button", { name: "Dana", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit player", exact: true });
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Dawn");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page.getByRole("link", { name: "Go home", exact: true }).click();
    await page.getByRole("link", { name: "Continue game with Dawn", exact: true }).waitFor();
    await openGames(page);
    await page.getByRole("link", { name: "Continue game with Dawn", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("shows loading, empty and retryable errors without turning failed deletes into navigation", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await page.evaluate(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) => {
        const original = gamesApi.getList;
        const ready = new Promise(resolve => { window.releaseGamesList = resolve; });
        gamesApi.getList = async (...args) => {
          gamesApi.getList = original;
          await ready;
          return original(...args);
        };
      })
    `);
    await openGames(page);
    await page.locator(".list-shimmer").first().waitFor();
    await page.evaluate("window.releaseGamesList()");
    await page.getByText("No games yet", { exact: true }).waitFor();

    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await seedGames(page);
    await page.reload();
    await page.getByRole("link", { name: "Go home", exact: true }).waitFor();
    await failNextGameOperation(page, "getList");
    await page.goto(`${appUrl}#/phaseCompan10n/games`);
    await page.getByRole("alert").filter({ hasText: "Unable to load games." }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    const active = page.getByRole("link", { name: "Continue game with Dana", exact: true });
    await active.waitFor();
    const play = active.locator("svg.lucide-play");
    const idleColor = await play.evaluate((icon) => getComputedStyle(icon).color);
    await active.hover();
    await expectIconColor(play, "--color-pt-blue-500");
    const completed = page.getByRole("link", {
      name: "View Standings for game with Amy, Bob",
      exact: true,
    });
    await completed.hover();
    await expectIconColor(
      completed.locator("svg.lucide-chart-no-axes-column"),
      "--color-pt-green-500",
    );
    const remove = page.getByRole("button", { name: "Delete game with Dana", exact: true });
    await remove.hover();
    expect(await play.evaluate((icon) => getComputedStyle(icon).color)).toBe(idleColor);
    expect(await play.evaluate((icon) => getComputedStyle(icon).fill)).toBe("none");

    await failNextGameOperation(page, "delete");
    await page.getByRole("button", { name: "Delete game with Dana", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Temporary storage failure" }).waitFor();
    expect(await active.count()).toBe(1);
    expect(page.url()).toBe(`${appUrl}#/phaseCompan10n/games`);

    await failNextGameOperation(page, "getById");
    await active.click();
    await page.getByRole("alert").filter({ hasText: "Unable to load this Game." }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("refreshes cached Home, Games and removed detail data after the twenty-first completion", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { activeId, completedId } = await seedGames(page);
    await page.evaluate(`
      Promise.all([
        import("/scorekeeper/src/data/api/games.ts"),
        import("/scorekeeper/src/data/api/rounds.ts")
      ]).then(async ([{ gamesApi }, { roundsApi }]) => {
        const active = await gamesApi.getById(${JSON.stringify(activeId)});
        for (let i = 0; i < 19; i++) {
          const game = await gamesApi.create({
            players: active.players, phaseSet: active.phaseSet, settings: active.settings
          });
          await roundsApi.add({
            gameId: game.id, roundWinnerId: active.players[0],
            scores: [{ playerId: active.players[0], phaseStatus: "completed", score: 0 }]
          });
        }
      })
    `);
    await page.goto(`${appUrl}#/phaseCompan10n`);
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).waitFor();
    await openGames(page);
    const oldResult = page.getByRole("link", {
      name: "View Standings for game with Amy, Bob",
      exact: true,
    });
    await oldResult.click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    await page.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Dana", exact: true }).click();
    await page.getByRole("button", { name: "Save round", exact: true }).click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Casey", exact: true }).waitFor();
    await expect.poll(() => gameLinks(page).count()).toBe(1);
    await openGames(page);
    await page
      .getByRole("link", { name: "View Standings for game with Dana", exact: true })
      .first()
      .waitFor();
    await expect.poll(() => gameLinks(page).count()).toBe(21);
    expect(await oldResult.count()).toBe(0);
    // Hash navigation preserves the query cache from the first visit.
    await page.evaluate((id) => {
      window.location.hash = `/phaseCompan10n/game/${id}`;
    }, completedId);
    await page.getByText("This Game is no longer available.", { exact: true }).waitFor();
    expect(await page.getByRole("region", { name: "Scoreboard", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

async function expectIconColor(icon: Locator, token: string) {
  const colors = await icon.evaluate((element, colorToken) => {
    const sample = document.createElement("span");
    sample.style.color = `var(${colorToken})`;
    document.body.append(sample);
    const expected = getComputedStyle(sample).color;
    sample.remove();
    return { actual: getComputedStyle(element).color, expected };
  }, token);
  expect(colors.actual).toBe(colors.expected);
}

async function failNextGameOperation(page: Page, operation: "getList" | "getById" | "delete") {
  await page.evaluate(`
    import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) => {
      const original = gamesApi[${JSON.stringify(operation)}];
      gamesApi[${JSON.stringify(operation)}] = async () => {
        gamesApi[${JSON.stringify(operation)}] = original;
        throw new Error("Temporary storage failure");
      };
    })
  `);
}

function gameLinks(page: Page) {
  return page.locator('a[href*="/phaseCompan10n/game/"]');
}

async function openGames(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Games", exact: true }).click({ timeout: 5_000 });
}

async function seedGames(page: Page) {
  await page.goto(`${appUrl}#/phaseCompan10n/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  return page.evaluate<{ completedId: string; activeId: string }>(`
    Promise.all([
      import("/scorekeeper/src/data/api/games.ts"),
      import("/scorekeeper/src/data/api/players.ts"),
      import("/scorekeeper/src/data/api/rounds.ts")
    ]).then(async ([{ gamesApi }, { playersApi }, { roundsApi }]) => {
      const amy = await playersApi.create({ name: "Amy", color: "#123456", isFavorite: 0 });
      const bob = await playersApi.create({ name: "Bob", color: "#abcdef", isFavorite: 0 });
      const casey = await playersApi.create({ name: "Casey", color: "Jam", isFavorite: 0 });
      const dana = await playersApi.create({ name: "Dana", color: "Ocean", isFavorite: 0 });
      const input = {
        phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["phase-1"] },
        settings: { tiebreaker: "roundsWon", roundSkipPenalty: 100, sitOutPenalty: 0 }
      };
      const now = Date.now;
      try {
        Date.now = () => now() - 300000;
        await gamesApi.create({ ...input, players: [casey.id] });
        const completed = await gamesApi.create({ ...input, players: [amy.id, bob.id] });
        Date.now = () => now() - 120000;
        await roundsApi.add({
          gameId: completed.id, roundWinnerId: amy.id,
          scores: [
            { playerId: amy.id, phaseStatus: "completed", score: 0 },
            { playerId: bob.id, phaseStatus: "failed", score: 0 }
          ]
        });
        Date.now = now;
        const active = await gamesApi.create({ ...input, players: [dana.id] });
        await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
        await playersApi.delete(bob.id);
        return { completedId: completed.id, activeId: active.id };
      } finally {
        Date.now = now;
      }
    })
  `);
}
