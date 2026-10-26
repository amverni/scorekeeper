/// <reference types="node" />

import { type Browser, chromium, type Page } from "playwright";
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
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it("keeps the selected Player focused after a native held-touch release without toggling the Round", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const gameId = await seedGame(page);
    await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
    const round = page.getByRole("button", {
      name: /^(Expand|Collapse) Round 1$/,
      includeHidden: true,
    });
    const cell = page.getByRole("cell", { name: "Bob, Round 1: 1 Points", exact: true });
    await cell.waitFor();
    const bounds = await cell.boundingBox();
    if (!bounds) throw new Error("Missing saved cell");
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + 8, id: 1 }],
    });
    const editor = page.getByRole("dialog", { name: "Edit Round", exact: true });
    const bob = editor.getByRole("tab", { name: "Bob", exact: true });
    await bob.waitFor();
    await expect.poll(() => bob.evaluate((tab) => tab === document.activeElement)).toBe(true);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // Compatibility mouse events run after touchend; observe their settled focus and click.
    await page.waitForTimeout(200);
    expect(await bob.evaluate((tab) => tab === document.activeElement)).toBe(true);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    expect(await round.getAttribute("aria-expanded")).toBe("false");
    await cell.tap();
    expect(await round.getAttribute("aria-expanded")).toBe("true");
    await round.tap();
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    for (const axis of ["vertical", "horizontal"] as const) {
      await card.evaluate((element) => element.scrollTo(0, 0));
      await expect
        .poll(() => card.evaluate((element) => element.scrollLeft + element.scrollTop))
        .toBe(0);
      const bounds = await card.boundingBox();
      if (!bounds) throw new Error("Missing scorecard");
      const x = bounds.x + bounds.width - 40;
      const y = bounds.y + 170;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let step = 1; step <= 6; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: x - (axis === "horizontal" ? step * 20 : 0),
              y: y - (axis === "vertical" ? step * 15 : 0),
              id: 1,
            },
          ],
        });
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(700);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect
        .poll(() =>
          card.evaluate(
            (element, axis) => (axis === "vertical" ? element.scrollTop : element.scrollLeft),
            axis,
          ),
        )
        .toBeGreaterThan(0);
    }
    await card.evaluate((element) => element.scrollTo(0, 0));
    await cell.tap();
    await page.getByRole("button", { name: "Edit Round 1 for Bob", exact: true }).press("Enter");
    await bob.waitFor();
    await page.reload();
    await cell.waitFor();
  } finally {
    await page.close();
  }
}, 30_000);

async function seedGame(page: Page) {
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  return page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const players = await Promise.all(["Amy", "Bob", "Cam", "Dee", "Eli", "Fay"].map((name) =>
      playersApi.create({ name, color: "Jam", isFavorite: 0 })));
    const game = await genericGamesApi.create({
      players: players.map(({ id }) => id),
      settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
    });
    for (let round = 0; round < 18; round++) {
      await genericRoundsApi.add({
        gameId: game.id, mode: "points",
        scores: players.map(({ id }, index) => ({ playerId: id, points: String(index) })),
      });
    }
    return game.id;
  })()`);
}
