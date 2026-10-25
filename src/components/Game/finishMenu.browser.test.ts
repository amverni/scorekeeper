/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
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

const owners = ["phase10", "generic"] as const;
const apiImport = (owner: ScorekeeperId) =>
  owner === "phase10"
    ? 'const { gamesApi: api } = await import("/scorekeeper/src/data/api/games.ts");'
    : 'const { genericGamesApi: api } = await import("/scorekeeper/src/data/api/genericGames.ts");';
const home = (owner: ScorekeeperId) => (owner === "phase10" ? "/phaseCompan10n" : "/scorekeeper");
const gamePath = (owner: ScorekeeperId, id: string) => `${home(owner)}/game/${id}`;

async function seed(page: Page, owner: ScorekeeperId) {
  await page.goto(`${appUrl}#${home(owner)}`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<{ game: StoredGame; players: Player[] }>(`(async () => {
    ${apiImport(owner)}
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
    const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
    const game = await api.create({
      players: [amy.id, bob.id],
      ${
        owner === "phase10"
          ? 'phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] }, settings: { tiebreaker: "roundsWon", roundSkipPenalty: 0, sitOutPenalty: 0 }'
          : 'settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false }'
      }
    });
    return { game, players: [amy, bob] };
  })()`);
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  return page;
}

const popup = (page: Page) => page.getByRole("dialog", { name: "Finish Game", exact: true });
const flag = (page: Page) => page.locator('button[aria-label="Finish Game"]');
const add = (page: Page, owner: ScorekeeperId) =>
  page.getByRole("button", {
    name: owner === "phase10" ? "Add round 1" : "Add Round",
    exact: true,
  });

async function enterDraft(page: Page, owner: ScorekeeperId) {
  await add(page, owner).click();
  const entry = page.getByRole("dialog");
  if (owner === "phase10") {
    await entry.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: "Amy", exact: true }).click();
  } else {
    await entry.getByRole("button", { name: "8", exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await entry.waitFor({ state: "detached" });
}

function readGame(page: Page, owner: ScorekeeperId, id: string) {
  return page.evaluate<StoredGame | undefined>(`(async () => {
    ${apiImport(owner)}
    return api.getById(${JSON.stringify(id)});
  })()`);
}

it.each(
  owners,
)("keeps %s navigation in the same safe corners before and after completion", async (owner) => {
  const page = await newPage();
  try {
    const { game } = await seed(page, owner);
    const url = `${appUrl}#${gamePath(owner, game.id)}`;
    await page.evaluate(`(async () => {
      ${
        owner === "phase10"
          ? `const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
             await roundsApi.add({ gameId: ${JSON.stringify(game.id)}, roundWinnerId: ${JSON.stringify(game.players[0])},
               scores: ${JSON.stringify(game.players)}.map(playerId => ({ playerId, phaseStatus: "completed", score: 0 })) });`
          : `const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
             await genericRoundsApi.add({ gameId: ${JSON.stringify(game.id)}, mode: "points",
               scores: ${JSON.stringify(game.players)}.map(playerId => ({ playerId, points: "5" })) });`
      }
    })()`);
    for (const status of ["active", "completed"]) {
      await page.goto(url);
      if (status === "completed") {
        await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
      }
      const menu = page.getByRole("button", { name: "Menu", exact: true });
      const standings = page.getByRole("button", { name: "Open Standings", exact: true });
      await menu.waitFor();
      await expect.poll(() => standings.isEnabled()).toBe(true);
      expect(await page.getByRole("link", { name: "Go home", exact: true }).count()).toBe(0);
      expect(await flag(page).count()).toBe(status === "active" ? 1 : 0);
      expect(
        await page.getByRole("button", { name: "Open Phases Card", exact: true }).count(),
      ).toBe(owner === "phase10" && status === "active" ? 1 : 0);
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [1280, 900],
      ]) {
        await page.setViewportSize({ width, height });
        await page.addStyleTag({
          content:
            ":root { --safe-area-inset-top: 12px; --safe-area-inset-right: 20px; --safe-area-inset-bottom: 24px; --safe-area-inset-left: 16px; }",
        });
        const top = await menu.boundingBox();
        const bottom = await standings.boundingBox();
        if (!top || !bottom) throw new Error("Missing Game navigation");
        expect(top.x).toBeGreaterThan(width / 2);
        expect(top.y).toBeGreaterThanOrEqual(12);
        expect(top.y + top.height).toBeLessThan(height / 2);
        expect(bottom.x).toBeLessThan(width / 2);
        expect(bottom.y).toBeGreaterThan(height / 2);
        for (const bounds of [top, bottom]) {
          expect(bounds.x).toBeGreaterThanOrEqual(16);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 20);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 24);
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
      }
      await menu.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("navigation").waitFor();
      expect(await page.getByRole("navigation").getByRole("link").allTextContents()).toEqual([
        ...(owner === "phase10"
          ? ["Home", "Games", "Players", "Phases", "Settings"]
          : ["Home", "Games", "Players"]),
        ...(status === "active" ? ["Edit game"] : []),
      ]);
      await page.keyboard.press("Escape");
      await expect
        .poll(() => menu.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await standings.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await expect
        .poll(() => standings.evaluate((element) => element === document.activeElement))
        .toBe(true);
      const savedGame = await readGame(page, owner, game.id);
      const readRounds = () =>
        page.evaluate(`(async () => {
        const { ${owner === "phase10" ? "roundsApi" : "genericRoundsApi"}: api } =
          await import("/scorekeeper/src/data/api/${owner === "phase10" ? "rounds" : "genericRounds"}.ts");
        return api.getByGameId(${JSON.stringify(game.id)});
      })()`);
      const savedRounds = await readRounds();
      const destinations =
        owner === "phase10"
          ? ["Home", "Games", "Players", "Phases", "Settings"]
          : ["Home", "Games", "Players"];
      for (const destination of destinations) {
        await menu.click();
        const link = page.getByRole("link", { name: destination, exact: true });
        const path = destination === "Home" ? "/" : `${home(owner)}/${destination.toLowerCase()}`;
        expect(await link.getAttribute("href")).toBe(`/scorekeeper/#${path}`);
        await link.click();
        await page.waitForURL(`${appUrl}#${path}`);
        await page.reload();
        await page
          .getByRole(destination === "Home" ? "heading" : "link", {
            name: destination === "Home" ? "Scorekeepers" : "Go home",
            exact: true,
          })
          .waitFor();
        expect(await readGame(page, owner, game.id)).toEqual(savedGame);
        expect(await readRounds()).toEqual(savedRounds);
        await page.goto(url);
        if (status === "completed") {
          await page.getByRole("tabpanel", { name: "Standings", exact: true }).waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "detached" });
        }
        await expect.poll(() => standings.isEnabled()).toBe(true);
      }
      if (status === "active") {
        await page.evaluate(`(async () => {
          ${apiImport(owner)}
          await api.finish(${JSON.stringify(game.id)});
        })()`);
      }
    }
  } finally {
    await page.close();
  }
}, 120_000);

it.each(
  owners,
)("anchors the compact %s menu safely with input-aware focus on dismissal", async (owner) => {
  const page = await newPage();
  try {
    const { game } = await seed(page, owner);
    const url = `${appUrl}#${gamePath(owner, game.id)}`;
    await page.goto(url);
    await add(page, owner).waitFor();
    await page.addStyleTag({
      content:
        ":root { --safe-area-inset-top: 12px; --safe-area-inset-right: 20px; --safe-area-inset-bottom: 24px; --safe-area-inset-left: 16px; }",
    });
    const back = await page
      .getByRole("button", { name: "Open Standings", exact: true })
      .boundingBox();
    const before = await flag(page).boundingBox();
    if (!before || !back) throw new Error("Missing footer controls");
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    expect(await flag(page).boundingBox()).toEqual(before);
    await expect
      .poll(async () => (await flag(page).locator("span").boundingBox())?.width)
      .toBeGreaterThan(before.width);
    await page.mouse.up();
    await popup(page).waitFor();
    expect(await popup(page).getByRole("button").allTextContents()).toEqual(["Pause", "Delete"]);
    expect(await popup(page).getByRole("heading").count()).toBe(0);
    const panel = await popup(page).boundingBox();
    if (!panel) throw new Error("Missing menu");
    expect(panel.y + panel.height).toBeCloseTo(before.y - 8, 0);
    expect(panel.x + panel.width).toBeCloseTo(before.x + before.width, 0);
    expect(panel.height).toBeLessThan(160);
    expect(panel.x).toBeGreaterThanOrEqual(16);
    expect(panel.x + panel.width).toBeLessThanOrEqual(300);
    expect(panel.y).toBeGreaterThan(12);
    expect(before.y + before.height * 1.05).toBeLessThanOrEqual(544);
    const buttons = await popup(page)
      .getByRole("button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { y, height } = element.getBoundingClientRect();
          return { y, height };
        }),
      );
    expect(buttons.every((button) => button.height >= 44)).toBe(true);
    expect(buttons[0].y).toBeLessThan(buttons[1].y);
    await expect
      .poll(() => popup(page).evaluate((element) => element.contains(document.activeElement)))
      .toBe(false);
    await page.keyboard.press("Escape");
    await popup(page).waitFor({ state: "detached" });
    await expect
      .poll(() => flag(page).evaluate((element) => element === document.activeElement))
      .toBe(true);
    await page.keyboard.press("Enter");
    await popup(page).waitFor();
    await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
    await popup(page).waitFor({ state: "detached" });
    expect(page.url()).toBe(url);
    expect(await readGame(page, owner, game.id)).toEqual(game);
    await expect
      .poll(() => flag(page).evaluate((element) => element === document.activeElement))
      .toBe(false);
  } finally {
    await page.close();
  }
}, 60_000);

it.each(
  owners.flatMap((owner) =>
    (["light", "dark"] as const).map((colorScheme) => ({ owner, colorScheme })),
  ),
)("uses keyboard-only focus for the $owner Finish menu in $colorScheme mode", async ({
  owner,
  colorScheme,
}) => {
  const page = await newPage();
  try {
    await page.emulateMedia({ colorScheme });
    const { game } = await seed(page, owner);
    const url = `${appUrl}#${gamePath(owner, game.id)}`;
    await page.goto(url);
    await add(page, owner).waitFor();
    const menu = popup(page);
    const trigger = flag(page);
    const pause = menu.getByRole("button", { name: "Pause", exact: true });
    const remove = menu.getByRole("button", { name: "Delete", exact: true });
    const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";

    for (const pointer of ["mouse", "touch"] as const) {
      if (pointer === "mouse") await trigger.click();
      else await trigger.tap();
      await menu.waitFor();
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      await page.keyboard.press(tab);
      await expect
        .poll(() => pause.evaluate((element) => element === document.activeElement))
        .toBe(true);
      expect(await pause.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      expect(await pause.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        "none",
      );
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((element) => element === document.activeElement))
        .toBe(true);

      if (pointer === "mouse") await trigger.click();
      else await trigger.tap();
      await menu.waitFor();
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      if (pointer === "mouse") await page.mouse.click(4, 4);
      else await page.touchscreen.tap(4, 4);
      await menu.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((element) => element === document.activeElement))
        .toBe(false);

      await trigger.focus();
      await page.keyboard.press(pointer === "mouse" ? "Enter" : "Space");
      await menu.waitFor();
      await expect
        .poll(() => pause.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await page.keyboard.press(tab);
      expect(await remove.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press(`Shift+${tab}`);
      expect(await pause.evaluate((element) => element === document.activeElement)).toBe(true);
      if (pointer === "mouse") await page.mouse.click(4, 4);
      else await page.touchscreen.tap(4, 4);
      await menu.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((element) => element === document.activeElement))
        .toBe(false);
      expect(page.url()).toBe(url);
      expect(await readGame(page, owner, game.id)).toEqual(game);
    }
  } finally {
    await page.close();
  }
}, 60_000);

it.each(
  owners,
)("retains a %s draft on failed Delete, blocks pending actions, and deletes only after success", async (owner) => {
  const page = await newPage();
  try {
    const { game, players } = await seed(page, owner);
    const url = `${appUrl}#${gamePath(owner, game.id)}`;
    await page.goto(url);
    await enterDraft(page, owner);
    await flag(page).click();
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      const original = api.deleteEmpty;
      api.deleteEmpty = async (...args) => {
        api.deleteEmpty = original;
        const method = ${JSON.stringify(owner === "phase10" ? "getById" : "getScoreboard")};
        const read = api[method];
        api[method] = async () => {
          api[method] = read;
          throw new Error("Temporary refresh failure");
        };
        throw new Error("Temporary deletion failure");
      };
    })()`);
    await popup(page).getByRole("button", { name: "Delete", exact: true }).click();
    await popup(page)
      .getByRole("alert")
      .filter({ hasText: "Temporary deletion failure" })
      .waitFor();
    expect(await readGame(page, owner, game.id)).toEqual(game);
    expect(page.url()).toBe(url);
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await popup(page).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await add(page, owner).click();
    const entry = page.getByRole("dialog");
    expect(
      await entry
        .getByRole(owner === "phase10" ? "button" : "status", {
          name: owner === "phase10" ? /Round Winner/ : "Amy Points",
        })
        .innerText(),
    ).toContain(owner === "phase10" ? "Amy" : "8");
    await expect
      .poll(() => entry.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await entry.evaluate((element) =>
      Promise.allSettled(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished),
      ),
    );
    await page.keyboard.press("Escape");
    await entry.waitFor({ state: "detached" });
    const back = await page
      .getByRole("button", { name: "Open Standings", exact: true })
      .boundingBox();
    if (!back) throw new Error("Missing Standings control");
    await flag(page).click();
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      const original = api.deleteEmpty;
      window.deleteCalls = 0;
      const ready = new Promise(resolve => { window.releaseDelete = resolve; });
      api.deleteEmpty = async (...args) => {
        window.deleteCalls++;
        await ready;
        return original(...args);
      };
    })()`);
    await popup(page)
      .getByRole("button", { name: "Delete", exact: true })
      .evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    await popup(page).getByRole("button", { name: "Deleting...", exact: true }).waitFor();
    for (const name of ["Pause", "Deleting..."]) {
      expect(await popup(page).getByRole("button", { name, exact: true }).isDisabled()).toBe(true);
    }
    await page.keyboard.press("Escape");
    await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
    expect(await popup(page).isVisible()).toBe(true);
    expect(page.url()).toBe(url);
    expect(await page.evaluate("window.deleteCalls")).toBe(1);
    expect(await readGame(page, owner, game.id)).toEqual(game);
    await page.evaluate("window.releaseDelete()");
    await page.waitForURL(`${appUrl}#${home(owner)}`);
    expect(await popup(page).count()).toBe(0);
    expect(await readGame(page, owner, game.id)).toBeUndefined();
    expect(
      await page.evaluate(
        `import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) => playersApi.getAll())`,
      ),
    ).toEqual(players);
    await page.goto(url);
    await page
      .getByText(
        owner === "phase10"
          ? "This Game is no longer available."
          : "Game not found in Scorekeeper.",
        { exact: true },
      )
      .waitFor();
    expect(await add(page, owner).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

it.each(owners)("rejects a %s Delete after another tab saves a Round", async (owner) => {
  const page = await newPage();
  try {
    const { game } = await seed(page, owner);
    await page.goto(`${appUrl}#${gamePath(owner, game.id)}`);
    await enterDraft(page, owner);
    await flag(page).click();
    await popup(page).getByRole("button", { name: "Delete", exact: true }).waitFor();
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      const game = await api.getById(${JSON.stringify(game.id)});
      ${
        owner === "phase10"
          ? `const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
           await roundsApi.add({ gameId: game.id, roundWinnerId: game.players[0],
             scores: game.players.map(playerId => ({ playerId, phaseStatus: "completed", score: 0 })) });`
          : `const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
           await genericRoundsApi.add({ gameId: game.id, mode: "points",
             scores: game.players.map(playerId => ({ playerId, points: "5" })) });`
      }
    })()`);
    await popup(page).getByRole("button", { name: "Delete", exact: true }).click();
    await popup(page).getByRole("alert").filter({ hasText: "saved Rounds" }).waitFor();
    expect(await readGame(page, owner, game.id)).toMatchObject({ id: game.id, status: "active" });
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    expect(await popup(page).getByRole("button", { name: "Finish", exact: true }).isEnabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await popup(page).waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: owner === "phase10" ? "Add round 2" : "Add Round", exact: true })
      .click();
    expect(
      await page
        .getByRole("dialog")
        .getByRole(owner === "phase10" ? "button" : "status", {
          name: owner === "phase10" ? /Round Winner/ : "Amy Points",
        })
        .innerText(),
    ).toContain(owner === "phase10" ? "Amy" : "8");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await flag(page).click();
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    expect(await popup(page).getByRole("button", { name: "Finish", exact: true }).isEnabled()).toBe(
      true,
    );
  } finally {
    await page.close();
  }
}, 60_000);

it.each(
  owners,
)("never treats loading, stale zero-Round data, or a failed %s refresh as permission to Delete", async (owner) => {
  const page = await newPage();
  try {
    const { game } = await seed(page, owner);
    const url = `${appUrl}#${gamePath(owner, game.id)}`;
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      const method = ${JSON.stringify(owner === "phase10" ? "getView" : "getScoreboard")};
      const original = api[method];
      const ready = new Promise(resolve => { window.releaseMenuRead = resolve; });
      api[method] = async (...args) => {
        api[method] = original;
        await ready;
        return original(...args);
      };
    })()`);
    await page.goto(url);
    if (owner === "phase10") {
      await flag(page).click();
      expect(
        await popup(page).getByRole("button", { name: "Finish", exact: true }).isDisabled(),
      ).toBe(true);
      expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(
        0,
      );
      await page.keyboard.press("Escape");
      await popup(page).waitFor({ state: "detached" });
    } else {
      await page.getByText("Loading Game...", { exact: true }).waitFor();
      expect(await flag(page).count()).toBe(0);
    }
    await page.evaluate("window.releaseMenuRead()");
    await add(page, owner).waitFor();
    await flag(page).click();
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).isEnabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await popup(page).waitFor({ state: "detached" });

    // A real Player mutation invalidates the cached Game without changing its zero Rounds.
    await page.evaluate(`import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) =>
      playersApi.create({ name: "Unused", color: "Jam", isFavorite: 0 }))`);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Unused", exact: true }).click();
    await page.getByRole("button", { name: "Unused", exact: true }).waitFor({ state: "detached" });
    await page.evaluate(`(async () => {
      ${apiImport(owner)}
      const method = ${JSON.stringify(owner === "phase10" ? "getById" : "getScoreboard")};
      const original = api[method];
      const ready = new Promise(resolve => { window.releaseMenuRead = resolve; });
      api[method] = async () => {
        api[method] = original;
        await ready;
        throw new Error("Temporary read failure");
      };
    })()`);
    await page.goto(url);
    await flag(page).click();
    expect(
      await popup(page).getByRole("button", { name: "Finish", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    await page.evaluate("window.releaseMenuRead()");
    await page.getByText("Unable to load this Game.", { exact: true }).waitFor();
    expect(
      await popup(page).getByRole("button", { name: "Finish", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).count()).toBe(0);
    expect(await popup(page).getByRole("button", { name: "Pause", exact: true }).isEnabled()).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await popup(page).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await add(page, owner).waitFor();
    await flag(page).click();
    expect(await popup(page).getByRole("button", { name: "Delete", exact: true }).isEnabled()).toBe(
      true,
    );
    expect(await readGame(page, owner, game.id)).toEqual(game);
  } finally {
    await page.close();
  }
}, 60_000);
