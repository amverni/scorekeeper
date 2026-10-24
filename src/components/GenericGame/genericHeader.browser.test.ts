/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
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
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function createGame(page: Page) {
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  return page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const player = await playersApi.create({ name: "Maya", color: "Ocean", isFavorite: 0 });
    return (await genericGamesApi.create({
      players: [player.id],
      settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
    })).id;
  })()`);
}

function wordGeometry(page: Page) {
  return page.getByRole("img", { name: "Scorekeeper", exact: true }).evaluate(async (element) => {
    const text = element.querySelector("text");
    if (!text) throw new Error("Missing Scorekeeper word");
    const style = getComputedStyle(text);
    const faces = await document.fonts.load(
      `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      "Scorekeeper",
    );
    await document.fonts.ready;
    const bounds = text.getBoundingClientRect();
    const transform = text.getScreenCTM();
    if (!transform) throw new Error("Missing word transform");
    return {
      loaded: faces.length > 0 && faces.every((face) => face.status === "loaded"),
      center: bounds.x + bounds.width / 2,
      width: bounds.width,
      height: bounds.height,
      left: bounds.left - (Number.parseFloat(style.strokeWidth) * transform.a) / 2,
      right: bounds.right + (Number.parseFloat(style.strokeWidth) * transform.a) / 2,
    };
  });
}

async function expectSameWord(page: Page, expected: Awaited<ReturnType<typeof wordGeometry>>) {
  const actual = await wordGeometry(page);
  expect(actual.loaded).toBe(true);
  for (const metric of ["center", "width", "height", "left", "right"] as const) {
    expect(actual[metric], metric).toBeCloseTo(expected[metric], 3);
  }
}

it.each([
  "light",
  "dark",
] as const)("centers the loaded word with Menu above the stripes and clear of the letters in %s mode", async (colorScheme) => {
  const page = await browser.newPage({ colorScheme, timezoneId: "America/New_York" });
  await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
  try {
    const id = await createGame(page);
    await page.goto(`${appUrl}#/scorekeeper/game/${id}`);
    const button = page.getByRole("button", { name: "Menu", exact: true });
    await button.waitFor();
    let wordAspect: number | undefined;
    for (const [width, height, top, left, right] of [
      [390, 844, 0, 0, 0],
      [390, 701, 0, 0, 0],
      [390, 700, 0, 0, 0],
      [320, 568, 0, 0, 0],
      [844, 390, 0, 44, 0],
      [844, 390, 0, 0, 44],
      [1280, 900, 0, 0, 0],
      [1920, 1080, 0, 0, 0],
      [320, 568, 47, 44, 44],
      [390, 844, 0, 0, 0],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        ({ top, left, right }) => {
          for (const [edge, value] of Object.entries({ top, left, right })) {
            document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
          }
        },
        { top, left, right },
      );
      const word = await wordGeometry(page);
      expect(word.loaded).toBe(true);
      expect(
        word.center,
        `word center at ${width}x${height}, Safe Areas ${left}/${right}`,
      ).toBeCloseTo(width / 2, 0);
      wordAspect ??= word.width / word.height;
      expect(word.width / word.height).toBeCloseTo(wordAspect, 2);
      const header = await page.locator(".page-shell-header").boundingBox();
      expect(header?.height).toBeCloseTo(Math.max(height * 0.15 - 25, 64) + top, 1);

      await expect
        .poll(() =>
          page
            .getByRole("img", { name: "Scorekeeper", exact: true })
            .locator("rect")
            .evaluateAll((elements) =>
              elements.every((element) => {
                const box = element.getBoundingClientRect();
                return Math.abs(box.left) < 0.1 && Math.abs(box.right - innerWidth) < 0.1;
              }),
            ),
        )
        .toBe(true);
      const control = await button.boundingBox();
      if (!control || !header) throw new Error("Missing header control");
      const size = height <= 700 ? 44 : 56;
      const iconSize = height <= 700 ? 24 : 32;
      const finish = await page
        .getByRole("button", { name: "Finish Game", exact: true })
        .boundingBox();
      if (!finish) throw new Error("Missing footer control");
      expect(control.x + control.width, `header/footer right edge at ${width}px`).toBeCloseTo(
        finish.x + finish.width,
        1,
      );
      expect(control.width).toBe(size);
      expect(control.height).toBe(size);
      expect(await button.locator("svg").boundingBox()).toMatchObject({
        width: iconSize,
        height: iconSize,
      });
      expect(control.x).toBeGreaterThan(word.right);
      expect(word.left).toBeGreaterThan(left);
      const band = await page
        .getByRole("img", { name: "Scorekeeper", exact: true })
        .locator("rect")
        .evaluateAll((elements) => {
          if (elements.length !== 4) throw new Error("Missing stripe band");
          const first = elements[0].getBoundingClientRect();
          const last = elements[3].getBoundingClientRect();
          const middleTop = elements[1].getBoundingClientRect().top;
          const middleBottom = elements[2].getBoundingClientRect().bottom;
          return { center: (first.top + last.bottom) / 2, middleTop, middleBottom };
        });
      expect(band.center).toBeGreaterThan(control.y);
      expect(band.center).toBeLessThan(control.y + control.height);
      expect(band.middleTop).toBeGreaterThan(control.y);
      expect(band.middleBottom).toBeLessThan(control.y + control.height);
      await button.hover();
      await page.mouse.down();
      expect((await button.boundingBox())?.width).toBe(size);
      await expect
        .poll(async () => (await button.locator("span").boundingBox())?.width)
        .toBeCloseTo(size * 1.1, 1);
      const pressed = await button.locator("span").boundingBox();
      if (!pressed) throw new Error("Missing pressed control");
      expect(pressed.x).toBeGreaterThan(word.right);
      expect(pressed.x + pressed.width).toBeLessThanOrEqual(width - right);
      expect(pressed.y).toBeGreaterThanOrEqual(top);
      expect(pressed.y + pressed.height).toBeLessThanOrEqual(header.height);
      expect(
        await button.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return [box.left + 1, box.right - 1].every((x) =>
            element.contains(document.elementFromPoint(x, box.top + box.height / 2)),
          );
        }),
      ).toBe(true);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await expect.poll(async () => (await button.locator("span").boundingBox())?.width).toBe(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
    await button.focus();
    await button.press(tab);
    await page.keyboard.press(`Shift+${tab}`);
    expect(await button.evaluate((element) => document.activeElement === element)).toBe(true);
    await expect
      .poll(() => button.evaluate((element) => getComputedStyle(element).outlineStyle))
      .toBe("solid");
    await button.press("Enter");
    const navigation = page.getByRole("navigation");
    await navigation.getByRole("link", { name: "Home", exact: true }).waitFor();
    await page.keyboard.press(tab);
    await expect
      .poll(() => navigation.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await navigation.waitFor({ state: "detached" });
    await expect
      .poll(() => button.evaluate((element) => document.activeElement === element))
      .toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps the word stationary through loading, Active Game, failed refresh, and Completed Game states", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/New_York",
  });
  await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
  try {
    const id = await createGame(page);
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(id)});
      await genericRoundsApi.add({
        gameId: game.id, mode: "points", scores: [{ playerId: game.players[0], points: "5" }],
      });
    })()`);
    // Hold a real storage transaction open so the scoreboard's read waits at the DB boundary.
    await page.evaluate(`new Promise((resolve, reject) => {
      const request = indexedDB.open("phase10-db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("games", "readwrite");
        let locked = true;
        window.releaseHeaderStorage = () => { locked = false; };
        transaction.oncomplete = () => db.close();
        const hold = () => {
          if (locked) transaction.objectStore("games").get(${JSON.stringify(id)}).onsuccess = hold;
        };
        hold();
        resolve();
      };
    })`);
    await page.goto(`${appUrl}#/scorekeeper/game/${id}`);
    await page.getByText("Loading Game...", { exact: true }).waitFor();
    const loading = await wordGeometry(page);
    const button = page.getByRole("button", { name: "Open Standings", exact: true });
    expect(await button.count()).toBe(0);
    await page.evaluate("window.releaseHeaderStorage()");
    await button.waitFor();
    await expectSameWord(page, loading);
    expect(await button.isEnabled()).toBe(true);

    await failGameRead(page, true);
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    const finish = page.getByRole("dialog", { name: "Finish Game", exact: true });
    await finish.waitFor();
    await expect
      .poll(() => finish.evaluate((element) => element.contains(document.activeElement)))
      .toBe(false);
    await finish.getByRole("button", { name: "Finish", exact: true }).press("Enter");
    await page.getByRole("alert").filter({ hasText: "Unable to load this Game." }).waitFor();
    expect(await button.isDisabled()).toBe(true);
    await expectSameWord(page, loading);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
    await expect
      .poll(() => standings.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await standings.waitFor({ state: "detached" });
    expect(await button.isEnabled()).toBe(true);
    await expectSameWord(page, loading);
    expect(await page.getByRole("button", { name: "Finish Game", exact: true }).count()).toBe(0);

    await page.reload();
    await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
    await expect
      .poll(() => standings.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await standings.waitFor({ state: "detached" });
    await expectSameWord(page, loading);
    await button.click();
    await standings.getByRole("list", { name: "Standings places", exact: true }).waitFor();
  } finally {
    await page.close();
  }
}, 60_000);

it("keeps the word stationary when an initial storage error is retried or the Game is missing", async () => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    timezoneId: "America/New_York",
  });
  await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
  try {
    const id = await createGame(page);
    await failGameRead(page);
    await page.goto(`${appUrl}#/scorekeeper/game/${id}`);
    await page.getByRole("alert").filter({ hasText: "Unable to load this Game." }).waitFor();
    const error = await wordGeometry(page);
    const button = page.getByRole("button", { name: "Open Standings", exact: true });
    expect(await button.count()).toBe(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await button.waitFor();
    await expectSameWord(page, error);
    await page.goto(`${appUrl}#/scorekeeper/game/missing-header-game`);
    await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
    expect(await button.count()).toBe(0);
    await expectSameWord(page, error);
  } finally {
    await page.close();
  }
}, 60_000);

async function failGameRead(page: Page, afterWrite = false) {
  await page.evaluate((afterWrite) => {
    const original = IDBDatabase.prototype.transaction;
    let fail = !afterWrite;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const names = typeof stores === "string" ? [stores] : Array.from(stores);
      if (names.includes("games") && mode !== "readwrite" && fail) {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException("Temporary storage failure", "UnknownError");
      }
      const transaction = original.call(this, stores, mode, options);
      if (names.includes("games") && mode === "readwrite") {
        transaction.addEventListener("complete", () => {
          fail = true;
        });
      }
      return transaction;
    };
  }, afterWrite);
}
