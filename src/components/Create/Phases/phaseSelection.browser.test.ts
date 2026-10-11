/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setVisibleViewport } from "../../../test/visualViewport";

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

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing Phase selection bounds");
  return bounds;
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function openPhases(page: Page) {
  await page.goto(`${appUrl}#/phaseCompan10n/create`);
  await page.getByRole("tab", { name: "Phases", exact: true }).click();
}

describe.each(["light", "dark"] as const)("floating Phase selection in %s", (colorScheme) => {
  it("keeps the Save Phase Set placeholder content-sized with its existing title and one X", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await openPhases(page);
      const trigger = page.getByRole("button", { name: "Save phase set", exact: true });
      for (let attempt = 0; attempt < 2; attempt++) {
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Save phase set", exact: true });
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        await close.waitFor({ timeout: 3_000 });
        expect(
          await dialog.getByRole("heading", { name: "Save phase set", exact: true }).count(),
        ).toBe(1);
        expect(await dialog.locator("header").getByRole("heading").count()).toBe(1);
        expect(await dialog.getByRole("button").count()).toBe(1);
        await dialog.getByText("Save phase set flow coming soon.", { exact: true }).waitFor();
        await settle(page);
        const panel = dialog.locator(".dialog-panel");
        expect((await box(panel)).height).toBeLessThan(200);
        await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
        await close.scrollIntoViewIfNeeded();
        await close.click();
        await dialog.waitFor({ state: "detached" });
        await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps Add Phases search and filters fixed, preserves selection, and retains the established reopen state", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await openPhases(page);
      await page.getByRole("button", { name: "Add Phase", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add phases", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await close.waitFor({ timeout: 3_000 });
      expect(await dialog.getByRole("heading").count()).toBe(0);
      expect(await dialog.getByRole("button", { name: "Go back" }).count()).toBe(0);
      await settle(page);
      const panel = dialog.locator(".dialog-panel");
      const colors = await panel.evaluate((element) => ({
        surface: getComputedStyle(element).backgroundColor,
        app: getComputedStyle(document.body).backgroundColor,
        filter: getComputedStyle(element).backdropFilter,
      }));
      expect(colors.surface).toBe(colors.app);
      expect(colors.filter).toBe("none");
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      const fitted = await box(panel);
      expect(fitted.y).toBeGreaterThanOrEqual(76);
      expect(fitted.y + fitted.height).toBeLessThanOrEqual(464);
      const search = dialog.getByRole("textbox");
      const region = dialog.getByRole("region", { name: "Phase search results", exact: true });
      const searchBounds = await box(search);
      const closeBounds = await box(close);
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(search)).toEqual(searchBounds);
      expect(await box(close)).toEqual(closeBounds);
      await search.fill("1 run of 4 and 5 cards of the same color");
      const phase = dialog.getByRole("button", {
        name: "1 run of 4 and 5 cards of the same color",
        exact: true,
      });
      await phase.click();
      expect(await phase.isDisabled()).toBe(true);
      await dialog.getByRole("button", { name: "Favorites", exact: true }).click();
      await close.click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Add Phase", exact: true }).click();
      await phase.waitFor();
      expect(await search.inputValue()).toBe("1 run of 4 and 5 cards of the same color");
      expect(
        await dialog.getByRole("button", { name: "Favorites" }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(await phase.isDisabled()).toBe(true);
      await search.fill("No matching Phase");
      await dialog.getByText('No phases matching "No matching Phase"', { exact: true }).waitFor();
      await settle(page);
      expect((await box(panel)).height).toBeLessThan(fitted.height);
      await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
      await search.scrollIntoViewIfNeeded();
      const visibleSearch = await box(search);
      expect(visibleSearch.y).toBeGreaterThanOrEqual(76);
      expect(visibleSearch.y + visibleSearch.height).toBeLessThanOrEqual(224);
      await close.scrollIntoViewIfNeeded();
      await close.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 900 },
  ])("scrolls Phase Sets without moving search/X at $width px and keeps a failed selection recoverable after close", async (viewport) => {
    const page = await browser.newPage({ viewport, colorScheme, reducedMotion: "reduce" });
    try {
      await page.goto(appUrl);
      const targetId = await page.evaluate<string>(`
        import("/scorekeeper/src/data/api/phaseSets.ts").then(async ({ phaseSetsApi }) => {
          let target;
          for (let index = 1; index <= 20; index++) {
            target = await phaseSetsApi.create({
              type: "saved",
              name: "Fixture " + String(index).padStart(2, "0"),
              phases: ["classic-1", "classic-2"],
            });
          }
          await phaseSetsApi.create({ type: "saved", name: "Fixture empty", phases: [] });
          return target.id;
        })
      `);
      await openPhases(page);
      const trigger = page.getByRole("button", { name: "Switch phase set", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Switch phase set", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await close.waitFor({ timeout: 3_000 });
      expect(await dialog.getByRole("heading").count()).toBe(0);
      const search = dialog.getByRole("textbox");
      await search.fill("Fixture");
      await dialog.getByRole("button", { name: "Fixture 20", exact: true }).waitFor();
      await settle(page);
      const panelBounds = await box(dialog.locator(".dialog-panel"));
      expect(panelBounds.width).toBeLessThanOrEqual(512);
      expect(panelBounds.y).toBeGreaterThanOrEqual(16);
      expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(viewport.height - 16);
      const region = dialog.getByRole("region", { name: "Phase Set search results", exact: true });
      const searchBounds = await box(search);
      const closeBounds = await box(close);
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(search)).toEqual(searchBounds);
      expect(await box(close)).toEqual(closeBounds);
      await dialog.getByRole("button", { name: "Fixture empty", exact: true }).click();
      await dialog
        .getByRole("alert")
        .getByText("This phase set has no phases.", { exact: true })
        .waitFor();
      await holdPhaseSetRead(page, targetId);
      await dialog.getByRole("button", { name: "Fixture 20", exact: true }).click();
      await close.click();
      await dialog.waitFor({ state: "detached" });
      await releasePhaseSetRead(page);
      await trigger.click();
      await dialog
        .getByRole("alert")
        .getByText("Phase Set storage unavailable", { exact: true })
        .waitFor();
      expect(await search.inputValue()).toBe("Fixture");
      await dialog.getByRole("button", { name: "Fixture 20", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      expect(await page.getByRole("button", { name: /^Reorder / }).count()).toBe(2);
      await trigger.click();
      expect(await search.inputValue()).toBe("Fixture");
      expect(await dialog.getByRole("alert").count()).toBe(0);
      await close.click();
    } finally {
      await releasePhaseSetRead(page);
      await page.close();
    }
  }, 30_000);
});

async function holdPhaseSetRead(page: Page, targetId: string) {
  await page.evaluate((targetId) => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === "customPhaseSets" && key === targetId) {
        IDBObjectStore.prototype.get = get;
        throw new DOMException("Phase Set storage unavailable", "UnknownError");
      }
      return get.call(this, key);
    };
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("phase10-db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("customPhaseSets", "readwrite");
        let held = true;
        window.addEventListener(
          "release-phase-set-read",
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
          if (held) transaction.objectStore("customPhaseSets").count().onsuccess = hold;
        };
        hold();
        resolve();
      };
    });
  }, targetId);
}

async function releasePhaseSetRead(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("release-phase-set-read")));
}
