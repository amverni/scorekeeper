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
  ] as const)("hugs fitting content while reserving the real Create Player requirement in %s", async (colorScheme) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("No players yet", { exact: true }).waitFor();
      await settle(page);
      const panel = dialog.locator(".dialog-panel");
      const searchBounds = await box(panel);
      expect(searchBounds.height).toBeLessThan(712);
      expect(searchBounds.y + searchBounds.height / 2).toBeCloseTo(422, 0);
      expect(await dialog.getByRole("textbox").count()).toBe(1);
      expect(await dialog.getByRole("button", { name: "Save", exact: true }).count()).toBe(0);
      await dialog.getByRole("textbox").fill("First navigation");
      await dialog.getByRole("button", { name: "Create new player", exact: true }).click();
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await name.waitFor();
      await settle(page);
      expect(await box(panel)).toEqual(searchBounds);
      expect(await name.inputValue()).toBe("First navigation");
      expect(await name.evaluate((element) => element === document.activeElement)).toBe(true);
      const form = dialog.getByRole("region", { name: "Create player form", exact: true });
      const favorite = await box(dialog.getByRole("switch", { name: "Favorite", exact: true }));
      const save = await box(dialog.getByRole("button", { name: "Save", exact: true }));
      expect(save.y - favorite.y - favorite.height).toBeLessThanOrEqual(24);
      expect(save.y + save.height).toBeLessThanOrEqual(searchBounds.y + searchBounds.height - 10);
      expect(await form.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
      await dialog.getByRole("button", { name: "Back to search" }).click();
      await settle(page);
      expect(await box(panel)).toEqual(searchBounds);
    } finally {
      await page.close();
    }
  }, 30_000);

  describe.each([
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ])("natural result requirements at $width px", (viewport) => {
    it.each([
      "light",
      "dark",
    ] as const)("grows to the cap, hugs 12 fitting rows, and releases obsolete requirements in %s", async (colorScheme) => {
      const page = await browser.newPage({
        viewport,
        hasTouch: true,
        colorScheme,
        reducedMotion: colorScheme === "light" ? "no-preference" : "reduce",
      });
      try {
        await page.goto(`${appUrl}#${route}`);
        await page.evaluate(`(async () => {
            const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
            for (let index = 1; index <= 30; index++) {
              await playersApi.create({
                name: (index <= 12 ? "Fitting " : index <= 14 ? "Short " : "Other ")
                  + String(index).padStart(2, "0"),
                color: "Jam", isFavorite: 0,
              });
            }
          })()`);
        await page.reload();
        const background = page.locator(".page-shell-main");
        const backgroundScroll = await background.evaluate((element) => element.scrollTop);
        await page.getByRole("button", { name: "Add Player", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const panel = dialog.locator(".dialog-panel");
        const search = dialog.getByRole("textbox");
        const results = dialog.getByRole("region", {
          name: "Player search results",
          exact: true,
        });
        await results.getByRole("button", { name: "Other 30", exact: true }).waitFor();
        await settle(page);
        expect((await box(panel)).height).toBe(viewport.height - 32);
        const closeBounds = await box(dialog.getByRole("button", { name: "Close", exact: true }));
        await results.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        const last = await box(results.getByRole("button", { name: "Short 14", exact: true }));
        const resultBounds = await box(results);
        expect(last.y + last.height).toBeLessThanOrEqual(resultBounds.y + resultBounds.height - 10);
        expect(await box(dialog.getByRole("button", { name: "Close", exact: true }))).toEqual(
          closeBounds,
        );

        await search.fill("Fitting");
        await expect.poll(() => results.getByRole("button").count()).toBe(12);
        await settle(page);
        await expect
          .poll(async () => (await box(panel)).height)
          .toBeLessThan(viewport.height - 132);
        const fitting = await box(panel);
        expect(fitting.y + fitting.height / 2).toBeCloseTo(viewport.height / 2, 0);
        expect(
          await results.evaluate((element) => element.scrollHeight - element.clientHeight),
        ).toBe(0);
        const firstRow = await box(
          results.getByRole("button", { name: "Fitting 01", exact: true }),
        );
        const lastRow = await box(results.getByRole("button", { name: "Fitting 12", exact: true }));
        expect(firstRow.height).toBe(40);
        expect(lastRow.height).toBe(40);
        expect(fitting.y + fitting.height - lastRow.y - lastRow.height).toBeLessThanOrEqual(20);

        await dialog.getByRole("button", { name: "Create new player" }).click();
        await dialog.getByRole("textbox", { name: "Name", exact: true }).waitFor();
        await settle(page);
        expect(await box(panel)).toEqual(fitting);
        const save = await box(dialog.getByRole("button", { name: "Save", exact: true }));
        const favorite = await box(dialog.getByRole("switch", { name: "Favorite", exact: true }));
        expect(save.y - favorite.y - favorite.height).toBeGreaterThan(24);
        await dialog.getByRole("button", { name: "Back to search" }).click();
        await settle(page);
        expect(await box(panel)).toEqual(fitting);

        await search.fill("Nothing matches");
        await results.getByText('No players matching "Nothing matches"', { exact: true }).waitFor();
        await settle(page);
        await expect.poll(async () => (await box(panel)).height).toBeLessThan(fitting.height);
        const empty = await box(panel);
        await search.fill("Short");
        await expect.poll(() => results.getByRole("button").count()).toBe(2);
        await settle(page);
        expect(await box(panel)).toEqual(empty);
        await search.fill("");
        await expect.poll(() => results.getByRole("button").count()).toBe(30);
        await settle(page);
        expect((await box(panel)).height).toBe(viewport.height - 32);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        expect(await background.evaluate((element) => element.scrollTop)).toBe(backgroundScroll);
        await page.getByRole("button", { name: "Add Player", exact: true }).click();
        await search.waitFor();
        expect(await search.inputValue()).toBe("");
        await settle(page);
        expect((await box(panel)).height).toBe(viewport.height - 32);

        await page.setViewportSize({ width: 844, height: 390 });
        await page.evaluate(() => {
          document.documentElement.style.setProperty("--safe-area-inset-left", "47px");
          document.documentElement.style.setProperty("--safe-area-inset-right", "34px");
        });
        await setVisibleViewport(page, {
          width: 700,
          height: 310,
          offsetLeft: 60,
          offsetTop: 40,
        });
        await settle(page);
        const landscape = await box(panel);
        expect(landscape.height).toBe(278);
        expect(landscape.y).toBe(56);
        expect(landscape.x).toBeGreaterThanOrEqual(76);
        expect(landscape.x + landscape.width).toBeLessThanOrEqual(744);
        expect(landscape.x + landscape.width / 2).toBeCloseTo(410, 0);
        await dialog.getByRole("button", { name: "Create new player" }).click();
        const name = dialog.getByRole("textbox", { name: "Name", exact: true });
        await name.waitFor();
        await settle(page);
        expect(await box(panel)).toEqual(landscape);
        const form = dialog.getByRole("region", { name: "Create player form", exact: true });
        const fixedSave = await box(dialog.getByRole("button", { name: "Save", exact: true }));
        await form.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(await form.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect(await box(dialog.getByRole("button", { name: "Save", exact: true }))).toEqual(
          fixedSave,
        );
        expect(fixedSave.y + fixedSave.height).toBeLessThanOrEqual(334);
        await setVisibleViewport(page, {
          width: 700,
          height: 180,
          offsetLeft: 60,
          offsetTop: 40,
        });
        await settle(page);
        await panel.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const crampedSaveButton = dialog.getByRole("button", { name: "Save", exact: true });
        await expect
          .poll(async () => {
            await panel.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            const bounds = await box(crampedSaveButton);
            return bounds.y + bounds.height;
          })
          .toBeLessThanOrEqual(204);
        const crampedSave = await box(crampedSaveButton);
        expect(crampedSave.y).toBeGreaterThanOrEqual(56);
        expect(crampedSave.y + crampedSave.height).toBeLessThanOrEqual(204);
        await setVisibleViewport(page, {
          width: 700,
          height: 310,
          offsetLeft: 60,
          offsetTop: 40,
        });
        await dialog.getByRole("button", { name: "Back to search" }).click();
        await search.fill("Short");
        await expect.poll(() => results.getByRole("button").count()).toBe(2);
        await settle(page);
        expect((await box(panel)).height).toBe(278);
        await page.setViewportSize(viewport);
        await page.evaluate(() => {
          document.documentElement.style.setProperty("--safe-area-inset-left", "0px");
          document.documentElement.style.setProperty("--safe-area-inset-right", "0px");
        });
        await setVisibleViewport(page, {
          ...viewport,
          offsetLeft: 0,
          offsetTop: 0,
        });
        await settle(page);
        expect(await box(panel)).toEqual(empty);
        expect(await background.evaluate((element) => element.scrollTop)).toBe(backgroundScroll);
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  it("fits pending reads and recoverable errors, then follows settled filtered results", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(60_000);
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.evaluate(`(async () => {
        const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
        for (let index = 1; index <= 30; index++) {
          await playersApi.create({ name: "Player " + index, color: "Jam", isFavorite: 0 });
        }
      })()`);
      await page.reload();
      await holdPlayerStorage(page);
      await page.evaluate(() => {
        const getAll = IDBObjectStore.prototype.getAll;
        let transaction: IDBTransaction | undefined;
        let failed = false;
        window.addEventListener(
          "fail-player-read",
          () => {
            failed = true;
            transaction?.abort();
          },
          { once: true },
        );
        IDBObjectStore.prototype.getAll = function (query, count) {
          const request = getAll.call(this, query, count);
          if (this.name === "players") {
            IDBObjectStore.prototype.getAll = getAll;
            transaction = this.transaction;
            if (failed) transaction.abort();
          }
          return request;
        };
      });
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const panel = dialog.locator(".dialog-panel");
      const search = dialog.getByRole("textbox");
      const results = dialog.getByRole("region", { name: "Player search results", exact: true });
      await results.locator(".list-shimmer").first().waitFor();
      expect((await box(panel)).height).toBeLessThan(712);
      expect(await search.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event("fail-player-read")));
      await releasePlayerStorage(page);
      await results
        .getByRole("alert")
        .getByText("Unable to load players.", { exact: true })
        .waitFor();
      const errorBounds = await box(panel);
      expect(errorBounds.height).toBeLessThan(712);
      expect(errorBounds.y + errorBounds.height / 2).toBe(422);
      await results.getByRole("button", { name: "Try again", exact: true }).click();
      await expect.poll(() => results.getByRole("button").count()).toBe(30);
      await settle(page);
      expect((await box(panel)).height).toBe(812);
      await holdPlayerStorage(page);
      await search.fill("No matching Player");
      expect(await results.getByRole("button").count()).toBe(30);
      expect((await box(panel)).height).toBe(812);
      await releasePlayerStorage(page);
      await results
        .getByText('No players matching "No matching Player"', { exact: true })
        .waitFor();
      await settle(page);
      await expect.poll(async () => (await box(panel)).height).toBeLessThan(712);
      expect(await box(panel)).toEqual(errorBounds);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      await expect.poll(() => results.getByRole("button").count()).toBe(30);
      await settle(page);
      expect((await box(panel)).height).toBe(812);
      expect(await search.inputValue()).toBe("");
    } finally {
      await releasePlayerStorage(page);
      await page.close();
    }
  }, 30_000);

  it.each([
    "light",
    "dark",
  ] as const)("updates the natural form requirement after validation, save failure, and retry in %s", async (colorScheme) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#${route}`);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("No players yet", { exact: true }).waitFor();
      const panel = dialog.locator(".dialog-panel");
      const initial = await box(panel);
      await dialog.getByRole("textbox").fill("Resized draft");
      await dialog.getByRole("button", { name: "Create new player" }).click();
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await name.waitFor();
      await name.fill("");
      await dialog.getByRole("alert").getByText("Name is required", { exact: true }).waitFor();
      await expect.poll(async () => (await box(panel)).height).toBeGreaterThan(initial.height);
      await name.fill("Resized draft");
      await expect.poll(async () => (await box(panel)).height).toBe(initial.height);
      const failure = `Unable to save. ${"The draft remains available. ".repeat(50)}`;
      await holdPlayerStorage(page, failure);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.getByRole("button", { name: "Saving...", exact: true }).waitFor();
      await releasePlayerStorage(page);
      await dialog.getByRole("alert").getByText(failure, { exact: true }).waitFor();
      await expect.poll(async () => (await box(panel)).height).toBe(812);
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      const fixedSave = await box(save);
      const form = dialog.getByRole("region", { name: "Create player form", exact: true });
      await form.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await form.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(save)).toEqual(fixedSave);
      await holdPlayerStorage(page);
      await save.click();
      await dialog.getByRole("button", { name: "Saving...", exact: true }).waitFor();
      await expect.poll(async () => (await box(panel)).height).toBe(initial.height);
      expect(await name.inputValue()).toBe("Resized draft");
      expect(await dialog.getByRole("button", { name: "Back to search" }).isDisabled()).toBe(true);
      await releasePlayerStorage(page);
      await dialog.getByRole("textbox").waitFor();
      const selected = dialog.getByRole("button", { name: "Resized draft", exact: true });
      await selected.waitFor();
      expect(await selected.isDisabled()).toBe(true);
      expect(await selected.count()).toBe(1);
      expect(await box(panel)).toEqual(initial);
    } finally {
      await releasePlayerStorage(page);
      await page.close();
    }
  }, 30_000);

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
          const titleCenter = await header.getByRole("heading").evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const { x, width } = range.getBoundingClientRect();
            return x + width / 2;
          });
          expect(titleCenter).toBeCloseTo(panelBounds.x + panelBounds.width / 2, 0);

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
      expect(original.height).toBeLessThan(768);
      expect(original.y).toBeGreaterThanOrEqual(36);
      expect(original.y + original.height).toBeLessThanOrEqual(804);
      expect(original.y + original.height / 2).toBe(420);
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const searchClose = await box(close);
      const searchSurface = await box(search.locator(".."));
      expect(searchClose.y - original.y).toBe(8);
      expect(searchSurface.y - searchClose.y - searchClose.height).toBe(8);
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      await setVisibleViewport(page, { width: 390, height: 241, offsetLeft: 0, offsetTop: 60 });
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
      const saveBounds = await box(save);
      const closeBounds = await box(close);
      const nameLabel = await box(dialog.getByText("Name", { exact: true }));
      expect(closeBounds.y - fitted.y).toBe(8);
      expect(nameLabel.y - closeBounds.y - closeBounds.height).toBe(8);
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
