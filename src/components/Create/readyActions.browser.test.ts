/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionAppearance, expectReadyAction } from "../ui/Button/readyActionTestUtils";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  appUrl = `http://127.0.0.1:${address.port}/scorekeeper/`;
  await server.warmupRequest("/src/main.tsx");
  await server.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function holdSettingsStorage(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("phase10-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("settings", "readwrite");
          let held = true;
          window.addEventListener(
            "release-settings-storage",
            () => {
              held = false;
            },
            { once: true },
          );
          transaction.oncomplete = () => db.close();
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
          const hold = () => {
            if (held) transaction.objectStore("settings").count().onsuccess = hold;
          };
          hold();
          resolve();
        };
      }),
  );
}

async function releaseSettingsStorage(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("release-settings-storage")));
}

it.each([
  "loading",
  "read failure",
] as const)("prevents Start during app-default %s even with manually chosen Phases, then recovers the draft", async (condition) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await page.evaluate(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
        for (const name of ["Amy", "Bob"]) {
          await playersApi.create({ name, color: "Jam", isFavorite: 1 });
        }
        await settingsApi.updateGameDefaults({
          inOrderPhases: false, tiebreaker: "fewestWilds", roundSkipPenalty: 45, sitOutPenalty: 15,
        });
      })()`);
    if (condition === "loading") {
      await holdSettingsStorage(page);
    } else {
      await page.evaluate(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === "settings") {
            IDBObjectStore.prototype.get = get;
            throw new DOMException("Cannot read saved defaults.", "UnknownError");
          }
          return get.call(this, key);
        };
      });
    }
    await page.getByRole("link", { name: "Create Game", exact: true }).click();
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    await page.getByRole("button", { name: "Pick 10 random phases", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: /^Remove / }).count()).toBe(10);
    const start = page.getByRole("button", { name: "Start", exact: true });
    expect(await start.isDisabled()).toBe(true);
    await start.evaluate((element) => (element as HTMLButtonElement).click());
    expect(
      await page.evaluate(`(async () => {
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        return (await gamesApi.getAll()).length;
      })()`),
    ).toBe(0);
    if (condition === "loading") {
      await releaseSettingsStorage(page);
    } else {
      await page.getByRole("alert").filter({ hasText: "Cannot read saved defaults." }).waitFor();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
    }
    await expect.poll(() => start.isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: /^Remove / }).count()).toBe(10);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(
      await page
        .getByRole("switch", { name: "In-order phases", exact: true })
        .getAttribute("aria-checked"),
    ).toBe("false");
    await start.click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    const gameId = page.url().split("/").at(-1);
    await page.reload();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    expect(
      await page.evaluate(`(async () => {
        const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
        return (await gamesApi.getById(${JSON.stringify(gameId)})).settings;
      })()`),
    ).toEqual({
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 45,
      sitOutPenalty: 15,
    });
  } finally {
    await releaseSettingsStorage(page);
    await page.close();
  }
}, 60_000);

it("keeps an edited creation draft when the configured Phase Order loads late", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n`);
    await page.getByText("No active games yet", { exact: true }).waitFor();
    await page.evaluate(`(async () => {
      const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
      await settingsApi.setDefaultInOrderPhases(false);
    })()`);
    await holdSettingsStorage(page);
    await page.getByRole("link", { name: "Create Game", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const toggle = page.getByRole("switch", { name: "In-order phases", exact: true });
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await toggle.click();
    await toggle.click();
    await releaseSettingsStorage(page);
    await page.getByRole("tab", { name: "Phases", exact: true }).click();
    await page
      .getByRole("button", { name: /^Remove / })
      .first()
      .waitFor();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await page
      .getByRole("button", { name: "Reset game settings to defaults", exact: true })
      .click();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
  } finally {
    await releaseSettingsStorage(page);
    await page.close();
  }
}, 60_000);

it("blocks duplicate preference saves and resets while pending, surfaces storage failures, and retries the selected value", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/settings`);
    const toggle = page.getByRole("switch", { name: "In-order phases", exact: true });
    await toggle.waitFor();
    await holdSettingsStorage(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "settings") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Settings storage is full.", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await toggle.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect.poll(() => toggle.isDisabled()).toBe(true);
    const reset = page.getByRole("button", { name: "Reset settings to defaults", exact: true });
    expect(await reset.isDisabled()).toBe(true);
    await releaseSettingsStorage(page);
    await page.getByRole("alert").filter({ hasText: "Settings storage is full." }).waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("false");
    await page.reload();
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "settings") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Unable to reset saved settings.", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await reset.click();
    await page.getByRole("alert").filter({ hasText: "Unable to reset saved settings." }).waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
    await page.reload();
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
  } finally {
    await releaseSettingsStorage(page);
    await page.close();
  }
}, 60_000);

it("reloads the In-order phases app default, inherits and resets creation drafts, and leaves saved Games read-only", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    await page.goto(`${appUrl}#/phaseCompan10n/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
      for (const name of ["Amy", "Bob"]) {
        await playersApi.create({ name, color: "Jam", isFavorite: 1 });
      }
      await settingsApi.updateGameDefaults({
        tiebreaker: "fewestWilds", roundSkipPenalty: 45, sitOutPenalty: 15,
      });
    })()`);
    await page.goto(`${appUrl}#/phaseCompan10n/settings`);
    const toggle = page.getByRole("switch", { name: "In-order phases", exact: true });
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("false");
    await page.reload();
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");

    await page.goto(`${appUrl}#/phaseCompan10n/create`);
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await toggle.click();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await page
      .getByRole("button", { name: "Reset game settings to defaults", exact: true })
      .click();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    const gameId = page.url().split("/").at(-1);
    if (!gameId) throw new Error("Missing created Game identity");
    const savedSettings = await page.evaluate(`(async () => {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      return (await gamesApi.getById(${JSON.stringify(gameId)})).settings;
    })()`);
    expect(savedSettings).toEqual({
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 45,
      sitOutPenalty: 15,
    });

    await page.goto(`${appUrl}#/phaseCompan10n/settings`);
    await toggle.waitFor();
    await page.getByRole("button", { name: "Reset settings to defaults", exact: true }).click();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
    await page.reload();
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await page.goto(`${appUrl}#/phaseCompan10n/game/${gameId}`);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Edit game", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await page.locator("dl").innerText()).toContain("In-order phases\nOff");
    expect(await page.getByRole("switch").count()).toBe(0);
    expect(await page.locator("dl").innerText()).toContain("Fewest Wilds");

    await page.goto(`${appUrl}#/phaseCompan10n/create`);
    for (const name of ["Amy", "Bob"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await toggle.click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Add round 1", exact: true }).waitFor();
    expect(
      await page.evaluate(`(async () => {
      const { gamesApi } = await import("/scorekeeper/src/data/api/games.ts");
      const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
      const games = await gamesApi.getAll();
      return {
        orders: games.map((game) => game.settings.inOrderPhases),
        defaultOrder: (await settingsApi.get()).gameDefaults.inOrderPhases,
      };
    })()`),
    ).toEqual({ orders: [false, false], defaultOrder: true });
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    expect(await page.getByText("In-order phases", { exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 60_000);

describe.each(["/scorekeeper", "/phaseCompan10n"])("ready Start in %s", (home) => {
  it.each([
    "light",
    "dark",
  ] as const)("follows Player/Phase requirements and pending creation in %s mode", async (colorScheme) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await page.goto(`${appUrl}#${home}/players`);
      await page.getByText("No players yet", { exact: true }).waitFor();
      await page.evaluate(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        const { phaseSetsApi } = await import("/scorekeeper/src/data/api/phaseSets.ts");
        const { settingsApi } = await import("/scorekeeper/src/data/api/settings.ts");
        for (const name of ["Maya", "Rowan"]) {
          await playersApi.create({ name, color: "Jam", isFavorite: 1 });
        }
        const phaseSet = await phaseSetsApi.create({
          name: "One Phase", type: "saved", phases: ["classic-1"],
        });
        await settingsApi.setDefaultPhaseSetId(phaseSet.id);
      })()`);
      await page.goto(`${appUrl}#${home}/create`);
      const start = page.getByRole("button", { name: "Start", exact: true });
      const cancel = page.getByRole("link", { name: "Cancel", exact: true });
      await start.waitFor();
      await expectReadyAction(start, cancel, false);
      expect(await start.locator("svg.lucide-play").count()).toBe(1);
      expect(await start.boundingBox()).toMatchObject({ width: 56, height: 56 });
      await page.getByRole("button", { name: "Maya", exact: true }).click();
      await expectReadyAction(start, cancel, home === "/scorekeeper");
      if (home === "/phaseCompan10n") {
        await page.getByRole("button", { name: "Rowan", exact: true }).click();
        await expectReadyAction(start, cancel, true);
        await page.getByRole("tab", { name: "Phases", exact: true }).click();
        await page.getByRole("button", { name: /^Remove / }).click();
        await expectReadyAction(start, cancel, false);
        await page.getByRole("button", { name: "Reset to default phase set", exact: true }).click();
        await expectReadyAction(start, cancel, true);
      }
      await cancel.focus();
      await page.keyboard.press(process.platform === "darwin" ? "Alt+Tab" : "Tab");
      expect(await start.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await start.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");
      expect(await start.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
        "solid",
      );

      // Hold persistence, not the form or mutation, to observe the real pending guard.
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("phase10-db");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction("games", "readwrite");
              let locked = true;
              window.addEventListener(
                "release-ready-start",
                () => {
                  locked = false;
                },
                { once: true },
              );
              transaction.oncomplete = () => db.close();
              transaction.onabort = () => {
                db.close();
                reject(transaction.error);
              };
              const hold = () => {
                if (locked) transaction.objectStore("games").count().onsuccess = hold;
              };
              hold();
              resolve();
            };
          }),
      );
      await page.keyboard.press("Enter");
      await expectReadyAction(start, cancel, false);
      await page.evaluate(() => window.dispatchEvent(new Event("release-ready-start")));
      await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
      expect(page.url()).toMatch(new RegExp(`#${home}/game/[^/]+$`));
      const finish = page.getByRole("button", { name: "Finish Game", exact: true });
      expect((await actionAppearance(finish.locator("span.glass"))).surface).toEqual(
        (await actionAppearance(page.getByRole("button", { name: "Open Standings", exact: true })))
          .surface,
      );
    } finally {
      await page.close();
    }
  }, 60_000);
});
