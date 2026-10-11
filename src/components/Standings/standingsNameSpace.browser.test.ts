/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { swipeTabPanel } from "../../test/swipeTabPanel";
import type { Game, GenericGame, GenericRound, Player, Round } from "../../types";
import { makePhaseGraphGame } from "./phaseGraphTestFixtures";

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

const players: Player[] = [
  { id: "amy", name: "Alexandria Montgomery", color: "Jam", isFavorite: 0, createdAt: 0 },
  { id: "bob", name: "Bartholomew Wellington", color: "Santorini", isFavorite: 0, createdAt: 0 },
  { id: "cam", name: "Christopher Worthington", color: "Spearmint", isFavorite: 0, createdAt: 0 },
];

async function seedGame(
  page: Page,
  game: Game | GenericGame,
  round: Round | GenericRound,
  identities = players,
) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  await page.evaluate(
    async ({ game, round, players }) => {
      const request = indexedDB.open("phase10-db");
      await new Promise<void>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["games", "rounds", "players"], "readwrite");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
          tx.objectStore("games").put(game);
          tx.objectStore("rounds").put(round);
          for (const player of players) {
            tx.objectStore("players").put(
              game.status === "completed" ? { ...player, name: `Renamed ${player.id}` } : player,
            );
          }
        };
      });
    },
    { game, round, players: identities },
  );
  const prefix = game.scorekeeper === "phase10" ? "phaseCompan10n/" : "scorekeeper/";
  await page.goto(`${appUrl}#/${prefix}game/${game.id}`);
  if (game.status !== "completed") {
    await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
  }
  await page.getByRole("dialog").locator(".dialog-panel").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

function textBox(locator: Locator) {
  return locator.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!text) throw new Error("Missing visible score text");
    const range = document.createRange();
    range.selectNodeContents(text);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, width: bounds.width };
  });
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Expected visible Standings content");
  return bounds;
}

// Recreate the pre-#26 row at the same width, with the same font and content.
function legacyNameWidth(name: Locator, scorekeeper: "phase10" | "generic") {
  return name.evaluate((element, scorekeeper) => {
    const row = element.parentElement;
    if (!row) throw new Error("Missing Standings row");
    const legacy = document.createElement("div");
    legacy.style.cssText = [
      "position:fixed;left:0;top:0;display:flex;align-items:center;font-size:14px",
      `width:${row.getBoundingClientRect().width}px`,
      `gap:${scorekeeper === "phase10" ? 12 : 8}px`,
    ].join(";");
    for (const child of Array.from(row.children)) {
      if (child === element) break;
      legacy.append(child.cloneNode(true));
    }
    const oldName = element.cloneNode(true);
    legacy.append(oldName);
    if (scorekeeper === "phase10") {
      const scores = document.createElement("span");
      scores.style.cssText =
        "display:grid;flex-shrink:0;grid-template-columns:3.75rem 0.5rem 4.75rem;gap:4px";
      const phase = Array.from(row.querySelectorAll("span")).find((span) =>
        /^Ph \d+$/.test(span.textContent ?? ""),
      );
      const secondary = Array.from(row.querySelectorAll("span")).find((span) =>
        /^-?\d+ (pts|wins?)$/.test(span.textContent ?? ""),
      );
      if (!phase || !secondary) throw new Error("Missing Phase or Tiebreaker");
      scores.append(
        phase.cloneNode(true),
        document.createElement("span"),
        secondary.cloneNode(true),
      );
      legacy.append(scores);
    } else {
      const scores = row.lastElementChild;
      if (!scores) throw new Error("Missing generic scores");
      legacy.append(scores.cloneNode(true));
    }
    document.body.append(legacy);
    const width = legacy.querySelector("[title]")?.getBoundingClientRect().width;
    legacy.remove();
    if (width === undefined) throw new Error("Missing legacy name");
    return width;
  }, scorekeeper);
}

async function expectFits(locator: Locator, container: Locator) {
  const bounds = await box(locator);
  const outer = await box(container);
  expect(bounds.x).toBeGreaterThanOrEqual(outer.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
}

describe.each(["light", "dark"] as const)("Standings name space in %s mode", (colorScheme) => {
  it("keeps the Phase workspace, long list, graphs and reopen navigation usable across screen sizes", async () => {
    const page = await browser.newPage({
      viewport: { width: 320, height: 568 },
      colorScheme,
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      const identities = Array.from({ length: 24 }, (_, index) => ({
        ...players[index % players.length],
        id: `player-${index}`,
        name: `Alexandria Montgomery ${index}`,
      }));
      const game = makePhaseGraphGame({
        players: identities.map((player) => player.id),
        activePlayers: identities.map((player) => player.id),
      });
      await seedGame(
        page,
        game,
        {
          gameId: game.id,
          scorekeeper: "phase10",
          roundNumber: 1,
          roundWinnerId: null,
          scores: [
            { playerId: identities[0].id, currentPhase: 1, phaseStatus: "failed", score: 0 },
            ...identities.slice(1).map((player, index) => ({
              playerId: player.id,
              currentPhase: 1,
              phaseStatus: "failed" as const,
              score: index + 1,
            })),
          ],
        },
        identities,
      );
      await page.addStyleTag({
        content:
          ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 16px; --safe-area-inset-right: 16px; }",
      });
      const dialog = page.getByRole("dialog");
      const surface = dialog.locator(".dialog-panel");
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      expect(await close.count()).toBe(1);
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 844, height: 390 },
        { width: 1280, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await expect.poll(async () => (await box(surface)).height).toBe(viewport.height - 86);
        const bounds = await box(surface);
        expect(bounds.y).toBe(36);
        expect(bounds.width).toBe(Math.min(576, viewport.width - 64));
        expect(await surface.getAttribute("data-dialog-scroll")).toBe("body");
        expect(await surface.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
          "none",
        );
        const closeBounds = await box(close);
        await dialog.getByRole("tab", { name: "Standings", exact: true }).click();
        const list = dialog.getByRole("region", { name: "Standings", exact: true });
        await list.focus();
        await page.keyboard.press("End");
        await expect
          .poll(() =>
            list.evaluate(
              (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          )
          .toBeLessThanOrEqual(1);
        const last = await box(list.getByRole("listitem").last());
        const listBounds = await box(list);
        expect(last.y + last.height).toBeLessThanOrEqual(listBounds.y + listBounds.height - 10);
        for (const [tab, label] of [
          ["Phases", "Phase progress by round"],
          ["Tiebreaker", "Tiebreaker progress by round"],
        ]) {
          await dialog.getByRole("tab", { name: tab, exact: true }).click();
          const graph = dialog.getByRole("img", { name: label, exact: true });
          expect((await box(graph)).height).toBeGreaterThan(70);
          expect(await dialog.getByRole("table").locator("tbody tr").count()).toBe(24);
          expect(await box(close)).toEqual(closeBounds);
        }
      }
      const standingsTab = dialog.getByRole("tab", { name: "Standings", exact: true });
      await standingsTab.focus();
      await page.keyboard.press("ArrowRight");
      expect(
        await dialog
          .getByRole("tab", { name: "Phases", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
      await swipeTabPanel(
        dialog.getByRole("img", { name: "Phase progress by round", exact: true }),
        "left",
      );
      await expect
        .poll(() =>
          dialog
            .getByRole("tab", { name: "Tiebreaker", exact: true })
            .getAttribute("aria-selected"),
        )
        .toBe("true");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const open = page.getByRole("button", { name: "Open Standings", exact: true });
      await expect
        .poll(() => open.evaluate((element) => document.activeElement === element))
        .toBe(true);
      await open.click();
      expect(
        await dialog
          .getByRole("tab", { name: "Standings", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
      await close.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("reclaims Phase 10 name width and aligns scores without overlapping the Finished indicator", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      const game = makePhaseGraphGame({
        players: players.map((player) => player.id),
        activePlayers: players.map((player) => player.id),
        phaseSet: {
          id: "phases",
          name: "Ten Phases",
          type: "temporary",
          phases: ["phase-1", ...Array.from({ length: 9 }, (_, index) => `phase-${index + 2}`)],
        },
      });
      await seedGame(
        page,
        {
          ...game,
          status: "completed",
          completedAt: 1,
          completionType: "normal",
          playerSnapshots: players,
          winnerIds: ["amy"],
        },
        {
          gameId: game.id,
          scorekeeper: "phase10",
          roundNumber: 1,
          roundWinnerId: "amy",
          scores: [
            { playerId: "amy", currentPhase: 10, phaseStatus: "completed", score: 1234 },
            { playerId: "bob", currentPhase: 10, phaseStatus: "failed", score: 5 },
            { playerId: "cam", currentPhase: 3, phaseStatus: "failed", score: 99 },
          ],
        },
      );
      const dialog = page.getByRole("dialog");
      const panel = dialog.getByRole("tabpanel", { name: "Standings", exact: true });
      expect(await panel.innerText()).not.toContain("\u2022");
      expect(await panel.innerText()).not.toContain("Renamed");
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        const names = players.map((player) => panel.getByTitle(player.name, { exact: true }));
        const primary = panel.getByText("Ph 10", { exact: true });
        const secondary = ["1234 pts", "5 pts", "99 pts"].map((text) =>
          panel.getByText(text, { exact: true }),
        );
        for (const name of names) {
          expect(
            (await box(name)).width - (await legacyNameWidth(name, "phase10")),
          ).toBeGreaterThan(24);
          const nameBox = await box(name);
          expect(nameBox.x + nameBox.width).toBeLessThan((await box(primary.nth(0))).x);
        }
        if (width === 320) {
          expect(
            await names[0].evaluate((element) => element.scrollWidth > element.clientWidth),
          ).toBe(true);
        }
        expect((await box(primary.nth(0))).x).toBeCloseTo((await box(primary.nth(1))).x, 1);
        expect((await box(secondary[0])).x).toBeCloseTo((await box(secondary[1])).x, 1);
        expect((await box(secondary[0])).x).toBeCloseTo((await box(secondary[2])).x, 1);
        const check = panel.getByLabel("Finished", { exact: true });
        const checkBox = await box(check);
        const scoreBox = await box(secondary[0]);
        expect(scoreBox.x - (checkBox.x + checkBox.width)).toBeGreaterThanOrEqual(4);
        expect(scoreBox.x - (checkBox.x + checkBox.width)).toBeLessThanOrEqual(8);
        for (const score of [...secondary, primary.nth(0), primary.nth(1), check]) {
          await expectFits(score, panel);
        }
        await expectFits(
          dialog.getByRole("tab", { name: "Tiebreaker", exact: true }),
          dialog.locator(".dialog-panel"),
        );
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    { tiebreaker: false, completed: false },
    { tiebreaker: false, completed: true },
    { tiebreaker: true, completed: false },
    { tiebreaker: true, completed: true },
  ])("reclaims generic name width with $tiebreaker secondary scores and completed=$completed", async ({
    tiebreaker,
    completed,
  }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      const activeGame: GenericGame = {
        id: "generic-space",
        scorekeeper: "generic",
        status: "active",
        players: players.map((player) => player.id),
        settings: {
          mode: "points",
          pointsDirection: "high",
          tiebreaker: tiebreaker ? { direction: "low" } : null,
          dealer: false,
        },
        createdAt: 0,
        lastActivityAt: 0,
      };
      await seedGame(
        page,
        completed
          ? {
              ...activeGame,
              status: "completed",
              completedAt: 1,
              completionType: "manual",
              winnerIds: ["amy"],
              playerSnapshots: players,
            }
          : activeGame,
        {
          scorekeeper: "generic",
          gameId: activeGame.id,
          roundNumber: 1,
          mode: "points",
          scores: [
            { playerId: "amy", points: 1234, ...(tiebreaker && { tiebreaker: -12345 }) },
            { playerId: "bob", points: 5, ...(tiebreaker && { tiebreaker: -2 }) },
            { playerId: "cam", points: -99, ...(tiebreaker && { tiebreaker: 0 }) },
          ],
        },
      );
      const dialog = page.getByRole("dialog");
      const list = dialog.getByRole("list", { name: "Standings places", exact: true });
      expect(await list.innerText()).not.toContain("\u2022");
      expect(await list.innerText()).not.toContain("Renamed");
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        const rows = list.getByRole("listitem");
        const primaryBoxes = [];
        const secondaryBoxes = [];
        for (const [index, player] of players.entries()) {
          const row = rows.nth(index);
          const name = row.getByTitle(player.name, { exact: true });
          expect(
            (await box(name)).width - (await legacyNameWidth(name, "generic")),
          ).toBeGreaterThan(5);
          const primary = row.getByText("Total Points:", { exact: true }).locator("..");
          expect(await primary.innerText()).toContain(["1234", "5", "-99"][index]);
          await expectFits(primary, list);
          primaryBoxes.push(await textBox(primary));
          const secondary = row.getByText("Total Tiebreaker:", { exact: true }).locator("..");
          if (tiebreaker) {
            expect(await secondary.innerText()).toContain(["-12345", "-2", "0"][index]);
            await expectFits(secondary, list);
            secondaryBoxes.push(await textBox(secondary));
          } else {
            expect(await secondary.count()).toBe(0);
            const primaryBox = await box(primary);
            const nameBox = await box(name);
            expect(primaryBox.x - (nameBox.x + nameBox.width)).toBeLessThanOrEqual(8);
          }
        }
        for (const bounds of [...primaryBoxes, ...secondaryBoxes]) {
          expect(bounds.x + bounds.width).toBeCloseTo(primaryBoxes[0].x + primaryBoxes[0].width, 1);
        }
        await expectFits(
          dialog.getByRole("button", { name: "Close", exact: true }),
          dialog.locator(".dialog-panel"),
        );
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Open Standings", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      expect(
        await page
          .getByRole("button", { name: "Open Standings", exact: true })
          .evaluate((element) => document.activeElement === element),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);
});
