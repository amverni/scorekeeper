/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
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

it("keeps every completed surface frozen across shared Player edits and deletion without reloading", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const games = await page.evaluate<
      { id: string; home: string; graphTabs: string[]; graphLabels: string[] }[]
    >(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
      const maya = await playersApi.create({ name: "Maya", color: "#123456", isFavorite: 0 });
      const rowan = await playersApi.create({ name: "Rowan", color: "#abcdef", isFavorite: 0 });
      const players = [maya.id, rowan.id];
      const results = [];
      for (const mode of ["points", "singleRoundWinner", "passFail"]) {
        const game = await genericGamesApi.create({
          players,
          settings: mode === "points"
            ? { mode, pointsDirection: "low", tiebreaker: { direction: "high" }, dealer: true }
            : { mode, tiebreaker: null, dealer: true },
        });
        await genericRoundsApi.add({
          gameId: game.id, mode,
          scores: players.map((playerId, index) => mode === "points"
            ? { playerId, points: "-12", tiebreaker: "4" }
            : mode === "singleRoundWinner" ? { playerId, won: index === 0 } : { playerId, passed: true }),
        });
        const metric = mode === "points" ? "Points" : mode === "singleRoundWinner" ? "Rounds Won" : "Passes";
        results.push({
          id: game.id, home: "/scorekeeper",
          graphTabs: mode === "points" ? [metric, "Tiebreaker"] : [metric],
          graphLabels: mode === "points"
            ? ["Points progress by round", "Tiebreaker progress by round"]
            : [metric + " progress by round"],
        });
      }
      const phase = await gamesApi.create({
        players,
        phaseSet: { id: "integration", type: "temporary", name: "Three phases", phases: ["phase-1", "phase-2", "phase-3"] },
        settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 0, sitOutPenalty: 0 },
      });
      await roundsApi.add({
        gameId: phase.id, roundWinnerId: maya.id,
        scores: players.map(playerId => ({ playerId, phaseStatus: "completed", score: 0 })),
      });
      results.push({
        id: phase.id, home: "/phaseCompan10n",
        graphTabs: ["Phases", "Tiebreaker"],
        graphLabels: ["Phase progress by round", "Tiebreaker progress by round"],
      });
      return results;
    })()`);
    const standings = page.getByRole("dialog").filter({
      has: page.getByRole("tab", { name: "Standings", exact: true }),
    });
    for (const game of games) {
      await page.goto(`${appUrl}#${game.home}/game/${game.id}`);
      await page.getByRole("button", { name: "Finish Game", exact: true }).click();
      const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
      await finish.getByRole("button", { name: "Finish", exact: true }).click();
      await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
      await finish.waitFor({ state: "detached" });
      await standings.getByRole("tab", { name: game.graphTabs[0], exact: true }).click();
      await standings.getByRole("img", { name: game.graphLabels[0], exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await standings.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("link", { name: "Games", exact: true }).click();
      await page
        .getByRole("link", { name: "View Standings for game with Maya, Rowan", exact: true })
        .first()
        .waitFor();
    }

    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByRole("button", { name: "Maya", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit player", exact: true });
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Maya changed");
    await editor.getByRole("radio", { name: "Select color Rose", exact: true }).check();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("button", { name: "Delete Rowan", exact: true }).click();
    await page.getByRole("button", { name: "Rowan", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Maya changed", exact: true }).waitFor();

    for (const game of games) {
      await page.goto(`${appUrl}#${game.home}/games`);
      const resultLink = page
        .getByRole("link", { name: "View Standings for game with Maya, Rowan", exact: true })
        .and(page.locator(`a[href$="/game/${game.id}"]`));
      await resultLink.waitFor();
      expect(
        await resultLink
          .locator('span[style*="background-color"]')
          .evaluateAll((avatars) =>
            avatars.map((avatar) => getComputedStyle(avatar).backgroundColor),
          ),
      ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)"]);
      await resultLink.click();
      const places = standings.getByRole("list", { name: "Standings places", exact: true });
      await places.waitFor();
      expect(await places.innerText()).toContain("Maya");
      expect(await places.innerText()).toContain("Rowan");
      expect(await places.innerText()).not.toContain("Maya changed");
      expect(
        await places
          .locator('span[style*="background-color"]')
          .evaluateAll((avatars) =>
            avatars.map((avatar) => getComputedStyle(avatar).backgroundColor),
          ),
      ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)"]);
      for (const [index, tab] of game.graphTabs.entries()) {
        await standings.getByRole("tab", { name: tab, exact: true }).click();
        const graph = standings.getByRole("img", { name: game.graphLabels[index], exact: true });
        await graph.waitFor();
        expect(await standings.innerHTML()).toContain("Maya");
        expect(await standings.innerHTML()).toContain("Rowan");
        expect(await standings.innerHTML()).not.toContain("Maya changed");
        expect(
          await graph
            .locator("path[stroke]")
            .evaluateAll((paths) => paths.map((path) => path.getAttribute("stroke"))),
        ).toEqual(["#123456", "#abcdef"]);
      }
      await page.keyboard.press("Escape");
      await standings.waitFor({ state: "detached" });
      const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
      expect(
        await scoreboard
          .locator('.scoreboard-cell--sticky-top span[style*="background-color"]:visible')
          .evaluateAll((avatars) =>
            avatars.map((avatar) => getComputedStyle(avatar).backgroundColor),
          ),
      ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)"]);
      expect(await scoreboard.innerHTML()).not.toContain("Maya changed");
      expect(await page.getByRole("button", { name: /^Add [Rr]ound/ }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
}, 90_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function settleMotion(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function expectContained(control: Locator, container: Locator) {
  const bounds = await control.boundingBox();
  const area = await container.boundingBox();
  if (!bounds || !area) throw new Error("Missing control geometry");
  expect(bounds.x).toBeGreaterThanOrEqual(area.x);
  expect(bounds.y).toBeGreaterThanOrEqual(area.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
}

it.each([
  { mode: "singleRoundWinner", width: 320, height: 568, colorScheme: "dark" },
  { mode: "singleRoundWinner", width: 390, height: 844, colorScheme: "light" },
  { mode: "singleRoundWinner", width: 768, height: 1024, colorScheme: "dark" },
  { mode: "passFail", width: 320, height: 568, colorScheme: "light" },
  { mode: "passFail", width: 390, height: 844, colorScheme: "dark" },
  { mode: "passFail", width: 768, height: 1024, colorScheme: "light" },
] as const)("keeps $mode long-roster entry and Save outside Safe Areas at $width x $height in $colorScheme", async ({
  mode,
  width,
  height,
  colorScheme,
}) => {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/scorekeeper`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    const names = Array.from({ length: 16 }, (_, index) => `Alexandria Montgomery ${index + 1}`);
    const gameId = await page.evaluate<string>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const players = [];
      for (const name of ${JSON.stringify(names)}) {
        players.push(await playersApi.create({ name, color: "Ocean", isFavorite: 0 }));
      }
      const mode = ${JSON.stringify(mode)};
      const game = await genericGamesApi.create({
        players: players.map(player => player.id),
        settings: { mode, tiebreaker: null, dealer: false },
      });
      for (let index = 0; index < 12; index++) {
        await genericRoundsApi.add({
          gameId: game.id, mode,
          scores: players.map((player, playerIndex) => mode === "singleRoundWinner"
            ? { playerId: player.id, won: playerIndex === 0 }
            : { playerId: player.id, passed: false }),
        });
      }
      return game.id;
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
    await page.addStyleTag({
      content:
        ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 16px; --safe-area-inset-right: 16px; }",
    });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    expect(
      await page.evaluate(async () => {
        const fonts = await document.fonts.load('16px "Quicksand Variable"');
        return fonts.length > 0 && fonts.every((font) => font.status === "loaded");
      }),
    ).toBe(true);
    await settleMotion(page);
    const scroll = dialog.getByRole("region", {
      name: mode === "singleRoundWinner" ? "Choose Round Winner" : "Pass/Fail entries",
      exact: true,
    });
    const role = mode === "singleRoundWinner" ? "radio" : "button";
    for (const name of [names[0], names[15]]) {
      const capsule = dialog.getByRole(role, { name, exact: true });
      await capsule.click({ trial: true });
      await capsule.focus();
      await scroll.evaluate((element, bottom) => {
        element.scrollTop = bottom ? element.scrollHeight : 0;
      }, name === names[15]);
      const resting = await capsule.boundingBox();
      if (!resting) throw new Error("Missing Player capsule");
      expect(resting.height).toBeGreaterThanOrEqual(44);
      expect(
        await capsule.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
        ),
      ).toBeGreaterThanOrEqual(resting.height / 2);
      await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => (await capsule.boundingBox())?.width ?? 0)
        .toBeGreaterThan(resting.width + 1);
      await expectContained(capsule, scroll);
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
    const last = dialog.getByRole(role, { name: names[15], exact: true });
    await last.press("Space");
    expect(
      await last.getAttribute(mode === "singleRoundWinner" ? "aria-checked" : "aria-pressed"),
    ).toBe("true");
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const bounds = await save.boundingBox();
    if (!bounds) throw new Error("Missing Save geometry");
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 34);
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 16);
    expect(await dialog.getByRole("tab").count()).toBe(0);
    expect(await dialog.getByText(/Tiebreaker/).count()).toBe(0);
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await page
      .getByRole("cell", {
        name: `${names[15]}, Round 13: ${mode === "singleRoundWinner" ? "Won" : "Passed"}`,
        exact: true,
      })
      .waitFor();
    expect(await page.getByRole("img", { name: "Dealer", exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  } finally {
    await page.close();
  }
}, 60_000);

const numericLayouts = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
].flatMap((viewport) =>
  (["light", "dark"] as const).flatMap((colorScheme) =>
    [false, true].map((tiebreaker) => ({ ...viewport, colorScheme, tiebreaker })),
  ),
);

async function expectNumericFit(dialog: Locator) {
  const body = dialog.locator("[data-swipe-navigation-root]");
  const whole = await dialog
    .locator(".dialog-panel")
    .evaluate((element) => getComputedStyle(element).overflowY === "auto");
  for (const container of [body, dialog.locator(".dialog-body")]) {
    expect(
      await container.evaluate((element) => ({
        overflow: element.scrollHeight - element.clientHeight,
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    ).toEqual({ overflow: 0, top: 0, left: 0 });
  }
  const keys = dialog.getByRole("group", { name: /keypad$/ }).getByRole("button");
  expect(await keys.count()).toBe(12);
  for (const control of [
    ...(await keys.all()),
    ...(await dialog.getByRole("status").all()),
    ...(await dialog.getByRole("alert").all()),
  ]) {
    await expectContained(control, body);
  }
  for (const key of await keys.all()) {
    const bounds = await key.boundingBox();
    if (!bounds) throw new Error("Missing numeric key");
    expect(bounds.width).toBeGreaterThanOrEqual(24);
    expect(bounds.width).toBeCloseTo(bounds.height, 0);
    if (await key.isDisabled()) continue;
    if (whole) await key.scrollIntoViewIfNeeded();
    expect(
      await key.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        );
      }),
    ).toBe(true);
  }
  const errorRegion = dialog.getByRole("region", { name: "Round save error", exact: true });
  if (await errorRegion.count()) {
    expect(
      await errorRegion.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBe(0);
  }
}

it.each(
  numericLayouts,
)("fits numeric entry, using modal scrolling only when cramped, with a long roster and Safe Areas at $width x $height in $colorScheme (Tiebreaker $tiebreaker)", async ({
  width,
  height,
  colorScheme,
  tiebreaker,
}) => {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme,
    hasTouch: true,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/scorekeeper`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    const names = Array.from({ length: 8 }, (_, index) => `Alexandria Montgomery ${index + 1}`);
    const gameId = await page.evaluate<string>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const players = [];
      for (const name of ${JSON.stringify(names)}) {
        players.push(await playersApi.create({ name, color: "Ocean", isFavorite: 0 }));
      }
      const game = await genericGamesApi.create({
        players: players.map(player => player.id),
        settings: { mode: "points", pointsDirection: "low", tiebreaker: ${tiebreaker ? '{ direction: "high" }' : "null"}, dealer: true },
      });
      for (let index = 0; index < 12; index++) {
        await genericRoundsApi.add({
          gameId: game.id, mode: "points",
          scores: players.map(player => ({ playerId: player.id, points: "-1234567", ...(${tiebreaker} ? { tiebreaker: "7654321" } : {}) })),
        });
      }
      return game.id;
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
    await page.addStyleTag({
      content:
        ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 16px; --safe-area-inset-right: 16px; }",
    });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const scroll = dialog.locator("[data-swipe-navigation-root]");
    expect(
      await page.evaluate(async () => {
        const fonts = await document.fonts.load('16px "Quicksand Variable"');
        return fonts.length > 0 && fonts.every((font) => font.status === "loaded");
      }),
    ).toBe(true);
    await settleMotion(page);
    await expectNumericFit(dialog);
    const panelBounds = await dialog.locator(".dialog-panel").boundingBox();
    if (!panelBounds) throw new Error("Missing numeric dialog panel");
    expect(panelBounds.y).toBe(36);
    expect(panelBounds.height).toBe(height - 20 - 34 - 32);
    for (const name of names) {
      const playerTab = dialog.getByRole("tab", { name, exact: true });
      await playerTab.click();
      await expect.poll(() => playerTab.getAttribute("aria-selected")).toBe("true");
      const points = dialog.getByRole("status", { name: `${name} Points`, exact: true });
      await dialog.getByRole("button", { name: "0", exact: true }).focus();
      await page.keyboard.type("1234567-");
      if (tiebreaker) {
        await dialog.getByRole("button", { name: `${name} Points`, exact: true }).focus();
        const secondary = dialog.getByRole("button", { name: `${name} Tiebreaker`, exact: true });
        const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
        await page.keyboard.press(tab);
        await expect
          .poll(() => secondary.evaluate((element) => element === document.activeElement))
          .toBe(true);
        expect(await secondary.getAttribute("aria-pressed")).toBe("true");
        await page.keyboard.type("7654321");
        expect(await secondary.innerText()).toContain("7654321");
      }
      expect(await points.innerText()).toContain("-1234567");
      await expectNumericFit(dialog);
    }
    const metrics = tiebreaker ? ["Points", "Tiebreaker"] : ["Points"];
    const lastName = names[7];
    for (const metric of metrics) {
      if (tiebreaker) {
        await dialog.getByRole("button", { name: `${lastName} ${metric}`, exact: true }).focus();
      } else {
        await dialog.getByRole("button", { name: "0", exact: true }).focus();
      }
      await page.keyboard.press("Delete");
      await page.keyboard.type("1.5");
      await dialog
        .getByRole("alert")
        .filter({ hasText: `whole number for ${metric}` })
        .waitFor();
      await expectNumericFit(dialog);
      await page.keyboard.press("Delete");
      await page.keyboard.type("9007199254740992-");
      await dialog
        .getByRole("alert")
        .filter({ hasText: new RegExp(`${metric} must be`) })
        .waitFor();
      await expectNumericFit(dialog);
      for (const value of ["9".repeat(22), "9".repeat(51)]) {
        await page.keyboard.press("Delete");
        await page.keyboard.type(value);
        expect(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(
          true,
        );
        expect(
          await dialog
            .getByRole("status", { name: `${lastName} ${metric}`, exact: true })
            .innerText(),
        ).toContain(value);
        await expectNumericFit(dialog);
      }
    }
    for (const metric of metrics) {
      if (tiebreaker) {
        await dialog.getByRole("button", { name: `${lastName} ${metric}`, exact: true }).focus();
      }
      await page.keyboard.press("Delete");
      await page.keyboard.type("9007199254740991-");
    }
    await expectNumericFit(dialog);
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: /Total Points must be/ })
      .waitFor();
    await expectNumericFit(dialog);
    for (const metric of metrics) {
      await (tiebreaker
        ? dialog.getByRole("button", { name: `${lastName} ${metric}`, exact: true })
        : dialog.getByRole("button", { name: "0", exact: true })
      ).focus();
      await page.keyboard.press("Delete");
      await page.keyboard.type(metric === "Points" ? "1234567-" : "7654321");
    }
    for (const metric of tiebreaker ? ["Points", "Tiebreaker"] : []) {
      const field = dialog.getByRole("button", { name: `${names[7]} ${metric}`, exact: true });
      const resting = await field.boundingBox();
      if (!resting) throw new Error("Missing numeric field geometry");
      await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => (await field.boundingBox())?.width ?? 0)
        .toBeGreaterThan(resting.width + 1);
      await expectContained(field, scroll);
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
    const key = dialog.getByRole("button", { name: "Backspace", exact: true });
    const resting = await key.boundingBox();
    if (!resting) throw new Error("Missing Backspace geometry");
    await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await key.boundingBox())?.width ?? 0)
      .toBeGreaterThan(resting.width + 1);
    await expectContained(key, scroll);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    const bounds = await save.boundingBox();
    if (!bounds) throw new Error("Missing Save geometry");
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 34);
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 16);
    expect(await dialog.locator("input, textarea").count()).toBe(0);
    await expectNumericFit(dialog);
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await page
      .getByRole("cell", {
        name: `${names[7]}, Round 13: -1234567 Points${tiebreaker ? ", 7654321 Tiebreaker" : ""}`,
        exact: true,
      })
      .waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  } finally {
    await page.close();
  }
}, 60_000);
