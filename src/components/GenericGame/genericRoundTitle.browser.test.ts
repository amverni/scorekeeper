import type { Browser } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
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

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const settings: GenericGameSettings[] = [
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: false },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  { mode: "passFail", tiebreaker: null, dealer: false },
];

it.each([
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])("keeps Add Round accessible without reserving heading space in every mode at $width x $height", async (viewport) => {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(`${appUrl}#/scorekeeper`);
    const gameIds = await page.evaluate<string[]>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const player = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
      const ids = [];
      for (const settings of ${JSON.stringify(settings)}) {
        const game = await genericGamesApi.create({ players: [player.id], settings });
        ids.push(game.id);
      }
      return ids;
    })()`);

    for (const [index, gameId] of gameIds.entries()) {
      await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
      const addRound = page.getByRole("button", { name: "Add Round", exact: true });
      await addRound.click();
      const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
      await dialog.getByRole("button", { name: "Save", exact: true }).waitFor();
      await expect.poll(() => dialog.getAttribute("data-dialog-open")).toBe("true");
      await dialog.locator(".dialog-panel").evaluate(async (element) => {
        element.getBoundingClientRect();
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click({ trial: true });

      const title = dialog.getByRole("heading", { name: "Add Round", exact: true });
      const titleBounds = await title.boundingBox();
      if (!titleBounds) throw new Error("Missing accessible Add Round title");
      expect(titleBounds.width).toBeLessThanOrEqual(1);
      expect(titleBounds.height).toBeLessThanOrEqual(1);
      expect(
        await title.evaluate((element) => {
          const style = getComputedStyle(element);
          return style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
        }),
      ).toBe(true);

      const mode = settings[index].mode;
      const firstPlayer =
        mode === "points"
          ? dialog.getByRole("tab", { name: "Maya", exact: true })
          : mode === "singleRoundWinner"
            ? dialog.getByRole("radio", { name: "Maya", exact: true })
            : dialog.getByRole("button", { name: "Maya", exact: true });
      // Sample both bounds in one frame so the shared entrance transform cancels out.
      const playerOffset = await firstPlayer.evaluate((element) => {
        const content = element.closest(".dialog-body");
        if (!content) throw new Error("Missing Round content");
        return element.getBoundingClientRect().y - content.getBoundingClientRect().y;
      });
      // Existing padding and the tab border use at most 25px; allow 1px for rounding.
      expect(playerOffset).toBeGreaterThanOrEqual(0);
      expect(playerOffset).toBeLessThanOrEqual(26);

      const saveBounds = await dialog
        .getByRole("button", { name: "Save", exact: true })
        .boundingBox();
      if (!saveBounds) throw new Error("Missing Save action");
      expect(saveBounds.y + saveBounds.height).toBeLessThan(viewport.height);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(() => addRound.evaluate((element) => element === document.activeElement))
        .toBe(true);
    }
  } finally {
    await page.close();
  }
}, 60_000);
