/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import { touchGesture } from "../../test/touchGesture";

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

async function openGame(page: Page, kind: "generic" | "phase10", playerCount = 2, roundCount = 2) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
    const players = [];
    for (let index = 0; index < ${playerCount}; index++) {
      players.push(await playersApi.create({ name: "Player " + index, color: "Jam", isFavorite: 0 }));
    }
    const game = ${JSON.stringify(kind)} === "generic"
      ? await genericGamesApi.create({
          players: players.map(player => player.id),
          firstDealer: { type: "player", playerId: players[0].id },
          settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
        })
      : await gamesApi.create({
          players: players.map(player => player.id),
          phaseSet: { id: "short", type: "temporary", name: "Short", phases: Array(10).fill("classic-1") },
          settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
        });
    for (let round = 1; round <= ${roundCount}; round++) {
      if (${JSON.stringify(kind)} === "generic") {
        await genericRoundsApi.add({
          gameId: game.id, mode: "points",
          scores: players.map(player => ({ playerId: player.id, points: String(round * 5) })),
        });
      } else {
        await roundsApi.add({
          gameId: game.id, roundWinnerId: null,
          scores: players.map(player => ({
            playerId: player.id, phaseStatus: "failed", score: 50 + (round % 10) * 5,
            pointsCardBreakdown: { p5: 10 - (round % 10), p10: round % 10, skipCard: 0, wild: 0 },
          })),
        });
      }
    }
    return game.id;
  })()`);
  const route = kind === "generic" ? "scorekeeper" : "phaseCompan10n";
  await page.goto(`${appUrl}#/${route}/game/${gameId}`);
  await roundControl(page, kind).waitFor();
  return gameId;
}

function roundControl(page: Page, kind: "generic" | "phase10", round = 1) {
  return page.getByRole("button", {
    name: kind === "generic" ? `Expand Round ${round}` : `Round ${round}`,
    exact: true,
    includeHidden: true,
  });
}

function readRounds(page: Page, kind: "generic" | "phase10", gameId: string) {
  return page.evaluate<{ roundNumber: number; id: string }[]>(`(async () => {
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    return ${JSON.stringify(kind)} === "generic"
      ? genericRoundsApi.getByGameId(${JSON.stringify(gameId)})
      : (await gamesApi.getView(${JSON.stringify(gameId)})).rounds.map(round => round.source);
  })()`);
}

async function dragMouse(page: Page, target: Locator, distance: number, release = true) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Missing Round target");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 6 });
  if (release) await page.mouse.up();
}

async function waitForRestingAction(trash: Locator) {
  await expect
    .poll(() => trash.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(64);
}

it.each([
  "generic",
  "phase10",
] as const)("smoothly closes a sub-half-width %s reveal instead of latching it open", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const control = roundControl(page, kind);
    const before = await control.boundingBox();
    if (!before) throw new Error("Missing Round bounds");
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await dragMouse(page, control, 20, false);
    await trash.waitFor();
    await control.evaluate((element) => {
      document.addEventListener(
        "pointerup",
        () => element.setAttribute("data-release-x", String(element.getBoundingClientRect().x)),
        { once: true },
      );
    });
    await page.mouse.up();
    expect(Number(await control.getAttribute("data-release-x"))).toBeCloseTo(before.x + 20, 0);
    await page.locator(".scorecard-row-action").waitFor({ state: "detached" });
    expect((await control.boundingBox())?.x).toBeCloseTo(before.x, 0);

    expect(await page.getByRole("dialog", { name: "Delete round", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("keeps the %s deletion target revealed until confirmation is canceled", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const control = roundControl(page, kind);
    const before = await control.boundingBox();
    if (!before) throw new Error("Missing Round bounds");
    const rowTrash = page.locator(".scorecard-row-action");
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    const fullWidth = await page
      .getByRole("region", { name: "Scoreboard", exact: true })
      .evaluate((element) => element.clientWidth);
    await dragMouse(page, control, 20, false);
    const shortStarted = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await rowTrash.waitFor({ state: "detached" });
    const shortDuration = (await page.evaluate(() => performance.now())) - shortStarted;

    for (const distance of [150, 55]) {
      await dragMouse(page, control, distance);
      if (distance === 55) {
        await waitForRestingAction(
          page.getByRole("button", { name: "Delete Round 1", exact: true }),
        );
        await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
      }
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
      expect(await rowTrash.count()).toBe(1);
      expect((await rowTrash.boundingBox())?.width).toBeLessThan(fullWidth);
      await expect
        .poll(() => rowTrash.evaluate((element) => element.getBoundingClientRect().width))
        .toBeCloseTo(fullWidth, 0);
      expect((await control.boundingBox())?.x).toBeGreaterThan(before.x + 32);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      expect(await rowTrash.count()).toBe(1);
      await control.evaluate((element) => {
        let maximum = element.getBoundingClientRect().x;
        const row = element.closest("[data-scorecard-round]");
        if (!row) throw new Error("Missing saved Round");
        function sample() {
          maximum = Math.max(maximum, element.getBoundingClientRect().x);
          element.setAttribute("data-cancel-max-x", String(maximum));
          if (row?.querySelector(".scorecard-row-action")) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      const closeStarted = await page.evaluate(() => performance.now());
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await control.boundingBox())?.x).toBeGreaterThan(before.x);
      await rowTrash.waitFor({ state: "detached" });
      const closeDuration = (await page.evaluate(() => performance.now())) - closeStarted;
      expect(closeDuration).toBeGreaterThan(shortDuration * 2);
      expect((await control.boundingBox())?.x).toBeCloseTo(before.x, 0);
      expect(Number(await control.getAttribute("data-cancel-max-x"))).toBeLessThanOrEqual(
        before.x + fullWidth + 1,
      );
    }
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  ["generic", 150],
  ["phase10", 150],
  ["generic", -150],
  ["phase10", -150],
] as const)(
  "retains the %s confirmation row and animated Cancel after a viewport change from %i px",
  async (kind, distance) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    try {
      const gameId = await openGame(page, kind, 8);
      const before = await readRounds(page, kind, gameId);
      const root = page.getByRole("region", {
        name: "Scoreboard",
        exact: true,
        includeHidden: true,
      });
      if (distance < 0) {
        await root.evaluate(
          (element) =>
            new Promise<void>((resolve) => {
              element.addEventListener("scrollend", () => resolve(), { once: true });
              element.scrollLeft = element.scrollWidth;
            }),
        );
      }
      const width = await root.evaluate((element) => element.clientWidth);
      await dragMouse(page, roundControl(page, kind), distance);
      const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
      const cancel = confirmation.getByRole("button", { name: "Cancel", exact: true });
      await cancel.waitFor();
      const trash = page.locator(".scorecard-row-action");
      await page.setViewportSize({ width: 844, height: 390 });
      expect(await trash.count()).toBe(1);
      await roundControl(page, kind).evaluate((element) => {
        const row = element.closest("[data-scorecard-round]");
        function sample() {
          const action = row?.querySelector(".scorecard-row-action");
          if (!action) return;
          element.setAttribute(
            "data-cancel-last-width",
            String(action.getBoundingClientRect().width),
          );
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await cancel.click();
      await expect
        .poll(() => root.evaluate((element) => element.clientWidth))
        .toBeGreaterThan(width);
      expect(await trash.count()).toBe(1);
      await trash.waitFor({ state: "detached" });
      const lastWidth = await roundControl(page, kind).getAttribute("data-cancel-last-width");
      expect(lastWidth).not.toBeNull();
      expect(Number(lastWidth)).toBeLessThanOrEqual(1);
      expect(await confirmation.count()).toBe(0);
      expect(await readRounds(page, kind, gameId)).toEqual(before);
    } finally {
      await page.close();
    }
  },
  45_000,
);

it.each([
  "generic",
  "phase10",
] as const)("slides surviving %s rows upward only after successful deletion", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind, 2, 3);
    const saved = await readRounds(page, kind, gameId);
    const upcoming = page.getByRole("button", {
      name: kind === "generic" ? "Add Round" : "Add round 4",
      exact: true,
      includeHidden: true,
    });
    const upcomingBefore = await upcoming.boundingBox();
    const survivor = await page.locator('[data-scorecard-round="3"]').elementHandle();
    if (!survivor) throw new Error("Missing surviving Round");
    const before = await survivor.boundingBox();
    const deleted = await page.locator('[data-scorecard-round="1"]').boundingBox();
    if (!before || !deleted || !upcomingBefore) throw new Error("Missing Round bounds");
    await survivor.evaluate((element) => {
      const observer = new MutationObserver(() => {
        const root = element.closest(".scoreboard-scroller");
        for (const animation of root?.getAnimations({ subtree: true }) ?? []) animation.pause();
      });
      observer.observe(element, { attributes: true, attributeFilter: ["data-scorecard-round"] });
    });
    await dragMouse(page, roundControl(page, kind), 150);
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await expect.poll(() => survivor.getAttribute("data-scorecard-round")).toBe("2");
    expect(await survivor.evaluate((element) => element.getAnimations().length)).toBe(1);
    expect((await survivor.boundingBox())?.y).toBeCloseTo(before.y, 0);
    const nextUpcoming = page.getByRole("button", {
      name: kind === "generic" ? "Add Round" : "Add round 3",
      exact: true,
    });
    expect((await nextUpcoming.boundingBox())?.y).toBeCloseTo(upcomingBefore.y, 0);
    await survivor.evaluate((element) => {
      const root = element.closest(".scoreboard-scroller");
      for (const animation of root?.getAnimations({ subtree: true }) ?? []) animation.finish();
    });
    expect((await survivor.boundingBox())?.y).toBeCloseTo(before.y - deleted.height, 0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await dragMouse(page, roundControl(page, kind), 150);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    expect(await readRounds(page, kind, gameId)).toEqual([{ ...saved[2], roundNumber: 1 }]);
    const remaining = page.locator('[data-scorecard-round="1"]');
    expect(await remaining.evaluate((element) => element.getAnimations().length)).toBe(0);
    expect((await remaining.boundingBox())?.y).toBeCloseTo(deleted.y, 0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("slides the whole %s Round continuously without a minimum-width reveal jump", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const control = roundControl(page, kind);
    const entry =
      kind === "generic"
        ? page.getByRole("cell", { name: "Player 0, Round 1: 5 Points, Dealer", exact: true })
        : scroller.locator(".scoreboard-entry__phase").first();
    const header = scroller.locator(".scoreboard-cell--sticky-corner");
    const before = await control.boundingBox();
    const entryBounds = await entry.boundingBox();
    const headerBefore = await header.boundingBox();
    if (!before || !entryBounds || !headerBefore) throw new Error("Missing scorecard bounds");
    await dragMouse(page, entry, -24, false);
    await expect
      .poll(() => control.evaluate((element) => element.getBoundingClientRect().x))
      .toBeCloseTo(before.x - 24, 0);
    expect((await entry.boundingBox())?.x).toBeCloseTo(entryBounds.x - 24, 0);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await expect
      .poll(() => trash.evaluate((element) => element.getBoundingClientRect().width))
      .toBeCloseTo(24, 0);
    expect((await header.boundingBox())?.x).toBeCloseTo(headerBefore.x, 0);

    await page.mouse.move(
      entryBounds.x + entryBounds.width / 2,
      entryBounds.y + entryBounds.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();
    await page.locator(".scorecard-row-action").waitFor({ state: "detached" });
    expect((await control.boundingBox())?.x).toBeCloseTo(before.x, 0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("reserves %s wheel input for table navigation, including edge overscroll", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const root = page.getByRole("region", { name: "Scoreboard", exact: true });
    const control = roundControl(page, kind);
    const before = await control.boundingBox();
    if (!before) throw new Error("Missing Round bounds");
    const trash = page.locator(".scorecard-row-action");
    await control.hover();
    for (const delta of [-9_000, 9_000]) {
      await root.evaluate((element) => {
        element.removeAttribute("data-wheel-processed");
        element.addEventListener(
          "wheel",
          () =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => element.setAttribute("data-wheel-processed", "done")),
            ),
          { once: true },
        );
      });
      await page.mouse.wheel(delta, 0);
      await expect.poll(() => root.getAttribute("data-wheel-processed")).toBe("done");
      expect(await trash.count()).toBe(0);
      expect(await page.getByRole("dialog", { name: "Delete round", exact: true }).count()).toBe(0);
      expect((await control.boundingBox())?.x).toBeCloseTo(before.x, 0);
    }

    await dragMouse(page, control, 55);
    await waitForRestingAction(trash);
    await page.mouse.wheel(55, 0);
    await trash.waitFor({ state: "detached" });
    expect((await control.boundingBox())?.x).toBeCloseTo(before.x, 0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("preserves ordinary %s horizontal scrolling across headers and saved Rounds", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind, 12);
    const root = page.getByRole("region", { name: "Scoreboard", exact: true });
    for (const target of [
      root.locator(".scoreboard-cell--sticky-corner"),
      roundControl(page, kind),
    ]) {
      await target.hover();
      for (const [start, delta, end] of [
        [80, 24, 224],
        [320, -24, 176],
      ] as const) {
        await root.evaluate(
          (element, position) =>
            new Promise<void>((resolve) => {
              const end = (event: Event) => {
                if (event.target !== element) return;
                element.removeEventListener("scrollend", end);
                resolve();
              };
              element.addEventListener("scrollend", end);
              element.scrollLeft = position;
            }),
          start,
        );
        for (let index = 0; index < 6; index++) await page.mouse.wheel(delta, 0);
        await expect.poll(() => root.evaluate((element) => element.scrollLeft)).toBe(end);
        expect(await page.getByRole("button", { name: /^Delete Round/ }).count()).toBe(0);
      }
    }
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("keeps %s wheel navigation separate from a fresh mouse row drag", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind, 8);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    await roundControl(page, kind).hover();
    await page.mouse.wheel(150, 0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^Delete Round/ }).count()).toBe(0);

    const completed = scroller.evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          const end = (event: Event) => {
            if (
              event.target !== element ||
              element.scrollWidth - element.clientWidth - element.scrollLeft > 1
            ) {
              return;
            }
            element.removeEventListener("scrollend", end);
            resolve();
          };
          element.addEventListener("scrollend", end);
        }),
    );
    await page.mouse.wheel(900, 0);
    await completed;
    expect(await page.getByRole("button", { name: /^Delete Round/ }).count()).toBe(0);

    const entry =
      kind === "generic"
        ? page.getByRole("cell", { name: "Player 7, Round 1: 5 Points", exact: true })
        : scroller.locator(".scoreboard-entry__phase").nth(7);
    await entry.hover();
    await page.mouse.wheel(55, 0);
    await dragMouse(page, entry, -55);
    await waitForRestingAction(page.getByRole("button", { name: "Delete Round 1", exact: true }));
    expect(await page.getByRole("dialog", { name: "Delete round", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("animates the %s action closed on a row tap without toggling that row", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const first = page.getByRole("button", {
      name: kind === "generic" ? /^(Expand|Collapse) Round 1$/ : /^Round 1(?:, expanded)?$/,
    });
    const second = page.getByRole("button", {
      name: kind === "generic" ? /^(Expand|Collapse) Round 2$/ : /^Round 2(?:, expanded)?$/,
    });
    const before = await first.boundingBox();
    if (!before) throw new Error("Missing Round bounds");
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });

    for (const target of [second, first]) {
      await dragMouse(page, first, 55);
      await trash.waitFor();
      await target.click();
      if (target === second) {
        expect((await first.boundingBox())?.x).toBeGreaterThan(before.x);
      }
      await trash.waitFor({ state: "detached" });
      expect(await first.getAttribute("aria-expanded")).toBe("false");
      expect(await second.getAttribute("aria-expanded")).toBe("false");
      expect((await first.boundingBox())?.x).toBeCloseTo(before.x, 0);
    }

    await second.click();
    expect(await second.getAttribute("aria-expanded")).toBe("true");
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  -1, 1,
])("keeps columns aligned when a mouse row drag retreats past zero at edge %i", async (direction) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, "generic", 8);
    const root = page.getByRole("region", { name: "Scoreboard", exact: true });
    if (direction === 1) {
      await root.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect
        .poll(() =>
          root.evaluate(
            (element) => element.scrollWidth - element.clientWidth - element.scrollLeft,
          ),
        )
        .toBeLessThanOrEqual(1);
    }
    const control = roundControl(page, "generic");
    const entry = page.getByRole("cell", {
      name:
        direction === -1 ? "Player 0, Round 1: 5 Points, Dealer" : "Player 7, Round 1: 5 Points",
      exact: true,
    });
    const before = await entry.boundingBox();
    const controlBefore = await control.boundingBox();
    if (!before || !controlBefore) throw new Error("Missing Round bounds");
    const column = await root.evaluate((element) => element.scrollLeft);
    const distance = -direction * 55;
    await dragMouse(page, entry, distance, false);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await trash.waitFor();
    await page.mouse.move(before.x + before.width / 2 - distance, before.y + before.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await trash.waitFor({ state: "detached" });
    expect((await entry.boundingBox())?.x).toBeCloseTo(before.x, 0);
    expect((await control.boundingBox())?.x).toBeCloseTo(controlBefore.x, 0);
    expect(await root.evaluate((element) => element.scrollLeft)).toBe(column);
    expect(await page.getByRole("dialog", { name: "Delete round", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 45_000);

it("keeps a wide scorecard's scroll range fixed during a full right row reveal", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, "generic", 8);
    const root = page.getByRole("region", {
      name: "Scoreboard",
      exact: true,
      includeHidden: true,
    });
    await root.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const capacity = await root.evaluate((element) => element.scrollWidth);
    const bounds = await root.boundingBox();
    if (!bounds) throw new Error("Missing scoreboard bounds");
    await dragMouse(
      page,
      page.getByRole("cell", { name: "Player 7, Round 1: 5 Points", exact: true }),
      -bounds.width,
    );
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    expect(await root.evaluate((element) => element.scrollWidth)).toBe(capacity);
    const trash = await page.locator(".scorecard-row-action").boundingBox();
    expect(trash?.x).toBeCloseTo(bounds.x + 1, 0);
    expect(trash?.width).toBeCloseTo(bounds.width - 2, 0);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("reveals mirrored %s mouse actions without overflow and confirms deletion only on release", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const cell =
      kind === "generic"
        ? page.getByRole("cell", { name: "Player 0, Round 1: 5 Points, Dealer", exact: true })
        : scroller.locator(".scoreboard-entry__phase").first();
    expect(await scroller.evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(
      true,
    );
    await dragMouse(page, cell, 55);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await waitForRestingAction(trash);
    const first = await trash.boundingBox();
    const bounds = await scroller.boundingBox();
    expect(Math.abs((first?.x ?? 0) - (bounds?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(first?.width).toBeGreaterThanOrEqual(44);
    expect(first?.height).toBeGreaterThanOrEqual(44);
    await trash.focus();
    await page.keyboard.press("Escape");
    await trash.waitFor({ state: "detached" });
    await expect
      .poll(() =>
        roundControl(page, kind).evaluate((element) => element === document.activeElement),
      )
      .toBe(true);
    await dragMouse(page, cell, 55);
    await waitForRestingAction(trash);
    await trash.click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation
      .getByText("Delete Round 1? This cannot be undone.", { exact: true })
      .waitFor();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await trash.waitFor({ state: "detached" });
    expect(await readRounds(page, kind, gameId)).toEqual(before);
    await dragMouse(page, cell, -150, false);
    expect(await confirmation.count()).toBe(0);
    await page.mouse.up();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([{ ...before[1], roundNumber: 1 }]);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("requires a fresh %s edge drag after scrolling columns and preserves vertical navigation and editing", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind, 8, 20);
    const before = await readRounds(page, kind, gameId);
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const control = roundControl(page, kind);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth - 30;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await dragMouse(page, control, -100);
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollWidth - element.clientWidth - element.scrollLeft,
        ),
      )
      .toBeLessThanOrEqual(1);
    expect(await trash.count()).toBe(0);
    const roundBounds = await control.boundingBox();
    await dragMouse(page, control, -55);
    await waitForRestingAction(trash);
    const trashBounds = await trash.boundingBox();
    const bounds = await scroller.boundingBox();
    expect(
      Math.abs(
        (trashBounds?.x ?? 0) + (trashBounds?.width ?? 0) - (bounds?.x ?? 0) - (bounds?.width ?? 0),
      ),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await scroller.hover();
    await page.mouse.wheel(0, 250);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^Delete Round/ }).count()).toBe(0);
    const header = scroller.locator(".scoreboard-cell--sticky-corner");
    expect((await header.boundingBox())?.y).toBeCloseTo((bounds?.y ?? 0) + 1, 0);
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect.poll(() => control.boundingBox()).toEqual(roundBounds);
    await touchGesture(control, [
      { x: 100, y: 100, time: 0 },
      { x: 102, y: 150, time: 100 },
      { x: 102, y: 150, time: 200 },
    ]);
    expect(await trash.count()).toBe(0);
    await control.click();
    await page
      .getByRole("button", { name: "Edit Round 1 for Player 0", exact: true })
      .press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await readRounds(page, kind, gameId)).toEqual(before);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "generic",
  "phase10",
] as const)("rejects stale %s row deletion and blocks duplicate submissions while surfacing storage failure", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const control = roundControl(page, kind);
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    async function reveal() {
      await dragMouse(page, control, 55);
      const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
      await waitForRestingAction(trash);
      await trash.click();
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    }
    await reveal();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "games") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Row deletion storage failed", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await holdRoundStorage(page);
    const remove = confirmation.getByRole("button", { name: "Delete", exact: true });
    await remove.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => remove.isDisabled()).toBe(true);
    expect(
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(await confirmation.locator(".dialog-panel").isVisible()).toBe(true);
    await releaseRoundStorage(page);
    await confirmation
      .getByRole("alert")
      .filter({ hasText: "Row deletion storage failed" })
      .waitFor();
    expect(await page.locator(".scorecard-row-action").count()).toBe(1);
    expect(await readRounds(page, kind, gameId)).toEqual(before);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });

    await page.locator(".scorecard-row-action").waitFor({ state: "detached" });
    await reveal();
    await page.evaluate(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      if (${JSON.stringify(kind)} === "generic") {
        const editor = await genericRoundsApi.getEditor(${JSON.stringify(gameId)}, ${JSON.stringify(before[1].id)});
        await genericRoundsApi.delete({ gameId: editor.round.gameId, roundId: editor.round.id, version: editor.version });
      } else {
        const editor = await gamesApi.getRoundEditor(${JSON.stringify(gameId)}, 2);
        await gamesApi.deleteRound({ gameId: editor.game.id, roundId: editor.round.id, version: editor.version });
      }
    })()`);
    await remove.click();
    await confirmation.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([before[0]]);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual([before[0]]);
  } finally {
    await releaseRoundStorage(page);
    await page.close();
  }
}, 60_000);

it("does not retarget a stale Phase 10 row to the Round that inherited its number", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, "phase10");
    const before = await readRounds(page, "phase10", gameId);
    await page.evaluate(`(async () => {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const editor = await gamesApi.getRoundEditor(${JSON.stringify(gameId)}, 1);
      await gamesApi.deleteRound({ gameId: editor.game.id, roundId: editor.round.id, version: editor.version });
    })()`);
    await dragMouse(page, roundControl(page, "phase10"), 55);
    await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    await confirmation.getByRole("alert").filter({ hasText: "Game history changed" }).waitFor();
    expect(await confirmation.getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await roundControl(page, "phase10").waitFor();
    expect(await readRounds(page, "phase10", gameId)).toEqual([{ ...before[1], roundNumber: 1 }]);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  "generic",
  "phase10",
] as const)("insets the %s trash capsule without adding a tracking minimum", async (kind) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, kind);
    const control = roundControl(page, kind);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await dragMouse(page, control, -24, false);
    const tiny = await trash.boundingBox();
    const tinySurface = await trash.locator(".scorecard-row-action__surface").boundingBox();
    if (!tiny || !tinySurface) throw new Error("Missing trash capsule");
    expect(tiny.width).toBeCloseTo(24, 0);
    expect(tinySurface.width).toBeGreaterThan(0);
    expect(tinySurface.width).toBeLessThan(tiny.width);
    await page.mouse.up();
    await trash.waitFor({ state: "detached" });

    await dragMouse(page, control, -55);
    await waitForRestingAction(trash);
    const bounds = await trash.boundingBox();
    const surface = await trash.locator(".scorecard-row-action__surface").boundingBox();
    if (!bounds || !surface) throw new Error("Missing resting trash capsule");
    expect(surface.width).toBeCloseTo(surface.height, 0);
    expect(surface.x).toBeGreaterThan(bounds.x);
    expect(surface.y).toBeGreaterThan(bounds.y);
    expect(surface.x + surface.width).toBeLessThan(bounds.x + bounds.width);
    expect(surface.y + surface.height).toBeLessThan(bounds.y + bounds.height);
    const ends = await control.evaluate((element) => {
      const row = element.closest("[data-scorecard-round]");
      if (!row) throw new Error("Missing saved Round");
      return [...row.querySelectorAll(".scoreboard-cell")]
        .filter((_cell, index, cells) => index === 0 || index === cells.length - 1)
        .map((cell) => getComputedStyle(cell).boxShadow);
    });
    expect(ends.every((shadow) => shadow !== "none")).toBe(true);
  } finally {
    await page.close();
  }
}, 45_000);

it.each([
  { kind: "generic", width: 320 },
  { kind: "phase10", width: 320 },
  { kind: "generic", width: 390 },
  { kind: "phase10", width: 390 },
  { kind: "generic", width: 768 },
  { kind: "phase10", width: 768 },
] as const)("supports mirrored touch actions, retreat and cancellation in $kind at $width px", async ({
  kind,
  width,
}) => {
  const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await openGame(page, kind);
    const before = await readRounds(page, kind, gameId);
    const control = roundControl(page, kind);
    const trash = page.getByRole("button", { name: "Delete Round 1", exact: true });
    const confirmation = page.getByRole("dialog", { name: "Delete round", exact: true });
    const scroller = page.getByRole("region", { name: "Scoreboard", exact: true });
    const bounds = await scroller.boundingBox();
    if (!bounds) throw new Error("Missing scoreboard");
    const travel = bounds.width * 0.5;
    for (const direction of [-1, 1]) {
      await touchGesture(control, [
        { x: 200, y: 150, time: 0 },
        { x: 200 + direction * 55, y: 150, time: 100 },
        { x: 200 + direction * 55, y: 150, time: 200 },
      ]);
      await waitForRestingAction(trash);
      const box = await trash.boundingBox();
      if (!box) throw new Error("Missing trash action");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeCloseTo((await control.boundingBox())?.y ?? 0, 0);
      expect(
        Math.abs(
          (direction === 1 ? box.x : box.x + box.width) -
            (direction === 1 ? bounds.x : bounds.x + bounds.width),
        ),
      ).toBeLessThanOrEqual(1);
      if (width === 320) await trash.tap();
      else await trash.press("Enter");
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      await confirmation.waitFor({ state: "detached" });
      await trash.waitFor({ state: "detached" });

      await touchGesture(
        control,
        [
          { x: 200, y: 150, time: 0 },
          { x: 200 + direction * travel, y: 150, time: 100 },
        ],
        null,
      );
      expect(await confirmation.count()).toBe(0);
      await control.dispatchEvent("touchcancel");
      await touchGesture(control, [
        { x: 200, y: 150, time: 0 },
        { x: 200 + direction * travel, y: 150, time: 100 },
        { x: 200 + direction * 30, y: 150, time: 200 },
        { x: 200 + direction * 30, y: 150, time: 300 },
      ]);
      expect(await confirmation.count()).toBe(0);
      await page.keyboard.press("Escape");
      await trash.waitFor({ state: "detached" });
    }
    await touchGesture(
      control,
      [
        { x: 200, y: 150, time: 0 },
        { x: 200 + travel, y: 150, time: 100 },
        { x: 200 + travel, y: 150, time: 200 },
      ],
      "touchcancel",
    );
    expect(await confirmation.count()).toBe(0);
    expect(await trash.count()).toBe(0);
    expect(await control.getAttribute("aria-expanded")).toBe("false");
    await touchGesture(control, [
      { x: 200, y: 150, time: 0 },
      { x: 200 + travel, y: 150, time: 100 },
      { x: 200 + travel, y: 150, time: 200 },
    ]);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await confirmation
      .getByRole("button", { name: width === 390 ? "Delete" : "Cancel", exact: true })
      .click();
    await confirmation.waitFor({ state: "detached" });
    await page.reload();
    await roundControl(page, kind).waitFor();
    expect(await readRounds(page, kind, gameId)).toEqual(
      width === 390 ? [{ ...before[1], roundNumber: 1 }] : before,
    );
  } finally {
    await page.close();
  }
}, 45_000);
