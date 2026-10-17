/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { touchGesture } from "../../../test/touchGesture";

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

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function visitModal(page: Page, trigger: Locator) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  const background = page.locator(".page-shell-main");
  const scrollTop = await background.evaluate((element) => element.scrollTop);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.waitFor();
  await settle(page);
  expect(await close.count()).toBe(1);
  const closeBounds = await close.boundingBox();
  expect(closeBounds?.width).toBe(44);
  expect(closeBounds?.height).toBe(44);
  expect((await dialog.locator("header").boundingBox())?.height).toBe(60);
  const panel = dialog.locator(".dialog-panel");
  const bounds = await panel.boundingBox();
  if (!bounds) throw new Error("Missing modal surface");
  expect(bounds.x).toBeGreaterThanOrEqual(16);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(374);
  expect(bounds.y).toBeGreaterThanOrEqual(63);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(794);
  expect(bounds.x + bounds.width / 2).toBeCloseTo(195, 0);
  expect(bounds.y + bounds.height / 2).toBeCloseTo(428.5, 0);
  const title = dialog.locator("header").getByRole("heading").and(page.locator(":not(.sr-only)"));
  if (await title.count()) {
    const textBounds = await title.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const { x, width } = range.getBoundingClientRect();
      return { x, width };
    });
    expect(textBounds.x + textBounds.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0);
  }
  const appearance = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      surface: style.backgroundColor,
      app: getComputedStyle(document.body).backgroundColor,
      filter: style.backdropFilter,
      corners: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomLeftRadius,
        style.borderBottomRightRadius,
      ],
    };
  });
  expect(appearance.surface).toBe(appearance.app);
  expect(appearance.filter).toBe("none");
  expect(appearance.corners).toEqual(["16px", "16px", "16px", "16px"]);
  const backdrop = await dialog.locator(".dialog-backdrop").evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.backgroundColor, filter: style.backdropFilter };
  });
  expect(backdrop.color).toBe("rgba(0, 0, 0, 0)");
  expect(backdrop.filter).toContain("blur(");
  expect(await page.locator("#root").getAttribute("inert")).not.toBeNull();
  expect(await background.evaluate((element) => element.scrollTop)).toBe(scrollTop);

  await touchGesture(
    dialog.locator("header"),
    [
      { y: 100, time: 0 },
      { y: 160, time: 100 },
      { y: 160, time: 150 },
    ],
    "touchcancel",
  );
  await settle(page);
  expect(await panel.boundingBox()).toEqual(bounds);
  await close.click();
  await dialog.waitFor({ state: "detached" });
  await expect.poll(() => page.locator("#root").getAttribute("inert")).toBeNull();
  await expect.poll(() => background.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await expect
    .poll(() => trigger.evaluate((element) => element === document.activeElement))
    .toBe(true);
}

it.each([
  "light",
  "dark",
] as const)("uses one floating contract across every shared consumer and returns to usable pages in %s", async (colorScheme) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme,
    reducedMotion: colorScheme === "light" ? "reduce" : "no-preference",
  });
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(60_000);
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
      },
      { once: true },
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(appUrl);
    const fixtures = await page.evaluate<{ phase: string; generic: string[] }>(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
        const maya = await playersApi.create({ name: "Maya", color: "#123456", isFavorite: 0 });
        const zoe = await playersApi.create({ name: "Zoe", color: "#abcdef", isFavorite: 0 });
        for (let index = 1; index <= 18; index++) {
          await playersApi.create({
            name: "Player " + String(index).padStart(2, "0"), color: "#123456", isFavorite: 0,
          });
        }
        const players = [maya.id, zoe.id];
        const phase = await gamesApi.create({
          players,
          phaseSet: {
            id: "cutover", type: "temporary", name: "Three phases",
            phases: ["classic-1", "classic-2", "classic-3"],
          },
          settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 0, sitOutPenalty: 0 },
        });
        await roundsApi.add({
          gameId: phase.id, roundWinnerId: maya.id,
          scores: players.map(playerId => ({ playerId, phaseStatus: "completed", score: 0 })),
        });
        const generic = [];
        for (const mode of ["points", "singleRoundWinner", "passFail"]) {
          const game = await genericGamesApi.create({
            players,
            settings: mode === "points"
              ? { mode, pointsDirection: "high", tiebreaker: null, dealer: false }
              : { mode, tiebreaker: null, dealer: false },
          });
          await genericRoundsApi.add({
            gameId: game.id, mode,
            scores: players.map((playerId, index) => mode === "points"
              ? { playerId, points: "1" }
              : mode === "singleRoundWinner"
                ? { playerId, won: index === 0 } : { playerId, passed: true }),
          });
          generic.push(game.id);
        }
        return { phase: phase.id, generic };
      })()`);
    for (const experience of ["scorekeeper", "phaseCompan10n"]) {
      await page.goto(`${appUrl}#/${experience}/players`);
      await page.getByRole("button", { name: "Zoe", exact: true }).waitFor();
      await page.locator(".page-shell-main").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await visitModal(page, page.getByRole("button", { name: "Create new player", exact: true }));
      await visitModal(page, page.getByRole("button", { name: "Zoe", exact: true }));
      await page.goto(`${appUrl}#/${experience}/create`);
      await visitModal(page, page.getByRole("button", { name: "Add Player", exact: true }));
    }

    await page.goto(`${appUrl}#/phaseCompan10n/create`);
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    for (const name of ["Add Phase", "Switch phase set", "Save phase set"]) {
      await visitModal(page, page.getByRole("button", { name, exact: true }));
    }
    await page.goto(`${appUrl}#/phaseCompan10n/phases`);
    await visitModal(page, page.getByRole("button", { name: "Original", exact: true }));
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    await visitModal(page, page.getByRole("button", { name: "2 sets of 3", exact: true }));

    await page.goto(`${appUrl}#/phaseCompan10n/game/${fixtures.phase}`);
    for (const name of ["Add round 2", "Open Standings", "Open Phases Card"]) {
      await visitModal(page, page.getByRole("button", { name, exact: true }));
    }
    for (const gameId of fixtures.generic) {
      await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
      for (const name of ["Add Round", "Open Standings"]) {
        await visitModal(page, page.getByRole("button", { name, exact: true }));
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 120_000);

it.each([
  { width: 320, height: 568 },
  { width: 1280, height: 900 },
])("keeps a long Phase Set title centered, single-line and fully named at $width px", async (viewport) => {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  try {
    await page.goto(appUrl);
    const phaseSetName = await page.evaluate<string>(`(async () => {
      const { phaseSetsApi } = await import("/scorekeeper/src/data/api/phaseSets.ts");
      const phaseSet = await phaseSetsApi.create({
        type: "saved",
        name: "Weekend Players' favorite Phase Set with a very long name ".repeat(4).trim(),
        phases: ["classic-1"],
      });
      return phaseSet.name;
    })()`);
    await page.goto(`${appUrl}#/phaseCompan10n/phases`);
    await page.getByRole("button", { name: phaseSetName, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: phaseSetName, exact: true });
    const title = dialog.getByRole("heading", { name: phaseSetName, exact: true });
    await title.waitFor();
    await settle(page);
    const panelBounds = await dialog.locator(".dialog-panel").boundingBox();
    const titleBounds = await title.boundingBox();
    const closeBounds = await dialog
      .getByRole("button", { name: "Close", exact: true })
      .boundingBox();
    if (!panelBounds || !titleBounds || !closeBounds) throw new Error("Missing title geometry");
    expect(titleBounds.x + titleBounds.width / 2).toBeCloseTo(
      panelBounds.x + panelBounds.width / 2,
      0,
    );
    expect(titleBounds.x + titleBounds.width).toBeLessThanOrEqual(closeBounds.x - 12);
    const layout = await title.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        align: style.textAlign,
        overflow: style.overflow,
        ellipsis: style.textOverflow,
        whiteSpace: style.whiteSpace,
        lineHeight: Number.parseFloat(style.lineHeight),
        truncated: element.scrollWidth > element.clientWidth,
      };
    });
    expect(layout).toMatchObject({
      align: "center",
      overflow: "hidden",
      ellipsis: "ellipsis",
      whiteSpace: "nowrap",
      truncated: true,
    });
    expect(titleBounds.height).toBeCloseTo(layout.lineHeight, 0);
    expect((await dialog.locator("header").boundingBox())?.height).toBe(60);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  } finally {
    await page.close();
  }
}, 30_000);

it("keeps an existing static title on one line in a compact modal", async () => {
  const page = await browser.newPage({
    viewport: { width: 280, height: 568 },
    reducedMotion: "reduce",
  });
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/create`);
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    await page.getByRole("button", { name: "Save phase set", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save phase set", exact: true });
    const title = dialog.getByRole("heading", { name: "Save phase set", exact: true });
    await title.waitFor();
    await settle(page);
    expect((await dialog.locator("header").boundingBox())?.height).toBe(60);
    expect(
      await title.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflow: style.overflow,
          ellipsis: style.textOverflow,
          whiteSpace: style.whiteSpace,
          truncated: element.scrollWidth > element.clientWidth,
        };
      }),
    ).toEqual({
      overflow: "hidden",
      ellipsis: "ellipsis",
      whiteSpace: "nowrap",
      truncated: true,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  } finally {
    await page.close();
  }
}, 30_000);
