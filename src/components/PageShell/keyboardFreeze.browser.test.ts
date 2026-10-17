/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
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

async function enableTouchKeyboard(page: Page) {
  // Desktop WebKit automation reports zero touch points even with hasTouch.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
  });
}

async function seedPlayers(page: Page) {
  await page.evaluate(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    for (let index = 1; index <= 24; index++) {
      await playersApi.create({
        name: "Player " + String(index).padStart(2, "0"),
        color: "#123456",
        isFavorite: 0,
      });
    }
  })()`);
  await page.reload();
  await page.getByRole("button", { name: "Player 01", exact: true }).waitFor();
}

it.each([
  "scorekeeper",
  "phaseCompan10n",
])("freezes standalone Player content only while the software keyboard is visible in %s", async (experience) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/${experience}/players`);
    await seedPlayers(page);
    const search = page.getByRole("textbox", { name: "Search players" });
    const results = page.locator(".dialog-scroll").first();
    await search.fill("Player");
    const originalHeader = await page.locator(".page-shell-header").boundingBox();
    const originalFooter = await page.locator(".page-shell-footer").boundingBox();
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    await results.hover();
    await page.mouse.wheel(0, 200);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await results.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.locator(".page-shell-header").boundingBox()).toEqual(originalHeader);
    expect(await page.locator(".page-shell-footer").boundingBox()).toEqual(originalFooter);
    expect(
      await touchGesture(results, [
        { y: 200, time: 0 },
        { y: 100, time: 100 },
        { y: 100, time: 120 },
      ]),
    ).toEqual([false, true, false]);
    await results.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await search.inputValue()).toBe("Player");

    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    await results.hover();
    await page.mouse.wheel(0, 200);
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
}, 30_000);

it("reveals Game Name, keeps the freeze through blur, and unlocks when the keyboard closes", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 500 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/create`);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Game name", exact: true });
    await input.fill("Friday game");
    const original = await input.boundingBox();
    if (!original) throw new Error("Missing Game Name input");
    await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 0 });
    const revealed = await input.boundingBox();
    if (!revealed) throw new Error("Missing revealed Game Name input");
    expect(revealed.y).toBeLessThan(original.y);
    expect(revealed.y).toBeGreaterThanOrEqual(8);
    expect(revealed.y + revealed.height).toBeLessThanOrEqual(172);
    const content = page.getByRole("tabpanel").locator(".dialog-scroll");
    const position = await content.evaluate((element) => element.scrollTop);
    await input.blur();
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(position);
    await setVisibleViewport(page, { width: 390, height: 500, offsetLeft: 0, offsetTop: 0 });
    await content.hover();
    await page.mouse.wheel(0, 180);
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(position);
    expect(await input.inputValue()).toBe("Friday game");
    await expect.poll(() => page.locator("#root").getAttribute("style")).toBe("");
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  ["scorekeeper", "reduce"],
  ["phaseCompan10n", "reduce"],
  ["scorekeeper", "no-preference"],
  ["phaseCompan10n", "no-preference"],
] as const)(
  "reveals a new Player input when moving from standalone search into a modal in %s with %s motion",
  async (experience, reducedMotion) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion,
    });
    try {
      await enableTouchKeyboard(page);
      await page.goto(`${appUrl}#/${experience}/players`);
      const search = page.getByRole("textbox", { name: "Search players" });
      await search.fill("New pilot");
      await setVisibleViewport(page, { width: 390, height: 220, offsetLeft: 0, offsetTop: 0 });
      await page.getByRole("button", { name: "Create new player", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
      const input = dialog.getByRole("textbox", { name: "Name", exact: true });
      await input.focus();
      await page.evaluate(() =>
        Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
      );
      await expect
        .poll(() => input.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await expect
        .poll(async () => {
          const bounds = await input.boundingBox();
          return bounds !== null && bounds.y >= 8 && bounds.y + bounds.height <= 212;
        })
        .toBe(true);
      expect(await input.inputValue()).toBe("New pilot");
      const panel = dialog.locator(".dialog-panel");
      const height = (await panel.boundingBox())?.height;
      await input.fill("New pilot edited");
      await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      expect((await panel.boundingBox())?.height).toBe(height);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await search.fill("");
      await page.getByRole("button", { name: "New pilot edited", exact: true }).waitFor();
      await expect.poll(() => page.locator("#root").getAttribute("style")).toBe("");
    } finally {
      await page.close();
    }
  },
  30_000,
);

it.each([
  false,
  true,
])("does not freeze focused content without a software keyboard (touch: %s)", async (hasTouch) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch,
    reducedMotion: "reduce",
  });
  try {
    if (hasTouch) await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await seedPlayers(page);
    await page.getByRole("textbox", { name: "Search players" }).fill("Player");
    if (!hasTouch) {
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    }
    const results = page.locator(".dialog-scroll").first();
    await results.hover();
    await page.mouse.wheel(0, 200);
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator("#root").getAttribute("style")).toBeNull();
  } finally {
    await page.close();
  }
}, 30_000);

it("releases Keyboard Freeze when the keyboard closes while the page is zoomed", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await seedPlayers(page);
    await page.getByRole("textbox", { name: "Search players" }).fill("Player");
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error("Missing VisualViewport");
      Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    });
    await setVisibleViewport(page, { width: 195, height: 422, offsetLeft: 0, offsetTop: 0 });
    const results = page.locator(".dialog-scroll").first();
    await results.hover();
    await page.mouse.wheel(0, 180);
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => page.locator("#root").getAttribute("style")).toBe("");
  } finally {
    await page.close();
  }
}, 30_000);

it("reveals a newly focused Player input while a zoomed Keyboard Freeze remains active", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByRole("textbox", { name: "Search players" }).fill("Zoomed pilot");
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error("Missing VisualViewport");
      Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    });
    await setVisibleViewport(page, { width: 195, height: 210, offsetLeft: 0, offsetTop: 0 });
    await page.getByRole("button", { name: "Create new player", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    const input = dialog.getByRole("textbox", { name: "Name", exact: true });
    await input.focus();
    await expect
      .poll(async () => {
        const bounds = await input.boundingBox();
        return bounds !== null && bounds.y >= 8 && bounds.y + bounds.height <= 202;
      })
      .toBe(true);
    expect(await input.inputValue()).toBe("Zoomed pilot");
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  "scorekeeper",
  "phaseCompan10n",
])("reveals the Player input without shrinking its modal or shifting the background independently in %s", async (experience) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/${experience}/players`);
    await page.getByRole("button", { name: "Create new player", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    const input = dialog.getByRole("textbox", { name: "Name", exact: true });
    await input.fill("Keyboard pilot");
    await input.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) throw new Error("Missing Player name input");
      element.setSelectionRange(2, 8);
    });
    const panel = dialog.locator(".dialog-panel");
    const header = page.locator(".page-shell-header");
    const originalPanel = await panel.boundingBox();
    const originalHeader = await header.boundingBox();
    if (!originalPanel || !originalHeader) throw new Error("Missing original view");
    await setVisibleViewport(page, { width: 390, height: 220, offsetLeft: 0, offsetTop: 60 });
    const revealedPanel = await panel.boundingBox();
    const revealedHeader = await header.boundingBox();
    const revealedInput = await input.boundingBox();
    if (!revealedPanel || !revealedHeader || !revealedInput) {
      throw new Error("Missing revealed view");
    }
    expect(revealedPanel.height).toBe(originalPanel.height);
    expect(revealedPanel.width).toBe(originalPanel.width);
    expect(revealedInput.y).toBeGreaterThanOrEqual(68);
    expect(revealedInput.y + revealedInput.height).toBeLessThanOrEqual(272);
    expect(revealedHeader.y - originalHeader.y).toBeCloseTo(revealedPanel.y - originalPanel.y, 0);
    expect(
      await input.evaluate((element) =>
        element instanceof HTMLInputElement ? [element.selectionStart, element.selectionEnd] : [],
      ),
    ).toEqual([2, 8]);
    const content = dialog.getByRole("region", { name: "Create player", exact: true });
    const frozenTop = await content.evaluate((element) => element.scrollTop);
    await content.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(frozenTop);
    for (const target of [
      dialog.getByRole("heading", { name: "New Player", exact: true }),
      content,
    ]) {
      for (const direction of [-1, 1]) {
        await touchGesture(target, [
          { y: 0, time: 0 },
          { y: direction * 130, time: 150 },
          { y: direction * 130, time: 200 },
        ]);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(await dialog.count()).toBe(1);
        expect(await panel.boundingBox()).toEqual(revealedPanel);
      }
    }
    expect(await input.inputValue()).toBe("Keyboard pilot");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    await expect.poll(() => header.boundingBox()).toEqual(originalHeader);
    await expect.poll(() => page.locator("#root").getAttribute("style")).toBe("");
  } finally {
    await page.close();
  }
}, 30_000);

it.each([
  -1, 1,
])("restores swipe dismissal in direction %s when the keyboard closes even if Name stays focused", async (direction) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByRole("button", { name: "Create new player", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    const input = dialog.getByRole("textbox", { name: "Name", exact: true });
    await input.fill("Keyboard pilot");
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);
    await touchGesture(dialog.getByRole("heading", { name: "New Player", exact: true }), [
      { y: 0, time: 0 },
      { y: direction * 130, time: 150 },
      { y: direction * 130, time: 200 },
    ]);
    await dialog.waitFor({ state: "detached" });
  } finally {
    await page.close();
  }
}, 30_000);

it("cancels an active drag when the keyboard opens without blocking Escape or outside dismissal", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(60_000);
  try {
    await enableTouchKeyboard(page);
    await page.goto(`${appUrl}#/scorekeeper/players`);
    const create = page.getByRole("button", { name: "Create new player", exact: true });
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    const input = dialog.getByRole("textbox", { name: "Name", exact: true });
    await input.fill("Keyboard pilot");
    const panel = dialog.locator(".dialog-panel");
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error("Missing modal before drag");
    await touchGesture(
      dialog.getByRole("heading", { name: "New Player", exact: true }),
      [
        { y: 0, time: 0 },
        { y: 60, time: 100 },
      ],
      null,
    );
    expect((await panel.boundingBox())?.y).toBe(bounds.y + 60);
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    expect(await panel.boundingBox()).toEqual(bounds);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });

    await create.click();
    await input.fill("Outside pilot");
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 0 });
    await page.touchscreen.tap(2, 2);
    await dialog.waitFor({ state: "detached" });
    await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    await expect.poll(() => page.locator("#root").getAttribute("style")).toBe("");
  } finally {
    await page.close();
  }
}, 30_000);
