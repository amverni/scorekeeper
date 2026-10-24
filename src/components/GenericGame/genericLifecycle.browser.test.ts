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

async function openGames(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Games", exact: true }).click();
  await page.waitForURL(`${appUrl}#/scorekeeper/games`);
}

function gameLinks(page: Page) {
  return page.getByRole("link", { name: /^(Continue game with|View Standings for game with)/ });
}

it("browses mixed generic Games with snapshot avatars and distinct actions, and deletes without crossing ownership", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const game = await seedGame(page);
    const phaseId = await page.evaluate<string>(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(game.id)});
      const casey = await playersApi.create({ name: "Casey", color: "Jam", isFavorite: 0 });
      await genericGamesApi.create({ players: [casey.id], settings: game.settings });
      await genericRoundsApi.add({
        gameId: game.id, mode: "points", scores: game.players.map(playerId => ({ playerId, points: "5" })),
      });
      await genericGamesApi.finish(game.id);
      await playersApi.update(game.players[0], { name: "Renamed", color: "#654321" });
      await playersApi.delete(game.players[1]);
      const dana = await playersApi.create({ name: "Dana", color: "Jam", isFavorite: 0 });
      await genericGamesApi.create({ players: [dana.id], settings: game.settings });
      const phase = await gamesApi.create({
        players: [casey.id, dana.id],
        phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["phase-1"] },
        settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 0, sitOutPenalty: 0 },
      });
      return phase.id;
    })()`);
    await page.goto(`${appUrl}#/scorekeeper`);
    await page.reload();
    await page.getByRole("link", { name: "Continue game with Dana", exact: true }).waitFor();
    expect(await gameLinks(page).count()).toBe(2);
    await openGames(page);
    const completed = page.getByRole("link", {
      name: "View Standings for game with Maya, Rowan",
      exact: true,
    });
    await completed.waitFor();
    expect(
      await gameLinks(page).evaluateAll((links) => links.map((link) => link.ariaLabel)),
    ).toEqual([
      "Continue game with Dana",
      "View Standings for game with Maya, Rowan",
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
    await active.hover();
    await expectIconColor(active.locator("svg.lucide-play"), "--color-pt-blue-500");
    await completed.hover();
    await expectIconColor(
      completed.locator("svg.lucide-chart-no-axes-column"),
      "--color-pt-green-500",
    );
    await completed.focus();
    await page.keyboard.press("Enter");
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    await standings.getByRole("list", { name: "Standings places" }).waitFor();
    expect(await standings.innerText()).toContain("Maya");
    expect(await standings.innerText()).toContain("Rowan");
    expect(await standings.innerText()).not.toContain("Renamed");
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
    await openGames(page);
    await completed.waitFor();
    expect(await gameLinks(page).first().getAttribute("aria-label")).toBe(
      "Continue game with Dana",
    );
    await page.getByRole("button", { name: "Delete game with Maya, Rowan", exact: true }).click();
    await completed.waitFor({ state: "detached" });
    expect(page.url()).toBe(`${appUrl}#/scorekeeper/games`);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
    await page.goto(`${appUrl}#/scorekeeper/game/${phaseId}`);
    await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
    await page.goto(`${appUrl}#/phaseCompan10n/game/${phaseId}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    await page.goto(`${appUrl}#/scorekeeper/games`);
    await active.waitFor();
    await page.getByRole("button", { name: "Delete game with Dana", exact: true }).click();
    await active.waitFor({ state: "detached" });
    await page.getByRole("link", { name: "Go home", exact: true }).click();
    await expect.poll(() => gameLinks(page).count()).toBe(1);
  } finally {
    await page.close();
  }
}, 60_000);

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

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function seedGame(page: Page, names = ["Maya", "Rowan"], dealer = false) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  const game = await page.evaluate<GenericGame>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const players = [];
    for (const [index, name] of ${JSON.stringify(names)}.entries()) {
      players.push(await playersApi.create({
        name, color: index === 0 ? "#123456" : "#abcdef", isFavorite: 0,
      }));
    }
    return genericGamesApi.create({
      players: players.map(player => player.id),
      settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: ${dealer} },
    });
  })()`);
  // Seeding through the API does not invalidate the mounted Home query.
  await page.reload();
  await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
  await page.getByRole("table", { name: "Points scoreboard" }).waitFor();
  return game;
}

function readGame(page: Page, id: string) {
  return page.evaluate<GenericGame>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.getById(${JSON.stringify(id)});
  })()`);
}

it("offers Pause and Delete without a saved Round and discards a draft only when leaving", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const game = await seedGame(page);
    const finishButton = page.getByRole("button", { name: "Finish Game", exact: true });
    await finishButton.click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await finish.getByRole("button", { name: "Pause", exact: true }).waitFor();
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    expect(await finish.getByRole("button").allTextContents()).toEqual(["Pause", "Delete"]);
    expect(await finish.innerText()).not.toContain("Save at least one Round");
    expect(await finish.getByRole("heading").count()).toBe(0);
    await expect
      .poll(() => finish.evaluate((element) => element.contains(document.activeElement)))
      .toBe(false);
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await expect
      .poll(() => finishButton.evaluate((element) => element === document.activeElement))
      .toBe(true);

    const menuBox = await page.getByRole("button", { name: "Menu", exact: true }).boundingBox();
    const finishBox = await finishButton.boundingBox();
    const standingsBox = await page.getByRole("button", { name: "Open Standings" }).boundingBox();
    if (!menuBox || !finishBox || !standingsBox) throw new Error("Missing Game controls");
    expect(menuBox.x).toBeGreaterThan(195);
    expect(menuBox.y).toBeLessThan(422);
    expect(finishBox.x).toBeGreaterThan(195);
    expect(finishBox.y).toBeGreaterThan(422);
    expect(standingsBox.x).toBeLessThan(195);
    expect(standingsBox.y).toBeGreaterThan(422);

    const add = page.getByRole("button", { name: "Add Round", exact: true });
    await add.click();
    const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    await entry.getByRole("button", { name: "8", exact: true }).waitFor();
    expect(await entry.getAttribute("aria-modal")).toBe("true");
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    expect(
      await page.evaluate(
        ({ x, y, width, height }) =>
          !!document.elementFromPoint(x + width / 2, y + height / 2)?.closest('[role="dialog"]'),
        finishBox,
      ),
    ).toBe(true);
    await entry.getByRole("button", { name: "8", exact: true }).click();
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press(tab);
      await expect
        .poll(() => entry.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await finishButton.click();
    await page.mouse.click(4, 4);
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await add.click();
    expect(
      await entry.getByRole("status", { name: "Maya Points", exact: true }).innerText(),
    ).toContain("8");
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await finishButton.click();
    await finish.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForURL(`${appUrl}#/scorekeeper`);
    expect(await readGame(page, game.id)).toMatchObject({ status: "active" });
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.getByRole("link", { name: "Continue game with Maya, Rowan", exact: true }).click();
    await add.click();
    expect(await entry.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "0",
    );
    expect(await entry.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

async function saveRound(page: Page, scores: Record<string, string>) {
  await page.getByRole("button", { name: "Add Round", exact: true }).click();
  const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
  for (const [name, points] of Object.entries(scores)) {
    await entry.getByRole("tab", { name, exact: true }).click();
    await entry.getByRole("button", { name: "0", exact: true }).focus();
    await page.keyboard.type(points.replace(/^-/, ""));
    if (points.startsWith("-")) await page.keyboard.press("-");
  }
  await entry.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
}

it.each([
  true,
  false,
])("manually finishes saved Points (tied: %s) and reopens final Standings once", async (tied) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const game = await seedGame(page, ["Maya", "Rowan"], true);
    await saveRound(page, { Maya: "5", Rowan: tied ? "5" : "-2" });
    expect(await readGame(page, game.id)).toMatchObject({ status: "active" });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    await entry.getByRole("button", { name: "9", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    const confirm = finish.getByRole("button", { name: "Finish", exact: true });
    await confirm.waitFor();
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    await expect
      .poll(async () => {
        const bounds = await confirm.boundingBox();
        return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(568);
    await confirm.click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    const places = standings.getByRole("list", { name: "Standings places" });
    await places.waitFor();
    await finish.waitFor({ state: "detached" });
    expect(await places.getByRole("listitem").allTextContents()).toEqual([
      expect.stringContaining("Place 1"),
      expect.stringContaining(tied ? "Tied for place 1" : "Place 2"),
    ]);
    expect(await readGame(page, game.id)).toMatchObject({
      status: "completed",
      completionType: "manual",
      winnerIds: tied ? game.players : [game.players[0]],
      playerSnapshots: [
        { id: game.players[0], name: "Maya", color: "#123456" },
        { id: game.players[1], name: "Rowan", color: "#abcdef" },
      ],
    });
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Expand Round 2", exact: true }).count()).toBe(0);
    expect(await page.getByRole("cell", { name: /upcoming Round/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(
      await page
        .getByRole("cell", { name: "Maya, Round 1: 5 Points, Dealer", exact: true })
        .innerText(),
    ).toContain("Accumulated Points: 5");
    expect(await standings.count()).toBe(0);
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    await places.waitFor();
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.reload();
    await places.waitFor();
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(await standings.count()).toBe(0);
    await returnToDashboard(page);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await openGames(page);
    await page
      .getByRole("link", { name: "View Standings for game with Maya, Rowan", exact: true })
      .click();
    await places.waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps failed completion recoverable and prevents duplicate or dismissed pending Finish", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const game = await seedGame(page);
    await saveRound(page, { Maya: "0", Rowan: "-1" });
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const original = genericGamesApi.finish;
      genericGamesApi.finish = async () => {
        genericGamesApi.finish = original;
        throw new Error("Temporary storage failure");
      };
    })()`);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await finish.getByRole("alert").filter({ hasText: "Temporary storage failure" }).waitFor();
    expect(await readGame(page, game.id)).toMatchObject({ status: "active" });
    expect(await finish.getByRole("button", { name: "Pause", exact: true }).isEnabled()).toBe(true);
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const original = genericGamesApi.finish;
      const ready = new Promise(resolve => { window.releaseFinish = resolve; });
      genericGamesApi.finish = async (...args) => {
        genericGamesApi.finish = original;
        await ready;
        return original(...args);
      };
    })()`);
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await finish.getByRole("button", { name: "Finishing...", exact: true }).waitFor();
    for (const name of ["Finishing...", "Pause"]) {
      expect(await finish.getByRole("button", { name, exact: true }).isDisabled()).toBe(true);
    }
    await page.keyboard.press("Escape");
    expect(await finish.getByRole("button", { name: "Finishing...", exact: true }).count()).toBe(1);
    expect(await readGame(page, game.id)).toMatchObject({ status: "active" });
    await page.evaluate("window.releaseFinish()");
    await page.getByRole("dialog", { name: "Standings", exact: true }).getByRole("list").waitFor();
    expect(await readGame(page, game.id)).toMatchObject({ status: "completed" });
  } finally {
    await page.close();
  }
}, 60_000);
