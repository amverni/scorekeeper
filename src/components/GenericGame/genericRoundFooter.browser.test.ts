/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { touchGesture } from "../../test/touchGesture";
import { setVisibleViewport } from "../../test/visualViewport";
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

const longErrorSettings = [
  { mode: "passFail", tiebreaker: null, dealer: false },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: false },
] satisfies GenericGameSettings[];

it.each(
  [
    { width: 320, height: 480 },
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ].flatMap((viewport) => longErrorSettings.map((settings) => ({ ...viewport, settings }))),
)("keeps $settings.mode actions and entry usable at $width x $height when a recoverable error is longer than the dialog", async ({
  width,
  height,
  settings: gameSettings,
}) => {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  try {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
      });
    });
    const dialog = await openRound(page, gameSettings, 12);
    if (gameSettings.mode === "singleRoundWinner") {
      await dialog.getByRole("radio", { name: "Player 12", exact: true }).click();
    }
    await failNextSave(
      page,
      "Round storage unavailable. Keep this draft and try saving again. ".repeat(20),
    );
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await dialog.getByRole("alert").filter({ hasText: "Round storage unavailable" }).waitFor();
    await expectPinnedActions(dialog, 34);
    if (gameSettings.mode === "points") {
      const body = dialog.locator("[data-swipe-navigation-root]");
      expect(await body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
      const keys = dialog.getByRole("group", { name: /keypad$/ }).getByRole("button");
      const area = await body.boundingBox();
      if (!area) throw new Error("Missing numeric entry body");
      for (const key of await keys.all()) {
        const bounds = await key.boundingBox();
        if (!bounds) throw new Error("Missing numeric key");
        expect(bounds.width).toBeGreaterThanOrEqual(24);
        expect(bounds.y).toBeGreaterThanOrEqual(area.y);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height - 10);
      }
    }
    expect(await save.isEnabled()).toBe(true);
    const error = dialog.getByRole("region", { name: "Round save error", exact: true });
    expect(await error.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await error.focus();
    await page.keyboard.press("End");
    await expect.poll(() => error.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expectPinnedActions(dialog, 34);

    // A dragged dialog must carry its actions, rather than leave them fixed to the viewport.
    await dialog.locator(".dialog-panel").evaluate((element) => {
      element.style.transform = "translateY(-24px)";
    });
    await expectPinnedActions(dialog, 34);
    await dialog.locator(".dialog-panel").evaluate((element) => {
      element.style.removeProperty("transform");
    });
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openRound(page: Page, settings: GenericGameSettings, playerCount: number) {
  await page.goto(`${appUrl}#/scorekeeper`);
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const players = [];
    for (let index = 1; index <= ${playerCount}; index++) {
      const player = await playersApi.create({
        name: "Player " + index, color: "Jam", isFavorite: 0,
      });
      players.push(player.id);
    }
    return (await genericGamesApi.create({
      players, settings: ${JSON.stringify(settings)},
    })).id;
  })()`);
  await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
  await page.getByRole("button", { name: "Add Round", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
  await dialog.getByRole("button", { name: "Save", exact: true }).waitFor();
  return dialog;
}

async function expectPinnedActions(dialog: Locator, bottomInset: number) {
  const panelElement = dialog.locator(".dialog-panel");
  const whole = await panelElement.evaluate(
    (element) => getComputedStyle(element).overflowY === "auto",
  );
  if (whole) {
    await dialog.getByRole("button", { name: "Save", exact: true }).focus();
    await dialog.page().evaluate(() => new Promise(requestAnimationFrame));
  }
  const panel = await panelElement.boundingBox();
  if (!panel) throw new Error("Missing Round dialog panel");
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  expect(await close.count()).toBe(1);
  const closeBounds = await close.boundingBox();
  const save = await dialog.getByRole("button", { name: "Save", exact: true }).boundingBox();
  if (!closeBounds || !save) throw new Error("Missing Round actions");
  if (!whole) expect(closeBounds.y - panel.y).toBeCloseTo(16, 0);
  expect(panel.y + panel.height - save.y - save.height).toBeGreaterThanOrEqual(16);
  expect(panel.y + panel.height - save.y - save.height).toBeLessThanOrEqual(32);
  expect(panel.y + panel.height).toBeLessThanOrEqual(
    (dialog.page().viewportSize()?.height ?? 0) - bottomInset - 16,
  );
  if (!whole)
    expect(
      await dialog.locator(".dialog-body").evaluate((element) => ({
        overflow: element.scrollHeight - element.clientHeight,
        scrollTop: element.scrollTop,
      })),
    ).toEqual({ overflow: 0, scrollTop: 0 });
}

async function failNextSave(page: Page, message: string) {
  await page.evaluate((message) => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "rounds") {
        IDBObjectStore.prototype.add = add;
        throw new DOMException(message, "QuotaExceededError");
      }
      return add.call(this, value, key);
    };
  }, message);
}

it.each(
  [longErrorSettings[0], longErrorSettings[2]].flatMap((settings) =>
    [-1, 1].flatMap((direction) =>
      [844, 180].map((visibleHeight) => ({ settings, direction, visibleHeight })),
    ),
  ),
)("respects the nearest $settings.mode save-error boundary in direction $direction at $visibleHeight px", async ({
  settings,
  direction,
  visibleHeight,
}) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const dialog = await openRound(page, settings, 12);
    await failNextSave(page, "Round storage unavailable. Keep the draft and retry. ".repeat(30));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const error = dialog.getByRole("region", { name: "Round save error", exact: true });
    const message = error.getByRole("alert");
    await message.waitFor();
    await setVisibleViewport(page, {
      width: 390,
      height: visibleHeight,
      offsetLeft: 0,
      offsetTop: visibleHeight === 180 ? 60 : 0,
    });
    const panel = dialog.locator(".dialog-panel");
    const resting = await panel.boundingBox();
    await error.evaluate((element) => {
      element.scrollTop = 60;
    });
    expect(await error.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(
      await touchGesture(message, [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]),
    ).toEqual([false, false, false]);
    expect(await panel.boundingBox()).toEqual(resting);
    await error.evaluate((element, direction) => {
      element.scrollTop = direction === -1 ? element.scrollHeight : 0;
    }, direction);
    await touchGesture(message, [
      { y: 0, time: 0 },
      { y: direction * 120, time: 500 },
      { y: direction * 120, time: 700 },
    ]);
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    await dialog.getByRole("region", { name: "Round save error", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps horizontal Player navigation and numeric controls independent from modal dismissal", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const dialog = await openRound(page, longErrorSettings[2], 2);
    const panel = dialog.locator(".dialog-panel");
    const resting = await panel.boundingBox();
    const value = dialog.getByRole("status", { name: "Player 1 Points", exact: true });
    await touchGesture(value, [
      { x: 250, y: 0, time: 0 },
      { x: 100, y: 10, time: 100 },
      { x: 100, y: 10, time: 110 },
    ]);
    await expect
      .poll(() =>
        dialog.getByRole("tab", { name: "Player 2", exact: true }).getAttribute("aria-selected"),
      )
      .toBe("true");
    expect(await panel.boundingBox()).toEqual(resting);
    const digit = dialog.getByRole("button", { name: "7", exact: true });
    for (const direction of [-1, 1]) {
      await touchGesture(digit, [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]);
      await touchGesture(dialog.getByRole("tab", { name: "Player 1", exact: true }), [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]);
    }
    expect(await panel.boundingBox()).toEqual(resting);
    await digit.click();
    expect(
      await dialog.getByRole("status", { name: "Player 2 Points", exact: true }).innerText(),
    ).toBe("7");
  } finally {
    await page.close();
  }
}, 60_000);

it.each(
  [-1, 1].flatMap((direction) => ["header", "body"].map((source) => ({ direction, source }))),
)("does not let a non-scrolling $source child bypass the whole-panel boundary in direction $direction", async ({
  direction,
  source,
}) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const dialog = await openRound(page, longErrorSettings[2], 2);
    await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
    const panel = dialog.locator(".dialog-panel");
    const header =
      source === "header"
        ? dialog.locator("header")
        : dialog.getByRole("status", { name: "Player 1 Points", exact: true });
    const resting = await panel.boundingBox();
    expect(await panel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await panel.evaluate((element) => {
      element.scrollTop = 50;
    });
    expect(
      await touchGesture(header, [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]),
    ).toEqual([false, false, false]);
    expect(await panel.boundingBox()).toEqual(resting);
    await panel.evaluate((element, direction) => {
      element.scrollTop = direction === -1 ? element.scrollHeight : 0;
    }, direction);
    await touchGesture(header, [
      { y: 0, time: 0 },
      { y: direction * 120, time: 500 },
      { y: direction * 120, time: 700 },
    ]);
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  -1, 1,
])("respects the independent Player list boundary in direction %s without dragging selection controls", async (direction) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const dialog = await openRound(page, longErrorSettings[0], 12);
    const list = dialog.getByRole("region", { name: "Pass/Fail entries", exact: true });
    const panel = dialog.locator(".dialog-panel");
    const resting = await panel.boundingBox();
    await list.evaluate((element) => {
      element.scrollTop = 60;
    });
    expect(
      await touchGesture(list, [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]),
    ).toEqual([false, false, false]);
    expect(await panel.boundingBox()).toEqual(resting);
    await list.evaluate((element, direction) => {
      element.scrollTop = direction === -1 ? element.scrollHeight : 0;
    }, direction);
    const player = dialog.getByRole("button", {
      name: direction === -1 ? "Player 12" : "Player 1",
      exact: true,
    });
    expect(
      await touchGesture(player, [
        { y: 0, time: 0 },
        { y: direction * 160, time: 100 },
        { y: direction * 160, time: 110 },
      ]),
    ).toEqual([false, false, false]);
    expect(await player.getAttribute("aria-pressed")).toBe("false");
    expect(await panel.boundingBox()).toEqual(resting);
    await touchGesture(list, [
      { y: 0, time: 0 },
      { y: direction * 120, time: 500 },
      { y: direction * 120, time: 700 },
    ]);
    await dialog.waitFor({ state: "detached" });
  } finally {
    await page.close();
  }
}, 60_000);

async function expectBodyClearOfActions(dialog: Locator, lastControl: Locator) {
  const body = dialog.locator(".dialog-scroll:not(.dialog-content)").first();
  if (await dialog.getByRole("group", { name: /keypad$/ }).count()) {
    expect(await body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
  } else {
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  }
  const bodyBounds = await body.boundingBox();
  const lastBounds = await lastControl.boundingBox();
  const saveBounds = await dialog.getByRole("button", { name: "Save", exact: true }).boundingBox();
  if (!bodyBounds || !lastBounds || !saveBounds) throw new Error("Missing Round body geometry");
  expect(lastBounds.y).toBeGreaterThanOrEqual(bodyBounds.y);
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
    bodyBounds.y + bodyBounds.height - 10,
  );
  expect(bodyBounds.y + bodyBounds.height).toBeLessThan(saveBounds.y);
}

const settings: GenericGameSettings[] = [
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: false },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  { mode: "passFail", tiebreaker: null, dealer: false },
];

it.each(
  settings,
)("keeps $mode controls useful through cramped-height fallback and restoration", async (gameSettings) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  try {
    const dialog = await openRound(page, gameSettings, 12);
    const panel = dialog.locator(".dialog-panel");
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
      const bounds = await panel.boundingBox();
      if (!bounds) throw new Error("Missing cramped workspace");
      expect(bounds.y).toBe(76);
      expect(bounds.height).toBe(148);
      const control =
        gameSettings.mode === "points"
          ? dialog.getByRole("button", { name: "7", exact: true })
          : dialog.getByRole(gameSettings.mode === "singleRoundWinner" ? "radio" : "button", {
              name: "Player 12",
              exact: true,
            });
      await control.click();
      const controlBounds = await control.boundingBox();
      if (!controlBounds) throw new Error("Missing entry control");
      expect(controlBounds.width).toBeGreaterThanOrEqual(24);
      expect(controlBounds.height).toBeGreaterThanOrEqual(24);
      expect(controlBounds.y).toBeGreaterThanOrEqual(bounds.y);
      expect(controlBounds.y + controlBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await save.focus();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const saveBounds = await save.boundingBox();
      if (!saveBounds) throw new Error("Missing cramped Save");
      expect(saveBounds.y).toBeGreaterThanOrEqual(bounds.y + 4);
      expect(saveBounds.y + saveBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height - 4);
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await close.scrollIntoViewIfNeeded();
      expect((await close.boundingBox())?.y).toBeGreaterThanOrEqual(bounds.y);
      await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
      await expectPinnedActions(dialog, 0);
    }
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  { width: 320, height: 480, bottom: 0, left: 0, right: 0 },
  { width: 320, height: 568, bottom: 34, left: 20, right: 12 },
  { width: 390, height: 844, bottom: 0, left: 0, right: 0 },
  { width: 768, height: 1024, bottom: 34, left: 0, right: 0 },
])("pins every mode's actions with short/long rosters at $width x $height and $bottom px Safe Area", async (viewport) => {
  for (const playerCount of [1, 12]) {
    for (const gameSettings of settings) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      try {
        await page.addInitScript(({ bottom, left, right }) => {
          document.addEventListener("DOMContentLoaded", () => {
            const style = document.documentElement.style;
            style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
            style.setProperty("--safe-area-inset-left", `${left}px`);
            style.setProperty("--safe-area-inset-right", `${right}px`);
          });
        }, viewport);
        const dialog = await openRound(page, gameSettings, playerCount);
        await expectPinnedActions(dialog, viewport.bottom);
        const panelBounds = await dialog.locator(".dialog-panel").boundingBox();
        if (!panelBounds) throw new Error("Missing Round dialog");
        expect(panelBounds.y).toBeCloseTo(16, 0);
        expect(panelBounds.height).toBeCloseTo(viewport.height - viewport.bottom - 32, 0);
        expect(panelBounds.x).toBeGreaterThanOrEqual(viewport.left + 16);
        expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(
          viewport.width - viewport.right - 16,
        );
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          expect(
            await dialog
              .locator(".dialog-panel")
              .evaluate((panel) => getComputedStyle(panel).backdropFilter),
          ).toBe("none");
          expect(
            await dialog.locator(".dialog-panel").evaluate((panel) => {
              const probe = document.createElement("div");
              probe.style.backgroundColor = "var(--color-app-background)";
              document.body.append(probe);
              const matches =
                getComputedStyle(probe).backgroundColor === getComputedStyle(panel).backgroundColor;
              probe.remove();
              return matches;
            }),
          ).toBe(true);
          expect(
            await dialog
              .locator(".dialog-backdrop")
              .evaluate((element) => getComputedStyle(element).backgroundColor),
          ).toBe("rgba(0, 0, 0, 0)");
        }
        const lastName = `Player ${playerCount}`;
        const lastControl =
          gameSettings.mode === "points"
            ? dialog.getByRole("button", { name: "Backspace", exact: true })
            : dialog.getByRole(gameSettings.mode === "singleRoundWinner" ? "radio" : "button", {
                name: lastName,
                exact: true,
              });
        if (gameSettings.mode === "points") {
          await dialog.getByRole("tab", { name: lastName, exact: true }).click();
          const digit = dialog.getByRole("button", { name: "7", exact: true });
          await digit.click();
          await digit.focus();
          await page.keyboard.type(".5");
          await dialog.getByRole("alert").filter({ hasText: "Enter a whole number" }).waitFor();
          expect(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(
            true,
          );
          await expectPinnedActions(dialog, viewport.bottom);
          await page.keyboard.press("Delete");
          await page.keyboard.press("7");
        } else {
          const body = dialog.locator(".dialog-scroll:not(.dialog-content)").first();
          if (playerCount === 12) {
            expect(
              await body.evaluate((element) => element.scrollHeight > element.clientHeight),
            ).toBe(true);
          }
          await lastControl.click();
        }
        await expectBodyClearOfActions(dialog, lastControl);
        await expectPinnedActions(dialog, viewport.bottom);

        await failNextSave(page, "Round storage unavailable. Try saving again.");
        const save = dialog.getByRole("button", { name: "Save", exact: true });
        await save.click();
        await dialog.getByRole("alert").filter({ hasText: "Round storage unavailable" }).waitFor();
        await expectPinnedActions(dialog, viewport.bottom);
        const error = dialog.getByRole("region", { name: "Round save error", exact: true });
        const errorBounds = await error.boundingBox();
        const saveBounds = await save.boundingBox();
        if (!errorBounds || !saveBounds) throw new Error("Missing error/action geometry");
        expect(errorBounds.y + errorBounds.height).toBeLessThan(saveBounds.y);

        for (const name of ["Close", "Save"]) {
          const action = dialog.getByRole("button", { name, exact: true });
          const bounds = await action.boundingBox();
          if (!bounds) throw new Error("Missing action");
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.down();
          await expect
            .poll(async () => (await action.boundingBox())?.width ?? 0)
            .toBeGreaterThan(bounds.width + 1);
          const pressed = await action.boundingBox();
          if (!pressed) throw new Error("Missing pressed action");
          expect(pressed.x).toBeGreaterThan(Math.max(panelBounds.x, viewport.left));
          expect(pressed.x + pressed.width).toBeLessThan(
            Math.min(panelBounds.x + panelBounds.width, viewport.width - viewport.right),
          );
          expect(pressed.y + pressed.height).toBeLessThan(viewport.height - viewport.bottom);
          await page.mouse.move(0, 0);
          await page.mouse.up();
        }
        await save.click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
      } finally {
        await page.close();
      }
    }
  }
}, 120_000);
