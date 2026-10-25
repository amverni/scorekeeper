/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
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

it.each([
  "light",
  "dark",
] as const)("keeps signed safe-integer Points and Tiebreaker values unclipped in a solo %s Game", async (colorScheme) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, colorScheme });
  page.setDefaultTimeout(5_000);
  try {
    const id = await openGame(
      page,
      {
        mode: "points",
        pointsDirection: "low",
        tiebreaker: { direction: "high" },
        dealer: true,
      },
      ["Maya Chen"],
    );
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(id)});
      await genericRoundsApi.add({ gameId: game.id, mode: "points",
        scores: [{ playerId: game.players[0], points: "-9007199254740991", tiebreaker: "9007199254740991" }],
      });
    })()`);
    await page.reload();
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    const cell = card.getByRole("cell", {
      name: "Maya Chen, Round 1: -9007199254740991 Points, 9007199254740991 Tiebreaker, Dealer",
      exact: true,
    });
    await cell.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const header = card.getByRole("columnheader", { name: /Maya Chen/ });
    expect(await header.innerText()).toContain("Total Points: -9007199254740991");
    expect(await header.innerText()).toContain("Total Tiebreaker: 9007199254740991");
    for (const number of [
      header.getByText("Total Points:", { exact: true }).locator(".."),
      header.getByText("Total Tiebreaker:", { exact: true }).locator(".."),
      cell.getByText("-9007199254740991", { exact: true }),
      cell.getByText("9007199254740991", { exact: true }),
    ]) {
      expect(await number.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const bounds = await box(number);
      const column = await box(header);
      expect(bounds.x).toBeGreaterThanOrEqual(column.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(column.x + column.width);
      expect(
        Math.abs(bounds.x + bounds.width / 2 - (column.x + column.width / 2)),
      ).toBeLessThanOrEqual(0.6);
    }
    const marker = await box(cell.getByText("D", { exact: true }));
    expect(marker.x + marker.width).toBeLessThan(
      (await box(cell.getByText("-9007199254740991", { exact: true }))).x,
    );
    await cell.click();
    expect(await cell.innerText()).toContain("Accumulated Points: -9007199254740991");
    expect(await cell.innerText()).toContain("Accumulated Tiebreaker: 9007199254740991");
    expect(await cell.getAttribute("aria-describedby")).toBeTruthy();
    expect(await card.getByRole("row").last().getByRole("cell").allTextContents()).toEqual(["D"]);
    const upcomingDealer = await box(
      card.getByRole("row").last().getByRole("cell").getByText("D", { exact: true }),
    );
    expect(upcomingDealer.x).toBeCloseTo(marker.x, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.evaluate(`(async () => {
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      const game = await genericGamesApi.getById(${JSON.stringify(id)});
      await genericRoundsApi.add({ gameId: game.id, mode: "points",
        scores: [{ playerId: game.players[0], points: "7", tiebreaker: "-1" }],
      });
    })()`);
    await page.reload();
    await cell.waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const savedDealer = await box(cell.getByText("D", { exact: true }));
      for (const badge of await card.getByText("D", { exact: true }).all()) {
        expect((await box(badge)).x).toBeCloseTo(savedDealer.x, 1);
      }
      const shortCell = card.getByRole("cell", {
        name: "Maya Chen, Round 2: 7 Points, -1 Tiebreaker, Dealer",
        exact: true,
      });
      const shortBounds = await box(shortCell);
      const shortValue = await box(shortCell.getByText("7", { exact: true }));
      expect(shortValue.x + shortValue.width / 2).toBeCloseTo(
        shortBounds.x + shortBounds.width / 2,
        1,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  } finally {
    await page.close();
  }
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Expected visible scoreboard content");
  return bounds;
}

async function openGame(
  page: Page,
  settings: GenericGameSettings,
  names = ["Maya Chen", "Rowan Patel"],
) {
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(`${appUrl}#/scorekeeper/players`);
  await page.getByText("No players yet", { exact: true }).waitFor();
  const id = await page.evaluate<string>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const players = [];
    for (const name of ${JSON.stringify(names)}) {
      players.push((await playersApi.create({ name, color: "#16A34A", isFavorite: 0 })).id);
    }
    return (await genericGamesApi.create({ players, settings: ${JSON.stringify(settings)} })).id;
  })()`);
  await page.goto(`${appUrl}#/scorekeeper/game/${id}`);
  await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return id;
}

async function saveRounds(page: Page, gameId: string, count = 2) {
  await page.evaluate(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
    const game = await genericGamesApi.getById(${JSON.stringify(gameId)});
    const mode = game.settings.mode;
    for (let round = 0; round < ${count}; round++) {
      await genericRoundsApi.add({
        gameId: game.id, mode,
        scores: game.players.map((playerId, index) => mode === "points"
          ? { playerId, points: round === 0 ? "-12" : "7",
              ...(game.settings.tiebreaker ? { tiebreaker: round === 0 ? "4" : "-1" } : {}) }
          : mode === "singleRoundWinner" ? { playerId, won: index === round % game.players.length }
          : { playerId, passed: index === round % game.players.length }),
      });
    }
  })()`);
  await page.reload();
  await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
}

const modes: Array<{ label: string; settings: GenericGameSettings; metric: string }> = [
  {
    label: "Points",
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
    metric: "Points",
  },
  {
    label: "Points with Tiebreaker",
    settings: {
      mode: "points",
      pointsDirection: "low",
      tiebreaker: { direction: "high" },
      dealer: true,
    },
    metric: "Points",
  },
  {
    label: "Single Round Winner",
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
    metric: "Wins",
  },
  {
    label: "Pass/Fail",
    settings: { mode: "passFail", tiebreaker: null, dealer: false },
    metric: "Passes",
  },
];

it.each(
  modes.flatMap((mode) => [
    mode,
    { ...mode, settings: { ...mode.settings, dealer: !mode.settings.dealer } },
  ]),
)("centers $label entries with Dealer tracking $settings.dealer without changing table density", async ({
  settings,
}) => {
  for (const playerCount of [1, 2, 7]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      colorScheme: playerCount === 2 ? "dark" : "light",
      hasTouch: true,
    });
    page.setDefaultTimeout(5_000);
    try {
      const id = await openGame(
        page,
        settings,
        Array.from({ length: playerCount }, (_, index) => `Player ${index + 1}`),
      );
      await saveRounds(page, id, playerCount);
      await page.evaluate(() => document.fonts.ready);
      const card = page.getByRole("region", { name: "Scoreboard", exact: true });
      const cell = card.getByRole("row").nth(1).getByRole("cell").first();
      const value =
        settings.mode === "points"
          ? cell.getByText("-12", { exact: true })
          : cell.locator("svg").first();
      const positions: Array<{ width: number; offset: number }> = [];
      for (const width of [320, 350, 390, 512, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await box(cell);
        const main = await box(value);
        const center = main.x + main.width / 2;
        expect(Math.abs(center - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(0.6);
        expect(bounds.height).toBe(settings.tiebreaker ? (playerCount === 1 ? 58 : 59) : 44);
        expect(bounds.width).toBeCloseTo(
          playerCount === 7
            ? settings.mode === "points" && settings.dealer
              ? 73.515625
              : 70
            : (Math.min(width, 512) - 32 - 2 - 36) / playerCount,
          1,
        );
        if (settings.mode === "points") {
          expect(await value.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
            "16px",
          );
        } else {
          expect(main.width).toBe(16);
          expect(main.height).toBe(16);
        }
        if (settings.tiebreaker) {
          const secondary = await box(cell.getByText("4", { exact: true }));
          expect(secondary.x + secondary.width / 2).toBeCloseTo(center, 1);
        }
        if (settings.dealer) {
          const badge = await box(cell.getByText("D", { exact: true }));
          expect(badge.width).toBe(17);
          expect(badge.height).toBe(17);
          expect(badge.x + badge.width).toBeLessThan(main.x);
          const offset = center - (badge.x + badge.width / 2);
          positions.push({ width: bounds.width, offset });
          expect(offset).toBeLessThan(60);
          if (playerCount === 7) {
            // Dealer tracking previously reserved 24px on each side of the central value.
            const outer = badge.x + badge.width / 2 - 12 - (bounds.x + 2);
            const interior = main.x - (badge.x + badge.width / 2 + 12);
            expect(outer).toBeGreaterThanOrEqual(0);
            expect(interior).toBeCloseTo(outer * 2, 0);
          }
        }
        const upcoming = card.getByRole("row").last().getByRole("cell").first();
        expect((await upcoming.innerText()).trim()).toBe(settings.dealer ? "D" : "");
        expect((await box(upcoming)).height).toBe(44);
        if (settings.dealer) {
          const nextBadge = await box(upcoming.getByText("D", { exact: true }));
          const savedBadge = await box(cell.getByText("D", { exact: true }));
          expect(nextBadge.x).toBeCloseTo(savedBadge.x, 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      if (settings.dealer && playerCount === 1) {
        expect(positions[2].width).toBeGreaterThan(positions[0].width);
        expect(positions[0].offset).toBeCloseTo(positions[2].offset, 1);
      }
      if (settings.dealer && playerCount === 2) {
        expect(positions[0].offset).toBeLessThan(positions[1].offset);
        expect(positions[1].offset).toBeLessThan(positions[2].offset);
        expect(positions[2].offset).toBeCloseTo(positions[3].offset, 1);
        expect(positions[3].offset).toBeCloseTo(positions[4].offset, 1);
      }
      const before = await box(value);
      const savedBounds = await box(cell);
      await cell.tap();
      expect(await box(value)).toEqual(before);
      expect((await box(cell)).height).toBe(
        settings.tiebreaker ? (playerCount === 1 ? 151 : 152) : playerCount === 1 ? 119 : 120,
      );
      expect(await cell.getByRole("button", { name: /^Edit Round/ }).count()).toBe(1);
      for (const detail of await cell.locator(".scoreboard-extras span:has(> .sr-only)").all()) {
        const bounds = await box(detail);
        expect(bounds.x + bounds.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
      }
      await cell.tap();
      expect(await box(cell)).toEqual(savedBounds);
    } finally {
      await page.close();
    }
  }
}, 60_000);

it.each([2, 7])("matches the capped header/footer width with %i Players", async (playerCount) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5_000);
  try {
    await openGame(
      page,
      { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
      Array.from({ length: playerCount }, (_, index) => `Player ${index + 1}`),
    );
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    for (const [width, height, left, right] of [
      [1280, 900, 0, 0],
      [1920, 1080, 0, 0],
      [390, 844, 0, 0],
      [320, 568, 0, 0],
      [844, 390, 44, 0],
      [844, 390, 0, 44],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        ({ left, right }) => {
          document.documentElement.style.setProperty("--safe-area-inset-left", `${left}px`);
          document.documentElement.style.setProperty("--safe-area-inset-right", `${right}px`);
        },
        { left, right },
      );
      const bounds = await box(card);
      const menu = await box(page.getByRole("button", { name: "Menu", exact: true }));
      const finish = await box(page.getByRole("button", { name: "Finish Game", exact: true }));
      const standings = await box(
        page.getByRole("button", { name: "Open Standings", exact: true }),
      );
      expect(bounds.width, `scoreboard width at ${width}px`).toBe(
        Math.min(width - left - right, 512) - 32,
      );
      expect(bounds.x).toBeCloseTo(standings.x, 1);
      expect(bounds.x + bounds.width).toBeCloseTo(finish.x + finish.width, 1);
      expect(bounds.x + bounds.width).toBeCloseTo(menu.x + menu.width, 1);
      expect(await card.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        playerCount === 7,
      );
      if (playerCount === 7) {
        await card.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        expect(await card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  } finally {
    await page.close();
  }
}, 30_000);

it("shows a compact blank upcoming row, compact Player badges, and a small Add Round control", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openGame(page, {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: null,
      dealer: false,
    });
    const table = page.getByRole("table", { name: "Points scoreboard", exact: true });
    const corner = table.getByRole("columnheader").first();
    expect((await box(corner)).width).toBe(36);
    expect((await corner.innerText()).trim()).toBe("Round");
    expect(
      await corner
        .getByText("Round", { exact: true })
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("absolute");
    const header = table.getByRole("columnheader", { name: /Maya Chen/ });
    expect((await box(header)).height).toBe(75);
    expect(await header.getByText("MC", { exact: true }).count()).toBe(1);
    expect(await header.getByText("Maya Chen", { exact: true }).isVisible()).toBe(false);
    expect(
      await header
        .getByRole("button", { name: "Maya Chen: Show all Player names", exact: true })
        .count(),
    ).toBe(1);
    const upcoming = table.getByRole("row").last();
    expect(await table.getByRole("row").count()).toBe(2);
    expect(await upcoming.getByRole("cell").count()).toBe(2);
    expect((await box(upcoming.getByRole("cell").first())).height).toBe(44);
    expect(await upcoming.getByRole("cell").count()).toBe(2);
    expect(await upcoming.getByRole("cell").allTextContents()).toEqual(["", ""]);
    expect(await table.getByText("No rounds yet.", { exact: true }).count()).toBe(0);
    const add = table.getByRole("button", { name: "Add Round", exact: true });
    expect((await box(add)).width).toBeLessThanOrEqual(36);
    expect(await add.innerText()).toBe("");
    await add.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog", { name: "Add Round", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => add.evaluate((element) => element === document.activeElement))
      .toBe(true);
  } finally {
    await page.close();
  }
}, 30_000);

it.each(
  modes,
)("expands only the selected $label Round from cells or keyboard and collapses outside", async ({
  settings,
  metric,
}) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  try {
    const id = await openGame(page, settings);
    await saveRounds(page, id);
    const card = page.getByRole("region", { name: "Scoreboard", exact: true });
    const row = card.getByRole("row").nth(1);
    const cell = row.getByRole("cell").first();
    const control = row.getByRole("button", { name: /^(Expand|Collapse) Round 1$/ });
    const next = card
      .getByRole("row")
      .nth(2)
      .getByRole("button", { name: /^(Expand|Collapse) Round 2$/ });
    const before = await box(control.locator("span"));
    await cell.tap();
    expect(await control.getAttribute("aria-expanded")).toBe("true");
    expect(await cell.innerText()).toContain(
      `Accumulated ${metric}: ${settings.mode === "points" ? "-12" : "1"}`,
    );
    const after = await box(control.locator("span"));
    expect(after.y).toBe(before.y);
    expect((await box(row.getByRole("rowheader"))).height).toBe((await box(cell)).height);
    if (settings.tiebreaker) {
      expect(await cell.innerText()).toContain("Accumulated Tiebreaker: 4");
    }
    await next.focus();
    await page.keyboard.press("Space");
    expect(await control.getAttribute("aria-expanded")).toBe("false");
    expect(await next.getAttribute("aria-expanded")).toBe("true");
    expect(await card.getByRole("button", { expanded: true }).count()).toBe(1);
    expect(await card.getByRole("row").nth(2).getByRole("cell").first().innerText()).toContain(
      `Accumulated ${metric}: ${settings.mode === "points" ? "-5" : "1"}`,
    );
    await page.locator(".page-shell-header").tap({ position: { x: 2, y: 2 } });
    expect(await next.getAttribute("aria-expanded")).toBe("false");
    await control.focus();
    await page.keyboard.press("Enter");
    expect(await control.getAttribute("aria-expanded")).toBe("true");
    await cell.tap();
    expect(await control.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await page.close();
  }
}, 30_000);

it.each(
  modes,
)("preserves compact $label columns, sticky axes, and read-only completed snapshots in both themes", async ({
  settings,
  metric,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 568 },
      colorScheme,
      hasTouch: true,
    });
    page.setDefaultTimeout(5_000);
    try {
      const names = [
        "Maya Chen",
        "Rowan Patel",
        "Lee",
        "Alexandria",
        "Christopher",
        "Jo",
        "Taylor",
      ];
      const id = await openGame(page, settings, names);
      const card = page.getByRole("region", { name: "Scoreboard", exact: true });
      expect(await card.getByRole("cell", { name: /upcoming Round/ }).count()).toBe(7);
      expect(await card.getByText("D", { exact: true }).count()).toBe(settings.dealer ? 1 : 0);
      await saveRounds(page, id, 24);
      const headers = card.getByRole("columnheader");
      expect(await headers.count()).toBe(8);
      for (const [index, name] of names.entries()) {
        expect(
          await headers
            .nth(index + 1)
            .getByText(name, { exact: true })
            .count(),
        ).toBe(1);
      }
      const header = headers.nth(1);
      const total = header.getByText(`Total ${metric}:`, { exact: true }).locator("..");
      expect(await total.evaluate((element) => getComputedStyle(element).fontSize)).toBe("24px");
      expect(await header.innerText()).toContain(
        `Total ${metric}: ${settings.mode === "points" ? 149 : 4}`,
      );
      expect(await header.getByText("Total Tiebreaker:", { exact: true }).count()).toBe(
        settings.tiebreaker ? 1 : 0,
      );
      if (settings.tiebreaker) {
        expect(await header.innerText()).toContain("Total Tiebreaker: -19");
      }
      const firstRow = card.getByRole("rowheader").first();
      expect((await box(firstRow)).height).toBe(settings.tiebreaker ? 59 : 44);
      const corner = headers.first();
      const initial = await box(corner);
      const background = await corner.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(background).toBe(colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)");
      await card.focus();
      await page.keyboard.down("ArrowRight");
      try {
        await expect.poll(() => card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      } finally {
        await page.keyboard.up("ArrowRight");
      }
      await card.evaluate((element) => {
        element.scrollLeft = 180;
        element.scrollTop = 360;
      });
      expect(await card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      expect(await card.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(corner)).toEqual(initial);
      expect((await box(card.getByRole("rowheader").nth(10))).x).toBe(initial.x);
      expect((await box(header)).y).toBe(initial.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      const upcoming = card.getByRole("row").last();
      expect(await upcoming.getByRole("cell").allTextContents()).toEqual(
        names.map((_, index) => (settings.dealer && index === 3 ? "D" : "")),
      );
      const add = upcoming.getByRole("button", { name: "Add Round", exact: true });
      await add.scrollIntoViewIfNeeded();
      expect(
        await add.evaluate(
          (element) =>
            element.parentElement && getComputedStyle(element.parentElement).borderTopStyle,
        ),
      ).toBe("dashed");
      expect((await box(add)).x).toBe(initial.x);
      await page.evaluate(`(async () => {
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const game = await genericGamesApi.finish(${JSON.stringify(id)});
        await playersApi.update(game.players[0], { name: "Changed name", color: "#A00000" });
        await playersApi.delete(game.players[1]);
      })()`);
      await page.reload();
      const standings = page.getByRole("dialog", { name: "Standings", exact: true });
      await standings.getByRole("button", { name: "Close", exact: true }).click();
      await standings.waitFor({ state: "detached" });
      expect(await card.getByRole("columnheader", { name: /Maya Chen/ }).count()).toBe(1);
      expect(await card.getByRole("columnheader", { name: /Rowan Patel/ }).count()).toBe(1);
      expect(await card.getByRole("columnheader", { name: /Changed name/ }).count()).toBe(0);
      expect(await card.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
      expect(await card.getByRole("cell", { name: /upcoming Round/ }).count()).toBe(0);
      await card.getByRole("row").nth(1).getByRole("cell").first().click();
      expect(
        await card.getByRole("button", { name: "Collapse Round 1", exact: true }).count(),
      ).toBe(1);
      expect(await card.getByRole("button", { name: /Edit|Delete/ }).count()).toBe(0);
    } finally {
      await page.close();
    }
  }
}, 60_000);
