/// <reference types="node" />

import type { Browser, Locator } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { holdRoundStorage, releaseRoundStorage } from "../../test/roundStorage";
import type { GenericGameSettings } from "../../types";
import { expectReadyAction } from "../ui/Button/readyActionTestUtils";

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

const settings: GenericGameSettings[] = [
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: false },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  { mode: "passFail", tiebreaker: null, dealer: false },
];

async function expectDraft(dialog: Locator, settings: GenericGameSettings, saved = false) {
  if (settings.mode === "points") {
    expect(await dialog.getByRole("status", { name: "Maya Points", exact: true }).innerText()).toBe(
      saved ? "0" : "7",
    );
    if (settings.tiebreaker) {
      expect(
        await dialog.getByRole("status", { name: "Maya Tiebreaker", exact: true }).innerText(),
      ).toBe(saved ? "0" : "3");
    }
  } else {
    expect(
      await dialog
        .getByRole(settings.mode === "passFail" ? "button" : "radio", { name: "Maya", exact: true })
        .getAttribute(settings.mode === "passFail" ? "aria-pressed" : "aria-checked"),
    ).toBe(String(!saved));
  }
}

it.each(
  settings,
)("allows pending $mode closure and recovers a failed draft without duplicate saves", async (gameSettings) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${appUrl}#/scorekeeper`);
    const gameId = await page.evaluate<string>(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { genericGamesApi } = await import("/scorekeeper/src/data/api/genericGames.ts");
      const player = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
      return (await genericGamesApi.create({
        players: [player.id],
        settings: ${JSON.stringify(gameSettings)},
      })).id;
    })()`);
    await page.goto(`${appUrl}#/scorekeeper/game/${gameId}`);
    const add = page.getByRole("button", { name: "Add Round", exact: true });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    if (gameSettings.mode === "points") {
      await dialog.getByRole("button", { name: "7", exact: true }).click();
      if (gameSettings.tiebreaker) {
        await dialog.getByRole("button", { name: "Maya Tiebreaker", exact: true }).click();
        await dialog.getByRole("button", { name: "3", exact: true }).click();
      }
    } else {
      await dialog
        .getByRole(gameSettings.mode === "passFail" ? "button" : "radio", {
          name: "Maya",
          exact: true,
        })
        .click();
    }
    await expectReadyAction(save, close, true);

    await holdRoundStorage(page, "Round storage unavailable");
    await save.click();
    const spinner = save.locator("svg[aria-hidden=true]");
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect(await close.isEnabled()).toBe(true);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectReadyAction(save, close, false);
    }
    expect(await save.innerText()).toBe("");
    expect(await save.locator("svg.lucide-check").count()).toBe(0);
    expect(await spinner.count()).toBe(1);
    expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      "none",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationName))
      .toBe("none");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await add.click();
    await expectDraft(dialog, gameSettings);
    expect(await save.isDisabled()).toBe(true);
    const entry =
      gameSettings.mode === "points"
        ? dialog.getByRole("button", { name: "7", exact: true })
        : dialog.getByRole(gameSettings.mode === "passFail" ? "button" : "radio", {
            name: "Maya",
            exact: true,
          });
    expect(await entry.isDisabled()).toBe(true);
    await dialog.locator("form").evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error("Missing Round form");
      form.requestSubmit();
    });
    await close.click();
    await dialog.waitFor({ state: "detached" });

    await releaseRoundStorage(page);
    await add.click();
    await dialog.getByRole("alert").filter({ hasText: "Round storage unavailable" }).waitFor();
    await expectDraft(dialog, gameSettings);
    expect(await save.isEnabled()).toBe(true);
    expect(await close.isEnabled()).toBe(true);
    expect(await save.locator("svg.lucide-check").count()).toBe(1);
    await expectReadyAction(save, close, true);
    await page.mouse.click(4, 4);
    await dialog.waitFor({ state: "detached" });
    await add.click();
    await dialog.getByRole("alert").filter({ hasText: "Round storage unavailable" }).waitFor();
    await expectDraft(dialog, gameSettings);
    await holdRoundStorage(page);
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    await page.mouse.click(4, 4);
    await dialog.waitFor({ state: "detached" });
    await add.click();
    await expectDraft(dialog, gameSettings);
    expect(await save.isDisabled()).toBe(true);
    expect(await entry.isDisabled()).toBe(true);
    await releaseRoundStorage(page);
    await dialog.waitFor({ state: "detached" });
    await page
      .getByRole("cell", {
        name:
          gameSettings.mode === "points"
            ? `Maya, Round 1: 7 Points${gameSettings.tiebreaker ? ", 3 Tiebreaker" : ""}`
            : `Maya, Round 1: ${gameSettings.mode === "passFail" ? "Passed" : "Won"}`,
        exact: true,
      })
      .waitFor();
    expect(await page.getByRole("button", { name: "Expand Round 2", exact: true }).count()).toBe(0);
    await add.click();
    await expectDraft(dialog, gameSettings, true);
    await page.reload();
    await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Expand Round 2", exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it.each([
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])("provides accessible circular Close/Save actions in every mode at $width x $height", async (viewport) => {
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
      const add = page.getByRole("button", { name: "Add Round", exact: true });
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add Round", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      await save.waitFor();
      expect(await close.innerText()).toBe("");
      expect(await save.innerText()).toBe("");
      expect(await close.locator("svg.lucide-x[aria-hidden=true]").count()).toBe(1);
      expect(await save.locator("svg.lucide-check[aria-hidden=true]").count()).toBe(1);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expectReadyAction(save, close, settings[index].mode !== "singleRoundWinner");
      }
      await page.emulateMedia({ colorScheme: "light" });

      const mode = settings[index].mode;
      if (mode === "points") {
        const metric = settings[index].tiebreaker ? "Maya Tiebreaker" : "Maya Points";
        const entry = settings[index].tiebreaker
          ? dialog.getByRole("button", { name: metric, exact: true })
          : dialog.getByRole("button", { name: "0", exact: true });
        await entry.focus();
        await page.keyboard.type("1.5");
        await dialog.getByRole("alert").filter({ hasText: "whole number" }).waitFor();
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await expectReadyAction(save, close, false);
        }
        await page.keyboard.press("Delete");
        await expectReadyAction(save, close, true);
        if (settings[index].tiebreaker) {
          await dialog.getByRole("button", { name: "Maya Points", exact: true }).click();
        }
      }
      if (mode === "singleRoundWinner") {
        expect(await save.isDisabled()).toBe(true);
        await dialog.getByText("0/1 winner selected", { exact: true }).waitFor();
        await dialog.getByRole("radio", { name: "Maya", exact: true }).click();
      } else if (mode === "passFail") {
        await dialog.getByRole("button", { name: "Maya", exact: true }).click();
      } else {
        await dialog.getByRole("button", { name: "7", exact: true }).click();
      }
      expect(await save.isEnabled()).toBe(true);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expectReadyAction(save, close, true);
      }
      await page.evaluate(() =>
        Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
      );

      for (const action of [close, save]) {
        const before = await action.boundingBox();
        if (!before) throw new Error("Missing footer action");
        expect(before.width).toBeGreaterThanOrEqual(44);
        expect(Math.abs(before.width - before.height)).toBeLessThan(1);
        expect(
          await action.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).borderRadius),
          ),
        ).toBeGreaterThanOrEqual(before.width / 2);
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down();
        await expect
          .poll(async () => (await action.boundingBox())?.width ?? 0)
          .toBeGreaterThan(before.width + 1);
        const pressed = await action.boundingBox();
        const content = await dialog.locator(".dialog-panel").boundingBox();
        if (!pressed || !content) throw new Error("Missing footer press geometry");
        expect(pressed.x).toBeGreaterThan(content.x);
        expect(pressed.x + pressed.width).toBeLessThan(content.x + content.width);
        expect(pressed.y).toBeGreaterThan(content.y);
        expect(pressed.y + pressed.height).toBeLessThan(content.y + content.height);
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
      const closeBounds = await close.boundingBox();
      const saveBounds = await save.boundingBox();
      if (!closeBounds || !saveBounds) throw new Error("Missing footer positions");
      expect(closeBounds.y + closeBounds.height).toBeLessThan(saveBounds.y);

      await save.focus();
      // macOS WebKit requires Option-Tab to include buttons without full keyboard access.
      await page.keyboard.press(process.platform === "darwin" ? "Alt+Tab" : "Tab");
      expect(await close.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press(process.platform === "darwin" ? "Shift+Alt+Tab" : "Shift+Tab");
      expect(await save.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(
        await save.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            focusVisible: element.hasAttribute("data-focus"),
            style: style.outlineStyle,
            width: style.outlineWidth,
          };
        }),
      ).toEqual({ focusVisible: true, style: "solid", width: "2px" });
      await close.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(() => add.evaluate((element) => element === document.activeElement))
        .toBe(true);

      await add.click();
      // Programmatic focus does not wait for the reopened dialog's entrance transition.
      await close.click({ trial: true });
      if (mode === "points") {
        expect(await dialog.locator("output").first().innerText()).toBe("7");
      } else if (mode === "singleRoundWinner") {
        expect(await dialog.getByRole("radio", { name: "Maya", exact: true }).isChecked()).toBe(
          true,
        );
      } else {
        expect(
          await dialog
            .getByRole("button", { name: "Maya", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("true");
      }
      await save.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Expand Round 1", exact: true }).waitFor();
      await add.click();
      if (mode === "points") {
        expect(await dialog.locator("output").first().innerText()).toBe("0");
      } else if (mode === "singleRoundWinner") {
        expect(await save.isDisabled()).toBe(true);
      } else {
        expect(
          await dialog
            .getByRole("button", { name: "Maya", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("false");
      }
      await close.click();
      await dialog.waitFor({ state: "detached" });
    }
  } finally {
    await page.close();
  }
}, 60_000);
