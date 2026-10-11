/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleDialogSlide } from "../../../test/dialogMotion";
import { holdPlayerStorage, releasePlayerStorage } from "../../../test/playerStorage";
import { touchGesture } from "../../../test/touchGesture";
import { setVisibleViewport } from "../../../test/visualViewport";

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

async function waitForSlide(slider: Locator) {
  await slider.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing Player flow bounds");
  return bounds;
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const image = await page.screenshot();
  return page.evaluate(
    async ({ image, clip }) => {
      const bitmap = new Image();
      bitmap.src = `data:image/png;base64,${image}`;
      await bitmap.decode();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing screenshot canvas");
      context.drawImage(bitmap, 0, 0);
      return Array.from(context.getImageData(clip.x, clip.y, clip.width, clip.height).data);
    },
    { image: image.toString("base64"), clip },
  );
}

describe.each(["/scorekeeper/create", "/phaseCompan10n/create"])("%s", (route) => {
  it.each([
    "light",
    "dark",
  ] as const)("glides a focused workspace at its fitted size above an already visible keyboard in %s", async (colorScheme) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      colorScheme,
      reducedMotion: "no-preference",
    });
    try {
      await page.goto(`${appUrl}#${route}`, { timeout: 60_000 });
      const background = page.locator(".page-shell");
      const original = await box(background);
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
      });
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      for (let opening = 0; opening < 2; opening++) {
        const entry = await sampleDialogSlide(page, () =>
          page.getByRole("button", { name: "Add Player", exact: true }).click(),
        );
        const dialog = page.getByRole("dialog");
        const panel = dialog.locator(".dialog-panel");
        const search = dialog.getByRole("textbox");
        const resting = entry.samples[4];
        expect(entry.samples[0].y).toBeCloseTo(512, 0);
        expect(resting.y).toBeCloseTo(76, 3);
        expect(resting.height).toBeCloseTo(388, 3);
        expect(resting.width).toBeCloseTo(351, 3);
        const travel = entry.samples[0].y - resting.y;
        expect(entry.samples[1].y).toBeLessThan(entry.samples[0].y - travel * 0.01);
        expect(entry.samples[2].y - resting.y).toBeGreaterThan(travel * 0.25);
        expect(entry.samples[3].y - resting.y).toBeGreaterThan(travel * 0.08);
        for (const sample of entry.samples) {
          expect(sample).toMatchObject({ scaleX: 1, scaleY: 1 });
          expect(sample.width).toBeCloseTo(resting.width, 3);
          expect(sample.height).toBeCloseTo(resting.height, 3);
        }
        await search.fill("Keyboard glide");
        await expect
          .poll(() => search.evaluate((element) => element === document.activeElement))
          .toBe(true);
        expect(await box(background)).toEqual(original);
        expect(await page.locator("#root").evaluate((element) => element.style.position)).toBe(
          "fixed",
        );
        await panel.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
        await settle(page);
        const field = await box(search);
        expect(field.y).toBeGreaterThanOrEqual(resting.y);
        expect(field.y + field.height).toBeLessThanOrEqual(resting.y + resting.height);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await expect
          .poll(() => page.locator("#root").evaluate((element) => element.style.position))
          .toBe("");
        expect(await box(background)).toEqual(original);
      }
    } finally {
      await page.close();
    }
  }, 90_000);

  describe.each([
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ])("Player page transitions at $width px", (viewport) => {
    it.each([
      "no-preference",
      "reduce",
    ] as const)("keeps the focused Player form aligned with reduced motion set to %s", async (reducedMotion) => {
      const page = await browser.newPage({ viewport, hasTouch: true, reducedMotion });
      try {
        await page.goto(`${appUrl}#${route}`);
        await page.getByRole("button", { name: "Add Player", exact: true }).tap();
        const dialog = page.getByRole("dialog");
        const slider = dialog.locator(".add-player-slider");
        const search = dialog.getByRole("textbox");
        await search.fill("Amy");
        await settle(page);
        const panel = dialog.locator(".dialog-panel");
        const restingPanel = await box(panel);
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        const restingClose = await box(close);
        expect(restingPanel.y).toBeGreaterThanOrEqual(16);
        expect(restingPanel.y + restingPanel.height).toBeLessThanOrEqual(viewport.height - 16);
        expect(await dialog.getByRole("heading").count()).toBe(0);

        for (let attempt = 0; attempt < 3; attempt++) {
          await dialog.getByRole("button", { name: "Create new player", exact: true }).tap();
          const name = dialog.getByRole("textbox", { name: "Name", exact: true });
          await name.waitFor();
          await waitForSlide(slider);

          const panelBounds = await dialog.locator(".dialog-panel").boundingBox();
          const nameBounds = await name.boundingBox();
          const back = dialog.getByRole("button", { name: "Back to search" });
          const backBounds = await back.boundingBox();
          if (!panelBounds || !nameBounds || !backBounds) {
            throw new Error("Missing Player form bounds");
          }
          expect(backBounds.x).toBeGreaterThanOrEqual(panelBounds.x);
          expect(nameBounds.x).toBeGreaterThanOrEqual(panelBounds.x);
          expect(nameBounds.x + nameBounds.width).toBeLessThanOrEqual(
            panelBounds.x + panelBounds.width,
          );
          expect(
            Math.abs(nameBounds.x + nameBounds.width / 2 - (panelBounds.x + panelBounds.width / 2)),
          ).toBeLessThanOrEqual(1);
          expect(await name.evaluate((element) => element === document.activeElement)).toBe(true);
          expect(await name.inputValue()).toBe("Amy");
          expect(await box(panel)).toEqual(restingPanel);
          expect(await box(close)).toEqual(restingClose);
          const header = dialog.locator("header");
          expect(await header.getByRole("button", { name: "Back to search" }).count()).toBe(1);
          expect(await header.getByRole("button", { name: "Close", exact: true }).count()).toBe(1);
          expect(
            await dialog.getByRole("heading", { name: "New Player", exact: true }).count(),
          ).toBe(1);

          await back.tap();
          await slider.and(dialog.locator("[data-view='search']")).waitFor({ state: "attached" });
          await waitForSlide(slider);
          await expect
            .poll(() => search.evaluate((element) => element === document.activeElement))
            .toBe(true);
          const searchBounds = await search.boundingBox();
          if (!searchBounds) throw new Error("Missing Player search bounds");
          expect(searchBounds.x).toBeGreaterThanOrEqual(panelBounds.x);
          expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(
            panelBounds.x + panelBounds.width,
          );
          expect(await search.inputValue()).toBe("Amy");
        }
        await close.tap();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Add Player", exact: true }).tap();
        await search.waitFor();
        expect(await search.inputValue()).toBe("");
        expect(await dialog.getByRole("button", { name: "Back to search" }).count()).toBe(0);
      } finally {
        await page.close();
      }
    }, 30_000);
  });

  it("fits both internal views above the keyboard and restores their stable workspace", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-area-inset-top", "20px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
        document.documentElement.style.setProperty("--safe-area-inset-left", "12px");
        document.documentElement.style.setProperty("--safe-area-inset-right", "8px");
      });
      await page.getByRole("button", { name: "Add Player", exact: true }).tap();
      const dialog = page.getByRole("dialog");
      const panel = dialog.locator(".dialog-panel");
      const search = dialog.getByRole("textbox");
      await search.fill("Keyboard Player");
      await settle(page);
      const original = await box(panel);
      expect(original.x).toBeGreaterThanOrEqual(28);
      expect(original.x + original.width).toBeLessThanOrEqual(366);
      expect(original.y).toBe(36);
      expect(original.y + original.height).toBe(804);
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      await setVisibleViewport(page, { width: 390, height: 257, offsetLeft: 0, offsetTop: 60 });
      await dialog.getByRole("button", { name: "Create new player" }).tap();
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await name.waitFor();
      await settle(page);
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      await save.scrollIntoViewIfNeeded();
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      const fitted = await box(panel);
      expect(fitted.y).toBe(76);
      expect(fitted.y + fitted.height).toBe(464);
      expect(await name.inputValue()).toBe("Keyboard Player");
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const saveBounds = await box(save);
      const closeBounds = await box(close);
      const region = dialog.getByRole("region", { name: "Create player form", exact: true });
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(save)).toEqual(saveBounds);
      expect(await box(close)).toEqual(closeBounds);
      await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
      await save.scrollIntoViewIfNeeded();
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const visibleSave = await box(save);
      expect(visibleSave.y).toBeGreaterThanOrEqual(76);
      expect(visibleSave.y + visibleSave.height).toBeLessThanOrEqual(224);
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      await dialog.getByRole("button", { name: "Back to search" }).tap();
      await settle(page);
      expect(await box(panel)).toEqual(fitted);
      expect(await search.inputValue()).toBe("Keyboard Player");
      expect(await search.evaluate((element) => element === document.activeElement)).toBe(true);
      await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      expect(await box(panel)).toEqual(original);
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    "light",
    "dark",
  ] as const)("shows both edges of the scroll-region keyboard focus ring in %s", async (colorScheme) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const dialog = page.getByRole("dialog");
      for (const label of ["Player search results", "Create player form"]) {
        if (label === "Create player form") {
          await dialog.getByRole("button", { name: "Create new player" }).click();
          await dialog.getByRole("textbox", { name: "Name", exact: true }).waitFor();
        }
        await settle(page);
        const region = dialog.getByRole("region", { name: label, exact: true });
        await page.keyboard.press("Tab");
        await region.focus();
        expect(await region.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
        const bounds = await box(region);
        for (const x of [Math.floor(bounds.x) + 12, Math.ceil(bounds.x + bounds.width) - 14]) {
          const clip = { x, y: Math.ceil(bounds.y) + 40, width: 2, height: 20 };
          await region.focus();
          const focused = await pixels(page, clip);
          await dialog.getByRole("button", { name: "Close", exact: true }).focus();
          const blurred = await pixels(page, clip);
          expect(
            focused.filter((channel, index) => Math.abs(channel - blurred[index]) > 10).length,
          ).toBeGreaterThan(10);
        }
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it("blocks leaving Create Player during a save, preserves failure feedback, and selects once on retry", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.getByRole("button", { name: "Add Player", exact: true }).tap();
      const dialog = page.getByRole("dialog");
      const search = dialog.getByRole("textbox");
      await search.fill("Recoverable Player");
      await dialog.getByRole("button", { name: "Create new player" }).tap();
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await name.waitFor();
      await dialog.getByRole("switch", { name: "Favorite", exact: true }).click();
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      const failure = `Player storage unavailable. ${"Retry keeps this draft. ".repeat(40)}`;
      await holdPlayerStorage(page, failure);
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      const saveBounds = await box(save);
      const back = dialog.getByRole("button", { name: "Back to search" });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await save.click();
      await dialog.getByRole("button", { name: "Saving...", exact: true }).waitFor();
      expect(await back.isDisabled()).toBe(true);
      expect(await close.isDisabled()).toBe(true);
      const panel = dialog.locator(".dialog-panel");
      const pendingBounds = await box(panel);
      for (const direction of [-1, 1]) {
        expect(
          await touchGesture(dialog.locator("header"), [
            { y: 0, time: 0 },
            { y: direction * 160, time: 100 },
            { y: direction * 160, time: 110 },
          ]),
        ).toEqual([false, false, false]);
        expect(await box(panel)).toEqual(pendingBounds);
      }
      await page.keyboard.press("Escape");
      await page.mouse.click(2, 2);
      expect(await dialog.getAttribute("data-dialog-open")).toBe("true");
      await releasePlayerStorage(page);
      await dialog.getByRole("alert").getByText(failure, { exact: true }).waitFor();
      expect(await name.inputValue()).toBe("Recoverable Player");
      expect(await back.isEnabled()).toBe(true);
      expect(await close.isEnabled()).toBe(true);
      expect(await box(save)).toEqual(saveBounds);
      const region = dialog.getByRole("region", { name: "Create player form", exact: true });
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await box(save)).toEqual(saveBounds);
      await save.click();
      await dialog.getByRole("textbox").waitFor();
      const selected = dialog.getByRole("button", { name: "Recoverable Player", exact: true });
      await selected.waitFor();
      expect(await selected.isDisabled()).toBe(true);
      expect(await selected.count()).toBe(1);
      expect(await dialog.getByRole("button", { name: "Back to search" }).count()).toBe(0);
      expect(await search.inputValue()).toBe("Recoverable Player");
      await dialog.getByRole("button", { name: "Create new player" }).tap();
      await name.waitFor();
      expect(
        await dialog.getByRole("switch", { name: "Favorite" }).getAttribute("aria-checked"),
      ).toBe("false");
      expect(await dialog.getByRole("alert").count()).toBe(0);
      await name.fill("Duplicate check");
      await back.tap();
      await dialog.getByRole("button", { name: "Create new player" }).tap();
      await name.waitFor();
      expect(await name.inputValue()).toBe("Recoverable Player");
      expect(errors).toEqual([]);
      await close.tap();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Add Player", exact: true }).tap();
      expect(await search.inputValue()).toBe("");
      expect(
        await dialog.getByRole("button", { name: "Recoverable Player", exact: true }).isDisabled(),
      ).toBe(true);
    } finally {
      await releasePlayerStorage(page);
      await page.close();
    }
  }, 30_000);
});
