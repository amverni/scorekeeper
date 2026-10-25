/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import type { GenericGame, GenericRound, GenericScoreboardView, PlayerIdentity } from "../../types";

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

async function newPage(viewport = { width: 390, height: 844 }, hasTouch = true) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  return page;
}

async function selectMode(page: Page, name: "Points" | "Pass/Fail") {
  await page.getByLabel("Scoring Mode", { exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

it("keeps Points as the setup default and preserves independent Dealer across mode switches", async () => {
  const page = await newPage();
  try {
    await seedPlayers(page, ["Maya"]);
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("button", { name: "Maya", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const mode = page.getByLabel("Scoring Mode", { exact: true });
    await mode.waitFor();
    expect(await mode.innerText()).toContain("Points");
    expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
      true,
    );
    const dealer = page.getByRole("switch", { name: "Dealer", exact: true });
    expect(await dealer.isChecked()).toBe(false);
    await dealer.click();
    await page.getByRole("radio", { name: "Low wins", exact: true }).click();
    await selectMode(page, "Pass/Fail");
    await expect
      .poll(() => page.getByRole("radiogroup", { name: "Points Direction", exact: true }).count())
      .toBe(0);
    await expect
      .poll(() =>
        page
          .getByRole("tabpanel", { name: "Settings", exact: true })
          .locator("[data-list-row-key]:visible")
          .count(),
      )
      .toBe(3);
    expect(await dealer.isChecked()).toBe(true);
    await selectMode(page, "Points");
    expect(await page.getByRole("radio", { name: "Low wins", exact: true }).isChecked()).toBe(true);
    expect(await dealer.isChecked()).toBe(true);
    await dealer.click();
    await selectMode(page, "Pass/Fail");
    expect(await dealer.isChecked()).toBe(false);
    await expect
      .poll(() => page.getByRole("radiogroup", { name: "Points Direction", exact: true }).count())
      .toBe(0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("table", { name: "Passes scoreboard" }).waitFor();
    const gameId = page.url().split("/").at(-1);
    if (!gameId) throw new Error("Missing created Game ID");
    expect((await readGame(page, gameId)).settings).toEqual({
      mode: "passFail",
      tiebreaker: null,
      dealer: false,
    });
    await page.reload();
    await page.getByRole("table", { name: "Passes scoreboard", exact: true }).waitFor();
    expect(
      await page.getByRole("cell", { name: "Maya, upcoming Round", exact: true }).innerText(),
    ).toBe("");
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Create Game", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await mode.innerText()).toContain("Points");
    expect(await page.getByRole("radio", { name: "High wins", exact: true }).isChecked()).toBe(
      true,
    );
    expect(await dealer.isChecked()).toBe(false);
  } finally {
    await page.close();
  }
}, 60_000);

async function seedPlayers(page: Page, names: string[]) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<PlayerIdentity[]>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const players = [];
    for (const [index, name] of ${JSON.stringify(names)}.entries()) {
      players.push(await playersApi.create({
        name, color: index === 0 ? "#123456" : "#abcdef", isFavorite: 1,
      }));
    }
    return players;
  })()`);
}

async function openGame(page: Page, names = ["Maya", "Rowan", "Lee"], dealer = false) {
  const players = await seedPlayers(page, names);
  const game = await page.evaluate<GenericGame>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.create({
      players: ${JSON.stringify(players.map((player) => player.id))},
      settings: { mode: "passFail", tiebreaker: null, dealer: ${dealer} },
    });
  })()`);
  // API seeding does not invalidate the Home query's cached empty Game list.
  await page.reload();
  await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
  await page.getByRole("table", { name: "Passes scoreboard", exact: true }).waitFor();
  return game;
}

function readGame(page: Page, id: string) {
  return page.evaluate<GenericGame>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.getById(${JSON.stringify(id)});
  })()`);
}

function readRounds(page: Page, id: string) {
  return page.evaluate<GenericRound[]>(`(async () => {
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    return genericRoundsApi.getByGameId(${JSON.stringify(id)});
  })()`);
}

function readScoreboard(page: Page, id: string) {
  return page.evaluate<GenericScoreboardView>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.getScoreboard(${JSON.stringify(id)});
  })()`);
}

async function openRound(page: Page) {
  await page.getByRole("button", { name: "Add Round", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
  await dialog.getByRole("group", { name: "Players who passed", exact: true }).waitFor();
  return dialog;
}

async function saveRound(page: Page, passed: string[]) {
  const dialog = await openRound(page);
  for (const name of passed) {
    await dialog.getByRole("button", { name, exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
}

async function expectOutcome(button: Locator, passed: boolean) {
  await expect.poll(() => button.getAttribute("aria-pressed")).toBe(String(passed));
  expect(await button.getByText(passed ? "Passed" : "Failed", { exact: true }).isVisible()).toBe(
    true,
  );
  if (passed) {
    expect(await button.locator("svg.lucide-check").isVisible()).toBe(true);
  }
}

it("opens saved outcomes without toggling focus, saves a non-impacting correction, and preserves the separate Add Round draft", async () => {
  const page = await newPage(undefined, false);
  try {
    const game = await openGame(page, ["Maya", "Rowan", "Lee"], true);
    await saveRound(page, ["Maya"]);
    await saveRound(page, ["Maya"]);
    const addDialog = await openRound(page);
    await addDialog.getByRole("button", { name: "Rowan", exact: true }).click();
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true }).press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const rowan = editor.getByRole("button", { name: "Rowan", exact: true });
    await expect
      .poll(() => rowan.evaluate((element) => element === document.activeElement))
      .toBe(true);
    await expectOutcome(rowan, false);
    await expectOutcome(editor.getByRole("button", { name: "Maya", exact: true }), true);
    await expectOutcome(editor.getByRole("button", { name: "Lee", exact: true }), false);
    expect(await editor.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await editor.getByRole("button", { name: "Maya", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog", { name: "Edit round", exact: true }).count()).toBe(0);
    await page.getByRole("cell", { name: "Maya, Round 1: Failed, Dealer", exact: true }).waitFor();
    expect(await page.getByRole("columnheader", { name: /Maya/ }).innerText()).toContain(
      "Total Passes: 1",
    );
    expect(await page.getByRole("columnheader").allTextContents()).toEqual([
      "Round",
      expect.stringContaining("Maya"),
      expect.stringContaining("Rowan"),
      expect.stringContaining("Lee"),
    ]);
    await openRound(page);
    await expectOutcome(addDialog.getByRole("button", { name: "Rowan", exact: true }), true);
    await expectOutcome(addDialog.getByRole("button", { name: "Maya", exact: true }), false);
    await addDialog.getByRole("button", { name: "Close", exact: true }).click();
    await addDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    expect(
      await standings
        .getByRole("list", { name: "Standings places", exact: true })
        .getByRole("listitem")
        .allTextContents(),
    ).toEqual([
      expect.stringContaining("Place 1"),
      expect.stringContaining("Place 2"),
      expect.stringContaining("Tied for place 2"),
    ]);
    await standings.getByRole("tab", { name: "Passes", exact: true }).click();
    expect(
      await standings
        .getByRole("table", { name: "Passes progress details", exact: true })
        .locator("tbody tr")
        .allTextContents(),
    ).toEqual(["Maya001", "Rowan000", "Lee000"]);
    const rounds = await readRounds(page, game.id);
    await page.reload();
    await page.getByRole("cell", { name: "Maya, Round 1: Failed, Dealer", exact: true }).waitFor();
    expect(await readRounds(page, game.id)).toEqual(rounds);
    expect((await readGame(page, game.id)).status).toBe("active");
  } finally {
    await page.close();
  }
}, 60_000);

it("saves all-fail, mixed, and all-pass full rosters with pass totals and rotating Dealers", async () => {
  const page = await newPage();
  try {
    const names = ["Maya", "Rowan", "Lee"];
    const game = await openGame(page, names, true);
    const dialog = await openRound(page);
    expect(await dialog.getByRole("tab").count()).toBe(0);
    expect(await dialog.locator("input,textarea").count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    for (const name of names) {
      await expectOutcome(dialog.getByRole("button", { name, exact: true }), false);
    }
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await openRound(page);
    for (const name of ["Maya", "Rowan", "Rowan"]) {
      await dialog.getByRole("button", { name, exact: true }).click();
    }
    await expectOutcome(dialog.getByRole("button", { name: "Maya", exact: true }), true);
    await expectOutcome(dialog.getByRole("button", { name: "Rowan", exact: true }), false);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await saveRound(page, names);

    const outcomes = [
      [false, false, false],
      [true, false, false],
      [true, true, true],
    ];
    const rounds = await readRounds(page, game.id);
    expect(rounds.map(({ mode, scores }) => ({ mode, scores }))).toEqual(
      outcomes.map((passed) => ({
        mode: "passFail",
        scores: game.players.map((playerId, index) => ({ playerId, passed: passed[index] })),
      })),
    );
    for (const [roundIndex, passed] of outcomes.entries()) {
      for (const [playerIndex, name] of names.entries()) {
        const label = `${name}, Round ${roundIndex + 1}: ${passed[playerIndex] ? "Passed" : "Failed"}${playerIndex === roundIndex ? ", Dealer" : ""}`;
        expect(await page.getByRole("cell", { name: label, exact: true }).count()).toBe(1);
      }
    }
    expect(
      await page.getByRole("cell", { name: "Maya, upcoming Round: Dealer", exact: true }).count(),
    ).toBe(1);
    for (const [name, total] of [
      ["Maya", 2],
      ["Rowan", 1],
      ["Lee", 1],
    ] as const) {
      expect(
        await page.getByRole("columnheader", { name: new RegExp(name) }).innerText(),
      ).toContain(`Total Passes: ${total}`);
    }
    await page.getByRole("button", { name: "Expand Round 2", exact: true }).click();
    expect(
      await page.getByRole("cell", { name: "Maya, Round 2: Passed", exact: true }).innerText(),
    ).toContain("Accumulated Passes: 1");
    expect(
      await page
        .getByRole("cell", { name: "Rowan, Round 2: Failed, Dealer", exact: true })
        .innerText(),
    ).toContain("Accumulated Passes: 0");
    const view = await readScoreboard(page, game.id);
    expect(
      view.standings.map(({ player, place, ...total }) => ({ id: player.id, ...total, place })),
    ).toEqual([
      { id: game.players[0], totalPasses: 2, place: 1 },
      { id: game.players[1], totalPasses: 1, place: 2 },
      { id: game.players[2], totalPasses: 1, place: 2 },
    ]);
    expect((await readGame(page, game.id)).status).toBe("active");
    await page.reload();
    await page.getByRole("cell", { name: "Lee, Round 3: Passed, Dealer", exact: true }).waitFor();
    expect(await readRounds(page, game.id)).toEqual(rounds);
  } finally {
    await page.close();
  }
}, 60_000);

async function finishGame(page: Page) {
  await page.getByRole("button", { name: "Finish Game", exact: true }).click();
  const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
  await finish.getByRole("button", { name: "Finish", exact: true }).click();
  const standings = page.getByRole("dialog", { name: "Standings", exact: true });
  await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
  return standings;
}

it("finishes tied Passes with competition places and preserves completed snapshots when reopened", async () => {
  const page = await newPage();
  try {
    const game = await openGame(page);
    await saveRound(page, ["Maya", "Rowan"]);
    const standings = await finishGame(page);
    const places = standings.getByRole("list", { name: "Standings places", exact: true });
    expect(
      await standings.getByRole("region", { name: "Passes Standings", exact: true }).count(),
    ).toBe(1);
    expect(await places.getByRole("listitem").allTextContents()).toEqual([
      expect.stringContaining("Place 1"),
      expect.stringContaining("Tied for place 1"),
      expect.stringContaining("Place 3"),
    ]);
    expect(await readGame(page, game.id)).toMatchObject({
      status: "completed",
      completionType: "manual",
      winnerIds: game.players.slice(0, 2),
      playerSnapshots: [
        { id: game.players[0], name: "Maya", color: "#123456" },
        { id: game.players[1], name: "Rowan", color: "#abcdef" },
        { id: game.players[2], name: "Lee", color: "#abcdef" },
      ],
    });
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      await playersApi.update(${JSON.stringify(game.players[0])}, { name: "Renamed", color: "#654321" });
      await playersApi.delete(${JSON.stringify(game.players[1])});
    })()`);
    await page.reload();
    await places.waitFor();
    expect(await places.innerText()).toContain("Maya");
    expect(await places.innerText()).toContain("Rowan");
    expect(await places.innerText()).not.toContain("Renamed");
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(
      await page.getByRole("cell", { name: "Rowan, Round 1: Passed", exact: true }).innerText(),
    ).toContain("Accumulated Passes: 1");
    expect(await standings.count()).toBe(0);
    await returnToDashboard(page);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Games", exact: true }).click();
    const history = page.getByRole("link", {
      name: "View Standings for game with Maya, Rowan, Lee",
      exact: true,
    });
    await history.waitFor();
    expect(
      await history
        .locator('span[style*="background-color"]')
        .evaluateAll((avatars) =>
          avatars.map((avatar) => getComputedStyle(avatar).backgroundColor),
        ),
    ).toEqual(["rgb(18, 52, 86)", "rgb(171, 205, 239)", "rgb(171, 205, 239)"]);
    await history.click();
    await places.waitFor();
    expect(await places.getByRole("listitem").allTextContents()).toEqual([
      expect.stringContaining("Maya"),
      expect.stringContaining("Rowan"),
      expect.stringContaining("Lee"),
    ]);
  } finally {
    await page.close();
  }
}, 60_000);

it("allows solo all-fail completion only after a saved Round", async () => {
  const page = await newPage();
  try {
    const game = await openGame(page, ["Maya"]);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    expect(await finish.getByRole("button", { name: "Finish", exact: true }).count()).toBe(0);
    expect(await finish.getByRole("button", { name: "Delete", exact: true }).isEnabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await finish.waitFor({ state: "detached" });
    await saveRound(page, []);
    const standings = await finishGame(page);
    expect(await standings.getByRole("listitem").innerText()).toContain("Place 1");
    expect(await readGame(page, game.id)).toMatchObject({
      status: "completed",
      winnerIds: game.players,
    });
    expect((await readScoreboard(page, game.id)).standings).toMatchObject([
      { totalPasses: 0, place: 1 },
    ]);
  } finally {
    await page.close();
  }
}, 60_000);

it("retains a draft on close, clears it after save, and discards it on navigation or reload", async () => {
  const page = await newPage();
  try {
    const game = await openGame(page, ["Maya", "Rowan"]);
    const dialog = await openRound(page);
    const maya = dialog.getByRole("button", { name: "Maya", exact: true });
    await maya.click();
    await expectOutcome(maya, true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await openRound(page);
    await expectOutcome(maya, true);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const saved = await readRounds(page, game.id);
    await openRound(page);
    await expectOutcome(maya, false);
    await maya.click();
    await expectOutcome(maya, true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Continue game with Maya, Rowan", exact: true }).click();
    await openRound(page);
    await expectOutcome(maya, false);
    await maya.click();
    await expectOutcome(maya, true);
    await page.reload();
    await openRound(page);
    for (const name of ["Maya", "Rowan"]) {
      await expectOutcome(dialog.getByRole("button", { name, exact: true }), false);
    }
    expect(await dialog.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    expect(await readRounds(page, game.id)).toEqual(saved);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  false,
  true,
])("preserves a declined all-%s correction, discards unsaved edits, and confirms shared places on mobile", async (passed) => {
  const page = await newPage({ width: 320, height: 568 });
  try {
    const game = await openGame(page);
    await saveRound(page, ["Maya"]);
    const saved = await readScoreboard(page, game.id);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit Round 1 for Rowan", exact: true });
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const confirmation = page.getByRole("dialog", { name: "Edit round", exact: true });
    const toggleNames = passed ? ["Rowan", "Lee"] : ["Maya"];
    await edit.click();
    await editor.getByRole("group", { name: "Players who passed", exact: true }).waitFor();
    await expectOutcome(editor.getByRole("button", { name: "Maya", exact: true }), true);
    await expectOutcome(editor.getByRole("button", { name: "Rowan", exact: true }), false);
    for (const name of toggleNames) await editor.getByRole("button", { name, exact: true }).click();

    for (const dismissal of ["Edit", "Escape", "outside"]) {
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await confirmation
        .getByText("This edit will change game results.", { exact: true })
        .waitFor();
      expect(await confirmation.getByRole("button").allTextContents()).toEqual(["Edit", "Save"]);
      if (dismissal === "Edit") {
        await confirmation.getByRole("button", { name: "Edit", exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await page.mouse.click(1, 1);
      }
      await confirmation.waitFor({ state: "detached" });
      for (const name of ["Maya", "Rowan", "Lee"]) {
        await expectOutcome(editor.getByRole("button", { name, exact: true }), passed);
      }
      expect(await readScoreboard(page, game.id)).toEqual(saved);
    }

    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await edit.click();
    await expectOutcome(editor.getByRole("button", { name: "Maya", exact: true }), true);
    await expectOutcome(editor.getByRole("button", { name: "Rowan", exact: true }), false);
    for (const name of toggleNames) await editor.getByRole("button", { name, exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await confirmation.waitFor({ state: "detached" });
    await page
      .getByRole("cell", { name: `Maya, Round 1: ${passed ? "Passed" : "Failed"}`, exact: true })
      .waitFor();
    expect((await readGame(page, game.id)).status).toBe("active");
    await page.reload();
    await page.getByRole("button", { name: "Add Round", exact: true }).waitFor();
    for (const name of ["Maya", "Rowan", "Lee"]) {
      expect(
        await page.getByRole("columnheader", { name: new RegExp(name) }).innerText(),
      ).toContain(`Total Passes: ${passed ? 1 : 0}`);
    }
    await finishGame(page);
    expect(await readGame(page, game.id)).toMatchObject({
      status: "completed",
      completionType: "manual",
      winnerIds: game.players,
    });
  } finally {
    await page.close();
  }
}, 60_000);

it("blocks duplicate pending Pass/Fail edits and retains outcomes after a failed save for retry", async () => {
  const page = await newPage();
  try {
    const game = await openGame(page);
    await saveRound(page, ["Maya"]);
    await saveRound(page, ["Maya"]);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const maya = editor.getByRole("button", { name: "Maya", exact: true });
    await maya.click();
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
    }, game.id);
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect(await maya.isDisabled()).toBe(true);
    expect(await editor.getByRole("button", { name: "Close", exact: true }).isDisabled()).toBe(
      true,
    );
    await editor.locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.keyboard.press("Escape");
    await releaseRoundStorage(page);
    await editor.getByRole("alert").filter({ hasText: "Correction storage unavailable" }).waitFor();
    await expectOutcome(maya, false);
    expect((await readRounds(page, game.id))[0]).toMatchObject({
      revision: 0,
      scores: [{ passed: true }, { passed: false }, { passed: false }],
    });
    await save.click();
    await editor.waitFor({ state: "detached" });
    await page.getByRole("cell", { name: "Maya, Round 1: Failed", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("cell", { name: "Maya, Round 1: Failed", exact: true }).waitFor();
    expect(await readRounds(page, game.id)).toMatchObject([
      {
        roundNumber: 1,
        revision: 1,
        scores: [{ passed: false }, { passed: false }, { passed: false }],
      },
      {
        roundNumber: 2,
        revision: 0,
        scores: [{ passed: true }, { passed: false }, { passed: false }],
      },
    ]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("surfaces stale Pass/Fail history without overwriting it or discarding the editable outcomes", async () => {
  const page = await newPage();
  try {
    const game = await openGame(page);
    await saveRound(page, ["Maya"]);
    const saved = await readRounds(page, game.id);
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit Round 1 for Maya", exact: true });
    await edit.click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: "Maya", exact: true }).click();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      await genericRoundsApi.add({
        gameId: ${JSON.stringify(game.id)}, mode: "passFail",
        scores: ${JSON.stringify(game.players.map((playerId) => ({ playerId, passed: false })))},
      });
    })()`);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "Game history changed." }).waitFor();
    await expectOutcome(editor.getByRole("button", { name: "Maya", exact: true }), false);
    expect((await readRounds(page, game.id))[0]).toEqual(saved[0]);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await edit.click();
    await expectOutcome(editor.getByRole("button", { name: "Maya", exact: true }), true);
  } finally {
    await page.close();
  }
}, 60_000);

async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function expectUnclippedCapsule(page: Page, button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  const before = await button.boundingBox();
  if (!before) throw new Error("Missing Pass/Fail toggle geometry");
  expect(before.height).toBeGreaterThanOrEqual(44);
  expect(before.width).toBeGreaterThan(before.height);
  const radii = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomLeftRadius,
      style.borderBottomRightRadius,
    ].map(Number.parseFloat);
  });
  for (const radius of radii) expect(radius).toBeGreaterThanOrEqual(before.height / 2);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  try {
    await expect
      .poll(async () => (await button.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width * 1.09);
    const clipping = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const clippedBy: string[] = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clip = parent.getBoundingClientRect();
        if (
          (style.overflowX !== "visible" &&
            (bounds.left < clip.left - 1 || bounds.right > clip.right + 1)) ||
          (style.overflowY !== "visible" &&
            (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1))
        ) {
          clippedBy.push(`${parent.tagName}: ${style.overflowX}/${style.overflowY}`);
        }
      }
      return {
        clippedBy,
        withinViewport:
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight,
      };
    });
    expect(clipping).toEqual({ clippedBy: [], withinViewport: true });
  } finally {
    await page.mouse.up();
  }
}

it("keeps a long roster scrollable, capsule presses unclipped, and keyboard focus contained at 320 x 568", async () => {
  const page = await newPage({ width: 320, height: 568 });
  try {
    const names = Array.from({ length: 12 }, (_, index) => `Alexandria Christopher ${index + 1}`);
    const game = await openGame(page, names);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = await openRound(page);
    expect(
      await page.evaluate(async () => {
        const fonts = await document.fonts.load(
          '16px "Quicksand Variable"',
          "Alexandria Christopher",
        );
        return fonts.length > 0 && fonts.every((font) => font.status === "loaded");
      }),
    ).toBe(true);
    await settleAnimations(page);
    expect(await dialog.getAttribute("aria-modal")).toBe("true");
    const group = dialog.getByRole("group", { name: "Players who passed", exact: true });
    expect(await group.getByRole("button").count()).toBe(names.length);
    expect(await dialog.getByRole("tab").count()).toBe(0);
    const first = group.getByRole("button", { name: names[0], exact: true });
    const last = group.getByRole("button", { name: names.at(-1), exact: true });
    await expectUnclippedCapsule(page, first);
    await expectUnclippedCapsule(page, last);
    expect(
      await last.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent.scrollHeight > parent.clientHeight && parent.scrollTop > 0) return true;
        }
        return false;
      }),
    ).toBe(true);
    await first.focus();
    const wasPressed = await first.getAttribute("aria-pressed");
    await page.keyboard.press("Space");
    expect(await first.getAttribute("aria-pressed")).toBe(wasPressed === "true" ? "false" : "true");
    await page.keyboard.press("Enter");
    expect(await first.getAttribute("aria-pressed")).toBe(wasPressed);
    // macOS WebKit requires Option-Tab to include buttons without full keyboard access.
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    for (const key of [tab, `Shift+${tab}`]) {
      for (let index = 0; index < names.length + 4; index++) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await expect
      .poll(() => add.evaluate((element) => element === document.activeElement))
      .toBe(true);
    await openRound(page);
    await last.scrollIntoViewIfNeeded();
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    if (!bounds) throw new Error("Missing Save geometry");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    expect(await page.locator("body").evaluate((element) => element.scrollWidth)).toBe(320);
    await save.click();
    await dialog.waitFor({ state: "detached" });
    expect((await readRounds(page, game.id))[0].scores).toHaveLength(names.length);
  } finally {
    await page.close();
  }
}, 60_000);
