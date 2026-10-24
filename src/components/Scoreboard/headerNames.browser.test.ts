/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { GenericGameSettings } from "../../types";
import { makePhaseGraphGame } from "../Standings/phaseGraphTestFixtures";

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

const modes = [
  { label: "Phase 10", route: "phaseCompan10n", settings: null },
  {
    label: "Points",
    route: "scorekeeper",
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  },
  {
    label: "Points with Tiebreaker",
    route: "scorekeeper",
    settings: {
      mode: "points",
      pointsDirection: "low",
      tiebreaker: { direction: "high" },
      dealer: true,
    },
  },
  {
    label: "Single Round Winner",
    route: "scorekeeper",
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  },
  {
    label: "Pass/Fail",
    route: "scorekeeper",
    settings: { mode: "passFail", tiebreaker: null, dealer: false },
  },
] satisfies Array<{ label: string; route: string; settings: GenericGameSettings | null }>;

type Mode = (typeof modes)[number];
const names = ["Alex Stone", "Ada Stone", "Bo Reed"];

async function openGame(
  page: Page,
  mode: Mode,
  playerNames = names,
  roundCount = 1,
  numericScores = { points: "-12", tiebreaker: "7" },
) {
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(`${appUrl}#/${mode.route}/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  const gameId = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
    const { phasesApi } = await import("/scorekeeper/src/data/api/phases.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const players = [];
    for (const [index, name] of ${JSON.stringify(playerNames)}.entries()) {
      players.push(await playersApi.create({
        name, color: ["Jam", "Santorini", "#123456"][index % 3], isFavorite: 0,
      }));
    }
    const ids = players.map(player => player.id);
    const settings = ${JSON.stringify(mode.settings)};
    const phaseGame = ${JSON.stringify(makePhaseGraphGame({ settings: { tiebreaker: "fewestSkips", roundSkipPenalty: 0, sitOutPenalty: 0 } }))};
    phaseGame.phaseSet.phases = Array(${roundCount + 3}).fill((await phasesApi.getAll())[0].id);
    const game = settings
      ? await genericGamesApi.create({ players: ids, settings })
      : await gamesApi.create({
          phaseSet: phaseGame.phaseSet,
          settings: phaseGame.settings,
          players: ids,
        });
    for (let round = 0; round < ${roundCount}; round++) {
      if (settings) {
        await genericRoundsApi.add({ gameId: game.id, mode: settings.mode,
          scores: ids.map((playerId, index) => settings.mode === "points"
            ? { playerId, points: ${JSON.stringify(numericScores.points)},
                ...(settings.tiebreaker ? { tiebreaker: ${JSON.stringify(numericScores.tiebreaker)} } : {}) }
            : settings.mode === "singleRoundWinner" ? { playerId, won: index === 0 }
            : { playerId, passed: index === 0 }),
        });
      } else {
        await roundsApi.add({ gameId: game.id, roundWinnerId: ids[0],
          scores: ids.map((playerId, index) => ({
            playerId, phaseStatus: index === 0 ? "completed" : "failed", score: 0,
          })),
        });
      }
    }
    return game.id;
  })()`);
  const url = `${appUrl}#/${mode.route}/game/${gameId}`;
  await page.goto(url);
  await scoreboard(page).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { gameId, url };
}

function scoreboard(page: Page) {
  return page.getByRole("region", { name: "Scoreboard", exact: true });
}

function toggles(page: Page) {
  return scoreboard(page).getByRole("button", { name: /(?:Show|Hide) all Player names/ });
}

async function settleMotion(locator: Locator) {
  await locator.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  });
}

it.each(modes)("toggles every $label header together from different Players", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await openGame(page, mode, names, 0);
    const controls = toggles(page);
    expect(await controls.count()).toBe(3);
    for (const expanded of [true, false, true, false]) {
      await controls.nth(expanded ? 0 : 1).tap();
      await settleMotion(scoreboard(page));
      for (const [index, name] of names.entries()) {
        expect(await controls.nth(index).getAttribute("aria-expanded")).toBe(String(expanded));
        expect(await controls.nth(index).getAttribute("aria-label")).toBe(
          `${name}: ${expanded ? "Hide" : "Show"} all Player names`,
        );
        expect(await scoreboard(page).getByText(name, { exact: true }).isVisible()).toBe(expanded);
      }
      await page.touchscreen.tap(5, 5);
      expect(await controls.first().getAttribute("aria-expanded")).toBe(String(expanded));
    }
  } finally {
    await page.close();
  }
}, 30_000);

async function bounds(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("Expected visible scoreboard content");
  return result;
}

const longNames = [
  "Alexandria Stone with an extraordinarily long Player name",
  "Adelaide Stone with another extraordinarily long Player name",
  "Bo Reed",
  "Casey Park",
  "Drew Avery",
  "Erin Taylor",
  "Fran Quinn",
];

function headers(page: Page) {
  return scoreboard(page).locator(".scoreboard-cell--sticky-top");
}

async function expectAligned(page: Page, playerCount: number) {
  const columns = await headers(page).all();
  const cells = scoreboard(page).locator(".scoreboard-cell--anchor-top");
  for (let index = 0; index < playerCount; index++) {
    const header = await bounds(columns[index]);
    const cell = await bounds(cells.nth(index + 1));
    expect(cell.x).toBeCloseTo(header.x, 1);
    expect(cell.width).toBeCloseTo(header.width, 1);
  }
}

it.each([
  modes[0],
  modes[2],
])("bounds $label name-driven columns to the visible scroller through resizing and scrolling", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  try {
    await openGame(page, mode, longNames, 24);
    const card = scoreboard(page);
    const compact = await bounds(headers(page).first());
    expect(compact.width).toBeLessThan(90);
    await toggles(page).first().click();
    await settleMotion(card);
    for (const width of [320, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 568 });
      await page.emulateMedia({ colorScheme: width === 1280 ? "dark" : "light" });
      await settleMotion(card);
      const column = await bounds(headers(page).first());
      const visibleWidth = await card.evaluate((element) => element.clientWidth);
      expect(column.width).toBeGreaterThan(compact.width);
      expect(column.width).toBeLessThanOrEqual(visibleWidth / 2 + 1);
      const name = card.getByText(longNames[0], { exact: true });
      expect(
        await name.evaluate((element) => ({
          ellipsis: getComputedStyle(element).textOverflow,
          wrapping: getComputedStyle(element).whiteSpace,
          clipped: element.scrollWidth > element.clientWidth,
        })),
      ).toEqual({ ellipsis: "ellipsis", wrapping: "nowrap", clipped: true });
      const nameBox = await bounds(name);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(column.x + column.width);
      await expectAligned(page, longNames.length);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    const top = (await bounds(headers(page).first())).y;
    const roundColumn = card.locator(".scoreboard-cell--sticky-left").first();
    const left = (await bounds(roundColumn)).x;
    await card.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = 100;
    });
    expect(await card.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await card.evaluate((element) => element.scrollLeft)).toBe(100);
    expect((await bounds(headers(page).first())).y).toBeCloseTo(top, 1);
    expect((await bounds(roundColumn)).x).toBeCloseTo(left, 1);
    await expectAligned(page, longNames.length);
    await toggles(page).nth(1).click();
    await settleMotion(card);
    expect((await bounds(headers(page).first())).width).toBeCloseTo(compact.width, 1);
    await expectAligned(page, longNames.length);
  } finally {
    await page.close();
  }
}, 30_000);

async function closeDialog(page: Page, dialog: Locator) {
  await settleMotion(dialog);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
}

async function saveRound(page: Page, mode: Mode) {
  await scoreboard(page)
    .getByRole("button", { name: /^Add [Rr]ound/ })
    .click();
  const dialog = page.getByRole("dialog");
  if (!mode.settings) {
    await dialog.getByRole("button", { name: /Round Winner/ }).click();
    await page.getByRole("option", { name: names[0], exact: true }).click();
    for (const name of names.slice(1)) {
      await dialog.getByRole("tab", { name, exact: true }).click();
      await dialog.getByRole("button", { name: "Failed", exact: true }).click();
    }
  } else if (mode.settings.mode === "singleRoundWinner") {
    await dialog.getByRole("radio", { name: names[0], exact: true }).click();
  }
  await dialog
    .getByRole("button", { name: mode.settings ? "Save" : "Save round", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
}

it.each(
  modes,
)("preserves $label names across saves and dialogs, resets on navigation, and reveals finalized identities", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const { gameId, url } = await openGame(page, mode, names, 0);
    await toggles(page).first().click();
    await settleMotion(scoreboard(page));
    const avatars = headers(page).locator('span[style*="background-color"]:visible');
    const colors = await avatars.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
    expect(await avatars.allTextContents()).toEqual(["", "", "BR"]);
    expect(await avatars.locator("svg").count()).toBe(2);
    await scoreboard(page)
      .getByRole("button", { name: /^Add [Rr]ound/ })
      .click();
    await closeDialog(page, page.getByRole("dialog"));
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");
    await saveRound(page, mode);
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");
    await expectAligned(page, names.length);

    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    await closeDialog(page, page.getByRole("dialog"));
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");

    if (!mode.settings) {
      await page.getByRole("button", { name: "Open Phases Card", exact: true }).click();
      const card = page.getByRole("dialog", { name: "Phases Card", exact: true });
      const phase = card.getByRole("button", { name: "Players on Phase 1", exact: true });
      await phase.click();
      expect(await phase.getAttribute("aria-expanded")).toBe("true");
      await closeDialog(page, card);
      expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");
      await toggles(page).nth(1).click();
      await page.getByRole("button", { name: "Open Phases Card", exact: true }).click();
      expect(await phase.getAttribute("aria-expanded")).toBe("false");
      await phase.click();
      await closeDialog(page, card);
      expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("false");
      await toggles(page).first().click();
    }

    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Games", exact: true }).click();
    await scoreboard(page).waitFor({ state: "detached" });
    await page.goBack();
    await scoreboard(page).waitFor();
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("false");
    await toggles(page).first().click();
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Finish Game", exact: true })
      .getByRole("button", { name: "Finish", exact: true })
      .click();
    const standings = page.getByRole("dialog").filter({
      has: page.getByRole("tab", { name: "Standings", exact: true }),
    });
    await standings.getByRole("tab", { name: "Standings", exact: true }).waitFor();
    await closeDialog(page, standings);
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");

    await page.evaluate(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { ${mode.settings ? "genericGamesApi" : "gamesApi"}: games } =
          await import("/scorekeeper/src/data/api/${mode.settings ? "genericGames" : "games"}.ts");
        const game = await games.getById(${JSON.stringify(gameId)});
        await playersApi.update(game.players[0], { name: "Changed Player", color: "Rose" });
        await playersApi.delete(game.players[1]);
      })()`);
    await page.reload();
    await standings.getByRole("tab", { name: "Standings", exact: true }).waitFor();
    await closeDialog(page, standings);
    expect(page.url()).toBe(url);
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("false");
    await toggles(page).nth(1).click();
    await settleMotion(scoreboard(page));
    for (const name of names) {
      expect(await scoreboard(page).getByText(name, { exact: true }).isVisible()).toBe(true);
    }
    expect(await scoreboard(page).getByText("Changed Player", { exact: true }).count()).toBe(0);
    expect(
      await avatars.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).backgroundColor),
      ),
    ).toEqual(colors);
    await expectAligned(page, names.length);
    await toggles(page).first().click();
    await settleMotion(scoreboard(page));
    expect(await avatars.allTextContents()).toEqual(["AS", "AS", "BR"]);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  1, 7,
])("keeps signed numeric extremes readable with %i Players in both header modes", async (playerCount) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  try {
    await openGame(page, modes[2], longNames.slice(0, playerCount), 1, {
      points: "-9007199254740991",
      tiebreaker: "9007199254740991",
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const expanded of [true, false]) {
        await toggles(page).first().click();
        await settleMotion(scoreboard(page));
        expect(await toggles(page).first().getAttribute("aria-expanded")).toBe(String(expanded));
        const header = headers(page).first();
        const cell = scoreboard(page).getByRole("cell").first();
        for (const container of [header, cell]) {
          const column = await bounds(container);
          const numbers = await container
            .locator("span")
            .filter({
              hasText: /^((Total Points: |Total Tiebreaker: )?-?9007199254740991)$/,
            })
            .all();
          expect(numbers.length).toBe(2);
          for (const text of numbers) {
            const box = await bounds(text);
            expect(box.x).toBeGreaterThanOrEqual(column.x);
            expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
            expect(
              await text.evaluate((element) => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
          }
        }
        expect(await cell.innerText()).toContain("-9007199254740991");
        const dealer = await bounds(cell.getByText("D", { exact: true }));
        const number = await bounds(cell.getByText("-9007199254740991", { exact: true }));
        expect(dealer.x + dealer.width).toBeLessThan(number.x);
        await expectAligned(page, playerCount);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      }
    }
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  modes[0],
  modes[2],
])("keeps a solo $label name on one line within its aligned column after resizing", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  try {
    await openGame(page, mode, [longNames[0]]);
    for (const width of [320, 1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const expanded of [true, false]) {
        await toggles(page).first().click();
        await settleMotion(scoreboard(page));
        const name = scoreboard(page).getByText(longNames[0], { exact: true });
        expect(await name.isVisible()).toBe(expanded);
        if (expanded) {
          const text = await bounds(name);
          const column = await bounds(headers(page).first());
          expect(text.x).toBeGreaterThanOrEqual(column.x);
          expect(text.x + text.width).toBeLessThanOrEqual(column.x + column.width);
        }
        await expectAligned(page, 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
    }
  } finally {
    await page.close();
  }
}, 30_000);

function sampleToggle(card: Locator) {
  return card.evaluate(async (element) => {
    const header = element.querySelector<HTMLElement>(".scoreboard-cell--sticky-top");
    const toggle = header?.querySelector("button");
    const cell = element.querySelectorAll(".scoreboard-cell--anchor-top")[1];
    const name = Array.from(header?.querySelectorAll("span") ?? []).find(
      (span) => span.childElementCount === 0 && span.textContent?.startsWith("Alexandria Stone"),
    );
    const avatar = header?.querySelector<HTMLElement>(
      '.scoreboard-identity-named span[style*="background-color"]',
    );
    if (!header || !toggle || !cell || !name || !avatar) throw new Error("Missing header content");
    function sample() {
      if (!header || !name || !avatar) throw new Error("Missing identity geometry");
      const column = header.getBoundingClientRect();
      const score = cell.getBoundingClientRect();
      const icon = avatar.getBoundingClientRect();
      let visibleRight = name.getBoundingClientRect().right;
      for (
        let parent = name.parentElement;
        parent && parent !== header;
        parent = parent.parentElement
      ) {
        if (["hidden", "clip"].includes(getComputedStyle(parent).overflowX)) {
          visibleRight = Math.min(visibleRight, parent.getBoundingClientRect().right);
        }
      }
      return {
        width: column.width,
        cellWidth: score.width,
        alignment: score.x - column.x,
        avatarWidth: icon.width,
        avatarHeight: icon.height,
        textHeight: name.getBoundingClientRect().height,
        opacity: Number(getComputedStyle(name).opacity),
        textOverflow: Math.max(0, visibleRight - column.right),
      };
    }
    const before = sample();
    toggle.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    const frames = [];
    for (const progress of [0.25, 0.5, 0.75, 1]) {
      for (const animation of animations) {
        animation.currentTime = Number(animation.effect?.getComputedTiming().endTime) * progress;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      frames.push(sample());
    }
    for (const animation of animations) animation.finish();
    return { before, frames, after: sample() };
  });
}

it.each([
  modes[0],
  modes[2],
])("animates $label name reveal and actual score columns together in both directions", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openGame(page, mode, longNames);
    await settleMotion(scoreboard(page));
    for (const expanding of [true, false]) {
      const { before, frames, after } = await sampleToggle(scoreboard(page));
      expect(after.width > before.width).toBe(expanding);
      const intermediate = frames.filter(
        (frame) =>
          frame.width > Math.min(before.width, after.width) + 1 &&
          frame.width < Math.max(before.width, after.width) - 1,
      );
      expect(intermediate.length).toBeGreaterThan(0);
      for (const frame of intermediate) {
        expect(frame.cellWidth).toBeCloseTo(frame.width, 1);
        expect(frame.alignment).toBeCloseTo(0, 1);
        expect(frame.opacity).toBeGreaterThan(0);
        expect(frame.opacity).toBeLessThan(1);
        expect(frame.avatarWidth).toBe(26);
        expect(frame.avatarHeight).toBe(26);
        expect(frame.textHeight).toBe(after.textHeight);
        expect(frame.textOverflow).toBe(0);
      }
    }
    // Interrupt in-flight transitions, rather than waiting between activations.
    await toggles(page)
      .first()
      .evaluate(async (element) => {
        if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a header button");
        for (let index = 0; index < 5; index++) {
          element.click();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      });
    await settleMotion(scoreboard(page));
    expect(await toggles(page).first().getAttribute("aria-expanded")).toBe("true");
    await expectAligned(page, longNames.length);
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  modes[0],
  modes[2],
])("supports $label keyboard toggles and reduced motion without losing full accessible names", async (mode) => {
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    reducedMotion: "reduce",
  });
  try {
    await openGame(page, mode, longNames);
    const control = toggles(page).first();
    await control.focus();
    expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    expect(
      await control.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).outlineWidth),
      ),
    ).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    expect(await control.getAttribute("aria-expanded")).toBe("true");
    expect(await control.getAttribute("aria-label")).toContain(longNames[0]);
    expect(
      await scoreboard(page).evaluate((element) => element.getAnimations({ subtree: true }).length),
    ).toBe(0);
    // Safari includes buttons in sequential keyboard navigation with Option-Tab.
    await page.keyboard.press("Alt+Tab");
    expect(
      await toggles(page)
        .nth(1)
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("Space");
    expect(await control.getAttribute("aria-expanded")).toBe("false");
    await expectAligned(page, longNames.length);
  } finally {
    await page.close();
  }
}, 30_000);
