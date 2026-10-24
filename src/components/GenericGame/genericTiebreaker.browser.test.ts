/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { returnToDashboard } from "../../test/gameNavigation";
import type { GenericGame, GenericRound, PlayerIdentity } from "../../types";

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

async function seedPlayers(page: Page, names = ["Maya"]) {
  await page.goto(`${appUrl}#/scorekeeper`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<PlayerIdentity[]>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const players = [];
    for (const [index, name] of ${JSON.stringify(names)}.entries()) {
      players.push(await playersApi.create({
        name, color: index === 0 ? "#123456" : "#abcdef", isFavorite: 1,
      }));
    }
    return players;
  })()`);
}

async function selectMode(page: Page, name: "Points" | "Single Round Winner" | "Pass/Fail") {
  await page.getByLabel("Scoring Mode", { exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

it.each([
  "no-preference",
  "reduce",
] as const)("keeps Scoring Mode pointer-selectable when reopening during dismissal after layout changes (%s motion)", async (reducedMotion) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion,
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const trigger = page.getByLabel("Scoring Mode", { exact: true });
    const enable = page.getByRole("switch", { name: "Enable Tiebreaker", exact: true });
    for (let cycle = 0; cycle < 10; cycle++) {
      await enable.click();
      await trigger.click();
      await page.keyboard.press("Escape");
      expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Space");
      await page.getByRole("option", { name: "Pass/Fail", exact: true }).click();
      expect(await trigger.innerText()).toContain("Pass/Fail");
      await selectMode(page, "Points");
      expect(await enable.isChecked()).toBe(cycle % 2 === 0);
    }
    await trigger.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await trigger.innerText()).toContain("Single Round Winner");
    expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
    await trigger.press("Space");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    expect(await trigger.innerText()).toContain("Points");
    expect(await enable.isChecked()).toBe(false);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  "Single Round Winner",
  "Pass/Fail",
] as const)("restores Tiebreaker choices through %s without leaking them into a count Game or new setup", async (mode) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await seedPlayers(page);
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("button", { name: "Maya", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const enable = page.getByRole("switch", { name: "Enable Tiebreaker", exact: true });
    const primary = page.getByRole("radiogroup", { name: "Points Direction", exact: true });
    const secondary = page.getByRole("radiogroup", { name: "Tiebreaker Direction", exact: true });
    expect(await enable.isChecked()).toBe(false);
    expect(await secondary.count()).toBe(0);
    expect(await primary.getByRole("radio", { name: "High wins" }).isChecked()).toBe(true);
    await enable.click();
    expect(await secondary.getByRole("radio", { name: "High wins" }).isChecked()).toBe(true);
    await secondary.getByRole("radio", { name: "Low wins" }).click();
    await primary.getByRole("radio", { name: "Low wins" }).click();
    await selectMode(page, mode);
    await expect.poll(() => enable.count()).toBe(0);
    expect(await primary.count()).toBe(0);
    expect(await secondary.count()).toBe(0);
    await selectMode(page, "Points");
    expect(await enable.isChecked()).toBe(true);
    expect(await primary.getByRole("radio", { name: "Low wins" }).isChecked()).toBe(true);
    expect(await secondary.getByRole("radio", { name: "Low wins" }).isChecked()).toBe(true);
    await enable.click();
    await expect.poll(() => secondary.count()).toBe(0);
    await enable.click();
    expect(await secondary.getByRole("radio", { name: "Low wins" }).isChecked()).toBe(true);
    await selectMode(page, mode);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
    const gameId = page.url().split("/").at(-1);
    const game = await page.evaluate<GenericGame>(`(async () => {
        const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
        return genericGamesApi.getById(${JSON.stringify(gameId)});
      })()`);
    expect(game.settings).toEqual({
      mode: mode === "Pass/Fail" ? "passFail" : "singleRoundWinner",
      tiebreaker: null,
      dealer: false,
    });
    expect(await page.getByText(/Tiebreaker/).count()).toBe(0);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    await dialog
      .getByRole(mode === "Pass/Fail" ? "button" : "radio", { name: "Maya", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    expect(await standings.innerText()).not.toContain("Tiebreaker");
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    await returnToDashboard(page);
    await page.getByRole("link", { name: "Create Game", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await page.getByLabel("Scoring Mode", { exact: true }).innerText()).toContain("Points");
    expect(await enable.isChecked()).toBe(false);
    expect(await primary.getByRole("radio", { name: "High wins" }).isChecked()).toBe(true);
    await enable.click();
    expect(await secondary.getByRole("radio", { name: "High wins" }).isChecked()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

async function openPointsGame(page: Page, names = ["Maya", "Rowan"]) {
  const players = await seedPlayers(page, names);
  const game = await page.evaluate<GenericGame>(`(async () => {
    const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
    return genericGamesApi.create({
      players: ${JSON.stringify(players.map((player) => player.id))},
      settings: { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: false },
    });
  })()`);
  await page.reload();
  await page.goto(`${appUrl}#/scorekeeper/game/${game.id}`);
  await page.getByRole("table", { name: "Points scoreboard", exact: true }).waitFor();
  return game;
}

it.each([
  "light",
  "dark",
] as const)("keeps the selected metric border stronger without relying on focus in %s mode", async (colorScheme) => {
  const page = await browser.newPage({ colorScheme, viewport: { width: 390, height: 844 } });
  try {
    await openPointsGame(page, ["Maya"]);
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const points = dialog.getByRole("button", { name: "Maya Points", exact: true });
    const secondary = dialog.getByRole("button", { name: "Maya Tiebreaker", exact: true });
    const zero = dialog.getByRole("button", { name: "0", exact: true });
    const sign = dialog.getByRole("button", { name: "Change sign", exact: true });
    const backspace = dialog.getByRole("button", { name: "Backspace", exact: true });
    const border = (field: typeof points) =>
      field.evaluate((element) => getComputedStyle(element).borderTopColor);
    const selectedBorder = await points.evaluate((element) => {
      const reference = document.createElement("span");
      reference.style.color = "var(--color-text-secondary)";
      element.append(reference);
      const color = getComputedStyle(reference).color;
      reference.remove();
      return color;
    });
    const ordinaryBorder = await border(secondary);
    expect(await border(points)).toBe(selectedBorder);
    expect(selectedBorder).not.toBe(ordinaryBorder);
    await zero.focus();
    expect(await points.evaluate((element) => element === document.activeElement)).toBe(false);
    expect(await border(points)).toBe(selectedBorder);
    await page.keyboard.type("12-");
    expect(await points.locator("output").innerText()).toBe("-12");
    await secondary.click();
    expect(await border(points)).toBe(ordinaryBorder);
    expect(await border(secondary)).toBe(selectedBorder);
    expect(await sign.isDisabled()).toBe(true);
    expect(await backspace.isDisabled()).toBe(true);
    for (const key of ["-", "+", "Backspace", "Delete", "0"]) {
      await page.keyboard.press(key);
      expect(await secondary.locator("output").innerText()).toBe("0");
    }
    await dialog.getByRole("button", { name: "3", exact: true }).click();
    await sign.click();
    expect(await secondary.locator("output").innerText()).toBe("-3");
    expect(await points.locator("output").innerText()).toBe("-12");
    await backspace.click();
    expect(await secondary.locator("output").innerText()).toBe("0");
    expect(await sign.isDisabled()).toBe(true);
    expect(await backspace.isDisabled()).toBe(true);
    await zero.focus();
    await page.keyboard.type("4-");
    await page.keyboard.press("Backspace");
    expect(await secondary.locator("output").innerText()).toBe("0");
    await points.focus();
    await page.keyboard.press("Delete");
    expect(await points.locator("output").innerText()).toBe("0");
    expect(await secondary.locator("output").innerText()).toBe("0");
    expect(await sign.isDisabled()).toBe(true);
    expect(await backspace.isDisabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("targets two independent numeric fields with one keypad and preserves the draft through tabs, swipe and Close", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await openPointsGame(page);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const points = dialog.getByRole("button", { name: "Maya Points", exact: true });
    const tiebreaker = dialog.getByRole("button", { name: "Maya Tiebreaker", exact: true });
    expect(await points.getAttribute("aria-pressed")).toBe("true");
    expect(await tiebreaker.getAttribute("aria-pressed")).toBe("false");
    expect(await dialog.getByRole("button", { name: "1", exact: true }).count()).toBe(1);
    expect(await dialog.locator("input, textarea").count()).toBe(0);
    await dialog.getByRole("button", { name: "1", exact: true }).click();
    await dialog.getByRole("button", { name: "0", exact: true }).click();
    expect(await points.innerText()).toContain("10");
    expect(await save.isEnabled()).toBe(true);
    await tiebreaker.click();
    expect(await tiebreaker.getAttribute("aria-pressed")).toBe("true");
    expect(await points.getAttribute("aria-pressed")).toBe("false");
    await dialog.getByRole("group", { name: "Maya Tiebreaker keypad", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "2", exact: true }).click();
    await dialog.getByRole("button", { name: "Change sign", exact: true }).click();
    expect(await tiebreaker.innerText()).toContain("-2");
    expect(await points.innerText()).toContain("10");
    expect(await dialog.getByRole("tab", { name: "Maya", exact: true }).innerText()).not.toContain(
      "Score entry",
    );
    await dialog.getByRole("tabpanel", { name: "Maya", exact: true }).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (const [type, clientX] of [
        ["touchstart", bounds.right - 30],
        ["touchmove", bounds.left + 20],
        ["touchend", bounds.left + 20],
      ] as const) {
        const touch = { identifier: 1, target: element, clientX, clientY: bounds.y + 40 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchend" ? [] : [touch] },
          changedTouches: { value: [touch] },
        });
        element.dispatchEvent(event);
      }
    });
    await expect
      .poll(() =>
        dialog.getByRole("tab", { name: "Rowan", exact: true }).getAttribute("aria-selected"),
      )
      .toBe("true");
    await dialog.getByRole("button", { name: "Rowan Points", exact: true }).focus();
    await page.keyboard.type("10");
    await dialog.getByRole("button", { name: "Rowan Tiebreaker", exact: true }).click();
    await page.keyboard.type("0");
    expect(await save.isEnabled()).toBe(true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await add.click();
    await dialog.getByRole("tab", { name: "Maya", exact: true }).click();
    expect(await points.innerText()).toContain("10");
    expect(await tiebreaker.innerText()).toContain("-2");
    const bounds = await save.boundingBox();
    if (!bounds) throw new Error("Missing Save geometry");
    expect(bounds.y + bounds.height).toBeLessThan(568);
    await save.click();
    await dialog.waitFor({ state: "detached" });
    const mayaCell = page.getByRole("cell", {
      name: "Maya, Round 1: 10 Points, -2 Tiebreaker",
      exact: true,
    });
    await mayaCell.waitFor();
    expect((await mayaCell.innerText()).trim().split(/\s+/)).toEqual(["10", "-2"]);
    const header = page.getByRole("columnheader").filter({ hasText: "Maya" });
    expect(await header.innerText()).toContain("Total Tiebreaker: -2");
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).click();
    expect(await mayaCell.innerText()).toContain("Accumulated Tiebreaker: -2");
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const standings = page.getByRole("dialog", { name: "Standings", exact: true });
    const rows = standings.getByRole("listitem");
    expect(await rows.nth(0).innerText()).toContain("Maya");
    expect(await rows.nth(0).innerText()).toContain("Total Tiebreaker: -2");
    expect(await rows.nth(1).innerText()).toContain("Place 2");
    await standings.getByRole("button", { name: "Close", exact: true }).click();
    await standings.waitFor({ state: "detached" });
    await add.click();
    expect(await points.locator("output").innerText()).toBe("0");
    expect(await tiebreaker.locator("output").innerText()).toBe("0");
    expect(await save.isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it("rejects inexact Tiebreakers, recovers from accumulated overflow atomically, and discards drafts on reload", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    const game = await openPointsGame(page, ["Maya"]);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const points = dialog.getByRole("button", { name: "Maya Points", exact: true });
    const secondary = dialog.getByRole("button", { name: "Maya Tiebreaker", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await add.click();
    await points.click();
    await page.keyboard.type("10");
    expect(await save.isEnabled()).toBe(true);
    for (const value of ["1.5", "1e2", "9007199254740992", "9007199254740991.1"]) {
      await secondary.click();
      await page.keyboard.press("Delete");
      await page.keyboard.type(value);
      expect(await secondary.innerText()).toContain(value);
      expect(await secondary.getAttribute("aria-invalid")).toBe("true");
      expect(await save.isDisabled()).toBe(true);
      await dialog.getByRole("alert").filter({ hasText: "Tiebreaker" }).waitFor();
    }
    await secondary.click();
    await page.keyboard.press("Delete");
    await page.keyboard.type("9007199254740991");
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await add.click();
    await points.click();
    await page.keyboard.type("5");
    await secondary.click();
    await page.keyboard.type("1");
    await save.click();
    await dialog.getByRole("alert").filter({ hasText: "Total Tiebreaker" }).waitFor();
    expect(await points.innerText()).toContain("5");
    expect(await secondary.innerText()).toContain("1");
    expect(await save.isEnabled()).toBe(true);
    const rounds = await page.evaluate<GenericRound[]>(`(async () => {
      const { genericRoundsApi } = await import("/scorekeeper/src/data/api/genericRounds.ts");
      return genericRoundsApi.getByGameId(${JSON.stringify(game.id)});
    })()`);
    expect(rounds).toHaveLength(1);
    await secondary.click();
    await page.keyboard.press("Backspace");
    expect(await secondary.locator("output").innerText()).toBe("0");
    expect(await save.isEnabled()).toBe(true);
    await page.keyboard.type("1-");
    await save.click();
    await dialog.waitFor({ state: "detached" });
    const header = page.getByRole("columnheader").filter({ hasText: "Maya" });
    expect(await header.innerText()).toContain("Total Points: 15");
    expect(await header.innerText()).toContain("Total Tiebreaker: 9007199254740990");
    await add.click();
    await points.click();
    await page.keyboard.type("2");
    await secondary.click();
    await page.keyboard.type("3");
    await page.reload();
    await add.click();
    expect(await points.locator("output").innerText()).toBe("0");
    expect(await secondary.locator("output").innerText()).toBe("0");
    expect(await save.isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it.each([
  {
    primary: "High wins",
    secondary: "High wins",
    leaderPoints: "10",
    behindPoints: "-10",
    leaderTiebreaker: "-1",
    behindTiebreaker: "-2",
  },
  {
    primary: "High wins",
    secondary: "Low wins",
    leaderPoints: "10",
    behindPoints: "-10",
    leaderTiebreaker: "-2",
    behindTiebreaker: "-1",
  },
  {
    primary: "Low wins",
    secondary: "High wins",
    leaderPoints: "-10",
    behindPoints: "10",
    leaderTiebreaker: "-1",
    behindTiebreaker: "-2",
  },
  {
    primary: "Low wins",
    secondary: "Low wins",
    leaderPoints: "-10",
    behindPoints: "10",
    leaderTiebreaker: "-2",
    behindTiebreaker: "-1",
  },
])("creates independent $primary / $secondary rules and preserves shared final places on reopening", async ({
  primary,
  secondary,
  leaderPoints,
  behindPoints,
  leaderTiebreaker,
  behindTiebreaker,
}) => {
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await seedPlayers(page, ["Maya", "Rowan", "Lee", "Alex"]);
    await page.goto(`${appUrl}#/scorekeeper/create`);
    for (const name of ["Maya", "Rowan", "Lee", "Alex"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "Points Direction", exact: true })
      .getByRole("radio", { name: primary, exact: true })
      .click();
    await page.getByRole("switch", { name: "Enable Tiebreaker", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "Tiebreaker Direction", exact: true })
      .getByRole("radio", { name: secondary, exact: true })
      .click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    expect(await dialog.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    expect(await dialog.getByText(/entered|Score entry/).count()).toBe(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    for (const name of ["Maya", "Rowan", "Lee", "Alex"]) {
      await page
        .getByRole("cell", { name: `${name}, Round 1: 0 Points, 0 Tiebreaker`, exact: true })
        .waitFor();
    }
    await page.getByRole("button", { name: "Add Round", exact: true }).click();
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      "0",
    );
    expect(
      await dialog.getByRole("status", { name: "Maya Tiebreaker", exact: true }).innerText(),
    ).toBe("0");
    // Lee's better secondary score must not overcome the primary comparison.
    for (const [name, points, tiebreaker] of [
      ["Maya", leaderPoints, leaderTiebreaker],
      ["Rowan", leaderPoints, behindTiebreaker],
      ["Lee", behindPoints, secondary === "High wins" ? "100" : "-100"],
      ["Alex", leaderPoints, leaderTiebreaker],
    ]) {
      await dialog.getByRole("tab", { name, exact: true }).click();
      await dialog.getByRole("button", { name: `${name} Points`, exact: true }).click();
      await page.keyboard.type(points.replace(/^-/, ""));
      if (points.startsWith("-")) await page.keyboard.press("-");
      await dialog.getByRole("button", { name: `${name} Tiebreaker`, exact: true }).click();
      await page.keyboard.type(tiebreaker.replace(/^-/, ""));
      if (tiebreaker.startsWith("-")) await page.keyboard.press("-");
    }
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const checkStandings = async () => {
      const standings = page.getByRole("dialog", { name: "Standings", exact: true });
      await standings.getByRole("listitem").first().waitFor();
      const rows = await standings.getByRole("listitem").allTextContents();
      expect(rows[0]).toContain("Place 1");
      expect(rows[0]).toContain("Maya");
      expect(rows[1]).toContain("Tied for place 1");
      expect(rows[1]).toContain("Alex");
      expect(rows[2]).toContain("Place 3");
      expect(rows[2]).toContain("Rowan");
      expect(rows[3]).toContain("Place 4");
      expect(rows[3]).toContain("Lee");
      return standings;
    };
    await page.getByRole("button", { name: "Open Standings", exact: true }).click();
    const live = await checkStandings();
    await live.getByRole("button", { name: "Close", exact: true }).click();
    await live.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Finish Game", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Finish Game", exact: true })
      .getByRole("button", { name: "Finish", exact: true })
      .click();
    await checkStandings();
    await page.reload();
    await checkStandings();
    expect(await page.getByRole("button", { name: "Add Round", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);
