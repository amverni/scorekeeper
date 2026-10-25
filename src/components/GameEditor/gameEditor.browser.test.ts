/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import type { Player, ScorekeeperId, StoredGame } from "../../types";

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

const home = (owner: ScorekeeperId) => (owner === "phase10" ? "/phaseCompan10n" : "/scorekeeper");
const apiImport = (owner: ScorekeeperId) =>
  owner === "phase10"
    ? 'const { gamesApi: api } = await import("/scorekeeper/src/data/api/games.ts");'
    : 'const { genericGamesApi: api } = await import("/scorekeeper/src/data/api/genericGames.ts");';

async function seed(page: Page, owner: ScorekeeperId, mode = "points") {
  await page.goto(`${appUrl}#${home(owner)}`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<StoredGame>(`(async () => {
    ${apiImport(owner)}
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
    const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
    return api.create({
      name: "Saved Game",
      players: [bob.id, amy.id],
      ${
        owner === "phase10"
          ? 'phaseSet: { id: "short", type: "temporary", name: "Saved phases", phases: ["classic-2", "classic-1", "classic-2"] }, settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 45, sitOutPenalty: 15 }'
          : `settings: ${JSON.stringify(
              mode === "points"
                ? {
                    mode,
                    pointsDirection: "low",
                    tiebreaker: { direction: "high" },
                    dealer: true,
                  }
                : { mode, tiebreaker: null, dealer: false },
            )}`
      }
    });
  })()`);
}

async function newPage(width = 320, height = 568) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  return page;
}

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const links = page.getByRole("navigation").getByRole("link");
  expect(await links.last().innerText()).toBe("Edit game");
  await page.getByRole("link", { name: "Edit game", exact: true }).click();
  await page.getByRole("heading", { name: "Edit game", exact: true }).waitFor();
}

it("stages a favorite Player, undoes additions, discards on Cancel, and saves only once", async () => {
  const page = await newPage();
  try {
    const game = await seed(page, "generic");
    const cam = await page.evaluate<Player>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      return playersApi.create({ name: "Cam", color: "Lime", isFavorite: 1 });
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    await openEditor(page);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    expect(await save.isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: /Reorder|Remove Bob|Remove Amy/ }).count()).toBe(
      0,
    );
    await page.getByRole("button", { name: "Remove Cam", exact: true }).click();
    await page
      .getByRole("button", { name: "Remove Cam", exact: true })
      .waitFor({ state: "detached" });
    expect(await save.isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await openEditor(page);
    expect(await save.isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await save.click();
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("columnheader").filter({ hasText: "Cam" }).waitFor();
    const saved = await page.evaluate<StoredGame>(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      return genericGamesApi.getById(${JSON.stringify(game.id)});
    })()`);
    expect(saved.players).toEqual([...game.players, cam.id]);
    expect(await page.getByRole("dialog").count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("reuses Player search and profile creation, retaining explicitly saved profiles when navigating away", async () => {
  const page = await newPage();
  try {
    const game = await seed(page, "generic");
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    await openEditor(page);
    await page.getByRole("button", { name: "Add Player", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add player", exact: true });
    expect(await add.getByRole("button", { name: "Bob", exact: true }).isDisabled()).toBe(true);
    await add.getByRole("textbox").fill("Dora");
    await add.getByRole("button", { name: "Create new player", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create player", exact: true });
    expect(await create.getByRole("textbox", { name: "Name", exact: true }).inputValue()).toBe(
      "Dora",
    );
    await create.getByRole("button", { name: "Save", exact: true }).click();
    await add.getByRole("button", { name: "Dora", exact: true }).waitFor();
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Remove Dora", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor();
    await openEditor(page);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Add Player", exact: true }).click();
    await add.getByRole("textbox").fill("Dora");
    await add.getByRole("button", { name: "Dora", exact: true }).click();
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("columnheader").filter({ hasText: "Dora" }).waitFor();
    await page.reload();
    await page.getByRole("columnheader").filter({ hasText: "Dora" }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("blocks pending duplicate Game saves and retains the staged addition after storage failure", async () => {
  const page = await newPage(390, 844);
  try {
    const game = await seed(page, "generic");
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 1 });
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    await openEditor(page);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await holdRoundStorage(page);
    await page.evaluate((id) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (value?.id === id) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Membership storage unavailable", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    }, game.id);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    await save.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await releaseRoundStorage(page);
    await page.getByRole("alert").filter({ hasText: "Membership storage unavailable" }).waitFor();
    await page.getByRole("button", { name: "Remove Cam", exact: true }).waitFor();
    const saved = await page.evaluate<StoredGame>(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      return genericGamesApi.getById(${JSON.stringify(game.id)});
    })()`);
    expect(saved).toEqual(game);
    await save.click();
    await page.getByRole("columnheader").filter({ hasText: "Cam" }).waitFor();
    await page.reload();
    await page.getByRole("columnheader").filter({ hasText: "Cam" }).waitFor();
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("surfaces stale Game history without discarding the recoverable addition", async () => {
  const page = await newPage();
  try {
    const game = await seed(page, "generic");
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 1 });
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    await openEditor(page);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      await genericRoundsApi.add({
        gameId: ${JSON.stringify(game.id)}, mode: "points",
        scores: ${JSON.stringify(game.players)}.map(playerId => ({ playerId, points: "4", tiebreaker: "1" }))
      });
    })()`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    await page.getByRole("button", { name: "Remove Cam", exact: true }).waitFor();
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    await openEditor(page);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Edit game", exact: true });
    await confirmation.getByRole("button", { name: "Edit", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Remove Cam", exact: true }).waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("columnheader").filter({ hasText: "Cam" }).waitFor();
    await page.reload();
    await page.getByRole("cell", { name: "Cam, Round 1: Did not play", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "points",
  "singleRoundWinner",
  "passFail",
])("joins in %s with blank history and preserves the unfinished next Round", async (mode) => {
  const page = await newPage(390, 844);
  try {
    const game = await seed(page, "generic", mode);
    await page.evaluate(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
        await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 1 });
        const ids = ${JSON.stringify(game.players)};
        await genericRoundsApi.add({
          gameId: ${JSON.stringify(game.id)}, mode: ${JSON.stringify(mode)},
          scores: ids.map((playerId, index) => ({
            playerId,
            ${mode === "points" ? 'points: "5", tiebreaker: "2"' : mode === "passFail" ? "passed: index === 0" : "won: index === 0"}
          }))
        });
      })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const round = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.click();
    if (mode === "points") {
      await round.getByRole("button", { name: "7", exact: true }).click();
      await round.getByRole("tab", { name: "Amy", exact: true }).click();
      await round.getByRole("button", { name: "Amy Tiebreaker", exact: true }).click();
      await page.keyboard.type("9");
    } else {
      await round
        .getByRole(mode === "passFail" ? "button" : "radio", { name: "Amy", exact: true })
        .click();
    }
    await page.keyboard.press("Escape");
    await round.waitFor({ state: "detached" });
    await openEditor(page);
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Edit game", exact: true });
    await confirmation.getByText("This edit will change game results.", { exact: true }).waitFor();
    await expect
      .poll(() =>
        confirmation
          .getByRole("button", { name: "Edit", exact: true })
          .evaluate((element) => element === document.activeElement),
      )
      .toBe(true);
    await confirmation.getByRole("button", { name: "Edit", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Remove Cam", exact: true }).waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmation.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("columnheader").filter({ hasText: "Cam" }).waitFor();
    const historical = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Expand Round 1", exact: true }) });
    expect(await historical.getByRole("cell").count()).toBe(3);
    expect(await historical.getByRole("cell").nth(2).innerText()).toBe("");
    await add.click();
    if (mode === "points") {
      expect(
        await round.getByRole("status", { name: "Amy Tiebreaker", exact: true }).innerText(),
      ).toBe("9");
      await round.getByRole("tab", { name: "Bob", exact: true }).click();
      expect(await round.getByRole("status", { name: "Bob Points", exact: true }).innerText()).toBe(
        "7",
      );
      await round.getByRole("tab", { name: "Cam", exact: true }).click();
      expect(await round.getByRole("status", { name: "Cam Points", exact: true }).innerText()).toBe(
        "0",
      );
      expect(
        await round.getByRole("status", { name: "Cam Tiebreaker", exact: true }).innerText(),
      ).toBe("0");
    } else {
      const role = mode === "passFail" ? "button" : "radio";
      const attribute = mode === "passFail" ? "aria-pressed" : "aria-checked";
      expect(
        await round.getByRole(role, { name: "Amy", exact: true }).getAttribute(attribute),
      ).toBe("true");
      expect(
        await round.getByRole(role, { name: "Cam", exact: true }).getAttribute(attribute),
      ).toBe("false");
    }
    await round.getByRole("button", { name: "Save", exact: true }).click();
    await round.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 2", exact: true }).waitFor();
    const view = await page.evaluate<import("../../types").GenericScoreboardView>(`(async () => {
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        return genericGamesApi.getScoreboard(${JSON.stringify(game.id)});
      })()`);
    expect(view.rounds.map(({ scores }) => scores.length)).toEqual([2, 3]);
    expect(view.players[2]).toMatchObject(
      mode === "points"
        ? { totalPoints: 0, totalTiebreaker: 0 }
        : mode === "passFail"
          ? { totalPasses: 0 }
          : { totalWins: 0 },
    );
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "phase10",
  "generic",
] as const)("opens the saved %s Game in a create-style inspection route without mutation", async (owner) => {
  const page = await newPage();
  try {
    const game = await seed(page, owner);
    const path = `${home(owner)}/game/${game.id}`;
    await page.goto(`${appUrl}#${path}`);
    await openEditor(page);
    expect(new URL(page.url()).hash).toBe(`#${path}/edit`);
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.getByRole("tab").allTextContents()).toEqual(
      owner === "phase10" ? ["Players", "Phases", "Settings"] : ["Players", "Settings"],
    );
    expect(
      await page.getByRole("tab", { name: "Players", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(await page.getByRole("tabpanel").getByRole("listitem").allTextContents()).toEqual([
      expect.stringContaining("Bob"),
      expect.stringContaining("Amy"),
    ]);
    const save = page.getByRole("button", { name: "Save", exact: true });
    expect(await save.isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("tabpanel", { name: "Settings", exact: true });
    expect(await settings.getByRole("button").count()).toBe(0);
    expect(await settings.locator("input, select, [role=switch], [role=combobox]").count()).toBe(0);
    for (const text of owner === "phase10"
      ? [
          "In-order phases",
          "On",
          "Fewest Wilds",
          "Round Skip Penalty",
          "45",
          "Sit Out Penalty",
          "15",
        ]
      : [
          "Saved Game",
          "Scoring Mode",
          "Points",
          "Points Direction",
          "Lower wins",
          "Enable Tiebreaker",
          "On",
          "Tiebreaker Direction",
          "Higher wins",
          "Dealer",
        ]) {
      await settings.getByText(text, { exact: true }).first().waitFor();
    }
    if (owner === "phase10") {
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const phases = page.getByRole("tabpanel", { name: "Phases", exact: true });
      expect(await phases.getByRole("listitem").count()).toBe(3);
      expect(await phases.getByRole("button").count()).toBe(0);
    }
    expect(await page.getByText(/Locked|Shuffle|Reset/, { exact: true }).count()).toBe(0);
    for (const [width, height, colorScheme] of [
      [320, 568, "light"],
      [768, 1024, "dark"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.addStyleTag({
        content:
          ":root { --safe-area-inset-left: 16px; --safe-area-inset-right: 20px; --safe-area-inset-bottom: 24px; }",
      });
      for (const action of [save, page.getByRole("link", { name: "Cancel", exact: true })]) {
        const bounds = await action.boundingBox();
        if (!bounds) throw new Error("Missing Game editor action");
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(16);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 20);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 24);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor();
    expect(new URL(page.url()).hash).toBe(`#${path}`);
    await openEditor(page);
    await page.goBack();
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor();
    await page.goto(`${appUrl}#${path}/edit`);
    await page.getByRole("tab", { name: "Players", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("tab", { name: "Players", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    const saved = await page.evaluate<StoredGame>(`(async () => {
        ${apiImport(owner)}
        return api.getById(${JSON.stringify(game.id)});
      })()`);
    expect(saved).toEqual(game);
  } finally {
    await page.close();
  }
}, 60_000);

it("preserves typed Points, Tiebreaker and selected Player through editing, but not reload", async () => {
  const page = await newPage();
  try {
    const game = await seed(page, "generic");
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.click();
    await dialog.getByRole("button", { name: "7", exact: true }).click();
    await dialog.getByRole("tab", { name: "Amy", exact: true }).click();
    await dialog.getByRole("button", { name: "Amy Tiebreaker", exact: true }).click();
    await page.keyboard.type("9");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await openEditor(page);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await add.click();
    expect(
      await dialog.getByRole("tab", { name: "Amy", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      await dialog.getByRole("status", { name: "Amy Tiebreaker", exact: true }).innerText(),
    ).toBe("9");
    await dialog.getByRole("tab", { name: "Bob", exact: true }).click();
    expect(await dialog.getByRole("status", { name: "Bob Points", exact: true }).innerText()).toBe(
      "7",
    );
    await page.reload();
    await add.click();
    expect(await dialog.getByRole("status", { name: "Bob Points", exact: true }).innerText()).toBe(
      "0",
    );
  } finally {
    await page.close();
  }
}, 60_000);

it("preserves Phase Round outcomes, count entries, winner and selected Player across the edit route", async () => {
  const page = await newPage(390, 844);
  try {
    const game = await seed(page, "phase10");
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const add = page.getByRole("button", { name: "Add round 1", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.click();
    await dialog.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Bob", exact: true }).click();
    await dialog.getByRole("tab", { name: "Amy", exact: true }).click();
    await dialog.getByRole("button", { name: "Failed", exact: true }).click();
    await dialog.getByRole("button", { name: "Set to 3", exact: true }).click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await openEditor(page);
    await page.goBack();
    await add.click();
    expect(
      await dialog.getByRole("tab", { name: "Amy", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      await dialog
        .getByRole("button", { name: "Failed", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await dialog.getByRole("button", { name: /Round Winner.*Bob/ }).waitFor();
    expect(
      await dialog
        .getByRole("spinbutton", { name: "Wilds used", exact: true })
        .getAttribute("aria-valuenow"),
    ).toBe("3");
    await dialog.getByRole("button", { name: "Save round", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    const saved = await page.evaluate(`(async () => {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const view = await gamesApi.getView(${JSON.stringify(game.id)});
      return view.rounds[0].source;
    })()`);
    expect(saved).toMatchObject({
      roundWinnerId: game.players[0],
      scores: [
        { playerId: game.players[0], phaseStatus: "completed", score: 0 },
        { playerId: game.players[1], phaseStatus: "failed", score: 3 },
      ],
    });
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "singleRoundWinner",
  "passFail",
])("preserves the Generic %s selection through edit-route cancellation", async (mode) => {
  const page = await newPage();
  try {
    const game = await seed(page, "generic", mode);
    await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const selected = dialog.getByRole(mode === "passFail" ? "button" : "radio", {
      name: "Amy",
      exact: true,
    });
    await add.click();
    await selected.click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await openEditor(page);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await add.click();
    expect(await selected.getAttribute(mode === "passFail" ? "aria-pressed" : "aria-checked")).toBe(
      "true",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    await add.click();
    expect(await selected.getAttribute(mode === "passFail" ? "aria-pressed" : "aria-checked")).toBe(
      "false",
    );
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "phase10",
  "generic",
] as const)("blocks direct %s edit URLs for Completed, missing and wrong-Scorekeeper Games", async (owner) => {
  const page = await newPage();
  try {
    const game = await seed(page, owner);
    const path = `${home(owner)}/game/${game.id}`;
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      ${
        owner === "phase10"
          ? `const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
             await roundsApi.add({ gameId: ${JSON.stringify(game.id)}, roundWinnerId: ${JSON.stringify(game.players[0])},
               scores: ${JSON.stringify(game.players)}.map(playerId => ({ playerId, phaseStatus: "completed", score: 0 })) });`
          : `const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
             await genericRoundsApi.add({ gameId: ${JSON.stringify(game.id)}, mode: "points",
               scores: ${JSON.stringify(game.players)}.map(playerId => ({ playerId, points: "5", tiebreaker: "0" })) });`
      }
      await api.finish(${JSON.stringify(game.id)});
    })()`);
    await page.goto(`${appUrl}#${path}/edit`);
    await page
      .getByRole("alert")
      .getByText("Reopen this Completed Game for correction before editing.", { exact: true })
      .waitFor();
    expect(await page.getByRole("tab").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    expect(await page.getByRole("link", { name: "Edit game", exact: true }).count()).toBe(0);
    for (const unavailable of [
      `${home(owner)}/game/missing/edit`,
      `${home(owner === "phase10" ? "generic" : "phase10")}/game/${game.id}/edit`,
    ]) {
      await page.goto(`${appUrl}#${unavailable}`);
      await page.getByText("This Game is no longer available.", { exact: true }).waitFor();
      expect(await page.getByRole("tab").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    }
    expect(
      await page.evaluate(`(async () => {
      ${apiImport(owner)}
      return (await api.getById(${JSON.stringify(game.id)})).status;
    })()`),
    ).toBe("completed");
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "phase10",
  "generic",
] as const)("surfaces a failed %s editor read and retries without creating a Game", async (owner) => {
  const page = await newPage(390, 844);
  try {
    const game = await seed(page, owner);
    await page.goto(`${appUrl}#${home(owner)}/game/${game.id}`);
    await page.getByRole("button", { name: "Open Standings", exact: true }).waitFor();
    await page.evaluate((gameId) => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (key === gameId) {
          IDBObjectStore.prototype.get = get;
          throw new DOMException("Editor read unavailable", "UnknownError");
        }
        return get.call(this, key);
      };
    }, game.id);
    await openEditor(page);
    await page.getByRole("alert").getByText("Editor read unavailable", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("tab", { name: "Players", exact: true }).waitFor();
    expect(await page.getByRole("alert").count()).toBe(0);
    expect(
      await page.evaluate(`(async () => {
      ${apiImport(owner)}
      return api.getById(${JSON.stringify(game.id)});
    })()`),
    ).toEqual(game);
  } finally {
    await page.close();
  }
}, 60_000);
