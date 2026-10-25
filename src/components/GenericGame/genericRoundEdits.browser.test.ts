/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { touchGesture } from "../../test/touchGesture";
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

it.each([
  { width: 390, height: 844, hasTouch: false },
  { width: 320, height: 568, hasTouch: true },
])("preserves confirmation and Add Round drafts at $width x $height (touch: $hasTouch)", async ({
  width,
  height,
  hasTouch,
}) => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const addDialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.click();
    await enterPoints(page, addDialog, "7");
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await enterPoints(page, editor, "-5");
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });

    for (const dismissal of ["Edit", "Escape", "outside"] as const) {
      expect(
        await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText(),
      ).toBe("-5");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await confirmation
        .getByText("This edit will change game results.", { exact: true })
        .waitFor();
      expect(await confirmation.getByRole("button").allTextContents()).toEqual(["Edit", "Save"]);
      expect(await confirmation.getByRole("button", { name: /Close|back/i }).count()).toBe(0);
      if (!hasTouch) {
        await expect
          .poll(() =>
            confirmation
              .getByRole("button", { name: "Edit", exact: true })
              .evaluate((element) => element === document.activeElement),
          )
          .toBe(true);
      } else {
        expect(
          await confirmation.evaluate((element) => element.contains(document.activeElement)),
        ).toBe(true);
      }
      await confirmation.evaluate((element) =>
        Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ),
      );
      const header = confirmation.locator("header");
      const before = await header.boundingBox();
      await touchGesture(header, [
        { y: 0, time: 0 },
        { y: 200, time: 200 },
        { y: 200, time: 500 },
      ]);
      expect(await header.boundingBox()).toEqual(before);
      if (dismissal === "Edit") {
        await confirmation.getByRole("button", { name: "Edit", exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await page.mouse.click(1, 1);
      }
      await confirmation.waitFor({ state: "detached" });
      expect(
        await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText(),
      ).toBe("-5");
    }

    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page
      .getByRole("cell", { name: "Maya, Round 1: -5 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
    await add.click();
    expect(
      await addDialog.getByRole("status", { name: "Maya Points", exact: true }).innerText(),
    ).toBe("7");
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    expect(await standings.getByRole("list").getByRole("listitem").allTextContents()).toEqual([
      expect.stringContaining("Rowan"),
      expect.stringContaining("Maya"),
    ]);
    await standings.getByRole("tab", { name: "Points", exact: true }).click();
    expect(
      await standings
        .getByRole("table", { name: "Points progress details", exact: true })
        .locator("tbody tr")
        .allTextContents(),
    ).toEqual(["Maya0-5", "Rowan00"]);
    await page.reload();
    await page
      .getByRole("cell", { name: "Maya, Round 1: -5 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Add Round", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("discards an unsaved correction and reopens the saved values instead of a cached edit draft", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page);
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      const expand = page.getByRole("button", { name: "Expand Round 1", exact: true });
      if (await expand.count()) await expand.click();
      await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
      expect(
        await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText(),
      ).toBe("10");
      await enterPoints(page, editor, "-8");
      await page.keyboard.press("Escape");
      await editor.waitFor({ state: "detached" });
      expect(await page.getByRole("dialog").count()).toBe(0);
    }
  } finally {
    await page.close();
  }
}, 60_000);

it("prevents duplicate pending edits and retains the draft after a storage failure", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await enterPoints(page, editor, "8");
    await holdRoundStorage(page);
    await page.evaluate((gameId) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (value?.id === gameId) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Correction storage unavailable", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    }, gameId);
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect(await editor.getByRole("button", { name: "Close", exact: true }).isDisabled()).toBe(
      true,
    );
    await editor.locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.keyboard.press("Escape");
    await editor.getByRole("tab", { name: "Maya", exact: true }).waitFor();
    await releaseRoundStorage(page);
    await editor.getByRole("alert").filter({ hasText: "Correction storage unavailable" }).waitFor();
    expect(await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "8",
    );
    await save.click();
    await editor.waitFor({ state: "detached" });
    await page
      .getByRole("cell", { name: "Maya, Round 1: 8 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
    const rounds = await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      return genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
    })()`);
    expect(rounds).toMatchObject([{ roundNumber: 1, revision: 1 }]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openGame(
  page: Page,
  settings: GenericGameSettings = {
    mode: "points",
    pointsDirection: "high",
    tiebreaker: { direction: "low" },
    dealer: true,
  },
) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const maya = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
    const rowan = await playersApi.create({ name: "Rowan", color: "Azure", isFavorite: 0 });
    const settings = ${JSON.stringify(settings)};
    const game = await genericGamesApi.create({ players: [maya.id, rowan.id], settings });
    await genericRoundsApi.add({
      gameId: game.id,
      mode: settings.mode,
      scores: settings.mode === "points"
        ? [{ playerId: maya.id, points: "10", tiebreaker: "2" },
           { playerId: rowan.id, points: "0", tiebreaker: "-3" }]
        : settings.mode === "passFail"
          ? [{ playerId: maya.id, passed: true }, { playerId: rowan.id, passed: false }]
          : [{ playerId: maya.id, won: true }, { playerId: rowan.id, won: false }],
    });
    return game.id;
  })()`);
  await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
  await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
  return gameId;
}

async function enterPoints(page: Page, dialog: Locator, value: string) {
  await dialog.getByRole("button", { name: "0", exact: true }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.type(value.replace(/^-/, ""));
  if (value.startsWith("-")) await page.keyboard.press("-");
}

it("opens the full prefilled Round from keyboard-accessible details and saves a simple correction directly", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).press("Enter");
    const edit = page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true });
    await edit.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await dialog.getByRole("tab", { name: "Rowan", exact: true }).waitFor();
    await expect
      .poll(() =>
        dialog
          .getByRole("tab", { name: "Rowan", exact: true })
          .evaluate((element) => element === document.activeElement),
      )
      .toBe(true);
    expect(
      await dialog.getByRole("tab", { name: "Rowan", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      await dialog.getByRole("status", { name: "Rowan Points", exact: true }).innerText(),
    ).toBe("0");
    expect(
      await dialog.getByRole("status", { name: "Rowan Tiebreaker", exact: true }).innerText(),
    ).toBe("-3");
    await dialog.getByRole("tab", { name: "Maya", exact: true }).click();
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "10",
    );
    await enterPoints(page, dialog, "8");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog", { name: "Edit round", exact: true }).count()).toBe(0);
    await page
      .getByRole("cell", { name: "Maya, Round 1: 8 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("cell", { name: "Maya, Round 1: 8 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
    expect(
      await page
        .getByRole("columnheader")
        .filter({ hasText: "Maya" })
        .getByText("Total Points:", { exact: true })
        .locator("..")
        .textContent(),
    ).toBe("Total Points: 8");
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "points",
  "singleRoundWinner",
  "passFail",
] as const)("does not expose editing for completed %s Games", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(
      page,
      mode === "points"
        ? { mode, pointsDirection: "high", tiebreaker: null, dealer: false }
        : { mode, tiebreaker: null, dealer: false },
    );
    await page.evaluate(`(async () => {
          const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
          await genericGamesApi.finish(${JSON.stringify(gameId)});
        })()`);
    await page.reload();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(await page.getByRole("button", { name: /^Edit Round/ }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("rejects stale confirmation without losing the draft and reloads fresh values when reopened", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await enterPoints(page, editor, "-5");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });
    await confirmation.getByRole("button", { name: "Save", exact: true }).waitFor();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const [round] = await genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
      const otherEditor = await genericRoundsApi.getEditor(round.gameId, round.id);
      await genericRoundsApi.edit({
        gameId: round.gameId, roundId: round.id, version: otherEditor.version, mode: "points",
        scores: round.scores.map((score, index) => ({
          playerId: score.playerId, points: String(index === 0 ? 9 : score.points),
          tiebreaker: String(score.tiebreaker),
        })),
      });
    })()`);
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await editor.getByRole("alert").filter({ hasText: "Game history changed." }).waitFor();
    expect(await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "-5",
    );
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    expect(await editor.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "9",
    );
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await page.reload();
    await page
      .getByRole("cell", { name: "Maya, Round 1: 9 Points, 2 Tiebreaker, Dealer", exact: true })
      .waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  { width: 390, height: 844, hasTouch: false },
  { width: 320, height: 568, hasTouch: true },
])("edits a saved winner without changing selection on focus and preserves the next Round draft at $width x $height", async ({
  width,
  height,
  hasTouch,
}) => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, { mode: "singleRoundWinner", tiebreaker: null, dealer: true });
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const addDialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.click();
    await addDialog.getByRole("radio", { name: "Maya", exact: true }).click();
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true }).press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const maya = editor.getByRole("radio", { name: "Maya", exact: true });
    const rowan = editor.getByRole("radio", { name: "Rowan", exact: true });
    await rowan.waitFor();
    await expect
      .poll(() => rowan.evaluate((element) => element === document.activeElement))
      .toBe(true);
    expect(await maya.isChecked()).toBe(true);
    expect(await rowan.isChecked()).toBe(false);
    expect(await editor.getByRole("tab").count()).toBe(0);
    expect(await editor.getByRole("radio").count()).toBe(2);
    await rowan.press("Space");
    expect(await rowan.isChecked()).toBe(true);
    expect(await editor.getByRole("radio", { checked: true }).count()).toBe(1);
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });
    for (const dismissal of ["Edit", "Escape", "outside"] as const) {
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await confirmation
        .getByText("This edit will change game results.", { exact: true })
        .waitFor();
      expect(await confirmation.getByRole("button").allTextContents()).toEqual(["Edit", "Save"]);
      expect(await confirmation.getByRole("button", { name: /Close|back/i }).count()).toBe(0);
      if (dismissal === "Edit") {
        await confirmation.getByRole("button", { name: "Edit", exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await page.mouse.click(1, 1);
      }
      await confirmation.waitFor({ state: "detached" });
      expect(await rowan.isChecked()).toBe(true);
    }
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page.getByRole("cell", { name: "Rowan, Round 1: Won", exact: true }).waitFor();
    expect(await page.getByRole("columnheader", { name: /Maya/ }).innerText()).toContain(
      "Total Wins: 0",
    );
    expect(await page.getByRole("columnheader", { name: /Rowan/ }).innerText()).toContain(
      "Total Wins: 1",
    );
    await add.click();
    expect(await addDialog.getByRole("radio", { name: "Maya", exact: true }).isChecked()).toBe(
      true,
    );
    expect(await addDialog.getByRole("radio", { checked: true }).count()).toBe(1);
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    expect(await standings.getByRole("listitem").allTextContents()).toEqual([
      expect.stringMatching(/^Place 11.*RowanTotal Wins: 1$/),
      expect.stringMatching(/^Place 22.*MayaTotal Wins: 0$/),
    ]);
    await page.reload();
    await page.getByRole("cell", { name: "Rowan, Round 1: Won", exact: true }).waitFor();
    await add.waitFor();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    expect(await rowan.isChecked()).toBe(true);
    await maya.click();
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    expect(await rowan.isChecked()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("retains a failed winner correction and prevents duplicate confirmed saves while storage is pending", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, {
      mode: "singleRoundWinner",
      tiebreaker: null,
      dealer: false,
    });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("radio", { name: "Rowan", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });
    const save = confirmation.getByRole("button", { name: "Save", exact: true });
    await save.waitFor();
    await holdRoundStorage(page);
    await page.evaluate((gameId) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (value?.id === gameId) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Winner correction storage unavailable", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    }, gameId);
    await save.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect(await confirmation.getByRole("button", { name: "Edit", exact: true }).isDisabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await save.waitFor();
    await releaseRoundStorage(page);
    await confirmation.waitFor({ state: "detached" });
    await editor
      .getByRole("alert")
      .filter({ hasText: "Winner correction storage unavailable" })
      .waitFor();
    expect(await editor.getByRole("radio", { name: "Rowan", exact: true }).isChecked()).toBe(true);
    expect(
      await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      return genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
    })()`),
    ).toMatchObject([{ revision: 0, scores: [{ won: true }, { won: false }] }]);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await save.click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("cell", { name: "Rowan, Round 1: Won", exact: true }).waitFor();
    expect(
      await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      return genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
    })()`),
    ).toMatchObject([{ revision: 1, scores: [{ won: false }, { won: true }] }]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("surfaces stale winner approval, keeps the correction draft, and reloads saved selection on reopening", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, {
      mode: "singleRoundWinner",
      tiebreaker: null,
      dealer: false,
    });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("radio", { name: "Rowan", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });
    await confirmation.getByRole("button", { name: "Save", exact: true }).waitFor();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const [round] = await genericRoundsApi.getByGameId(${JSON.stringify(gameId)});
      await genericRoundsApi.add({
        gameId: round.gameId, mode: round.mode, scores: round.scores,
      });
    })()`);
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await editor.getByRole("alert").filter({ hasText: "Game history changed." }).waitFor();
    expect(await editor.getByRole("radio", { name: "Rowan", exact: true }).isChecked()).toBe(true);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true }).click();
    expect(await editor.getByRole("radio", { name: "Maya", exact: true }).isChecked()).toBe(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await confirmation.count()).toBe(0);
    await page.reload();
    await page.getByRole("cell", { name: "Maya, Round 1: Won", exact: true }).waitFor();
    await page.getByRole("cell", { name: "Maya, Round 2: Won", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);
