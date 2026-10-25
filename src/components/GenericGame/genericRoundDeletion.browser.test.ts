/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { touchGesture } from "../../test/touchGesture";
import type { GenericGameSettings, GenericRound } from "../../types";

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

const settings: GenericGameSettings[] = [
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: true },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  { mode: "passFail", tiebreaker: null, dealer: true },
];

it.each(
  settings,
)("cancels safely with its $mode draft intact, then deletes only the selected earlier Round", async (settings) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, settings);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    expect(await add.getByRole("button", { name: "Delete Round", exact: true }).count()).toBe(0);
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    const editor = await openEditor(page);
    await changeDraft(page, editor, settings.mode);
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    for (const dismissal of ["Cancel", "Escape", "outside"] as const) {
      await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
      await confirmation
        .getByText("Delete Round 1? This cannot be undone.", { exact: true })
        .waitFor();
      expect(await confirmation.getByRole("button").allTextContents()).toEqual([
        "Cancel",
        "Delete",
      ]);
      await expect
        .poll(() =>
          confirmation
            .getByRole("button", { name: "Cancel", exact: true })
            .evaluate((element) => element === document.activeElement),
        )
        .toBe(true);
      await confirmation.evaluate((element) =>
        Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ),
      );
      const before = await confirmation.locator("header").boundingBox();
      await touchGesture(confirmation.locator("header"), [
        { y: 0, time: 0 },
        { y: 200, time: 200 },
        { y: 200, time: 500 },
      ]);
      expect(await confirmation.locator("header").boundingBox()).toEqual(before);
      if (dismissal === "Cancel") {
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await page.mouse.click(1, 1);
      }
      await confirmation.waitFor({ state: "detached" });
      await expectDraft(editor, settings.mode);
    }
    await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Expand Round 2", exact: true }).count()).toBe(0);
    const rounds = await readRounds(page, gameId);
    expect(rounds).toMatchObject([{ roundNumber: 1 }]);
    expect(rounds).toHaveLength(1);
    await page
      .getByRole("cell", {
        name:
          settings.mode === "points"
            ? "Rowan, Round 1: 7 Points, -1 Tiebreaker"
            : settings.mode === "singleRoundWinner"
              ? "Rowan, Round 1: Won"
              : "Rowan, Round 1: Passed",
        exact: true,
      })
      .waitFor();
    await page.getByRole("cell", { name: "Maya, upcoming Round", exact: true }).waitFor();
    await page.getByRole("cell", { name: "Rowan, upcoming Round: Dealer", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each(
  settings,
)("blocks duplicate pending $mode deletions and restores the draft after a failed transaction", async (settings) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, settings);
    const before = await readRounds(page, gameId);
    const editor = await openEditor(page);
    await changeDraft(page, editor, settings.mode);
    await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await expect
      .poll(() =>
        confirmation
          .getByRole("button", { name: "Cancel", exact: true })
          .evaluate((element) => element === document.activeElement),
      )
      .toBe(true);
    await holdRoundStorage(page);
    await page.evaluate((gameId) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (value?.id === gameId) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Deletion storage unavailable", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    }, gameId);
    const remove = confirmation.getByRole("button", { name: "Delete", exact: true });
    await remove.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
    await expect.poll(() => remove.isDisabled()).toBe(true);
    expect(
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.click(1, 1);
    expect(
      await confirmation
        .getByText("Delete Round 1? This cannot be undone.", { exact: true })
        .isVisible(),
    ).toBe(true);
    await releaseRoundStorage(page);
    await editor.getByRole("alert").filter({ hasText: "Deletion storage unavailable" }).waitFor();
    await confirmation.waitFor({ state: "detached" });
    await expectDraft(editor, settings.mode);
    expect(await readRounds(page, gameId)).toEqual(before);
    await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    expect(await readRounds(page, gameId)).toEqual([{ ...before[1], roundNumber: 1 }]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("rejects stale deletion without losing the draft, then deletes the sole Round after reopening", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, settings[0]);
    const before = await readRounds(page, gameId);
    const editor = await openEditor(page);
    await changeDraft(page, editor, "points");
    await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const editor = await genericRoundsApi.getEditor(${JSON.stringify(gameId)}, ${JSON.stringify(before[1].id)});
      await genericRoundsApi.delete({ gameId: editor.round.gameId, roundId: editor.round.id, version: editor.version });
    })()`);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    await confirmation.waitFor({ state: "detached" });
    await expectDraft(editor, "points");
    expect(await readRounds(page, gameId)).toEqual([before[0]]);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await openEditor(page);
    expect(await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "10",
    );
    await editor.getByRole("button", { name: "Delete Round", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add Round", exact: true }).waitFor();
    expect(await readRounds(page, gameId)).toEqual([]);
    expect(await page.getByRole("button", { name: /^Expand Round/ }).count()).toBe(0);
    expect(page.url()).toContain(`/scorekeeper/game/${gameId}`);
    await page.getByRole("cell", { name: "Maya, upcoming Round: Dealer", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.getByRole("button", { name: "Save", exact: true }).click();
    await add.waitFor({ state: "detached" });
    expect(await readRounds(page, gameId)).toMatchObject([{ roundNumber: 1 }]);
  } finally {
    await page.close();
  }
}, 60_000);

async function openGame(page: Page, settings: GenericGameSettings) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const maya = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
    const rowan = await playersApi.create({ name: "Rowan", color: "Azure", isFavorite: 0 });
    const settings = ${JSON.stringify(settings)};
    const game = await genericGamesApi.create({ players: [maya.id, rowan.id], settings });
    for (const first of [true, false]) {
      await genericRoundsApi.add({
        gameId: game.id, mode: settings.mode,
        scores: settings.mode === "points"
          ? [{ playerId: maya.id, points: first ? "10" : "0", tiebreaker: "2" },
             { playerId: rowan.id, points: first ? "0" : "7", tiebreaker: "-1" }]
          : settings.mode === "passFail"
            ? [{ playerId: maya.id, passed: first }, { playerId: rowan.id, passed: !first }]
            : [{ playerId: maya.id, won: first }, { playerId: rowan.id, won: !first }],
      });
    }
    return game.id;
  })()`);
  await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
  await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
  return gameId;
}

async function openEditor(page: Page) {
  const expand = page.getByRole("button", { name: "Expand Round 1", exact: true });
  if (await expand.count()) await expand.click();
  await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
  await editor.getByRole("button", { name: "Close", exact: true }).waitFor();
  return editor;
}

async function changeDraft(page: Page, editor: Locator, mode: GenericGameSettings["mode"]) {
  if (mode === "points") {
    await editor.getByRole("button", { name: "0", exact: true }).focus();
    await page.keyboard.press("Delete");
    await page.keyboard.type("8");
  } else {
    await editor
      .getByRole(mode === "passFail" ? "button" : "radio", {
        name: mode === "passFail" ? "Maya" : "Rowan",
        exact: true,
      })
      .click();
  }
}

async function expectDraft(editor: Locator, mode: GenericGameSettings["mode"]) {
  if (mode === "points") {
    expect(await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "8",
    );
  } else {
    expect(
      await editor
        .getByRole(mode === "passFail" ? "button" : "radio", {
          name: mode === "passFail" ? "Maya" : "Rowan",
          exact: true,
        })
        .getAttribute(mode === "passFail" ? "aria-pressed" : "aria-checked"),
    ).toBe(mode === "passFail" ? "false" : "true");
  }
}

function readRounds(page: Page, gameId: string) {
  return page.evaluate<GenericRound[]>(`(async () => {
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    return genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
  })()`);
}
