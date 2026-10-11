/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0, open: false },
  });
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

async function openMenuLink(page: Page, name: string) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();
}

describe("scorekeeper navigation", () => {
  it("opens each Create Game page from one keyboard-accessible circular action in the lower-right Scorekeeper Dashboard footer", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/New_York",
    });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      for (const home of ["/scorekeeper", "/phaseCompan10n"]) {
        await page.goto(`${appUrl}#${home}`);
        const create = page.getByRole("link", { name: "Create Game", exact: true });
        await create.waitFor();
        expect(await create.count()).toBe(1);
        expect(
          await page
            .locator(".page-shell-footer")
            .getByRole("link", { name: "Create Game", exact: true })
            .count(),
        ).toBe(1);
        expect(
          await page
            .locator(".page-shell-main")
            .getByRole("link", { name: "Create Game", exact: true })
            .count(),
        ).toBe(0);
        expect(await create.innerText()).toBe("");
        await page.getByRole("heading", { name: "Active Games", exact: true }).waitFor();

        const footer = await page.locator(".page-shell-footer").boundingBox();
        const control = await create.boundingBox();
        const icon = await create.locator("svg").boundingBox();
        if (!footer || !control || !icon) throw new Error("Missing Create Game control");
        expect(control.width).toBe(56);
        expect(control.height).toBe(56);
        expect(control.x).toBe(318);
        expect(control.y).toBeGreaterThanOrEqual(footer.y);
        expect(control.y + control.height).toBeLessThanOrEqual(844);
        expect(icon.width).toBe(32);
        expect(icon.height).toBe(32);
        expect(
          await create.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).borderRadius),
          ),
        ).toBeGreaterThanOrEqual(28);

        await page.getByRole("button", { name: "Menu", exact: true }).focus();
        // Safari includes links in keyboard navigation with Option-Tab.
        await page.keyboard.press("Alt+Tab");
        expect(await create.evaluate((element) => document.activeElement === element)).toBe(true);
        expect(await create.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
          "2px",
        );
        await create.hover();
        await expect
          .poll(() => create.evaluate((element) => getComputedStyle(element).filter))
          .toBe("brightness(1.1)");
        await page.keyboard.press("Enter");
        await page.getByRole("link", { name: "Cancel", exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#${home}/create`);
        await page.getByRole("link", { name: "Cancel", exact: true }).click();
        await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#${home}`);
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it("opens Home at the root and returns from each Scorekeeper Dashboard through the first menu item", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      await page.goto(appUrl);
      await expect
        .poll(() => page.getByRole("heading", { name: "Scorekeepers", exact: true }).count())
        .toBe(1);
      expect(await page.locator(".card-background").count()).toBe(0);
      expect(await page.title()).toBe("Scorekeeper");
      expect(await page.getByRole("link", { name: "Create Game", exact: true }).count()).toBe(0);
      expect(await page.getByRole("link", { name: "Go home", exact: true }).count()).toBe(0);
      const choices = page.getByRole("navigation", { name: "Scorekeepers" });
      const generic = choices.getByRole("link", { name: "Scorekeeper", exact: true });
      const phase = choices.getByRole("link", { name: "Phase Compan10n", exact: true });
      await phase.waitFor();
      expect(await choices.getByRole("link").count()).toBe(2);
      const genericBox = await generic.boundingBox();
      const phaseBox = await phase.boundingBox();
      if (!genericBox || !phaseBox) throw new Error("Missing scorekeeper choices");
      expect(phaseBox.y).toBeGreaterThan(genericBox.y + genericBox.height);
      for (const [name, path, title, menuLabels] of [
        ["Scorekeeper", "/scorekeeper", "Scorekeeper", ["Home", "Games", "Players"]],
        [
          "Phase Compan10n",
          "/phaseCompan10n",
          "Phaze Compan10n",
          ["Home", "Games", "Players", "Phases", "Settings"],
        ],
      ] as const) {
        await choices.getByRole("link", { name, exact: true }).focus();
        await page.keyboard.press("Enter");
        await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#${path}`);
        expect(await page.title()).toBe(title);
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        const menu = page.getByRole("navigation");
        expect(await menu.getByRole("link").allTextContents()).toEqual(menuLabels);
        for (const label of menuLabels) {
          expect(
            await menu.getByRole("link", { name: label, exact: true }).getAttribute("href"),
          ).toBe(
            label === "Home" ? "/scorekeeper/#/" : `/scorekeeper/#${path}/${label.toLowerCase()}`,
          );
        }
        await menu.getByRole("link", { name: "Home", exact: true }).click();
        await choices.waitFor();
        expect(page.url()).toBe(`${appUrl}#/`);
      }

      await generic.click();
      await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
      await page.goto(appUrl);
      await choices.waitFor();
      expect(await page.getByRole("link", { name: "Create Game", exact: true }).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("opens and reloads every moved Phase page inside the deployment base", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      for (const route of [
        "",
        "/create",
        "/games",
        "/players",
        "/phases",
        "/settings",
        "/phasescard",
      ]) {
        await page.goto(`${appUrl}#/phaseCompan10n${route}`);
        await expect.poll(() => page.locator(".card-background").count()).toBe(1);
        await page.reload();
        await expect.poll(() => page.locator(".card-background").count()).toBe(1);
        const home = page.getByRole("link", {
          name: route === "/create" ? "Cancel" : "Go home",
          exact: true,
        });
        if (route) {
          expect(await home.getAttribute("href")).toBe("/scorekeeper/#/phaseCompan10n");
          await home.click();
        }
        await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#/phaseCompan10n`);
      }
      await page.getByRole("link", { name: "Create Game", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: /Tips|Info/i }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  }, 60_000);

  it("opens and reloads nested generic pages with back navigation to the Scorekeeper Dashboard", async () => {
    const page = await browser.newPage();
    try {
      for (const [route, readyText] of [
        ["/scorekeeper", "No active games yet"],
        ["/scorekeeper/create", "Players"],
        ["/scorekeeper/games", "No games yet"],
        ["/scorekeeper/players", "No players yet"],
        ["/scorekeeper/game/missing-game", "Game not found in Scorekeeper."],
      ]) {
        await page.goto(`${appUrl}#${route}`);
        await page.getByText(readyText, { exact: true }).waitFor();
        await page.reload();
        await page.getByText(readyText, { exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#${route}`);
        if (route !== "/scorekeeper") {
          const back = page.getByRole("link", {
            name: route === "/scorekeeper/create" ? "Cancel" : "Go home",
            exact: true,
          });
          expect(await back.getAttribute("href")).toBe("/scorekeeper/#/scorekeeper");
          await back.click();
          await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
          expect(page.url()).toBe(`${appUrl}#/scorekeeper`);
        }
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("does not retain or redirect removed generic and chooser routes", async () => {
    const page = await browser.newPage();
    try {
      for (const route of ["/create", "/games", "/players", "/game/old-game", "/scorekeepers"]) {
        await page.goto(`${appUrl}#${route}`);
        await page.getByText("Not Found", { exact: true }).waitFor();
        expect(page.url()).toBe(`${appUrl}#${route}`);
        expect(await page.getByRole("link").count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it("shares Player edits and favorites between shells and starts only nested Phase Games", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      await page.goto(`${appUrl}#/scorekeeper/players`);
      for (const name of ["Maya", "Rowan"]) {
        await page.getByRole("button", { name: "Create new player" }).click();
        const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
        await dialog.getByRole("radio", { name: "Select color Jam", exact: true }).check();
        await dialog.getByRole("switch", { name: "Favorite", exact: true }).click();
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      expect(await page.locator(".card-background").count()).toBe(0);
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      expect(page.url()).toBe(`${appUrl}#/scorekeeper`);
      await openMenuLink(page, "Home");
      await page.getByRole("link", { name: "Phase Compan10n", exact: true }).click();
      await openMenuLink(page, "Players");
      await page.getByRole("button", { name: "Remove Maya from favorites", exact: true }).waitFor();
      expect(await page.locator(".card-background").count()).toBe(1);
      await page.getByRole("button", { name: "Maya", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit player", exact: true });
      expect(
        await editor.getByRole("radio", { name: "Select color Jam", exact: true }).isChecked(),
      ).toBe(true);
      await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Maya Updated");
      await editor.getByRole("radio", { name: "Select color Rose", exact: true }).check();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Remove Maya Updated from favorites", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add Maya Updated to favorites", exact: true })
        .waitFor();
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      expect(page.url()).toBe(`${appUrl}#/phaseCompan10n`);
      await openMenuLink(page, "Home");
      await page.getByRole("link", { name: "Scorekeeper", exact: true }).click();
      await openMenuLink(page, "Players");
      await page
        .getByRole("button", { name: "Add Maya Updated to favorites", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Maya Updated", exact: true }).click();
      expect(await editor.getByRole("textbox", { name: "Name", exact: true }).inputValue()).toBe(
        "Maya Updated",
      );
      expect(
        await editor.getByRole("radio", { name: "Select color Rose", exact: true }).isChecked(),
      ).toBe(true);
      expect(
        await editor
          .getByRole("switch", { name: "Favorite", exact: true })
          .getAttribute("aria-checked"),
      ).toBe("false");
      await editor.getByRole("button", { name: "Close", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Add Maya Updated to favorites", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "Remove Maya Updated from favorites", exact: true })
        .waitFor();
      expect(await page.getByRole("button", { name: "Maya", exact: true }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Maya Updated", exact: true }).count()).toBe(1);

      await page.goto(`${appUrl}#/phaseCompan10n/create`);
      await page.getByRole("button", { name: "Maya Updated", exact: true }).click();
      expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole("button", { name: "Rowan", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("button", { name: "Open Standings", exact: true }).waitFor();
      const gameUrl = page.url();
      expect(gameUrl).toMatch(/#\/phaseCompan10n\/game\/[^/]+$/);
      await page.reload();
      await page.getByRole("button", { name: "Open Standings", exact: true }).waitFor();
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      const gameLink = page.locator('a[href*="/phaseCompan10n/game/"]');
      await gameLink.waitFor();
      await gameLink.click();
      expect(page.url()).toBe(gameUrl);
      await page.goto(gameUrl.replace("/phaseCompan10n/game/", "/scorekeeper/game/"));
      await page.getByText("Game not found in Scorekeeper.", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Open Standings", exact: true }).count()).toBe(
        0,
      );
      await page.goto(`${appUrl}#/phaseCompan10n/game/missing-game`);
      await page.getByText("This Game is no longer available.", { exact: true }).waitFor();
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
      expect(page.url()).toBe(`${appUrl}#/phaseCompan10n`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("copies nested built-in and self-contained custom Phases Cards that reload in a fresh browser", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: (text: string) => {
              document.documentElement.dataset.copiedUrl = text;
              return Promise.resolve();
            },
          },
        });
      });
      await page.goto(`${appUrl}#/phaseCompan10n`);
      await page.getByRole("link", { name: "Open Phases Card", exact: true }).click();
      await page.getByRole("button", { name: "Share Phases Card", exact: true }).click();
      await page.getByRole("button", { name: "Phases Card link copied", exact: true }).waitFor();
      const builtInUrl = await page.locator("html").getAttribute("data-copied-url");
      expect(builtInUrl).toBe(`${appUrl}#/phaseCompan10n/phasescard/original`);
      if (!builtInUrl) throw new Error("Missing built-in share URL");
      await page.goto(builtInUrl);
      await page.reload();
      await page.getByText("Original", { exact: true }).waitFor();
      await page.getByText("2 sets of 3", { exact: true }).waitFor();

      const payload = {
        v: 1,
        name: "Travel Set",
        phases: [
          { requirements: [{ type: "set", count: 3, quantity: 2, isSameColor: false }] },
          { requirements: [{ type: "run", count: 7, quantity: 1, isSameColor: false }] },
        ],
      };
      const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
      await page.goto(`${appUrl}#/phaseCompan10n/phasescard/custom?data=${data}`);
      await page.getByText("Travel Set", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Share Phases Card", exact: true }).click();
      await page.getByRole("button", { name: "Phases Card link copied", exact: true }).waitFor();
      const customUrl = await page.locator("html").getAttribute("data-copied-url");
      expect(customUrl).toBe(`${appUrl}#/phaseCompan10n/phasescard/custom?data=${data}`);
      if (!customUrl) throw new Error("Missing custom share URL");
      const recipient = await browser.newPage({ timezoneId: "America/New_York" });
      await recipient.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
      try {
        await recipient.goto(customUrl);
        await recipient.reload();
        await recipient.getByText("Travel Set", { exact: true }).waitFor();
        expect(
          await recipient
            .getByRole("region", { name: "Phases Card phase list" })
            .locator("[title]")
            .allTextContents(),
        ).toEqual(["2 sets of 3", "1 run of 7"]);
        expect(
          await recipient.getByRole("link", { name: "Go home", exact: true }).getAttribute("href"),
        ).toBe("/scorekeeper/#/phaseCompan10n");
        await recipient.goto(`${appUrl}#/phaseCompan10n/phasescard/custom?data=invalid`);
        await recipient.getByText("This Phases Card link is invalid.", { exact: true }).waitFor();
        await recipient.goto(`${appUrl}#/phaseCompan10n/phasescard/missing-set`);
        await recipient.getByText("Phase Set not found.", { exact: true }).waitFor();
      } finally {
        await recipient.close();
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each([
    "Add Round",
    "Finish Game",
    "Standings",
    "Phases Card",
  ])("discards %s state when navigating directly between cached Phase Games", async (dialogName) => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/players`);
      await page.getByText("No players yet", { exact: true }).waitFor();
      const { first, second } = await page.evaluate<{
        first: string;
        second: string;
      }>(`(async () => {
          const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
          const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
          const { roundsApi } = await import("/scorekeeper/src/data/api/rounds.ts");
          const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
          const bob = await playersApi.create({ name: "Bob", color: "Rose", isFavorite: 0 });
          const input = {
            players: [amy.id, bob.id],
            phaseSet: {
              id: "cached-phases", type: "temporary", name: "Two Phases",
              phases: ["classic-1", "classic-2"],
            },
            settings: { tiebreaker: "roundsWon", roundSkipPenalty: 100, sitOutPenalty: 0 },
          };
          const first = await gamesApi.create(input);
          const second = await gamesApi.create(input);
          await roundsApi.add({
            gameId: second.id, roundWinnerId: amy.id,
            scores: [
              { playerId: amy.id, score: 0, phaseStatus: "completed" },
              { playerId: bob.id, score: 0, phaseStatus: "failed" },
            ],
          });
          return { first: first.id, second: second.id };
        })()`);
      const navigate = async (id: string) => {
        await page.evaluate((gameId) => {
          window.location.hash = `/phaseCompan10n/game/${gameId}`;
        }, id);
        await page.waitForURL(`${appUrl}#/phaseCompan10n/game/${id}`);
      };
      await navigate(second);
      await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
      await navigate(first);
      await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
      if (dialogName === "Add Round") {
        await page.getByRole("button", { name: "Add round 1", exact: true }).click();
        const entry = page.getByRole("dialog");
        await entry.getByRole("button", { name: /Round Winner/ }).click();
        await page.getByRole("option", { name: "Amy", exact: true }).click();
        await entry.getByRole("tab", { name: "Bob", exact: true }).click();
        await entry.getByRole("button", { name: "Failed", exact: true }).click();
        expect(await entry.getByRole("button", { name: "Save round" }).isEnabled()).toBe(true);
      } else {
        await page
          .getByRole("button", {
            name: dialogName === "Finish Game" ? dialogName : `Open ${dialogName}`,
            exact: true,
          })
          .click();
      }
      await page.getByRole("dialog").waitFor({ state: "attached" });
      await navigate(second);
      await page
        .getByRole("button", { name: "Add round 2", exact: true, includeHidden: true })
        .waitFor();
      await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
      await page.getByRole("button", { name: "Add round 2", exact: true }).click();
      const freshEntry = page.getByRole("dialog");
      expect(await freshEntry.getByRole("button", { name: "Save round" }).isDisabled()).toBe(true);
      expect(
        await freshEntry
          .getByRole("tab", { name: "Amy", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(await freshEntry.getByRole("button", { name: /Round Winner/ }).innerText()).toContain(
        "Choose winner",
      );
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.each(["light", "dark"] as const)("Scorekeeper presentation in %s mode", (colorScheme) => {
  it("gives Home a panel-free viewport with both branded choices inside Safe Areas", async () => {
    const page = await browser.newPage({ colorScheme, timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
    try {
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [512, 400],
        [844, 390],
        [1280, 900],
        [320, 320],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${appUrl}#/`);
        const choices = page.getByRole("navigation", { name: "Scorekeepers", exact: true });
        await choices.waitFor();
        await page.evaluate(() => document.fonts.ready);
        for (const insets of [
          { top: 0, right: 0, bottom: 0, left: 0 },
          { top: 47, right: 44, bottom: 34, left: 44 },
        ]) {
          await page.evaluate((insets) => {
            for (const [edge, value] of Object.entries(insets)) {
              document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
            }
          }, insets);
          const content = page.locator(".page-shell-main");
          await content.evaluate((element) => {
            element.scrollTop = 0;
          });
          const contentBox = await content.boundingBox();
          if (!contentBox) throw new Error("Missing Home content");
          expect(contentBox.y).toBe(insets.top);
          expect(contentBox.height).toBeCloseTo(height - insets.top - insets.bottom, 1);

          const generic = choices.getByRole("link", { name: "Scorekeeper", exact: true });
          const phase = choices.getByRole("link", { name: "Phase Compan10n", exact: true });
          const genericBox = await generic.boundingBox();
          const phaseBox = await phase.boundingBox();
          if (!genericBox || !phaseBox) throw new Error("Missing Scorekeeper choices");
          expect(genericBox.y).toBe(insets.top + 24);
          expect(phaseBox.y - genericBox.y - genericBox.height).toBe(24);
          expect(genericBox.width).toBe(phaseBox.width);
          expect(await choices.getByRole("link").count()).toBe(2);
          expect(await generic.getByRole("img", { name: "Scorekeeper", exact: true }).count()).toBe(
            1,
          );
          expect(
            await phase.getByRole("img", { name: "Phaze Compan10n", exact: true }).count(),
          ).toBe(1);

          for (const [index, choice] of [generic, phase].entries()) {
            await choice.focus();
            await content.evaluate((element, last) => {
              element.scrollTop = last ? element.scrollHeight : 0;
            }, index === 1);
            expect(await choice.evaluate((element) => element === document.activeElement)).toBe(
              true,
            );
            const box = await choice.boundingBox();
            if (!box) throw new Error("Missing focused choice");
            expect(box.x).toBeGreaterThanOrEqual(insets.left);
            expect(box.x + box.width).toBeLessThanOrEqual(width - insets.right);
            expect(box.y).toBeGreaterThanOrEqual(insets.top);
            expect(box.y + box.height).toBeLessThanOrEqual(height - insets.bottom);
          }
          expect(await page.locator(".page-panel-surface, .page-panel-shadow").count()).toBe(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        }
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("fits one-line logos and flat shells while preserving Safe Areas and Visual Bleed", async () => {
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [844, 390],
      [1280, 900],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        colorScheme,
        timezoneId: "America/New_York",
      });
      await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
      try {
        for (const route of ["/scorekeeper", "/scorekeeper/players", "/"]) {
          await page.goto(`${appUrl}#${route}`);
          const logo = page.getByRole("img", { name: "Scorekeeper", exact: true });
          await logo.waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.addStyleTag({
            content:
              ":root { --safe-area-inset-top: 47px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 44px; --safe-area-inset-right: 44px; }",
          });
          expect(await page.locator(".card-background, .card-panel-disclaimer").count()).toBe(0);
          expect(await page.getByText(/Mattel/).count()).toBe(0);
          const lettering = await logo.locator("text").evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                text: element.textContent,
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                font: style.fontFamily,
                fill: style.fill,
                stroke: style.stroke,
              };
            }),
          );
          expect(lettering).toHaveLength(1);
          expect(lettering[0].text).toBe("Scorekeeper");
          expect(lettering[0].font).toContain("Quicksand");
          expect(lettering[0].fill).not.toBe(lettering[0].stroke);
          expect(lettering[0].left).toBeGreaterThanOrEqual(44);
          expect(lettering[0].right).toBeLessThanOrEqual(width - 44);
          expect(lettering[0].top).toBeGreaterThanOrEqual(47);
          expect(lettering[0].bottom).toBeLessThanOrEqual(height - 34);
          const stripes = await logo.locator("rect").evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return {
                left: box.left,
                width: box.width,
                top: box.top,
                height: box.height,
                fill: getComputedStyle(element).fill,
              };
            }),
          );
          expect(stripes).toHaveLength(4);
          expect(new Set(stripes.map((stripe) => stripe.fill)).size).toBe(4);
          expect(stripes.map((stripe) => stripe.fill)).toEqual([
            "rgb(37, 99, 235)",
            "rgb(6, 182, 212)",
            "rgb(139, 92, 246)",
            "rgb(236, 72, 153)",
          ]);
          expect(stripes[0].left).toBeCloseTo(stripes[3].left);
          expect(stripes[0].width).toBeCloseTo(stripes[3].width);
          expect(stripes[1].top).toBeGreaterThan(stripes[0].top + stripes[0].height);
          expect(stripes[2].top).toBeGreaterThan(stripes[1].top + stripes[1].height);
          expect(stripes[3].top).toBeGreaterThan(stripes[2].top + stripes[2].height);
          expect(
            await page.locator(".page-shell-main").evaluate((element) => {
              const style = getComputedStyle(element);
              return [style.marginTop, style.marginBottom, style.paddingTop, style.clipPath];
            }),
          ).toEqual(["0px", "0px", "0px", "none"]);
          if (route !== "/") {
            const bleed = await page.locator(".page-shell-bottom-bleed").evaluate((element) => {
              const box = element.getBoundingClientRect();
              return {
                top: box.top,
                height: box.height,
                pointerEvents: getComputedStyle(element).pointerEvents,
              };
            });
            expect(bleed.top).toBeCloseTo(height, 1);
            expect(bleed.height).toBeCloseTo(height, 1);
            expect(bleed.pointerEvents).toBe("none");
          }
          if (route === "/scorekeeper/players") {
            expect(
              await page
                .locator(".page-shell-main .dialog-scroll")
                .evaluate((element) => getComputedStyle(element).paddingBottom),
            ).toBe("8px");
            const home = page.getByRole("link", { name: "Go home", exact: true });
            await home.hover();
            await page.mouse.down();
            await expect
              .poll(async () => (await home.boundingBox())?.width)
              .toBeCloseTo((height <= 700 ? 44 : 56) * 1.1, 1);
            const pressed = await home.boundingBox();
            if (!pressed) throw new Error("Missing pressed Home control");
            expect(pressed.x).toBeGreaterThanOrEqual(44);
            expect(pressed.y + pressed.height).toBeLessThanOrEqual(height - 34);
            await page.mouse.up();
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        }
      } finally {
        await page.close();
      }
    }
  }, 60_000);
});
