/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { holdScorecard } from "../../test/scorecardHold";
import type { Game, GameReadModel, Player } from "../../types";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  appUrl = `http://127.0.0.1:${address.port}/scorekeeper/`;
  await server.environments.client.warmupRequest("/src/main.tsx");
  await server.environments.client.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it.each([
  "mouse",
  "touch",
] as const)("holds Phase 10 cells and Round numbers with %s without changing saved results on opening", async (pointerType) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: pointerType === "touch",
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const { game } = await seedGame(page);
    const before = await readView(page, game.id);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const round = page.getByRole("button", { name: /^Round 1/, includeHidden: true });
    await round.click();
    const cell = page
      .locator(".scoreboard-cell")
      .filter({ has: page.getByRole("button", { name: "Edit Round 1 for Bob", exact: true }) })
      .locator(".scoreboard-entry__phase");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const bob = editor.getByRole("tab", { name: "Bob", exact: true });
    await holdScorecard(page, cell, bob, pointerType);
    expect(await bob.getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => bob.evaluate((tab) => tab === document.activeElement)).toBe(true);
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await expect
      .poll(() => round.evaluate((button) => button === document.activeElement))
      .toBe(true);
    expect(await round.getAttribute("aria-expanded")).toBe("true");
    await round.click();
    await holdScorecard(
      page,
      round,
      editor.getByRole("tab", { name: "Amy", exact: true }),
      pointerType,
    );
    expect(
      await editor.getByRole("tab", { name: "Amy", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Round 1", exact: true }).waitFor();
    expect(await readView(page, game.id)).toEqual(before);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  320, 768,
])("restores exact counters and Player focus at %s px, saves a numeric correction, and preserves the separate next-Round draft", async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { game, players } = await seedGame(page);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    await add.getByRole("button", { name: "Passed", exact: true }).click();
    await add.getByRole("button", { name: "Add 5 points (+5)", exact: true }).click();
    await add.getByRole("tab", { name: "Cam", exact: true }).click();
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Round 1", exact: true }).click();
    const editAction = page.getByRole("button", { name: "Edit Round 1 for Bob", exact: true });
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    if (width === 320) {
      await holdScorecard(
        page,
        page
          .locator(".scoreboard-cell")
          .filter({ has: editAction })
          .locator(".scoreboard-entry__phase"),
        editor.getByRole("tab", { name: "Bob", exact: true }),
      );
    } else {
      await editAction.press("Enter");
    }
    await expect
      .poll(() =>
        editor.getByRole("tab", { name: "Bob", exact: true }).getAttribute("aria-selected"),
      )
      .toBe("true");
    await expect
      .poll(() =>
        editor
          .getByRole("tab", { name: "Bob", exact: true })
          .evaluate((tab) => tab === document.activeElement),
      )
      .toBe(true);
    expect(
      await editor
        .getByRole("button", { name: /Add 10 points/ })
        .getAttribute("aria-describedby")
        .then((id) => editor.locator(`[id="${id}"]`).innerText()),
    ).toContain("Used 5 times");
    await editor.getByRole("tab", { name: "Amy", exact: true }).click();
    for (const name of [/Add 5 points/, /Add 10 points/, /Add 15 points/, /Add 25 points/]) {
      const id = await editor.getByRole("button", { name }).getAttribute("aria-describedby");
      expect(await editor.locator(`[id="${id}"]`).innerText()).toContain("Used 1 time");
    }
    await editor.getByRole("button", { name: /Add 5 points/ }).click();
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog", { name: "Edit round", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Edit game", exact: true }).click();
    await page.getByRole("tab", { name: "Players", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    expect(
      await add.getByRole("tab", { name: "Cam", exact: true }).getAttribute("aria-selected"),
    ).toBe("true");
    await add.getByRole("tab", { name: "Amy", exact: true }).click();
    expect(
      await add.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    const id = await add
      .getByRole("button", { name: /Add 5 points/ })
      .getAttribute("aria-describedby");
    expect(await add.locator(`[id="${id}"]`).innerText()).toContain("Used 1 time");
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    const view = await readView(page, game.id);
    expect(view.rounds[0].source.scores[0]).toMatchObject({
      playerId: players[0].id,
      score: 60,
      pointsCardBreakdown: { p5: 2, p10: 1, skipCard: 1, wild: 1 },
    });
    expect(view.players.map((player) => player.tiebreakerTotal)).toEqual([60, 75, 100]);
  } finally {
    await page.close();
  }
}, 60_000);

it("preserves consequential drafts through safe dismissal and failed saves, then hands off to completion one popup at a time", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { game, players } = await seedGame(page, 2);
    await addFailedRound(page, game.id, players);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Round 2", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 2 for Amy", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy", exact: true }).click();
    const impact = page.getByRole("dialog", { name: "Edit round", exact: true });
    for (const dismissal of ["Edit", "Escape", "outside"] as const) {
      await editor.getByRole("button", { name: "Save round", exact: true }).click();
      await impact.getByText("This edit will change game results.", { exact: true }).waitFor();
      expect(await impact.getByRole("button").allTextContents()).toEqual(["Edit", "Save"]);
      const box = await impact.locator(".dialog-panel").boundingBox();
      expect(box?.width).toBeLessThanOrEqual(384);
      await expect
        .poll(() =>
          impact
            .getByRole("button", { name: "Edit", exact: true })
            .evaluate((button) => button === document.activeElement),
        )
        .toBe(true);
      if (dismissal === "Edit")
        await impact.getByRole("button", { name: "Edit", exact: true }).click();
      else if (dismissal === "Escape") await page.keyboard.press("Escape");
      else await page.mouse.click(1, 1);
      await impact.waitFor({ state: "detached" });
      expect(
        await editor
          .getByRole("button", { name: "Passed", exact: true })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect((await readView(page, game.id)).rounds[1].source.scores[0].phaseStatus).toBe("failed");
    }
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await impact.getByRole("button", { name: "Save", exact: true }).waitFor();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Correction write failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    await impact.getByRole("button", { name: "Save", exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect
      .poll(() => impact.getByRole("button", { name: "Save", exact: true }).isDisabled())
      .toBe(true);
    await page.keyboard.press("Escape");
    expect(await impact.locator(".dialog-panel").isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await impact.waitFor({ state: "detached" });
    await editor.getByRole("alert").waitFor();
    expect(await editor.getByRole("alert").innerText()).toContain("Correction write failed");
    expect((await readView(page, game.id)).rounds[1].source.scores[0].phaseStatus).toBe("failed");
    expect(
      await editor
        .getByRole("button", { name: "Passed", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await impact.getByRole("button", { name: "Save", exact: true }).click();
    const choice = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await choice.getByRole("button", { name: "Keep playing", exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect((await readView(page, game.id)).rounds[1].source.scores[0].phaseStatus).toBe(
      "completed",
    );
    await page.reload();
    await choice.getByRole("button", { name: "Keep playing", exact: true }).click();
    await choice.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Round 2", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 2 for Bob", exact: true }).click();
    await editor.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Bob", exact: true }).click();
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await impact.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect((await readView(page, game.id)).game.status).toBe("completed");
    await page.reload();
    await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: /Edit Round/ }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 90_000);

it("mutes retained entries and revalidates an ineligible draft winner without losing their values when a correction is reversed", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { game, players } = await seedGame(page, 2);
    await addFailedRound(page, game.id, players);
    await addFailedRound(page, game.id, players);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    await page.getByRole("button", { name: "Add round 4", exact: true }).click();
    await add.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy", exact: true }).click();
    for (const player of players.slice(1)) {
      await add.getByRole("tab", { name: player.name, exact: true }).click();
      await add.getByRole("button", { name: "Failed", exact: true }).click();
    }
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Round 2", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 2 for Amy", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy", exact: true }).click();
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit round", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const choice = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await choice.getByRole("button", { name: "Keep playing", exact: true }).click();
    await choice.waitFor({ state: "detached" });
    const retained = page.getByText("Retained entry, not counted.", { exact: true });
    expect(await retained.count()).toBe(1);
    expect(
      await retained.evaluate((label) => {
        const cell = label.closest(".scoreboard-cell");
        if (!cell) throw new Error("Missing retained scorecard cell.");
        return Number(getComputedStyle(cell).opacity);
      }),
    ).toBeLessThan(1);
    const corrected = await readView(page, game.id);
    expect(corrected.rounds[2].scores.map((entry) => entry.counted)).toEqual([false, true, true]);
    expect(corrected.rounds[2].source.scores[0].score).toBe(100);

    await page.getByRole("button", { name: "Add round 4", exact: true }).click();
    await add.getByRole("alert").waitFor();
    expect(await add.getByRole("alert").innerText()).toContain(
      "selected Round Winner is no longer playing",
    );
    expect(await add.getByRole("button", { name: "Save round", exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await add.getByRole("tab", { name: "Amy", exact: true }).count()).toBe(0);
    expect(await add.getByRole("tabpanel").count()).toBe(1);
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Round 2", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 2 for Amy", exact: true }).click();
    await editor.getByRole("button", { name: "Failed", exact: true }).click();
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit round", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit round", exact: true })
      .waitFor({ state: "detached" });
    await editor.waitFor({ state: "detached" });
    expect(await retained.count()).toBe(0);
    await page.getByRole("button", { name: "Add round 4", exact: true }).click();
    await add.getByRole("tab", { name: "Amy", exact: true }).click();
    expect(await add.getByRole("button", { name: /Round Winner Amy/ }).count()).toBe(1);
    expect(
      await add.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(await add.getByRole("button", { name: "Save round", exact: true }).isDisabled()).toBe(
      false,
    );
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Add round 4", exact: true }).waitFor();
    const restored = await readView(page, game.id);
    expect(restored.rounds[2].scores.map((entry) => entry.counted)).toEqual([true, true, true]);
    expect(restored.rounds[2].source.scores[0].score).toBe(100);
  } finally {
    await page.close();
  }
}, 60_000);

it("allows correcting an excluded Rounds Won entry without inventing a winner for counted Sit Out entries", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { players } = await seedGame(page);
    const gameId = await page.evaluate<string>(`
      (async () => {
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
        const ids = ${JSON.stringify(players.map((player) => player.id))};
        const game = await gamesApi.create({
          players: ids,
          phaseSet: { id: "two", type: "temporary", name: "Two", phases: ["classic-1", "classic-2"] },
          settings: { tiebreaker: "roundsWon", roundSkipPenalty: 100, sitOutPenalty: 50 }
        });
        for (const winner of [ids[1], ids[0], null]) {
          await roundsApi.add({
            gameId: game.id, roundWinnerId: winner,
            scores: ids.map((playerId) => ({
              playerId, score: 0,
              phaseStatus: winner === null ? "satOut" : playerId === winner ? "completed" : "failed"
            }))
          });
        }
        const editor = await gamesApi.getRoundEditor(game.id, 1);
        await gamesApi.editRound({
          gameId: game.id, roundNumber: 1, version: editor.version,
          roundWinnerId: ids[1], confirmImpact: true,
          scores: editor.round.scores.map((score) =>
            score.playerId === ids[0] ? { ...score, phaseStatus: "completed" } : score
          )
        });
        const pending = (await gamesApi.getView(game.id)).pendingFinishChoice;
        await gamesApi.resolveFinishChoice(game.id, "continue", pending.token);
        return game.id;
      })()
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${gameId}`);
    await page.getByRole("button", { name: "Round 3", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 3 for Amy", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: "Failed", exact: true }).click();
    await editor.getByRole("tab", { name: "Bob", exact: true }).click();
    await editor.getByRole("button", { name: "Failed", exact: true }).click();
    await editor.getByRole("button", { name: /Round Winner/ }).click();
    expect(
      await page.getByRole("option", { name: "Amy", exact: true }).getAttribute("aria-disabled"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    await editor.getByRole("button", { name: "Sat Out", exact: true }).click();
    await editor.getByRole("tab", { name: "Amy", exact: true }).click();
    expect(
      await editor
        .getByRole("button", {
          name: "Round progress: 3 of 3 required entries complete",
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(await editor.getByRole("button", { name: "Save round", exact: true }).isDisabled()).toBe(
      false,
    );
    await editor.getByRole("button", { name: "Save round", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog", { name: "Edit round", exact: true }).count()).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Add round 4", exact: true }).waitFor();
    const view = await readView(page, gameId);
    expect(view.rounds[2].source.roundWinnerId).toBeNull();
    expect(view.rounds[2].source.scores.map((score) => score.phaseStatus)).toEqual([
      "failed",
      "satOut",
      "satOut",
    ]);
    expect(view.rounds[2].scores.map((score) => score.counted)).toEqual([false, true, true]);
    expect(view.players.map((player) => player.tiebreakerTotal)).toEqual([1, 1, 0]);
  } finally {
    await page.close();
  }
}, 60_000);

it("creates selectable play, preserves per-Player Phase drafts, and reloads numbered progress and read-only settings", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    await page.evaluate(`
      (async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
        await Promise.all(["Amy", "Bob", "Cam"].map((name) =>
          playersApi.create({ name, color: "Jam", isFavorite: 1 })
        ));
        await settingsApi.setDefaultTiebreaker("fewestWilds");
      })()
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/create`);
    for (const name of ["Amy", "Bob", "Cam"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const toggle = page.getByRole("switch", { name: "In-order phases", exact: true });
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await toggle.click();
    await page.getByRole("button", { name: "Start", exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    expect(
      await page.evaluate(`
      import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
        gamesApi.getAll().then((games) => games.length))
    `),
    ).toBe(1);
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    const phase = add.getByRole("button", { name: /^Phase\b/ });
    expect((await phase.innerText()).trim()).toBe("Phase 1");
    await phase.click();
    await page.getByRole("option", { name: /^Phase 10\b/ }).click();
    await add.getByRole("button", { name: "Passed", exact: true }).click();
    await add.getByRole("tab", { name: "Bob", exact: true }).click();
    await phase.click();
    await page.getByRole("option", { name: /^Phase 7\b/ }).click();
    await add.getByRole("button", { name: "Failed", exact: true }).click();
    await add.getByRole("tab", { name: "Cam", exact: true }).click();
    await add.getByRole("button", { name: "Failed", exact: true }).click();
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Edit game", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await page.locator("dl").innerText()).toContain("In-order phases\nOff");
    expect(await page.getByRole("switch").count()).toBe(0);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).click();
    await add.getByRole("tab", { name: "Bob", exact: true }).click();
    expect((await phase.innerText()).trim()).toBe("Phase 7");
    await add.getByRole("button", { name: "Save round", exact: true }).click();
    await add.waitFor({ state: "detached" });
    const gameId = page.url().split("/").at(-1);
    if (!gameId) throw new Error("Missing created Game identity");
    await page.reload();
    await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    expect(await page.locator(".scoreboard-cell--sticky-top").first().innerText()).toContain(
      "1/10 phases",
    );
    const saved = await readView(page, gameId);
    expect(saved.rounds[0].scores.map((entry) => entry.phaseNumber)).toEqual([10, 7, 1]);
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog");
    expect(
      await standings.getByRole("list").getByText("1/10 phases", { exact: true }).count(),
    ).toBe(1);
    await standings.getByRole("tab", { name: "Phases", exact: true }).click();
    expect(
      await standings.getByRole("table", { name: "Phase progress details" }).innerText(),
    ).toContain("0/10 phases");
    expect(
      await standings.getByRole("table", { name: "Phase progress details" }).innerText(),
    ).toContain("1/10 phases");
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    expect((await phase.innerText()).trim()).toBe("Phase 1");
    await phase.click();
    expect(
      await page.getByRole("option", { name: /^Phase 10\b/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    await page.keyboard.press("Escape");
    await add.getByRole("tab", { name: "Bob", exact: true }).click();
    await phase.click();
    expect(
      await page.getByRole("option", { name: /^Phase 7\b/ }).getAttribute("aria-disabled"),
    ).not.toBe("true");
    await page.keyboard.press("Escape");
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Amy", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit Round", exact: true });
    expect(await edit.getByText("Phase 10", { exact: true }).count()).toBe(1);
    expect(await edit.getByRole("button", { name: /^Phase\b/ }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("revalidates a preserved Selected Phase after correction and retains the draft through failed and duplicate saves", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    const gameId = await page.evaluate<string>(`
      (async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
        const players = await Promise.all(["Amy", "Bob", "Cam"].map((name) =>
          playersApi.create({ name, color: "Jam", isFavorite: 0 })
        ));
        const game = await gamesApi.create({
          players: players.map((player) => player.id),
          phaseSet: { id: "short", type: "temporary", name: "Short",
            phases: ["classic-1", "classic-1", "classic-3"] },
          settings: { inOrderPhases: false, tiebreaker: "fewestWilds",
            roundSkipPenalty: 100, sitOutPenalty: 0 }
        });
        await roundsApi.add({
          gameId: game.id, roundWinnerId: null,
          scores: players.map((player, index) => ({
            playerId: player.id, selectedPhase: index === 0 ? 3 : 1,
            phaseStatus: "failed", score: 1
          }))
        });
        return game.id;
      })()
    `);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${gameId}`);
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add Round", exact: true });
    const phase = add.getByRole("button", { name: /^Phase\b/ });
    await phase.click();
    await page.getByRole("option", { name: /^Phase 3\b/ }).click();
    await add.getByRole("button", { name: "Passed", exact: true }).click();
    for (const name of ["Bob", "Cam"]) {
      await add.getByRole("tab", { name, exact: true }).click();
      await add.getByRole("button", { name: "Failed", exact: true }).click();
    }
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await add.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Amy", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await edit.getByRole("button", { name: "Passed", exact: true }).click();
    await edit.getByRole("button", { name: "Save round", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit round", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await edit.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add round 2", exact: true }).click();
    await add.getByRole("tab", { name: "Amy", exact: true }).click();
    expect(await add.getByRole("alert").innerText()).toContain("Choose a Remaining Phase");
    const save = add.getByRole("button", { name: "Save round", exact: true });
    expect(await save.isDisabled()).toBe(true);
    expect((await phase.innerText()).trim()).toBe("Phase 3");
    expect(
      await add.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await phase.press("ArrowDown");
    await page.getByRole("listbox").press("Home");
    await page.getByRole("listbox").press("Enter");
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Selectable write failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    await save.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => save.isDisabled()).toBe(true);
    await releaseRoundStorage(page);
    await add.getByText(/Selectable write failed/).waitFor();
    expect((await phase.innerText()).trim()).toBe("Phase 1");
    expect((await readView(page, gameId)).rounds).toHaveLength(1);
    await save.click();
    await add.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 3", exact: true }).waitFor();
    const view = await readView(page, gameId);
    expect(view.rounds.map((round) => round.scores[0].phaseNumber)).toEqual([3, 1]);
    expect(view.players[0].progress.selectable?.resolvedPhases).toEqual([1, 3]);
  } finally {
    await page.close();
  }
}, 60_000);

async function addFailedRound(page: Page, gameId: string, players: Player[]) {
  await page.evaluate(`
        import("/scorekeeper/src/data/api/rounds.ts").then(({ roundsApi }) => roundsApi.add({
          gameId: ${JSON.stringify(gameId)}, roundWinnerId: null,
          scores: ${JSON.stringify(
            players.map((player) => ({
              playerId: player.id,
              phaseStatus: "failed",
              score: 100,
              pointsCardBreakdown: { p5: 0, p10: 10, skipCard: 0, wild: 0 },
            })),
          )}
        }))
      `);
}
async function seedGame(page: Page, phases = 3) {
  await page.goto(`${appUrl}#/phaseCompan10n/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  return page.evaluate<{ game: Game; players: Player[] }>(`
    (async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
      const players = await Promise.all(["Amy", "Bob", "Cam"].map((name) =>
        playersApi.create({ name, color: "Jam", isFavorite: 0 })
      ));
      const game = await gamesApi.create({
        players: players.map((player) => player.id),
        phaseSet: { id: "short", type: "temporary", name: "Short", phases: Array(${phases}).fill("classic-1") },
        settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 50 }
      });
      await roundsApi.add({
        gameId: game.id, roundWinnerId: null,
        scores: [
          { playerId: players[0].id, phaseStatus: "completed", score: 55, pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 1, wild: 1 } },
          { playerId: players[1].id, phaseStatus: "completed", score: 75, pointsCardBreakdown: { p5: 0, p10: 5, skipCard: 0, wild: 1 } },
          { playerId: players[2].id, phaseStatus: "failed", score: 100, pointsCardBreakdown: { p5: 0, p10: 10, skipCard: 0, wild: 0 } }
        ]
      });
      return { game, players };
    })()
  `);
}

function readView(page: Page, gameId: string) {
  return page.evaluate<GameReadModel>(`
    import("/scorekeeper/src/data/api/games.ts").then(({ gamesApi }) =>
      gamesApi.getView(${JSON.stringify(gameId)})
    )
  `);
}

it("confirms middle-Round deletion once, preserves canceled and failed editor drafts, and reloads only the surviving history", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { game, players } = await seedGame(page);
    await addFailedRound(page, game.id, players);
    await addFailedRound(page, game.id, players);
    const before = await readView(page, game.id);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Round 2", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 2 for Amy", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: "Passed", exact: true }).click();
    const remove = editor.getByRole("button", { name: "Delete Round", exact: true });
    const removeBox = await remove.boundingBox();
    const closeBox = await editor.getByRole("button", { name: "Close", exact: true }).boundingBox();
    expect(removeBox?.y).toBe(closeBox?.y);
    expect(removeBox?.x).toBeLessThan(closeBox?.x ?? 0);
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    for (const dismissal of ["Cancel", "Escape", "outside"] as const) {
      await remove.click();
      await confirmation
        .getByText("Delete Round 2? This cannot be undone.", { exact: true })
        .waitFor();
      expect(await confirmation.getByRole("button").allTextContents()).toEqual([
        "Cancel",
        "Delete",
      ]);
      await expect
        .poll(() =>
          confirmation
            .getByRole("button", { name: "Cancel", exact: true })
            .evaluate((button) => button === document.activeElement),
        )
        .toBe(true);
      if (dismissal === "Cancel") {
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      } else if (dismissal === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await page.mouse.click(1, 1);
      }
      await confirmation.waitFor({ state: "detached" });
      expect(
        await editor
          .getByRole("button", { name: "Passed", exact: true })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(await readView(page, game.id)).toEqual(before);
    }
    await remove.click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).waitFor();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Deletion write failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect
      .poll(() => confirmation.getByRole("button", { name: "Delete", exact: true }).isDisabled())
      .toBe(true);
    await page.keyboard.press("Escape");
    expect(await confirmation.locator(".dialog-panel").isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await confirmation.waitFor({ state: "detached" });
    await editor.getByRole("alert").waitFor();
    expect(await editor.getByRole("alert").innerText()).toContain("Deletion write failed");
    expect(
      await editor
        .getByRole("button", { name: "Passed", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(await readView(page, game.id)).toEqual(before);
    await remove.click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await editor.waitFor({ state: "detached" });
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Add round 3", exact: true }).waitFor();
    const after = await readView(page, game.id);
    expect(after.rounds.map((round) => round.source)).toEqual([
      before.rounds[0].source,
      { ...before.rounds[2].source, roundNumber: 2 },
    ]);
    await page.getByRole("button", { name: "Add round 3", exact: true }).click();
    expect(
      await page
        .getByRole("dialog", { name: "Add Round", exact: true })
        .getByRole("button", { name: "Delete Round", exact: true })
        .count(),
    ).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it("deletes the only saved Round without deleting its Game and reloads an empty Round 1", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    const { game } = await seedGame(page);
    await page.goto(`${appUrl}#/phaseCompan10n/game/${game.id}`);
    await page.getByRole("button", { name: "Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Edit Round 1 for Amy", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit Round", exact: true })
      .getByRole("button", { name: "Delete Round", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Delete round", exact: true })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Edit Round", exact: true })
      .waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    expect(await readView(page, game.id)).toMatchObject({
      game: { id: game.id, status: "active", players: game.players, settings: game.settings },
      rounds: [],
      nextRoundNumber: 1,
      players: [
        { progress: { currentPhase: 1 }, tiebreakerTotal: 0 },
        { progress: { currentPhase: 1 }, tiebreakerTotal: 0 },
        { progress: { currentPhase: 1 }, tiebreakerTotal: 0 },
      ],
    });
  } finally {
    await page.close();
  }
}, 30_000);
