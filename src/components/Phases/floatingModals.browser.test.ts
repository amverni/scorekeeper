/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleDialogSlide } from "../../test/dialogMotion";
import { touchGesture } from "../../test/touchGesture";
import { setVisibleViewport } from "../../test/visualViewport";

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

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Missing visible modal content");
  return bounds;
}

function holdPhaseStorage(page: Page, storeName: "customPhases" | "customPhaseSets") {
  return page.evaluate(
    (storeName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("phase10-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(storeName, "readwrite");
          let held = true;
          window.addEventListener(
            "release-phase-storage",
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
            if (held) transaction.objectStore(storeName).get("fixture").onsuccess = hold;
          };
          hold();
          resolve();
        };
      }),
    storeName,
  );
}

function panelFor(dialog: Locator) {
  return dialog.getByRole("heading").locator("xpath=ancestor::*[@data-headlessui-state][1]");
}

async function expectClearance(
  page: Page,
  panel: Locator,
  insets: { top: number; right: number; bottom: number; left: number },
) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Missing viewport");
  const bounds = await box(panel);
  expect(bounds.x).toBeGreaterThanOrEqual(insets.left + 16);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - insets.right - 16);
  expect(bounds.y).toBeGreaterThanOrEqual(insets.top + 16);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - insets.bottom - 16);
  expect(bounds.width).toBeLessThanOrEqual(512);
  expect(bounds.x + bounds.width / 2).toBeCloseTo(
    (insets.left + viewport.width - insets.right) / 2,
    0,
  );
  expect(bounds.y + bounds.height / 2).toBeCloseTo(
    (insets.top + viewport.height - insets.bottom) / 2,
    0,
  );
  return bounds;
}

async function samplePixels(page: Page, points: { x: number; y: number }[]) {
  const screenshot = await page.screenshot();
  return page.evaluate(
    async ({ image, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${image}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing screenshot canvas");
      context.drawImage(img, 0, 0);
      return points.map(({ x, y }) =>
        Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data),
      );
    },
    { image: screenshot.toString("base64"), points },
  );
}

describe.each([
  "light",
  "dark",
] as const)("floating management modals in %s appearance", (colorScheme) => {
  it.each([
    "2 sets of 3",
    "Original",
  ])("glides %s from just below the viewport and preserves downward closure on repeated opening", async (name) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`, { timeout: 60_000 });
      if (name === "2 sets of 3") {
        await page.getByRole("tab", { name: "Phases", exact: true }).click();
      }
      const insets = { top: 47, right: 0, bottom: 34, left: 0 };
      await page.evaluate((insets) => {
        for (const [edge, value] of Object.entries(insets)) {
          document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
        }
      }, insets);
      const trigger = page.getByRole("button", { name, exact: true });
      const dialog = page.getByRole("dialog", { name, exact: true });
      const panel = panelFor(dialog);
      for (let opening = 0; opening < 2; opening++) {
        const { samples } = await sampleDialogSlide(page, () => trigger.click());
        const travel = samples[0].y - samples[4].y;
        expect(samples[0].y).toBeCloseTo(876, 0);
        expect(samples[1].y).toBeLessThan(samples[0].y - travel * 0.01);
        expect(samples[2].y - samples[4].y).toBeGreaterThan(travel * 0.25);
        expect(samples[3].y - samples[4].y).toBeGreaterThan(travel * 0.08);
        for (let index = 0; index < samples.length; index++) {
          expect(samples[index]).toMatchObject({ scaleX: 1, scaleY: 1 });
          expect(samples[index].width).toBeCloseTo(samples[4].width, 3);
          expect(samples[index].height).toBeCloseTo(samples[4].height, 3);
          if (index > 0) expect(samples[index].y).toBeLessThan(samples[index - 1].y);
        }
        await panel.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
        await settle(page);
        const resting = await expectClearance(page, panel, insets);
        const exit = await sampleDialogSlide(
          page,
          () => dialog.getByRole("button", { name: "Close", exact: true }).click(),
          [0, 75, 150, 225],
        );
        expect(exit.duration).toBe(300);
        const exitTravel = exit.samples[4].y - resting.y;
        expect(exit.samples[0].y).toBeCloseTo(resting.y, 3);
        expect(exit.samples[4].y).toBeGreaterThanOrEqual(844);
        expect(exit.samples[1].y - resting.y).toBeLessThan(exitTravel * 0.1);
        expect(exit.samples[2].y - resting.y).toBeLessThan(exitTravel * 0.2);
        expect(
          await panel.evaluate((element) => getComputedStyle(element).transitionTimingFunction),
        ).toBe("cubic-bezier(0.5, 0, 1, 0)");
        for (let index = 0; index < exit.samples.length; index++) {
          expect(exit.samples[index]).toMatchObject({ scaleX: 1, scaleY: 1 });
          expect(exit.samples[index].width).toBeCloseTo(resting.width, 3);
          expect(exit.samples[index].height).toBeCloseTo(resting.height, 3);
          if (index > 0) expect(exit.samples[index].y).toBeGreaterThan(exit.samples[index - 1].y);
        }
        expect(await page.locator("#root").evaluate((element) => element.style.position)).toBe(
          "fixed",
        );
        await panel.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
        await dialog.waitFor({ state: "detached" });
        await expect
          .poll(() => page.locator("#root").evaluate((element) => element.style.position))
          .toBe("");
      }
    } finally {
      await page.close();
    }
  }, 90_000);

  it("dismisses a deliberate header pull at a consistent distance on short and tall panels", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      for (const name of ["Original", "2 sets of 3"]) {
        if (name === "2 sets of 3") {
          await page.getByRole("tab", { name: "Phases", exact: true }).click();
        }
        const trigger = page.getByRole("button", { name, exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name, exact: true });
        await dialog.getByRole("heading").waitFor();
        await settle(page);
        const panel = panelFor(dialog);
        const resting = await box(panel);
        const header = dialog.getByRole("heading");
        await touchGesture(header, [
          { y: 0, time: 0 },
          { y: 119, time: 500 },
          { y: 119, time: 800 },
        ]);
        await settle(page);
        expect(await box(panel)).toEqual(resting);
        await touchGesture(header, [
          { y: 0, time: 1000 },
          { y: 120, time: 1500 },
          { y: 120, time: 1800 },
        ]);
        await dialog.waitFor({ state: "detached" });
        await trigger.click();
        await dialog.getByRole("heading").waitFor();
        await settle(page);
        expect(await box(panel)).toEqual(resting);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("requires meaningful flick travel and recent downward release speed, rejecting pauses and reversals", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const trigger = page.getByRole("button", { name: "2 sets of 3", exact: true });
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      await trigger.click();
      await dialog.getByRole("heading").waitFor();
      await settle(page);
      const panel = panelFor(dialog);
      const resting = await box(panel);
      const header = dialog.getByRole("heading");
      for (const points of [
        [
          { y: 0, time: 0 },
          { y: 47, time: 30 },
          { y: 47, time: 40 },
        ],
        [
          { y: 0, time: 0 },
          { y: 48, time: 80 },
          { y: 48, time: 81 },
        ],
        [
          { y: 0, time: 0 },
          { y: 60, time: 40 },
          { y: 60, time: 250 },
        ],
        [
          { y: 0, time: 0 },
          { y: 140, time: 80 },
          { y: 130, time: 90 },
          { y: 130, time: 100 },
        ],
        [
          { y: 0, time: 0 },
          { y: 140, time: 80 },
          { y: 30, time: 100 },
        ],
      ]) {
        await touchGesture(header, points);
        await settle(page);
        expect(await box(panel)).toEqual(resting);
      }
      await touchGesture(header, [
        { y: 0, time: 0 },
        { y: 24, time: 20 },
        { y: 48, time: 40 },
        { y: 48, time: 41 },
      ]);
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("restores cancellations, upward and horizontal gestures without stretching or capturing controls", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      await dialog.getByRole("heading").waitFor();
      await settle(page);
      const panel = panelFor(dialog);
      const resting = await box(panel);
      const header = dialog.getByRole("heading");
      const returning = await sampleDialogSlide(page, () =>
        touchGesture(header, [
          { y: 0, time: 0 },
          { y: 60, time: 500 },
          { y: 60, time: 800 },
        ]),
      );
      expect(returning.duration).toBe(300);
      expect(returning.samples[0].y).toBeCloseTo(resting.y + 60, 3);
      expect(returning.samples[2].y - resting.y).toBeLessThan(6);
      expect(returning.samples[4].y).toBeCloseTo(resting.y, 3);
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await settle(page);
      const cancelled = await touchGesture(
        header,
        [
          { y: 0, time: 0 },
          { y: 160, time: 100 },
          { y: 160, time: 110 },
        ],
        "touchcancel",
      );
      expect(cancelled[1]).toBe(true);
      await settle(page);
      expect(await box(panel)).toEqual(resting);
      for (const points of [
        [
          { y: 100, time: 0 },
          { y: 0, time: 100 },
          { y: 0, time: 110 },
        ],
        [
          { x: 0, y: 0, time: 0 },
          { x: 150, y: 15, time: 100 },
          { x: 150, y: 160, time: 110 },
        ],
        [
          { y: 0, time: 0 },
          { y: 7, time: 1 },
          { y: 7, time: 2 },
        ],
      ]) {
        expect(await touchGesture(header, points)).toEqual([false, false, false]);
        await settle(page);
        expect(await box(panel)).toEqual(resting);
      }
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      expect(
        await touchGesture(close, [
          { y: 0, time: 0 },
          { y: 160, time: 100 },
          { y: 160, time: 110 },
        ]),
      ).toEqual([false, false, false]);
      expect(await box(panel)).toEqual(resting);
      await close.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("leaves scrolling native until a fresh swipe begins at the nearest content boundary", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 400 },
      hasTouch: true,
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      const text = dialog.getByText("Phases (10)", { exact: true });
      await text.waitFor();
      await settle(page);
      const panel = panelFor(dialog);
      const resting = await box(panel);
      const scroller = dialog.getByRole("region", { name: "Original", exact: true });
      await scroller.evaluate((element) => {
        element.scrollTop = 50;
      });
      // Move the real scroll owner to its boundary after touchstart, as native
      // scrolling would. That gesture must not transfer ownership mid-swipe.
      await text.evaluate((element) => {
        const touch = { identifier: 7, target: element, clientX: 100, clientY: 0 };
        const event = new Event("touchstart", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: [touch] });
        element.dispatchEvent(event);
      });
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      const prevented = await text.evaluate((element) => {
        const touch = { identifier: 7, target: element, clientX: 100, clientY: 160 };
        return ["touchmove", "touchend"].map((type) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [touch] },
            changedTouches: { value: [touch] },
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
      });
      expect(prevented).toEqual([false, false]);
      expect(await box(panel)).toEqual(resting);
      await scroller.hover();
      await page.mouse.wheel(0, 180);
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await box(panel)).toEqual(resting);
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect(
        await touchGesture(text, [
          { y: 150, time: 0 },
          { y: 0, time: 100 },
          { y: 0, time: 110 },
        ]),
      ).toEqual([false, false, false]);
      expect(await box(panel)).toEqual(resting);
      await touchGesture(text, [
        { y: 0, time: 0 },
        { y: 120, time: 500 },
        { y: 120, time: 700 },
      ]);
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("restricts mouse dragging to the header and restores pointer cancellation", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      await dialog.getByRole("heading").waitFor();
      await settle(page);
      const panel = panelFor(dialog);
      const resting = await box(panel);
      const body = await box(dialog.getByText("Phases (10)", { exact: true }));
      await page.mouse.move(body.x + 20, body.y + 8);
      await page.mouse.down();
      await page.mouse.move(body.x + 20, body.y + 150, { steps: 5 });
      await page.mouse.up();
      expect(await box(panel)).toEqual(resting);
      expect(await page.evaluate(() => getSelection()?.toString().length)).toBeGreaterThan(0);
      const header = await box(dialog.getByRole("heading"));
      await page.mouse.move(header.x + 10, header.y + 8);
      await page.mouse.down();
      await page.mouse.move(header.x + 10, header.y + 160, { steps: 5 });
      const dragged = await box(panel);
      expect(dragged.y).toBeGreaterThan(resting.y + 120);
      expect(dragged.height).toBe(resting.height);
      await panel.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
      await page.mouse.up();
      expect(await box(panel)).toEqual(resting);
      await page.mouse.move(header.x + 10, header.y + 8);
      await page.mouse.down();
      await page.mouse.move(header.x + 10, header.y + 160, { steps: 5 });
      await page.mouse.up();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("slides a released panel fully below the current visible viewport at its final size and reopens cleanly", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const trigger = page.getByRole("button", {
        name: "2 sets of 3",
        exact: true,
        includeHidden: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      await dialog.getByRole("heading").waitFor();
      await settle(page);
      await setVisibleViewport(page, { width: 390, height: 1600, offsetLeft: 0, offsetTop: 0 });
      const panel = panelFor(dialog);
      const resting = await box(panel);
      const { duration, samples } = await sampleDialogSlide(
        page,
        () =>
          touchGesture(dialog.getByRole("heading"), [
            { y: 0, time: 0 },
            { y: 120, time: 500 },
            { y: 120, time: 700 },
          ]),
        [0, 75, 150, 225],
      );
      expect(duration).toBe(300);
      expect(
        await panel.evaluate((element) => getComputedStyle(element).transitionTimingFunction),
      ).toBe("ease-out");
      expect(samples[0].y).toBeCloseTo(resting.y + 120, 0);
      expect(samples[1].y).toBeGreaterThan(samples[0].y + (samples[4].y - samples[0].y) * 0.25);
      expect(samples[4].y).toBeGreaterThanOrEqual(1600);
      for (let index = 0; index < samples.length; index++) {
        expect(samples[index]).toMatchObject({ scaleX: 1, scaleY: 1 });
        expect(samples[index].height).toBeCloseTo(resting.height, 3);
        expect(samples[index].width).toBeCloseTo(resting.width, 3);
        if (index > 0) expect(samples[index].y).toBeGreaterThan(samples[index - 1].y);
      }
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.currentTime = 150;
      });
      await trigger.evaluate((element) => {
        if (!(element instanceof HTMLElement)) throw new Error("Missing Phase trigger");
        element.click();
      });
      await expect.poll(() => dialog.getAttribute("data-dialog-open")).toBe("true");
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await settle(page);
      expect(await box(panel)).toEqual(resting);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("opens a content-sized, app-colored Phase with one accessible glass Close control", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const trigger = page.getByRole("button", { name: "2 sets of 3", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      const heading = dialog.getByRole("heading", { name: "2 sets of 3", exact: true });
      await heading.waitFor();
      await settle(page);
      const panel = panelFor(dialog);
      const bounds = await box(panel);
      expect(bounds.height).toBeLessThan(250);
      expect(bounds.y + bounds.height / 2).toBeCloseTo(422, 0);
      expect(bounds.x).toBeGreaterThanOrEqual(16);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(374);
      expect(
        await panel.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            filter: style.filter,
            backdropFilter: style.backdropFilter,
            shine: getComputedStyle(element, "::after").content,
            corners: [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomLeftRadius,
              style.borderBottomRightRadius,
            ],
          };
        }),
      ).toEqual({
        background: colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)",
        filter: "none",
        backdropFilter: "none",
        shine: "none",
        corners: ["16px", "16px", "16px", "16px"],
      });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      expect(await close.count()).toBe(1);
      expect(await dialog.getByRole("button", { name: "Go back", exact: true }).count()).toBe(0);
      const closeBounds = await box(close);
      expect(closeBounds.width).toBe(44);
      expect(closeBounds.height).toBe(44);
      expect(closeBounds.x).toBeGreaterThan(bounds.x + bounds.width / 2);
      expect(
        await close.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).borderRadius),
        ),
      ).toBeGreaterThanOrEqual(22);
      await close.click();
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((element) => document.activeElement === element))
        .toBe(true);
      await trigger.click();
      await dialog.getByText("built-in", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "Phase Sets", exact: true }).click();
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const phaseSet = page.getByRole("dialog", { name: "Original", exact: true });
      await phaseSet.getByText("Phases (10)", { exact: true }).waitFor();
      await phaseSet.getByText("10", { exact: true }).waitFor();
      await settle(page);
      const setBounds = await expectClearance(page, panelFor(phaseSet), {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
      expect(setBounds.height).toBeLessThan(700);
      await phaseSet.getByRole("button", { name: "Close", exact: true }).click();
      await phaseSet.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps the background blurred but undimmed and paints no skirt beneath the floating surface", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;inset:0;z-index:40;pointer-events:none;background:rgb(255,0,255)";
        document.body.append(probe);
      });
      await page.getByRole("button", { name: "2 sets of 3", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      await dialog.getByRole("button", { name: "Close", exact: true }).waitFor();
      await settle(page);
      const backdrop = await dialog.locator(".dialog-backdrop").evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.backgroundColor, blur: style.backdropFilter };
      });
      expect(backdrop).toEqual({ color: "rgba(0, 0, 0, 0)", blur: "blur(4px)" });
      const bounds = await box(panelFor(dialog));
      const samples = await samplePixels(page, [
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 5 },
        { x: 195, y: 839 },
        { x: 5, y: 5 },
      ]);
      expect(samples).toEqual([
        colorScheme === "light" ? [255, 255, 255, 255] : [23, 23, 23, 255],
        [255, 0, 255, 255],
        [255, 0, 255, 255],
      ]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("bounds a long Phase Set inside Safe Areas with a fixed header and a reachable final Phase", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
      hasTouch: true,
    });
    try {
      await page.goto(appUrl);
      await page.evaluate(`(async () => {
        const { phasesApi } = await import("/scorekeeper/src/data/api/phases.ts");
        const { phaseSetsApi } = await import("/scorekeeper/src/data/api/phaseSets.ts");
        const phases = (await phasesApi.getAll({ type: "built-in" })).slice(0, 24);
        if (phases.length !== 24) throw new Error("Missing fixture Phases");
        await phaseSetsApi.create({
          type: "saved", name: "Long pilot Phase Set", phases: phases.map(phase => phase.id),
        });
      })()`);
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      const trigger = page.getByRole("button", { name: "Long pilot Phase Set", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Long pilot Phase Set", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await close.waitFor();
      await dialog.getByText("Phases (24)", { exact: true }).waitFor();
      const panel = panelFor(dialog);
      const finalPhase = dialog.getByText("24", { exact: true });
      const scroller = finalPhase.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' overflow-y-auto ')][1]",
      );
      for (const [width, height, top, right, bottom, left] of [
        [320, 568, 0, 0, 0, 0],
        [390, 844, 47, 0, 34, 0],
        [844, 390, 0, 44, 21, 44],
        [844, 390, 20, 12, 21, 44],
        [1280, 900, 0, 0, 0, 0],
      ]) {
        await page.setViewportSize({ width, height });
        const insets = { top, right, bottom, left };
        await page.evaluate((insets) => {
          for (const [edge, value] of Object.entries(insets)) {
            document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
          }
        }, insets);
        await settle(page);
        const bounds = await expectClearance(page, panel, insets);
        expect(bounds.height).toBeCloseTo(height - top - bottom - 32, 0);
        const headerBounds = await box(close);
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect(await box(close)).toEqual(headerBounds);
        const last = await box(finalPhase);
        const scrollBounds = await box(scroller);
        expect(last.y).toBeGreaterThanOrEqual(scrollBounds.y);
        expect(last.y + last.height).toBeLessThanOrEqual(scrollBounds.y + scrollBounds.height - 10);
        expect(
          await finalPhase.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
            );
          }),
        ).toBe(true);
      }
      await close.tap();
      await dialog.waitFor({ state: "detached" });
      await trigger.click();
      await finalPhase.waitFor({ state: "attached" });
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
      await page.mouse.click(2, 2);
      await dialog.waitFor({ state: "detached" });
      await trigger.click();
      await close.waitFor();
      const region = dialog.getByRole("region", { name: "Long pilot Phase Set", exact: true });
      const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
      await close.focus();
      await page.keyboard.press(tab);
      await expect
        .poll(() => region.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await page.keyboard.press("PageDown");
      await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await close.focus();
      expect(
        await close.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.outlineStyle, style.outlineColor];
        }),
      ).toEqual(["solid", colorScheme === "light" ? "rgb(26, 26, 26)" : "rgb(255, 255, 255)"]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("fits keyboard dimensions and offsets inside intersecting Safe Areas without reflowing the app", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
        document.documentElement.style.setProperty("--safe-area-inset-right", "20px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
        document.documentElement.style.setProperty("--safe-area-inset-left", "12px");
      });
      const background = page.locator(".page-shell");
      const original = await box(background);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      await dialog.getByText("Phases (10)", { exact: true }).waitFor();
      const panel = panelFor(dialog);
      for (const visible of [
        { width: 350, height: 360, offsetLeft: 30, offsetTop: 100 },
        { width: 390, height: 420, offsetLeft: 0, offsetTop: 20 },
        { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 },
      ]) {
        await setVisibleViewport(page, visible);
        const bounds = await box(panel);
        const usable =
          visible.offsetTop === 100
            ? { left: 46, right: 354, top: 116, bottom: 444 }
            : visible.height === 420
              ? { left: 28, right: 354, top: 63, bottom: 424 }
              : { left: 28, right: 354, top: 63, bottom: 794 };
        expect(bounds.x).toBeGreaterThanOrEqual(usable.left);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(usable.right);
        expect(bounds.y).toBeGreaterThanOrEqual(usable.top);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(usable.bottom);
        expect(bounds.x + bounds.width / 2).toBeCloseTo((usable.left + usable.right) / 2, 0);
        expect(bounds.y + bounds.height / 2).toBeCloseTo((usable.top + usable.bottom) / 2, 0);
        expect(await box(background)).toEqual(original);
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("freezes pre-scrolled app content through viewport changes and repeated modal lifetimes", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const trigger = page.getByRole("button", {
        name: "1 run of 9",
        exact: true,
        includeHidden: true,
      });
      await trigger.scrollIntoViewIfNeeded();
      const scroller = trigger.locator("xpath=ancestor::*[contains(@class,'dialog-scroll')][1]");
      await scroller.evaluate((element) => {
        element.scrollTop = 100;
      });
      const position = await scroller.evaluate((element) => element.scrollTop);
      expect(position).toBeGreaterThan(0);
      const shell = page.locator(".page-shell");
      const originalBounds = await box(shell);
      const header = shell.locator(".page-shell-header");
      const footer = shell.locator(".page-shell-footer");
      const main = shell.locator(".page-shell-main");
      const interior = [await box(header), await box(footer), await box(main)];
      for (let attempt = 0; attempt < 2; attempt++) {
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "1 run of 9", exact: true });
        await dialog.getByRole("button", { name: "Close", exact: true }).waitFor();
        await settle(page);
        await page.mouse.move(10, 200);
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(100);
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(position);
        await page.setViewportSize({ width: 844, height: 390 });
        await setVisibleViewport(page, {
          width: 844,
          height: 280,
          offsetTop: 60,
          offsetLeft: 0,
        });
        expect(await box(shell)).toEqual(originalBounds);
        expect([await box(header), await box(footer), await box(main)]).toEqual(interior);
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(position);
        expect(await dialog.getAttribute("data-dialog-open")).toBe("true");
        await dialog.getByRole("button", { name: "Close", exact: true }).focus();
        const backgroundTab = page.getByRole("tab", { name: "Phase Sets", includeHidden: true });
        await backgroundTab.evaluate((element) => {
          if (!(element instanceof HTMLElement)) throw new Error("Missing background tab");
          element.focus();
        });
        await expect
          .poll(() =>
            dialog.evaluate((element) => ({
              inside: element.contains(document.activeElement),
              inert: document.getElementById("root")?.inert,
            })),
          )
          .toEqual({ inside: true, inert: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await setVisibleViewport(page, {
          width: 390,
          height: 844,
          offsetTop: 0,
          offsetLeft: 0,
        });
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(position);
        expect(await box(shell)).toEqual(originalBounds);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("preserves a scrolled document and leaves internal touch selection and zoom gestures native", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { value: "iPhone" });
      });
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.addStyleTag({
        content:
          "html, body { height: 1100px; overflow: auto; } #root { height: 844px; min-height: 0; }",
      });
      await page.evaluate(() => window.scrollTo(0, 120));
      expect(await page.evaluate(() => window.scrollY)).toBe(120);
      const shell = page.locator(".page-shell");
      const original = await box(shell);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      await dialog.getByText("Phases (10)", { exact: true }).waitFor();
      await settle(page);
      await page.mouse.move(2, 200);
      await page.mouse.wheel(0, 500);
      expect(await page.evaluate(() => window.scrollY)).toBe(120);
      expect(await box(shell)).toEqual(original);
      expect(
        await page.locator("#root").evaluate((element) => {
          const event = new Event("touchmove", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "touches", { value: [{ identifier: 1 }] });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }),
      ).toBe(true);
      await setVisibleViewport(page, { width: 390, height: 300, offsetLeft: 0, offsetTop: 60 });
      const region = dialog.getByRole("region", { name: "Original", exact: true });
      const gestures = await region.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const touch = {
          identifier: 1,
          target: element,
          clientX: bounds.x + 20,
          clientY: bounds.y + 20,
        };
        const pinch = {
          identifier: 2,
          target: element,
          clientX: bounds.x + 50,
          clientY: bounds.y + 20,
        };
        return [[touch], [touch, pinch]].map((touches) => {
          let prevented = false;
          for (const type of ["touchstart", "touchmove", "touchend"]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: type === "touchend" ? [] : touches },
              changedTouches: { value: touches },
            });
            element.dispatchEvent(event);
            if (type === "touchmove") prevented = event.defaultPrevented;
          }
          return prevented;
        });
      });
      expect(gestures).toEqual([false, false]);
      await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      expect(
        await region.evaluate((element) => {
          const event = new Event("touchmove", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "touches", {
            value: [{ identifier: 1 }, { identifier: 2 }],
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }),
      ).toBe(false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
      expect(await box(shell)).toEqual(original);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("uses the layout viewport when VisualViewport is unavailable", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.addInitScript(() => {
        Object.defineProperty(window, "visualViewport", { value: undefined });
      });
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      await dialog.getByText("Phases (10)", { exact: true }).waitFor();
      await page.setViewportSize({ width: 844, height: 390 });
      const insets = { top: 20, right: 44, bottom: 21, left: 44 };
      await page.evaluate((insets) => {
        for (const [edge, value] of Object.entries(insets)) {
          document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
        }
      }, insets);
      await expectClearance(page, panelFor(dialog), insets);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("waits for saved Phase Set content before sliding at its final size", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(appUrl);
      await page.evaluate(`(async () => {
        const { phasesApi } = await import("/scorekeeper/src/data/api/phases.ts");
        const { phaseSetsApi } = await import("/scorekeeper/src/data/api/phaseSets.ts");
        const source = (await phasesApi.getAll({ type: "built-in" })).slice(0, 24);
        const ids = [];
        for (const phase of source) {
          ids.push((await phasesApi.create({ type: "saved", requirements: phase.requirements })).id);
        }
        await phaseSetsApi.create({ type: "saved", name: "Delayed pilot Phase Set", phases: ids });
      })()`);
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      const trigger = page.getByRole("button", { name: "Delayed pilot Phase Set", exact: true });
      await trigger.waitFor();
      await holdPhaseStorage(page, "customPhases");
      await trigger.click();
      await page.waitForTimeout(100);
      expect(await page.getByRole("dialog").count()).toBe(0);
      const { samples } = await sampleDialogSlide(
        page,
        () => page.evaluate(() => window.dispatchEvent(new Event("release-phase-storage"))),
        [0, 105, 210, 315],
      );
      const dialog = page.getByRole("dialog", { name: "Delayed pilot Phase Set", exact: true });
      const panel = panelFor(dialog);
      await dialog.getByText("24", { exact: true }).waitFor({ state: "attached" });
      expect(samples[0].y).toBeGreaterThanOrEqual(844);
      for (const sample of samples) {
        expect(sample.width).toBeCloseTo(351, 3);
        expect(sample.height).toBeCloseTo(812, 1);
        expect(sample.height).toBeCloseTo(samples[0].height, 3);
      }
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.evaluate(() => window.dispatchEvent(new Event("release-phase-storage")));
      await page.close();
    }
  }, 60_000);

  it("reverses an interrupted native entrance and exit without releasing modal locks or retaining gesture state", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "no-preference",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`, { timeout: 60_000 });
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const trigger = page.getByRole("button", {
        name: "2 sets of 3",
        exact: true,
        includeHidden: true,
      });
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      const panel = panelFor(dialog);
      const entry = await sampleDialogSlide(page, () => trigger.click());
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.currentTime = 150;
      });
      const leaving = await sampleDialogSlide(page, () =>
        dialog.getByRole("button", { name: "Close", exact: true }).click(),
      );
      expect(leaving.samples[0].y).toBeCloseTo(entry.samples[2].y, 3);
      expect(leaving.samples[4].y).toBeGreaterThanOrEqual(844);
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) {
          const duration = animation.effect?.getComputedTiming().duration;
          if (typeof duration !== "number") throw new Error("Missing interrupted exit duration");
          animation.currentTime = duration / 2;
        }
      });
      const interrupted = await box(panel);
      const reopening = await sampleDialogSlide(page, () =>
        trigger.evaluate((element) => {
          if (!(element instanceof HTMLElement)) throw new Error("Missing Phase trigger");
          element.click();
        }),
      );
      expect(reopening.samples[0].y).toBeCloseTo(interrupted.y, 3);
      expect(reopening.samples[4].y).toBeCloseTo(entry.samples[4].y, 3);
      for (const slide of [leaving, reopening]) {
        for (const sample of slide.samples) {
          expect(sample).toMatchObject({ scaleX: 1, scaleY: 1 });
          expect(sample.width).toBeCloseTo(entry.samples[4].width, 3);
          expect(sample.height).toBeCloseTo(entry.samples[4].height, 3);
        }
      }
      expect(await page.locator("#root").evaluate((element) => element.style.position)).toBe(
        "fixed",
      );
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      expect(await panel.getAttribute("data-dialog-dragging")).toBeNull();
      expect(await panel.getAttribute("data-dialog-released")).toBeNull();
      expect(await panel.getAttribute("data-dialog-restoring")).toBeNull();
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await settle(page);
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await sampleDialogSlide(page, () => close.click());
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      expect(await page.locator("#root").evaluate((element) => element.style.position)).toBe(
        "fixed",
      );
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(() => page.locator("#root").evaluate((element) => element.style.position))
        .toBe("");
      await expect
        .poll(() => trigger.evaluate((element) => element === document.activeElement))
        .toBe(true);
    } finally {
      await page.close();
    }
  }, 90_000);

  it.each([
    "no-preference",
    "reduce",
  ] as const)("retains the selected Phase Set through a failed read and delayed retry with %s motion", async (reducedMotion) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion,
    });
    try {
      await page.goto(appUrl);
      await page.evaluate(`(async () => {
        const { phaseSetsApi } = await import("/scorekeeper/src/data/api/phaseSets.ts");
        await phaseSetsApi.create({
          type: "saved", name: "Recoverable pilot Phase Set", phases: ["classic-1", "classic-2"],
        });
      })()`);
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      const trigger = page.getByRole("button", {
        name: "Recoverable pilot Phase Set",
        exact: true,
      });
      await trigger.waitFor();
      await page.evaluate(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === "customPhaseSets") {
            IDBObjectStore.prototype.get = get;
            throw new DOMException("Phase Set storage unavailable", "UnknownError");
          }
          return get.call(this, key);
        };
      });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("alert").getByText("Phase Set storage unavailable").waitFor();
      await settle(page);
      await holdPhaseStorage(page, "customPhaseSets");
      await dialog.getByRole("button", { name: "Try again", exact: true }).click();
      await page.waitForTimeout(400);
      expect(await dialog.count()).toBe(1);
      expect(await dialog.getByText("Phase Set not found.", { exact: true }).count()).toBe(0);
      await page.evaluate(() => window.dispatchEvent(new Event("release-phase-storage")));
      const recovered = page.getByRole("dialog", {
        name: "Recoverable pilot Phase Set",
        exact: true,
      });
      await recovered.getByText("Phases (2)", { exact: true }).waitFor();
      await recovered.getByText("2", { exact: true }).waitFor();
      expect(await recovered.getByRole("alert").count()).toBe(0);
      await recovered.getByRole("button", { name: "Close", exact: true }).click();
      await recovered.waitFor({ state: "detached" });
      await trigger.click();
      await recovered.getByText("Phases (2)", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await recovered.waitFor({ state: "detached" });
    } finally {
      await page.evaluate(() => window.dispatchEvent(new Event("release-phase-storage")));
      await page.close();
    }
  }, 60_000);

  it.each([
    "no-preference",
    "reduce",
  ] as const)("preserves focus and cleanup across interrupted slides with motion set to %s", async (reducedMotion) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      await page.addStyleTag({ content: ".dialog-panel { transition-duration: 10s !important; }" });
      const trigger = page.getByRole("button", {
        name: "2 sets of 3",
        exact: true,
        includeHidden: true,
      });
      const dialog = page.getByRole("dialog", { name: "2 sets of 3", exact: true });
      const panel = panelFor(dialog);
      await trigger.click();
      await dialog.getByRole("heading").waitFor({ state: "attached" });

      function sampleSlide() {
        return panel.evaluate((element) => {
          const animation = element.getAnimations()[0];
          if (!animation) return [];
          animation.pause();
          const samples = [0, 2500, 5000, 7500, 9999].map((time) => {
            animation.currentTime = time;
            const rect = element.getBoundingClientRect();
            const transform = new DOMMatrix(getComputedStyle(element).transform);
            return {
              y: rect.y,
              width: rect.width,
              height: rect.height,
              scaleX: transform.a,
              scaleY: transform.d,
            };
          });
          animation.currentTime = 100;
          return samples;
        });
      }

      const entry = await sampleSlide();
      if (reducedMotion === "reduce") {
        expect(entry).toEqual([]);
      } else {
        expect(entry).toHaveLength(5);
        expect(entry[0].y).toBeGreaterThanOrEqual(844);
        for (let index = 0; index < entry.length; index++) {
          expect(entry[index]).toMatchObject({
            scaleX: 1,
            scaleY: 1,
          });
          expect(entry[index].width).toBeCloseTo(entry[0].width, 3);
          expect(entry[index].height).toBeCloseTo(entry[0].height, 3);
          if (index > 0) expect(entry[index].y).toBeLessThanOrEqual(entry[index - 1].y);
        }
      }
      await panel.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await settle(page);
      const restingBounds = await box(panel);
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await close.focus();
      const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
      const backTab = process.platform === "darwin" ? "Shift+Alt+Tab" : "Shift+Tab";
      for (const key of [tab, backTab]) {
        await page.keyboard.press(key);
        await expect
          .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
          .toBe(true);
      }
      await close.click();
      if (reducedMotion === "no-preference") {
        const exit = await sampleSlide();
        expect(exit).toHaveLength(5);
        expect(exit[0].y).toBeCloseTo(restingBounds.y, 0);
        expect(exit.at(-1)?.y).toBeGreaterThanOrEqual(844);
        for (let index = 1; index < exit.length; index++) {
          expect(exit[index].y).toBeGreaterThanOrEqual(exit[index - 1].y);
          expect(exit[index].height).toBeCloseTo(restingBounds.height, 3);
          expect(exit[index].width).toBeCloseTo(restingBounds.width, 3);
          expect(exit[index].scaleX).toBe(1);
          expect(exit[index].scaleY).toBe(1);
        }
        // Reopen through the same public trigger before after-leave clears its selection.
        await trigger.evaluate((element) => {
          if (!(element instanceof HTMLElement)) throw new Error("Missing Phase trigger");
          element.click();
        });
        await expect.poll(() => dialog.getAttribute("data-dialog-open")).toBe("true");
        await panel.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
        await settle(page);
        expect(await box(panel)).toEqual(restingBounds);
        expect(await dialog.getByText("built-in", { exact: true }).count()).toBe(1);
        await close.focus();
        await page.keyboard.press(tab);
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
        await close.click();
        await panel.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
      }
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(() => trigger.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await page.getByRole("button", { name: "1 run of 9", exact: true }).click();
      const next = page.getByRole("dialog", { name: "1 run of 9", exact: true });
      await next.getByRole("heading").waitFor({ state: "attached" });
      await panelFor(next).evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await page.keyboard.press("Escape");
      if (reducedMotion === "no-preference") {
        await panelFor(next).evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
      }
      await next.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);
});
