/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { touchGesture } from "../../test/touchGesture";
import { setVisibleViewport } from "../../test/visualViewport";
import type { Game, GameReadModel, GameTiebreaker, Player, Round } from "../../types";
import { expectReadyAction } from "../ui/Button/readyActionTestUtils";

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
  // Keep cold module transforms in the setup budget, not the first flow's timeout.
  await server.environments.client.warmupRequest("/src/main.tsx");
  await server.environments.client.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it("restores the durable first-finisher choice, continues without finished entries and automatically shows final places", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 1, "roundsWon", 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    let entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    for (const player of players.slice(1)) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Failed", exact: true }).click();
    }
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    const choice = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await choice.getByRole("button", { name: "Keep playing", exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect(await choice.innerText()).toContain(
      `${players[0].name} wins. Do others want to keep playing?`,
    );
    expect(await choice.getByRole("button").allTextContents()).toEqual(["Keep playing", "Finish"]);
    expect((await readRounds(page, game.id)).length).toBe(1);
    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    await touchGesture(choice.locator(".dialog-panel"), [
      { y: 0, time: 0 },
      { y: 250, time: 100 },
      { y: 250, time: 110 },
    ]);
    expect(await choice.locator(".dialog-panel").isVisible()).toBe(true);
    await page.reload();
    await choice.getByRole("button", { name: "Keep playing", exact: true }).waitFor();
    expect((await readRounds(page, game.id)).length).toBe(1);
    await choice.getByRole("button", { name: "Keep playing", exact: true }).click();
    await choice.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.locator(".scoreboard-cell--sticky-top").first().innerText()).toContain("1st");
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    expect(
      await entry
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label"))),
    ).toEqual([players[1].name, players[2].name]);
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    expect(await page.getByRole("option", { name: players[0].name, exact: true }).count()).toBe(0);
    await page.getByRole("option", { name: players[1].name, exact: true }).click();
    await entry.getByRole("tab", { name: players[2].name, exact: true }).click();
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    const standings = await openStandings(page);
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect((await readGameView(page, game.id))?.game).toMatchObject({
      status: "completed",
      completionType: "normal",
      winnerIds: [players[0].id],
    });
    expect(await standings.getByRole("list", { name: "Standings places" }).innerText()).toContain(
      "Place 3",
    );
    expect(await page.getByRole("dialog", { name: "Finish Game", exact: true }).count()).toBe(0);
    await standings.getByRole("tab", { name: "Phases", exact: true }).click();
    for (const player of players.slice(0, 2)) {
      expect(
        await standings
          .getByRole("img", { name: `Latest finished phase 1: ${player.name}`, exact: true })
          .count(),
      ).toBe(1);
    }
    await standings.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
    for (const player of players.slice(0, 2)) {
      expect(
        await standings
          .getByRole("img", { name: `Latest 1 win: ${player.name}`, exact: true })
          .count(),
      ).toBe(1);
    }
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    const headers = await page.locator(".scoreboard-cell--sticky-top").allTextContents();
    expect(headers.map((text) => text.match(/[123](st|nd|rd)/)?.[0])).toEqual([
      "1st",
      "2nd",
      "3rd",
    ]);
    expect((await readRounds(page, game.id))[1].scores.map((score) => score.playerId)).toEqual([
      players[1].id,
      players[2].id,
    ]);
    const blank = page.locator(".scoreboard > .scoreboard-cell").nth(9);
    expect((await blank.innerText()).trim()).toBe("");
    await page.reload();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    expect((await readGameView(page, game.id))?.game.status).toBe("completed");
    expect(
      await (await openStandings(page)).getByRole("list", { name: "Standings places" }).innerText(),
    ).toContain("Place 3");
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "Keep playing",
  "Finish",
] as const)("keeps a failed first-finisher %s choice explicit and retryable without resaving the Round", async (action) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 1, "roundsWon", 3);
    await page.evaluate(`
      import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) => roundsApi.add({
        gameId: ${JSON.stringify(game.id)},
        roundWinnerId: ${JSON.stringify(players[0].id)},
        scores: ${JSON.stringify(
          players.map((player, index) => ({
            playerId: player.id,
            phaseStatus: index === 0 ? "completed" : "failed",
            score: 0,
          })),
        )}
      }))
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const choice = page.getByRole("dialog", { name: "Finish Game", exact: true });
    const keep = choice.getByRole("button", { name: "Keep playing", exact: true });
    const finish = choice.getByRole("button", { name: "Finish", exact: true });
    await keep.waitFor();
    await expect
      .poll(() => keep.evaluate((button) => button === document.activeElement))
      .toBe(true);
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    await page.keyboard.press(tab);
    expect(await finish.evaluate((button) => button === document.activeElement)).toBe(true);
    await page.keyboard.press(tab);
    await expect
      .poll(() => choice.evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const panel = await choice.locator(".dialog-panel").boundingBox();
      if (!panel) throw new Error("Missing compact choice panel");
      expect(panel.width).toBeLessThanOrEqual(384);
      for (const button of [keep, finish]) {
        const box = await button.boundingBox();
        if (!box) throw new Error("Missing choice action");
        expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(panel.x);
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
      }
    }
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Choice write failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    await choice.getByRole("button", { name: action, exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => keep.isDisabled()).toBe(true);
    expect(await finish.isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    expect(await choice.locator(".dialog-panel").isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await choice.getByRole("alert").waitFor();
    expect(await choice.getByRole("alert").innerText()).toContain("Choice write failed");
    expect((await readGameView(page, game.id))?.game.status).toBe("active");
    expect((await readRounds(page, game.id)).length).toBe(1);
    await page.keyboard.press("Escape");
    expect(await keep.isVisible()).toBe(true);
    await choice.getByRole("button", { name: action, exact: true }).click();
    await choice.waitFor({ state: "detached" });
    if (action === "Finish") {
      await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    } else {
      await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    }
    await page.reload();
    if (action === "Finish") {
      await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    } else {
      await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    }
    const restored = await readGameView(page, game.id);
    expect(restored?.game.status).toBe(action === "Finish" ? "completed" : "active");
    expect(restored?.pendingFinishChoice).toBeNull();
    expect(restored?.rounds.length).toBe(1);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("shows retained entries and whole excluded Rounds muted while ordinary post-finish cells stay blank", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 2, "lowestPoints", 4);
    await page.evaluate(`
      Promise.all([
        import("/scorekeeper/src/data/api/rounds.ts"),
        import("/scorekeeper/src/data/api/games.ts")
      ]).then(async ([{ roundsApi }, { gamesApi }]) => {
        const players = ${JSON.stringify(players)};
        for (let index = 0; index < 3; index++) {
          await roundsApi.add({
            gameId: ${JSON.stringify(game.id)},
            roundWinnerId: index === 2 ? players[0].id : null,
            scores: players.map((player, playerIndex) => ({
              playerId: player.id,
              phaseStatus: playerIndex < 2 && index > 0 ? "completed" : "failed",
              score: 10
            }))
          });
        }
        const view = await gamesApi.getView(${JSON.stringify(game.id)});
        await gamesApi.resolveFinishChoice(view.game.id, "continue", view.pendingFinishChoice.token);
        await roundsApi.add({
          gameId: view.game.id, roundWinnerId: null,
          scores: players.slice(2).map((player) => ({ playerId: player.id, phaseStatus: "failed", score: 10 }))
        });
        await roundsApi.edit(view.game.id, 1, players[0].id, { phaseStatus: "completed" });
      })
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Round 3", exact: true }).click();
    const cells = page.locator(".scoreboard > .scoreboard-cell");
    const retained = cells.nth(16);
    expect(await retained.innerText()).toContain("Retained entry, not counted.");
    expect(Number(await retained.evaluate((cell) => getComputedStyle(cell).opacity))).toBeLessThan(
      1,
    );
    expect(
      await cells.nth(17).getByText("Retained entry, not counted.", { exact: true }).count(),
    ).toBe(0);
    expect((await cells.nth(21).innerText()).trim()).toBe("");
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.evaluate(`
      import("/scorekeeper/src/data/api/rounds.ts").then(async ({ roundsApi }) => {
        const gameId = ${JSON.stringify(game.id)};
        const players = ${JSON.stringify(players)};
        await roundsApi.edit(gameId, 1, players[1].id, { phaseStatus: "completed" });
        await roundsApi.edit(gameId, 1, players[2].id, { phaseStatus: "completed" });
        await roundsApi.edit(gameId, 2, players[2].id, { phaseStatus: "completed" });
      })
    `);
    await page.reload();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const excluded = page.getByRole("button", { name: "Round 3, not counted", exact: true });
    expect(Number(await excluded.evaluate((cell) => getComputedStyle(cell).opacity))).toBeLessThan(
      1,
    );
    expect(
      await page.getByRole("button", { name: "Round 4, not counted", exact: true }).count(),
    ).toBe(1);
    const view = await readGameView(page, game.id);
    expect(view?.gameEndingRound).toBe(2);
    expect(view?.rounds.length).toBe(4);
    expect(view?.rounds[2].source.roundWinnerId).toBe(players[0].id);
    expect(view?.rounds[2].scores.every((entry) => !entry.counted)).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("rejects a stale Add Round after a same-number history correction and preserves its draft for review", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "lowestPoints", 3);
    await page.evaluate(`
      import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) => roundsApi.add({
        gameId: ${JSON.stringify(game.id)}, roundWinnerId: null,
        scores: ${JSON.stringify(
          players.map((player) => ({
            playerId: player.id,
            phaseStatus: "failed",
            score: 50,
          })),
        )}
      }))
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    const entry = page.getByRole("dialog", { name: "Add Round", exact: true });
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    for (const player of players.slice(1)) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Failed", exact: true }).click();
    }
    await entry.getByRole("tab", { name: players[0].name, exact: true }).click();
    await page.evaluate(`
      import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) =>
        roundsApi.edit(${JSON.stringify(game.id)}, 1, ${JSON.stringify(players[0].id)}, { phaseStatus: "completed" })
      )
    `);
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await entry.getByText(/Couldn't save round: Game history changed/).waitFor();
    expect(
      await entry.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect((await readRounds(page, game.id)).length).toBe(1);
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await expect.poll(async () => (await readRounds(page, game.id)).length).toBe(1);
    await entry.getByRole("button", { name: "Close", exact: true }).click();
    await entry.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    expect(
      await entry.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await entry.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 3", exact: true }).waitFor();
    const restored = await readGameView(page, game.id);
    expect(restored?.players[0].progress).toMatchObject({ currentPhase: 2, isFinished: false });
    expect(restored?.rounds[1].scores[0].source).toMatchObject({
      currentPhase: 2,
      phaseStatus: "failed",
    });
  } finally {
    await page.close();
  }
}, 60_000);

it.each<GameTiebreaker>([
  "roundsWon",
  "lowestPoints",
])("keeps the %s Round Winner row single-line through selection, disabled states, and resizing", async (tiebreaker) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const longName = "Alexandria Stone with an extraordinarily long Player name";
    const { game, players } = await seedCompletionGame(page, 3, tiebreaker, 2, [
      "Amy Jones",
      longName,
    ]);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    const winner = entry.getByRole("button", { name: /Round Winner/ });

    expect(
      await page.evaluate(async () => {
        const fonts = await document.fonts.load('500 14px "Quicksand Variable"');
        await document.fonts.ready;
        return fonts.length;
      }),
    ).toBeGreaterThan(0);
    const expectAcrossWidths = async (value: string, player?: Player) => {
      for (const width of [390, 320, 360, 768, 1024, 320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expectWinnerRow(entry, value, width < 390, player);
      }
    };
    await expectAcrossWidths("Choose winner");

    // Keep the viewport fixed while reducing the space available to the row.
    await entry.locator(".dialog-panel").evaluate((panel) => {
      (panel as HTMLElement).style.width = "80vw";
    });
    await expectWinnerRow(entry, "Choose winner", true);
    await entry.locator(".dialog-panel").evaluate((panel) => {
      (panel as HTMLElement).style.removeProperty("width");
    });
    await expectWinnerRow(entry, "Choose winner", false);

    await page.setViewportSize({ width: 320, height: 844 });
    await winner.focus();
    expect(await winner.evaluate((button) => button === document.activeElement)).toBe(true);
    expect(
      await winner.evaluate((button) => {
        const style = getComputedStyle(button);
        return style.outlineStyle !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)";
      }),
    ).toBe(true);
    await page.keyboard.press("Space");
    await page.getByRole("listbox").waitFor();
    const panelBeforeSelection = await entry.locator(".dialog-panel").boundingBox();
    for (const direction of [-1, 1]) {
      await touchGesture(page.getByRole("listbox"), [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]);
      expect(await entry.locator(".dialog-panel").boundingBox()).toEqual(panelBeforeSelection);
      expect(await page.getByRole("listbox").isVisible()).toBe(true);
    }
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    expect(await winner.evaluate((button) => button === document.activeElement)).toBe(true);
    expect(
      await entry.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await expectAcrossWidths(players[0].name, players[0]);

    await page.setViewportSize({ width: 320, height: 844 });
    await winner.focus();
    await page.keyboard.press("Space");
    const option = page.getByRole("option", { name: longName, exact: true });
    await option.waitFor();
    await page.getByRole("listbox").evaluate(async (listbox) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.all(listbox.getAnimations({ subtree: true }).map((motion) => motion.finished));
    });
    expect(await option.ariaSnapshot()).toContain(longName);
    const optionBox = await option.boundingBox();
    const optionAvatar = await option.locator('span[style*="background-color"]').boundingBox();
    if (!optionBox || !optionAvatar) throw new Error("Missing winner option geometry");
    expect(optionBox.height).toBeGreaterThanOrEqual(40);
    expect(optionAvatar.width).toBe(24);
    expect(optionAvatar.x + optionAvatar.width).toBeLessThan(optionBox.x + optionBox.width);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    expect(await winner.evaluate((button) => button === document.activeElement)).toBe(true);
    await expectAcrossWidths(longName, players[1]);
    const name = winner.getByText(longName, { exact: true });
    expect(
      await name.evaluate((element) => ({
        truncated: element.scrollWidth > element.clientWidth,
        textOverflow: getComputedStyle(element).textOverflow,
      })),
    ).toEqual({ truncated: true, textOverflow: "ellipsis" });

    await winner.focus();
    await page.keyboard.press("Space");
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    expect(await winner.evaluate((button) => button === document.activeElement)).toBe(true);
    await expectWinnerRow(entry, longName, false, players[1]);
    await page.keyboard.press("Space");
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await expectAcrossWidths("Choose winner");

    for (const [index, player] of players.entries()) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Show extra options", exact: true }).click();
      await entry
        .getByRole("button", { name: index === 0 ? "Skipped" : "Sat Out", exact: true })
        .click();
    }
    expect(await winner.isDisabled()).toBe(true);
    await expectAcrossWidths("No winner");
    await page.keyboard.press("Tab");
    expect(await winner.evaluate((button) => button === document.activeElement)).toBe(false);
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    expect(await winner.isDisabled()).toBe(false);
    await expectAcrossWidths("Choose winner");
  } finally {
    await page.close();
  }
}, 60_000);

async function expectWinnerRow(entry: Locator, value: string, compact: boolean, player?: Player) {
  await entry.evaluate(async (dialog) => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(dialog.getAnimations({ subtree: true }).map((motion) => motion.finished));
  });
  const winner = entry.getByRole("button", { name: /Round Winner/ });
  const label = entry.getByText("Round Winner", { exact: true });
  const text = await label.evaluate((element) => {
    const range = document.createRange();
    const textNode = Array.from(element.childNodes).find(
      (node) => node.textContent?.trim() === "Round Winner",
    );
    if (!textNode) throw new Error("Missing Round Winner label text");
    range.selectNodeContents(textNode);
    const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.y)));
    const rect = range.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return { lines: lines.size, x: rect.x, right: rect.right, visibleRight: bounds.right };
  });
  const control = await winner.boundingBox();
  const valueBox = await winner.getByText(value, { exact: true }).boundingBox();
  const chevron = await winner.locator("svg").last().boundingBox();
  const panel = await entry.locator(".dialog-panel").boundingBox();
  if (!control || !valueBox || !chevron || !panel) throw new Error("Missing Round Winner geometry");
  expect(text.lines).toBe(1);
  expect(text.right).toBeLessThanOrEqual(text.visibleRight + 1);
  expect(text.right).toBeLessThanOrEqual(control.x);
  expect(chevron.width).toBeGreaterThanOrEqual(14);
  expect(chevron.x + chevron.width).toBeLessThanOrEqual(control.x + control.width);
  expect(control.height).toBe(40);
  expect(control.x + control.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(text.x).toBeGreaterThanOrEqual(panel.x);
  expect(valueBox.width > 1).toBe(!compact);
  if (!compact) {
    expect(valueBox.x).toBeGreaterThanOrEqual(control.x);
    expect(valueBox.x + valueBox.width).toBeLessThan(chevron.x);
  }
  expect(await winner.ariaSnapshot()).toContain(`button "Round Winner ${value}"`);
  if (player) {
    const avatar = winner.locator('span[style*="background-color"]');
    const avatarBox = await avatar.boundingBox();
    if (!avatarBox) throw new Error("Missing selected Player avatar");
    expect(avatarBox.width).toBe(24);
    expect(avatarBox.height).toBe(24);
    expect(avatarBox.x).toBeGreaterThanOrEqual(control.x);
    expect(avatarBox.x + avatarBox.width).toBeLessThan(chevron.x);
    expect(
      Math.abs(avatarBox.y + avatarBox.height / 2 - (chevron.y + chevron.height / 2)),
    ).toBeLessThan(1);
    expect(await avatar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      player.color === "#123456" ? "rgb(18, 52, 86)" : "rgb(171, 205, 239)",
    );
    if (!compact) expect(avatarBox.x + avatarBox.width).toBeLessThan(valueBox.x);
  }
}

it("counts the required winner separately and restores its requirement after all-Skipped/Sat Out exceptions", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "roundsWon", 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    const winner = entry.getByRole("button", { name: /Round Winner/ });
    const save = entry.getByRole("button", { name: "Save round", exact: true });
    await expectRoundProgress(page, entry, 0, 4, false, true);
    expect(await save.isDisabled()).toBe(true);

    await winner.click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    expect(
      await entry.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await expectRoundProgress(page, entry, 2, 4, false, true);
    for (const player of players.slice(1)) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Failed", exact: true }).click();
    }
    await expectRoundProgress(page, entry, 4, 4, true, true);
    expect(await save.isDisabled()).toBe(false);

    await winner.click();
    await page.getByRole("option", { name: "Choose winner", exact: true }).click();
    await expectRoundProgress(page, entry, 3, 4, false, true);
    expect(await save.isDisabled()).toBe(true);
    await entry.getByRole("tab", { name: players[0].name, exact: true }).click();
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await expectRoundProgress(page, entry, 3, 4, false, true);
    expect(await winner.isDisabled()).toBe(false);

    for (const player of players) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Show extra options", exact: true }).click();
      await entry.getByRole("button", { name: "Skipped", exact: true }).click();
    }
    await expectRoundProgress(page, entry, 3, 3, true, false);
    expect(await winner.isDisabled()).toBe(true);
    expect((await winner.innerText()).trim()).toBe("No winner");
    expect(await save.isDisabled()).toBe(false);

    await entry.getByRole("button", { name: "Sat Out", exact: true }).click();
    await expectRoundProgress(page, entry, 3, 3, true, false);
    for (const player of players.slice(0, 2)) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Sat Out", exact: true }).click();
    }
    await expectRoundProgress(page, entry, 3, 3, true, false);
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    expect(await winner.isDisabled()).toBe(false);
    expect((await winner.innerText()).trim()).toBe("Choose winner");
    await expectRoundProgress(page, entry, 3, 4, false, true);
    expect(await save.isDisabled()).toBe(true);
    await entry.getByRole("button", { name: "Skipped", exact: true }).click();
    await save.click();
    await entry.waitFor({ state: "detached" });
    expect(await readRounds(page, game.id)).toMatchObject([
      {
        roundWinnerId: null,
        scores: [{ phaseStatus: "satOut" }, { phaseStatus: "skipped" }, { phaseStatus: "satOut" }],
      },
    ]);
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    expect((await readRounds(page, game.id))[0].roundWinnerId).toBeNull();
  } finally {
    await page.close();
  }
}, 60_000);

it.each<GameTiebreaker>([
  "lowestPoints",
  "highestPoints",
  "fewestWilds",
  "fewestSkips",
  "mostSkipped",
])("saves and reloads complete %s entries without inferring a winner", async (tiebreaker) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, tiebreaker, 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    const winner = entry.getByRole("button", { name: /Round Winner/ });
    const save = entry.getByRole("button", { name: "Save round", exact: true });
    await expectRoundProgress(page, entry, 0, 3, false, false);
    for (const player of players) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Passed", exact: true }).click();
    }
    await expectRoundProgress(page, entry, 3, 3, true, false);
    expect(await save.isDisabled()).toBe(false);
    await winner.click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    await expectRoundProgress(page, entry, 3, 3, true, false);
    await winner.click();
    await page.getByRole("option", { name: "Choose winner", exact: true }).click();
    await expectRoundProgress(page, entry, 3, 3, true, false);
    expect(await entry.innerText()).not.toContain("Optional");
    await save.click();
    await entry.waitFor({ state: "detached" });
    expect(await readRounds(page, game.id)).toMatchObject([
      {
        roundNumber: 1,
        roundWinnerId: null,
        scores: players.map((player) => ({
          playerId: player.id,
          phaseStatus: "completed",
          score: 0,
          currentPhase: 1,
        })),
      },
    ]);
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    expect((await readRounds(page, game.id))[0].roundWinnerId).toBeNull();
    const view = await page.evaluate<GameReadModel>(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
        gamesApi.getView(${JSON.stringify(game.id)})
      )
    `);
    expect(view.rounds[0].scores.map((score) => score.source?.pointsCardBreakdown)).toEqual(
      players.map(() =>
        tiebreaker === "lowestPoints" || tiebreaker === "highestPoints"
          ? { p5: 0, p10: 0, skipCard: 0, wild: 0 }
          : undefined,
      ),
    );
    expect(await page.locator(".scoreboard-cell .border-current").count()).toBe(0);
    const standings = await openStandings(page);
    const results = standings.getByRole("tabpanel", { name: "Standings", exact: true });
    expect(await results.innerText()).toContain(players[0].name);
    expect(await results.innerText()).toContain(players[2].name);
    await standings.getByRole("tab", { name: "Phases", exact: true }).click();
    await standings.locator('[aria-label="Phase progress by round"]').waitFor();
    await standings.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
    await standings.locator('[aria-label="Tiebreaker progress by round"]').waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("preserves the actual Points Card Breakdown from Add Round controls through public readback after reload", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "lowestPoints", 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    await entry.getByRole("button", { name: "Passed", exact: true }).click();
    for (const points of [5, 10, 15, 25]) {
      await entry.getByRole("button", { name: new RegExp(`^Add ${points} points`) }).click();
    }
    expect(
      await entry.getByRole("tabpanel").getByText("Used 1 time", { exact: true }).count(),
    ).toBe(4);
    await entry.getByRole("tab", { name: players[1].name, exact: true }).click();
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await entry.getByRole("button", { name: /^Add 15 points/ }).click();
    await entry.getByRole("button", { name: /^Add 25 points/ }).click();
    await entry.getByRole("tabpanel").getByText("Used 8 times", { exact: true }).waitFor();
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: players[2].name, exact: true }).click();
    const save = entry.getByRole("button", { name: "Save round", exact: true });
    await holdRoundStorage(page, "Round storage unavailable");
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    await releaseRoundStorage(page);
    await entry
      .getByText("Couldn't save round: Round storage unavailable Try again.", { exact: true })
      .waitFor();
    await entry.getByRole("tabpanel").getByText("Used 8 times", { exact: true }).waitFor();
    expect(
      await page.evaluate(`
        import("/scorekeeper/src/data/api/games.ts").then(async ({ gamesApi }) =>
          (await gamesApi.getView(${JSON.stringify(game.id)})).rounds
        )
      `),
    ).toEqual([]);
    await holdRoundStorage(page);
    await save.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => save.isDisabled()).toBe(true);
    await releaseRoundStorage(page);
    await entry.waitFor({ state: "detached" });
    expect(
      await page.evaluate(`
        import("/scorekeeper/src/data/api/games.ts").then(async ({ gamesApi }) =>
          (await gamesApi.getView(${JSON.stringify(game.id)})).rounds.length
        )
      `),
    ).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();

    const view = await page.evaluate<GameReadModel>(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
        gamesApi.getView(${JSON.stringify(game.id)})
      )
    `);
    expect(view.rounds[0].source).toMatchObject({
      roundWinnerId: players[2].id,
      scores: [
        {
          playerId: players[0].id,
          phaseStatus: "completed",
          score: 55,
          pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 1, wild: 1 },
        },
        {
          playerId: players[1].id,
          phaseStatus: "failed",
          score: 80,
          pointsCardBreakdown: { p5: 8, p10: 0, skipCard: 1, wild: 1 },
        },
        {
          playerId: players[2].id,
          phaseStatus: "completed",
          score: 0,
          pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
        },
      ],
    });
    expect(view.rounds[0].scores.map((score) => score.source)).toEqual(
      view.rounds[0].source.scores,
    );
    expect(view.players.map((player) => player.tiebreakerTotal)).toEqual([55, 80, 0]);

    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    for (const [index, player] of players.entries()) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      if (index < 2) {
        await entry.getByRole("button", { name: "Show extra options", exact: true }).click();
        await entry
          .getByRole("button", { name: index === 0 ? "Skipped" : "Sat Out", exact: true })
          .click();
      } else {
        await entry.getByRole("button", { name: "Passed", exact: true }).click();
      }
    }
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await entry.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 3", exact: true }).waitFor();
    const reloaded = await page.evaluate<GameReadModel>(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
        gamesApi.getView(${JSON.stringify(game.id)})
      )
    `);
    expect(reloaded.rounds[0]).toEqual(view.rounds[0]);
    expect(reloaded.rounds[1].source.scores).toEqual([
      { playerId: players[0].id, phaseStatus: "skipped", currentPhase: 2, score: 100 },
      { playerId: players[1].id, phaseStatus: "satOut", currentPhase: 1, score: 0 },
      {
        playerId: players[2].id,
        phaseStatus: "completed",
        currentPhase: 2,
        score: 0,
        pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
      },
    ]);
    expect(reloaded.rounds[1].source.roundWinnerId).toBeNull();
  } finally {
    await page.close();
  }
}, 45_000);

it("keeps nonzero scorecard values, Standings and both graphs in agreement through save and reload", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "lowestPoints");
    await seedSavedRound(page, game, players, false);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    const entry = page.getByRole("dialog");
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Bob Stone", exact: true }).click();
    await entry.getByRole("tab", { name: "Amy Jones", exact: true }).click();
    await entry.getByRole("button", { name: "Passed", exact: true }).click();
    await entry.getByRole("button", { name: /^Add 5 points/ }).click();
    await entry.getByRole("button", { name: /^Add 5 points/ }).click();
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await entry.waitFor({ state: "detached" });

    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await page.getByRole("button", { name: "Add round 3", exact: true }).waitFor();
      const scoreboard = page.getByRole("region", { name: "Scoreboard", exact: true });
      const headers = scoreboard.locator(".scoreboard-cell--sticky-top");
      expect(await headers.nth(0).innerText()).toContain("Upcoming Round Dealer: Amy Jones");
      expect(await headers.nth(0).getByText("3", { exact: true }).count()).toBe(1);
      expect(await headers.nth(0).getByText("10 pts", { exact: true }).count()).toBe(1);
      expect(await headers.nth(1).getByText("2", { exact: true }).count()).toBe(1);
      expect(await headers.nth(1).getByText("20 pts", { exact: true }).count()).toBe(1);
      await scoreboard.getByRole("button", { name: "Round 2", exact: true }).click();
      const expanded = scoreboard.locator(".scoreboard-extras--open");
      await expect
        .poll(async () => (await expanded.nth(0).innerText()).trim())
        .toBe("10 pts\n10 pts");
      await expect
        .poll(async () => (await expanded.nth(1).innerText()).trim())
        .toBe("0 pts\n20 pts");

      const standings = await openStandings(page);
      const results = standings.getByRole("tabpanel", { name: "Standings", exact: true });
      const rows = results.getByRole("listitem");
      expect(await rows.nth(0).innerText()).toContain("Amy Jones");
      expect(await rows.nth(0).innerText()).toContain("Ph 3");
      expect(await rows.nth(0).innerText()).toContain("10 pts");
      expect(await rows.nth(1).innerText()).toContain("Bob Stone");
      expect(await rows.nth(1).innerText()).toContain("Ph 2");
      expect(await rows.nth(1).innerText()).toContain("20 pts");
      await standings.getByRole("tab", { name: "Phases", exact: true }).click();
      const phases = standings.getByRole("table", { name: "Phase progress details", exact: true });
      expect(await phases.getByRole("row").nth(1).getByRole("cell").allTextContents()).toEqual([
        "Phase 1",
        "Phase 2",
        "Phase 3",
      ]);
      expect(await phases.getByRole("row").nth(2).getByRole("cell").allTextContents()).toEqual([
        "Phase 1",
        "Phase 1",
        "Phase 2",
      ]);
      await standings.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
      const totals = standings.getByRole("table", {
        name: "Tiebreaker progress details",
        exact: true,
      });
      expect(await totals.getByRole("row").nth(1).getByRole("cell").allTextContents()).toEqual([
        "0 pts",
        "0 pts",
        "10 pts",
      ]);
      expect(await totals.getByRole("row").nth(2).getByRole("cell").allTextContents()).toEqual([
        "0 pts",
        "20 pts",
        "20 pts",
      ]);
      await page.keyboard.press("Escape");
      await standings.waitFor({ state: "detached" });
    }
    expect(await readRounds(page, game.id)).toMatchObject([
      { roundNumber: 1, roundWinnerId: players[0].id },
      {
        roundNumber: 2,
        roundWinnerId: players[1].id,
        scores: [
          { playerId: players[0].id, currentPhase: 2, phaseStatus: "completed", score: 10 },
          { playerId: players[1].id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        ],
      },
    ]);
  } finally {
    await page.close();
  }
}, 30_000);

it("restores Points entries when switching, clearing, or downgrading an explicit winner", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "lowestPoints", 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    const winner = entry.getByRole("button", { name: /Round Winner/ });
    await entry.getByRole("button", { name: "Passed", exact: true }).click();
    await entry.getByRole("button", { name: "Add 10 points (+10)", exact: true }).click();
    await entry.getByRole("button", { name: "Add 5 points (+5)", exact: true }).click();
    await entry.getByRole("tab", { name: players[1].name, exact: true }).click();
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await entry.getByRole("tab", { name: players[2].name, exact: true }).click();
    await entry.getByRole("button", { name: "Passed", exact: true }).click();
    await expectRoundProgress(page, entry, 3, 3, true, false);

    await winner.click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    await entry.getByRole("tab", { name: players[0].name, exact: true }).click();
    expect(await entry.getByRole("button", { name: "+10", exact: true }).isDisabled()).toBe(true);
    expect(
      await entry.getByRole("tabpanel").getByText("Used 0 times", { exact: true }).count(),
    ).toBe(4);
    await winner.click();
    await page.getByRole("option", { name: players[1].name, exact: true }).click();
    expect(
      await entry.getByRole("tabpanel").getByText("Used 1 time", { exact: true }).count(),
    ).toBe(2);
    await entry.getByRole("tab", { name: players[1].name, exact: true }).click();
    expect(
      await entry.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await winner.click();
    await page.getByRole("option", { name: "Choose winner", exact: true }).click();
    expect(
      await entry.getByRole("tabpanel").getByText("Used 10 times", { exact: true }).count(),
    ).toBe(1);
    await expectRoundProgress(page, entry, 2, 3, false, false);
    await entry.getByRole("button", { name: /^Round progress:/ }).click();
    await page.getByText("Needs 9 or fewer cards.", { exact: true }).waitFor();
    await entry.getByRole("button", { name: /^Round progress:/ }).click();
    expect(await entry.getByRole("button", { name: "Save round", exact: true }).isDisabled()).toBe(
      true,
    );
    await entry.getByRole("button", { name: "Failed", exact: true }).click();

    await winner.click();
    await page.getByRole("option", { name: players[0].name, exact: true }).click();
    await entry.getByRole("tab", { name: players[0].name, exact: true }).click();
    await entry.getByRole("button", { name: "Show extra options", exact: true }).click();
    await entry.getByRole("button", { name: "Skipped", exact: true }).click();
    expect((await winner.innerText()).trim()).toBe("Choose winner");
    await expectRoundProgress(page, entry, 3, 3, true, false);
    await entry.getByRole("button", { name: "Sat Out", exact: true }).click();
    await entry.getByRole("button", { name: "Passed", exact: true }).click();
    expect(
      await entry.getByRole("tabpanel").getByText("Used 1 time", { exact: true }).count(),
    ).toBe(2);
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    await entry.waitFor({ state: "detached" });
    expect(await readRounds(page, game.id)).toMatchObject([
      {
        roundWinnerId: null,
        scores: [
          {
            playerId: players[0].id,
            phaseStatus: "completed",
            score: 15,
            pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 0, wild: 0 },
          },
          {
            playerId: players[1].id,
            phaseStatus: "failed",
            score: 50,
            pointsCardBreakdown: { p5: 10, p10: 0, skipCard: 0, wild: 0 },
          },
          {
            playerId: players[2].id,
            phaseStatus: "completed",
            score: 0,
            pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
          },
        ],
      },
    ]);
  } finally {
    await page.close();
  }
}, 60_000);

it("normally finishes an all-Skipped Round without awarding any Round wins or winner indicators", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    for (const player of players) {
      await entry.getByRole("tab", { name: player.name, exact: true }).click();
      await entry.getByRole("button", { name: "Show extra options", exact: true }).click();
      await entry.getByRole("button", { name: "Skipped", exact: true }).click();
    }
    await expectRoundProgress(page, entry, 2, 2, true, false);
    await entry.getByRole("button", { name: "Save round", exact: true }).click();
    const results = page.getByRole("tabpanel", { name: "Standings", exact: true });
    await results.waitFor();
    expect(await results.getByText("0 wins", { exact: true }).count()).toBe(2);
    expect(await readResults(page)).toMatchObject({
      games: [{ status: "completed", completionType: "normal", winnerIds: [players[0].id] }],
    });
    expect(await readRounds(page, game.id)).toMatchObject([
      { roundWinnerId: null, scores: [{ phaseStatus: "skipped" }, { phaseStatus: "skipped" }] },
    ]);
    await page.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
    await page.locator('[aria-label="Tiebreaker progress by round"]').waitFor();
    const graph = page.getByRole("table", { name: "Tiebreaker progress details", exact: true });
    expect(await graph.getByRole("cell", { name: "0 wins", exact: true }).count()).toBe(4);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await page.locator(".scoreboard-cell .border-current").count()).toBe(0);
    await page.reload();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { includeHidden: true }).waitFor({ state: "detached" });
    await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: /^Add round/ }).count()).toBe(0);
    expect((await readRounds(page, game.id))[0].roundWinnerId).toBeNull();
  } finally {
    await page.close();
  }
}, 60_000);

async function expectRoundProgress(
  page: Page,
  entry: Locator,
  completed: number,
  total: number,
  ready: boolean,
  requiredWinner: boolean,
) {
  const progress = entry.getByRole("button", {
    name: `Round progress: ${completed} of ${total} required entries complete`,
    exact: true,
  });
  await progress.waitFor();
  await progress.click();
  await page.getByText(`${completed} of ${total}`, { exact: true }).waitFor();
  expect(await page.getByRole("listitem").filter({ hasText: "Round Winner" }).count()).toBe(
    requiredWinner ? 1 : 0,
  );
  expect(await page.getByText("Ready to save.", { exact: true }).count()).toBe(ready ? 1 : 0);
  if (!requiredWinner)
    expect(await page.getByText("Mark a Round Winner to save.", { exact: true }).count()).toBe(0);
  await progress.click();
}

it("keeps header buttons centered together with clearance above the slant", async () => {
  const page = await browser.newPage({ hasTouch: true });
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game } = await seedCompletionGame(page);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const standings = page.getByRole("button", { name: "Open Standings", exact: true });
    await standings.waitFor();
    for (const [width, height, top, left, right] of [
      [390, 844, 0, 0, 0],
      [390, 701, 0, 0, 0],
      [390, 700, 0, 0, 0],
      [320, 568, 0, 0, 0],
      [844, 390, 0, 0, 0],
      [390, 844, 47, 0, 0],
      [844, 390, 0, 44, 44],
      [1280, 900, 0, 0, 0],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        (insets) => {
          for (const [edge, value] of Object.entries(insets)) {
            document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
          }
        },
        { top, left, right },
      );
      const size = height <= 700 ? 44 : 56;
      const iconSize = height <= 700 ? 24 : 32;
      for (const control of [
        standings,
        page.getByRole("button", { name: "Menu", exact: true }),
        page.getByRole("button", { name: "Finish Game", exact: true }),
      ]) {
        expect(await control.boundingBox()).toMatchObject({ width: size, height: size });
        expect(await control.locator("svg").boundingBox()).toMatchObject({
          width: iconSize,
          height: iconSize,
        });
      }
      const header = await page.locator(".page-shell-header").boundingBox();
      const menuBounds = await page
        .getByRole("button", { name: "Menu", exact: true })
        .boundingBox();
      const phases = await page
        .getByRole("button", { name: "Open Phases Card", exact: true })
        .boundingBox();
      if (!header || !menuBounds || !phases) throw new Error("Missing header controls");
      expect(phases.height).toBe(size);
      expect(phases.y + phases.height / 2).toBeCloseTo(menuBounds.y + menuBounds.height / 2, 1);
      for (const control of [phases, menuBounds]) {
        const slantEdge = header.y + header.height - (50 * (control.x + control.width)) / width;
        expect
          .soft(control.y - top, `top clearance at ${width}x${height}`)
          .toBeGreaterThanOrEqual(10);
        expect
          .soft(slantEdge - control.y - control.height, `slant clearance at ${width}x${height}`)
          .toBeGreaterThanOrEqual(4);
      }
      expect
        .soft(header.height, `minimum header height at ${width}x${height}`)
        .toBeCloseTo(Math.max(height * 0.15, size + 50 + 20) + top, 1);
    }
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  844, 180,
])("keeps Phase Round dismissal and edits blocked until a failed save is recoverable, then retries safely at %dpx visible height", async (visibleHeight) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game } = await seedCompletionGame(page, 2);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: "Close", exact: true });
    const save = dialog.getByRole("button", { name: "Save round", exact: true });
    await cancel.waitFor();
    expect(await cancel.count()).toBe(1);
    expect(await dialog.getByRole("button", { name: "Cancel", exact: true }).count()).toBe(0);
    const bounds = await dialog.locator(".dialog-panel").boundingBox();
    if (!bounds) throw new Error("Missing Phase Round workspace");
    expect(bounds.y).toBe(16);
    expect(bounds.height).toBe(812);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectReadyAction(save, cancel, false);
    }
    await dialog.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy Jones", exact: true }).click();
    await dialog.getByRole("tab", { name: "Bob Stone", exact: true }).click();
    await dialog.getByRole("button", { name: "Failed", exact: true }).click();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectReadyAction(save, cancel, true);
      expect(await save.locator("svg.lucide-check[aria-hidden=true]").count()).toBe(1);
      expect(await save.boundingBox()).toMatchObject({ width: 40, height: 40 });
    }
    await setVisibleViewport(page, {
      width: 390,
      height: visibleHeight,
      offsetLeft: 0,
      offsetTop: visibleHeight === 180 ? 60 : 0,
    });
    await save.focus();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    if (visibleHeight === 180) {
      expect(
        await dialog.locator(".dialog-panel").evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
    }
    await holdRoundStorage(page, "Round storage unavailable");
    await save.click();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectReadyAction(save, cancel, false);
      expect(await cancel.isDisabled()).toBe(true);
      expect(await save.locator("svg.lucide-loader-circle[aria-hidden=true]").count()).toBe(1);
    }
    expect(await dialog.getByRole("button", { name: "Passed", exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await dialog.getByRole("tab", { name: "Amy Jones", exact: true }).isDisabled()).toBe(
      true,
    );
    const panel = dialog.locator(".dialog-panel");
    const pendingBounds = await panel.boundingBox();
    for (const direction of [-1, 1]) {
      expect(
        await touchGesture(dialog.locator("header"), [
          { y: 0, time: 0 },
          { y: direction * 160, time: 100 },
          { y: direction * 160, time: 110 },
        ]),
      ).toEqual([false, false, false]);
      expect(await panel.boundingBox()).toEqual(pendingBounds);
    }
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 4);
    expect(await cancel.isVisible()).toBe(true);
    await releaseRoundStorage(page);
    const feedback = dialog.getByText("Couldn't save round: Round storage unavailable Try again.", {
      exact: true,
    });
    await feedback.waitFor();
    const feedbackBounds = await feedback.boundingBox();
    const visiblePanel = await dialog.locator(".dialog-panel").boundingBox();
    if (!feedbackBounds || !visiblePanel) throw new Error("Missing Round failure feedback");
    expect(feedbackBounds.y).toBeGreaterThanOrEqual(visiblePanel.y);
    expect(feedbackBounds.y + feedbackBounds.height).toBeLessThanOrEqual(
      visiblePanel.y + visiblePanel.height,
    );
    expect(await cancel.isEnabled()).toBe(true);
    expect(await save.isEnabled()).toBe(true);
    expect(
      await dialog
        .getByRole("button", { name: "Failed", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    await touchGesture(dialog.locator("header"), [
      { y: 0, time: 0 },
      { y: -120, time: 500 },
      { y: -120, time: 700 },
    ]);
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    expect(
      await dialog
        .getByRole("button", { name: "Failed", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await holdRoundStorage(page);
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await cancel.isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    expect(await save.isDisabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("opens final Standings after a finishing Round and keeps completed snapshot names and colors after saved Players change", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page);
    const [amy, bob] = players;

    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy Jones", exact: true }).click();
    await entry.getByRole("tab", { name: "Bob Stone", exact: true }).click();
    await entry.getByRole("button", { name: "Failed", exact: true }).click();
    await entry.getByRole("button", { name: "Save round", exact: true }).click();

    const standings = page.getByRole("dialog").filter({
      has: page.getByRole("tab", { name: "Standings", exact: true }),
    });
    const results = standings.getByRole("tabpanel", { name: "Standings", exact: true });
    await results.waitFor({ timeout: 5_000 });
    expect(await results.innerText()).toContain("Amy Jones");
    expect(await results.innerText()).toContain("Bob Stone");
    expect(await results.innerText()).toContain("1 win");
    expect(await results.innerText()).toContain("0 wins");
    expect(await readResults(page)).toEqual({
      games: [
        expect.objectContaining({
          status: "completed",
          completionType: "normal",
          winnerIds: [amy.id],
          playerSnapshots: [
            { id: amy.id, name: "Amy Jones", color: "#123456" },
            { id: bob.id, name: "Bob Stone", color: "#abcdef" },
          ],
        }),
      ],
      players,
    });

    await page.keyboard.press("Escape");
    await standings.waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: /^Add round/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Finish Game" }).count()).toBe(0);
    expect(await readScoreboardHeaderPlayers(page)).toEqual([
      { backgroundColor: "rgb(18, 52, 86)", initials: "AJ" },
      { backgroundColor: "rgb(171, 205, 239)", initials: "BS" },
    ]);

    await updateAndDeleteSavedPlayers(page, amy.id, bob.id);

    await page.reload();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { includeHidden: true }).waitFor({ state: "detached" });
    await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor({ timeout: 5_000 });
    expect(await readResults(page)).toMatchObject({
      games: [
        expect.objectContaining({
          completionType: "normal",
          winnerIds: [amy.id],
          playerSnapshots: [
            { id: amy.id, name: "Amy Jones", color: "#123456" },
            { id: bob.id, name: "Bob Stone", color: "#abcdef" },
          ],
        }),
      ],
      players: [expect.objectContaining({ id: amy.id, name: "Zoe Quinn", color: "#654321" })],
    });
    expect(await readScoreboardHeaderPlayers(page)).toEqual([
      { backgroundColor: "rgb(18, 52, 86)", initials: "AJ" },
      { backgroundColor: "rgb(171, 205, 239)", initials: "BS" },
    ]);

    const reloadedStandings = await openStandings(page);
    const reloadedResults = reloadedStandings.getByRole("tabpanel", {
      name: "Standings",
      exact: true,
    });
    await reloadedResults.waitFor();
    const reloadedStandingsText = await reloadedResults.innerText();
    expect(reloadedStandingsText).toContain("Amy Jones");
    expect(reloadedStandingsText).toContain("Bob Stone");
    expect(reloadedStandingsText).not.toContain("Zoe Quinn");
    expect(
      await readAvatarBackgroundColors(reloadedResults.locator('span[style*="background-color"]')),
    ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)"]);

    await reloadedStandings.getByRole("tab", { name: "Phases", exact: true }).click();
    await reloadedStandings.locator('[aria-label="Phase progress by round"]').waitFor();
    const phaseMarkup = await reloadedStandings.innerHTML();
    expect(phaseMarkup).toContain("Amy Jones");
    expect(phaseMarkup).toContain("Bob Stone");
    expect(phaseMarkup).not.toContain("Zoe Quinn");
    const phaseStrokes = await reloadedStandings
      .locator('[aria-label="Phase progress by round"] path[stroke]')
      .evaluateAll((paths) =>
        paths
          .map((path) => path.getAttribute("stroke"))
          .filter((stroke): stroke is string => Boolean(stroke)),
      );
    expect(phaseStrokes).toContain("#123456");
    expect(phaseStrokes).toContain("#abcdef");
    expect(phaseStrokes).not.toContain("#654321");
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  "no-preference",
  "reduce",
] as const)("dismisses the Phases Card with Escape across repeated openings (%s motion)", async (reducedMotion) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game } = await seedCompletionGame(page, 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const trigger = page.getByRole("button", { name: "Open Phases Card", exact: true });
    const phases = page.getByRole("dialog", {
      name: "Phases Card",
      exact: true,
      includeHidden: true,
    });
    for (let opening = 0; opening < (reducedMotion === "reduce" ? 10 : 100); opening++) {
      await trigger.focus();
      if (opening % 2 === 0) await trigger.click();
      else await trigger.press("Enter");
      await phases.waitFor({ state: "attached" });
      await page.keyboard.press("Escape");
      await phases.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((button) => button === document.activeElement))
        .toBe(true);
    }
  } finally {
    await page.close();
  }
}, 120_000);

it("offers Pause and Delete before a saved Round and retains the session draft through Pause", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game } = await seedCompletionGame(page, 3);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);

    const finishGame = page.getByRole("button", { name: "Finish Game", exact: true });
    await finishGame.click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    expect(await finish.getByRole("button").allTextContents()).toEqual(["Pause", "Delete"]);
    expect(await finish.innerText()).not.toContain("Save at least one Round");
    expect(await finish.getByRole("heading").count()).toBe(0);
    await page.keyboard.press("Escape");
    await finish.waitFor({ state: "detached" });
    expect(await finishGame.evaluate((button) => button === document.activeElement)).toBe(true);

    const menuBox = await page.getByRole("button", { name: "Menu", exact: true }).boundingBox();
    const finishBox = await finishGame.boundingBox();
    const standingsBox = await page.getByRole("button", { name: "Open Standings" }).boundingBox();
    if (!menuBox || !finishBox || !standingsBox) throw new Error("Missing Game controls");
    expect(menuBox.x).toBeGreaterThan(195);
    expect(menuBox.y).toBeLessThan(422);
    expect(finishBox.x).toBeGreaterThan(195);
    expect(finishBox.y).toBeGreaterThan(422);
    expect(standingsBox.x).toBeLessThan(195);
    expect(standingsBox.y).toBeGreaterThan(422);
    const phasesTrigger = page.getByRole("button", { name: "Open Phases Card" });
    await phasesTrigger.focus();
    await phasesTrigger.click();
    const phasesCard = page.getByRole("dialog", { name: "Phases Card", includeHidden: true });
    await phasesCard.waitFor({ state: "attached" });
    await page
      .getByRole("dialog", { name: "Phases Card" })
      .getByRole("button", { name: "Share Phases Card", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await phasesCard.waitFor({ state: "detached" });
    await expect
      .poll(() => phasesTrigger.evaluate((button) => button === document.activeElement))
      .toBe(true);

    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    const entry = page.getByRole("dialog");
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy Jones", exact: true }).click();
    expect(await finishGame.count()).toBe(0);
    await page.keyboard.press("Tab");
    expect(await entry.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await entry.waitFor({ state: "detached" });
    await finishGame.click();
    await page.mouse.click(4, 4);
    await finish.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    expect(await entry.getByRole("button", { name: /Round Winner/ }).innerText()).toContain(
      "Amy Jones",
    );
    await page.keyboard.press("Escape");
    await entry.waitFor({ state: "detached" });
    await finishGame.click();
    await finish.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForURL("**/#/phaseCompan10n");
    expect(await readResults(page)).toMatchObject({ games: [{ id: game.id, status: "active" }] });
    await page.getByRole("link", { name: /^Continue game with/ }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    expect(await entry.getByRole("button", { name: /Round Winner/ }).innerText()).toContain(
      "Amy Jones",
    );
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  true,
  false,
])("finishes from saved Standings (tied: %s) and reopens a read-only result once", async (tied) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3, "lowestPoints");
    await seedSavedRound(page, game, players, tied);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Round Winner/ })
      .click();
    await page.getByRole("option", { name: "Bob Stone", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Finish Game", exact: true })
      .getByRole("button", { name: "Finish", exact: true })
      .click();
    const results = page.getByRole("tabpanel", { name: "Standings", exact: true });
    await results.waitFor({ timeout: 5_000 });
    await page.getByRole("dialog", { name: "Finish Game", exact: true }).waitFor({
      state: "detached",
    });
    expect(await results.innerText()).toContain("Amy Jones");
    expect(await results.innerText()).toContain("Bob Stone");
    expect(await readResults(page)).toMatchObject({
      games: [
        {
          status: "completed",
          completionType: "manual",
          winnerIds: tied ? [players[0].id, players[1].id] : [players[0].id],
          playerSnapshots: [
            { id: players[0].id, name: "Amy Jones", color: "#123456" },
            { id: players[1].id, name: "Bob Stone", color: "#abcdef" },
          ],
        },
      ],
    });
    expect(await readRounds(page, game.id)).toMatchObject([
      { roundNumber: 1, scores: [{ currentPhase: 1 }, { currentPhase: 1 }] },
    ]);

    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: /^Add round|^Finish Game$/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    await results.waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });

    await updateAndDeleteSavedPlayers(page, players[0].id, players[1].id);
    await page.reload();
    await results.waitFor();
    expect(await results.innerText()).toContain("Amy Jones");
    expect(await results.innerText()).toContain("Bob Stone");
    expect(await results.innerText()).not.toContain("Zoe Quinn");
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    const phases = page.getByRole("table", { name: "Phase progress details", exact: true });
    expect(await phases.getByRole("row").nth(1).getByRole("cell").allTextContents()).toEqual([
      "Phase 1",
      "Phase 2",
    ]);
    expect(await phases.getByRole("row").nth(2).getByRole("cell").allTextContents()).toEqual([
      "Phase 1",
      tied ? "Phase 2" : "Phase 1",
    ]);
    await page.getByRole("tab", { name: "Tiebreaker", exact: true }).click();
    const totals = page.getByRole("table", { name: "Tiebreaker progress details", exact: true });
    expect(await totals.getByRole("row").nth(1).getByRole("cell").allTextContents()).toEqual([
      "0 pts",
      "0 pts",
    ]);
    expect(await totals.getByRole("row").nth(2).getByRole("cell").allTextContents()).toEqual([
      "0 pts",
      tied ? "0 pts" : "20 pts",
    ]);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("region", { name: "Scoreboard", exact: true }).click();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.getByRole("button", { name: /^Add round|^Finish Game$/ }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30_000);

it("keeps a pending Finish on screen through dismissal attempts, shows failure, and can retry", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const { game, players } = await seedCompletionGame(page, 3);
    await seedSavedRound(page, game, players, false);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await page.evaluate(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) => {
        const finish = gamesApi.finish;
        gamesApi.finish = async (id) => {
          gamesApi.finish = finish;
          await new Promise((resolve) => window.addEventListener("release-finish", resolve, { once: true }));
          return finish(id);
        };
      })
    `);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Result write failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await finish.getByRole("button", { name: "Finishing...", exact: true }).waitFor();
    expect(
      await finish.getByRole("button", { name: "Finishing...", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await finish.getByRole("button", { name: "Pause", exact: true }).isDisabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    const bounds = await finish.boundingBox();
    if (!bounds) throw new Error("Missing Finish panel");
    await page.mouse.click(10, 200);
    expect(await finish.isVisible()).toBe(true);
    expect(page.url()).toBe(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.evaluate(() => window.dispatchEvent(new Event("release-finish")));
    await finish.getByRole("alert").waitFor();
    expect(await finish.getByRole("alert").innerText()).toContain("Couldn't finish Game");
    expect(await readResults(page)).toMatchObject({ games: [{ id: game.id, status: "active" }] });
    expect(await readRounds(page, game.id)).toHaveLength(1);
    await page.keyboard.press("Escape");
    await finish.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    expect(await finish.getByRole("alert").count()).toBe(0);
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    expect(await readResults(page)).toMatchObject({
      games: [{ id: game.id, status: "completed", winnerIds: [players[0].id] }],
    });
  } finally {
    await page.close();
  }
}, 30_000);

function seedCompletionGame(
  page: Page,
  phaseCount = 1,
  tiebreaker: GameTiebreaker = "roundsWon",
  playerCount = 2,
  playerNames = ["Amy Jones", "Bob Stone", "Cam Lee", "Dan Gray"],
) {
  return page.evaluate<{ game: Game; players: Player[] }>(`
    Promise.all([
      import("/scorekeeper/src/data/api/games.ts"),
      import("/scorekeeper/src/data/api/players.ts")
    ]).then(async ([{ gamesApi }, { playersApi }]) => {
      const amy = await playersApi.create({
        name: ${JSON.stringify(playerNames[0])},
        color: "#123456",
        isFavorite: 0
      });
      const bob = await playersApi.create({
        name: ${JSON.stringify(playerNames[1])},
        color: "#abcdef",
        isFavorite: 0
      });
      const players = [amy, bob];
      if (${playerCount} >= 3) {
        players.push(await playersApi.create({ name: ${JSON.stringify(playerNames[2])}, color: "#456789", isFavorite: 0 }));
      }
      if (${playerCount} >= 4) {
        players.push(await playersApi.create({ name: ${JSON.stringify(playerNames[3])}, color: "#765432", isFavorite: 0 }));
      }
      const game = await gamesApi.create({
        scorekeeper: "phase10",
        phaseSet: {
          id: "short-phases",
          type: "temporary",
          name: "One Phase",
          phases: ${JSON.stringify(Array.from({ length: phaseCount }, (_, index) => `phase-${index + 1}`))}
        },
        players: players.map((player) => player.id),
        settings: { tiebreaker: ${JSON.stringify(tiebreaker)}, roundSkipPenalty: 100, sitOutPenalty: 0 }
      });
      return { game, players };
    })
  `);
}

function seedSavedRound(page: Page, game: Game, players: Player[], tied: boolean) {
  return page.evaluate(`
    import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) =>
      roundsApi.add({
        gameId: ${JSON.stringify(game.id)},
        roundWinnerId: ${JSON.stringify(players[0].id)},
        scores: [
          { playerId: ${JSON.stringify(players[0].id)}, phaseStatus: "completed", score: 0 },
          { playerId: ${JSON.stringify(players[1].id)}, phaseStatus: ${JSON.stringify(tied ? "completed" : "failed")}, score: ${tied ? 0 : 20} }
        ]
      })
    )
  `);
}

function readRounds(page: Page, gameId: string) {
  return page.evaluate<Round[]>(`
    import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) =>
      roundsApi.getByGameId(${JSON.stringify(gameId)})
    )
  `);
}

function readGameView(page: Page, gameId: string) {
  return page.evaluate<GameReadModel | null>(`
    import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
      gamesApi.getView(${JSON.stringify(gameId)})
    )
  `);
}

async function openStandings(page: Page) {
  const standings = page.getByRole("dialog").filter({
    has: page.getByRole("tab", { name: "Standings", exact: true }),
  });
  if ((await standings.count()) === 0) {
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
  }
  await standings.waitFor({ state: "attached", timeout: 5_000 });
  return standings;
}

function updateAndDeleteSavedPlayers(page: Page, renamedId: string, removedId: string) {
  return page.evaluate(`
    Promise.all([
      import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) =>
        playersApi.update(${JSON.stringify(renamedId)}, { name: "Zoe Quinn", color: "#654321" })
      ),
      import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) =>
        playersApi.delete(${JSON.stringify(removedId)})
      )
    ])
  `);
}

function readScoreboardHeaderPlayers(page: Page) {
  return page
    .locator('.scoreboard-cell--sticky-top span[style*="background-color"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        backgroundColor: getComputedStyle(element as HTMLElement).backgroundColor,
        initials:
          Array.from(element.querySelectorAll("span"))
            .map((span) => span.textContent?.trim() ?? "")
            .join("")
            .trim() ||
          element.textContent?.trim() ||
          "",
      })),
    );
}

function readAvatarBackgroundColors(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element as HTMLElement).backgroundColor),
  );
}

function readResults(page: Page) {
  // Keep these imports in the browser rather than Vitest's SSR module loader.
  return page.evaluate<{ games: Array<Record<string, unknown>>; players: Player[] }>(`
    Promise.all([
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
        gamesApi.getAll()
      ),
      import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) =>
        playersApi.getAll()
      )
    ]).then(([games, players]) => ({ games, players }))
  `);
}
