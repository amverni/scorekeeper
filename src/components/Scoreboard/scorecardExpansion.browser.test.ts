/// <reference types="node" />

import { type Browser, type Locator, type Page, webkit } from "playwright";
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
  await server.environments.client.warmupRequest("/src/main.tsx");
  await server.environments.client.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it.each(
  (["generic", "phase"] as const).flatMap((scorekeeper) =>
    (["no-preference", "reduce"] as const).map((motion) => ({ scorekeeper, motion })),
  ),
)("animates $scorekeeper details in both directions with $motion motion", async ({
  scorekeeper,
  motion,
}) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: motion,
  });
  page.setDefaultTimeout(5_000);
  try {
    await openSavedGame(page, scorekeeper);
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    const cell =
      scorekeeper === "generic"
        ? card.getByRole("row").nth(1).getByRole("cell").first()
        : card.locator('[data-hold-round="1"][data-hold-player]').first();
    expect((await cell.locator(".scoreboard-extras").innerText()).trim()).toBe("");
    const opening = await sampleToggle(cell);
    expectProgress(opening, "opening", motion);
    expect((await cell.locator(".scoreboard-extras").innerText()).trim()).toBe(
      scorekeeper === "generic"
        ? "Accumulated Points: 15\nAccumulated Tiebreaker: 2"
        : "100 pts\n100 pts",
    );
    const closing = await sampleToggle(cell);
    expectProgress(closing, "closing", motion);
    expect((await cell.locator(".scoreboard-extras").innerText()).trim()).toBe("");
    expect(
      await cell
        .locator(".scoreboard-extras")
        .evaluate((element) => element instanceof HTMLElement && element.inert),
    ).toBe(true);
    expect(await cell.ariaSnapshot()).not.toContain("Accumulated");
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  "generic",
  "phase",
] as const)("reverses, switches, and dismisses %s expanded Rounds without stranded details", async (scorekeeper) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "no-preference",
    hasTouch: true,
  });
  page.setDefaultTimeout(5_000);
  try {
    await openSavedGame(page, scorekeeper);
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    const cell = card.locator('[data-hold-round="1"][data-hold-player]').first();
    const reversing = await sampleToggle(cell, 120);
    expect(reversing.at(-1)?.height).toBe(reversing[0].height);
    expect(reversing.at(-1)?.opacity).toBe(0);
    expect(Math.max(...reversing.map(({ opacity }) => opacity))).toBeGreaterThan(0.1);
    const first = roundControl(card, scorekeeper, 1);
    const second = roundControl(card, scorekeeper, 2);
    await cell.tap();
    expect(await first.getAttribute("aria-expanded")).toBe("true");
    await second.tap();
    expect(await first.getAttribute("aria-expanded")).toBe("false");
    expect(await second.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => card.locator(".scoreboard-extras--open").count()).toBe(2);
    await expect
      .poll(() =>
        cell.locator(".scoreboard-extras").evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("0");
    const details = card.locator(".scoreboard-extras--open").first();
    expect((await details.innerText()).trim()).toBe(
      scorekeeper === "generic"
        ? "Accumulated Points: 30\nAccumulated Tiebreaker: 4"
        : "100 pts\n200 pts",
    );
    await page.mouse.click(2, 2);
    expect(await second.getAttribute("aria-expanded")).toBe("false");
    expect(await card.getByRole("button", { name: /^Edit Round/ }).count()).toBe(0);
    await expect.poll(() => details.count()).toBe(0);
    await expect
      .poll(() =>
        card
          .locator(".scoreboard-extras")
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                element instanceof HTMLElement &&
                element.inert &&
                getComputedStyle(element).opacity === "0",
            ),
          ),
      )
      .toBe(true);
    await first.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Alt+Tab" : "Tab");
    expect(await second.evaluate((element) => element === document.activeElement)).toBe(true);
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  "generic",
  "phase",
] as const)("keeps %s editing focus-only and restores the identified Player action after dismissal", async (scorekeeper) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  try {
    await openSavedGame(page, scorekeeper);
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    const round = roundControl(card, scorekeeper, 1);
    const edits = card.getByRole("button", { name: /^Edit Round 1\b/ });
    expect(await edits.count()).toBe(0);
    await round.click();
    expect(await edits.count()).toBeGreaterThan(0);
    expect(await paintedActions(edits)).toBe(0);
    const bobEdit = card.getByRole("button", { name: "Edit Round 1 for Bob", exact: true });
    await round.focus();
    for (let tab = 0; tab < 4; tab++) {
      await page.keyboard.press(process.platform === "darwin" ? "Alt+Tab" : "Tab");
      if (await bobEdit.evaluate((element) => element === document.activeElement)) break;
    }
    expect(await bobEdit.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await paintedActions(bobEdit)).toBe(1);
    expect(await bobEdit.innerText()).toBe("Edit");
    expect(await bobEdit.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
      "none",
    );
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const bob = editor.getByRole("tab", { name: "Bob", exact: true });
    await expect
      .poll(() => bob.evaluate((element) => element === document.activeElement))
      .toBe(true);
    expect(await bob.getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await expect
      .poll(() => bobEdit.evaluate((element) => element === document.activeElement))
      .toBe(true);
    expect(await paintedActions(bobEdit)).toBe(1);
    await round.focus();
    expect(await paintedActions(edits)).toBe(0);
    await page.keyboard.press("Space");
    expect(await round.getAttribute("aria-expanded")).toBe("false");
    expect(await edits.count()).toBe(0);
    await page.keyboard.press("Enter");
    expect(await round.getAttribute("aria-expanded")).toBe("true");
    expect(await paintedActions(edits)).toBe(0);
  } finally {
    await page.close();
  }
}, 30_000);

function roundControl(card: Locator, scorekeeper: "generic" | "phase", number: number) {
  return card.getByRole("button", {
    name:
      scorekeeper === "generic"
        ? new RegExp(`^(Expand|Collapse) Round ${number}$`)
        : new RegExp(`^Round ${number}(, expanded)?$`),
  });
}

function paintedActions(actions: Locator) {
  return actions.evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          bounds.width > 2 &&
          bounds.height > 2 &&
          style.clip === "auto" &&
          style.visibility === "visible" &&
          Number(style.opacity) > 0
        );
      }).length,
  );
}

type Frame = { height: number; opacity: number; rowHeights: number[]; anchors: number[] };

function expectProgress(
  frames: Frame[],
  direction: "opening" | "closing",
  motion: "no-preference" | "reduce",
) {
  const closed = direction === "opening" ? frames[0] : frames.at(-1);
  const open = direction === "opening" ? frames.at(-1) : frames[0];
  if (!closed || !open) throw new Error("Missing transition samples");
  expect(open.height).toBeGreaterThan(closed.height + 10);
  expect(open.opacity).toBe(1);
  expect(closed.opacity).toBe(0);
  const intermediateHeights = frames.filter(
    (frame) => frame.height > closed.height + 1 && frame.height < open.height - 1,
  ).length;
  const intermediateOpacity = frames.filter(
    (frame) => frame.opacity > 0.02 && frame.opacity < 0.98,
  ).length;
  if (motion === "reduce") {
    expect(intermediateHeights).toBe(0);
    expect(intermediateOpacity).toBe(0);
  } else {
    expect(
      intermediateHeights,
      `${direction} must have intermediate rendered row heights`,
    ).toBeGreaterThan(1);
    expect(
      intermediateOpacity,
      `${direction} must have intermediate rendered detail opacity`,
    ).toBeGreaterThan(1);
  }
  for (const frame of frames) {
    for (const height of frame.rowHeights) expect(height).toBeCloseTo(frame.height, 1);
    for (const [index, value] of frame.anchors.entries()) {
      expect(value).toBeCloseTo(frames[0].anchors[index], 1);
    }
  }
}

function sampleToggle(cell: Locator, reverseAfter: number | null = null) {
  return cell.evaluate(async (element, reverseAfter) => {
    const card = element.closest(".scoreboard");
    if (!card) throw new Error("Missing scorecard");
    const round = (element as HTMLElement).dataset.actionRound;
    const row = Array.from(card.querySelectorAll(`[data-action-round="${round}"]`));
    const anchors = [
      ...element.querySelectorAll(
        ".scoreboard-entry__value, .scoreboard-entry__dealer, .scoreboard-entry__result",
      ),
      ...card.querySelectorAll(".scoreboard-cell--sticky-top"),
      ...row[0].querySelectorAll("button > span"),
    ];
    const sample = () => {
      const details = element.querySelector(".scoreboard-extras");
      return {
        height: element.getBoundingClientRect().height,
        opacity: details ? Number(getComputedStyle(details).opacity) : 0,
        rowHeights: row.map((cell) => cell.getBoundingClientRect().height),
        anchors: anchors.flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          return [bounds.x, bounds.y];
        }),
      };
    };
    const frames = [sample()];
    (element as HTMLElement).click();
    const start = performance.now();
    let reversed = false;
    while (performance.now() - start < 550) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push(sample());
      if (reverseAfter !== null && !reversed && performance.now() - start >= reverseAfter) {
        (element as HTMLElement).click();
        reversed = true;
      }
    }
    return frames;
  }, reverseAfter);
}

async function openSavedGame(page: Page, scorekeeper: "generic" | "phase") {
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  const id = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const players = await Promise.all(["Amy", "Bob"].map((name) =>
      playersApi.create({ name, color: "Jam", isFavorite: 0 })));
    const ids = players.map(({ id }) => id);
    if (${JSON.stringify(scorekeeper)} === "generic") {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.create({
        players: ids, firstDealer: { type: "player", playerId: ids[0] },
        settings: { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: true },
      });
      for (let round = 0; round < 2; round++) {
        await genericRoundsApi.add({ gameId: game.id, mode: "points",
          scores: ids.map((playerId) => ({ playerId, points: "15", tiebreaker: "2" })) });
      }
      return game.id;
    }
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
    const game = await gamesApi.create({
      players: ids, firstDealer: { type: "player", playerId: ids[0] },
      phaseSet: { id: "short", type: "temporary", name: "Short", phases: Array(3).fill("classic-1") },
      settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 50 },
    });
    for (let round = 0; round < 2; round++) {
      await roundsApi.add({ gameId: game.id, roundWinnerId: null,
        scores: ids.map((playerId) => ({ playerId, phaseStatus: "failed", score: 100,
          pointsCardBreakdown: { p5: 0, p10: 10, skipCard: 0, wild: 0 } })) });
    }
    return game.id;
  })()`);
  await page.goto(
    `${appUrl}#/${scorekeeper === "generic" ? "scorekeeper" : "phaseCompan10n"}/game/${id}`,
  );
  await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return id;
}
