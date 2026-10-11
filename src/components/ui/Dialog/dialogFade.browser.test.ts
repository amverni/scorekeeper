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

async function startGame(page: Page) {
  await page.goto(`${appUrl}#/phaseCompan10n/create`);
  for (const name of ["Amy", "Ben"]) {
    await page.getByRole("button", { name: "Add Player", exact: true }).click();
    await page.getByRole("button", { name: "Create new player" }).click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Add player", exact: true });
    await search.getByRole("button", { name, exact: true }).waitFor();
    await search.getByRole("button", { name: "Close", exact: true }).click();
    await search.waitFor({ state: "detached" });
  }
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("region", { name: "Scoreboard", exact: true }).waitFor();
}

function scrollAreaFor(content: Locator) {
  return content.locator(
    "xpath=ancestor-or-self::*[contains(concat(' ', normalize-space(@class), ' '), ' overflow-y-auto ')][1]",
  );
}

async function expectBottomFade(scroller: Locator) {
  const mask = await scroller.evaluate((element) => getComputedStyle(element).maskImage);
  expect(mask).toContain("calc(100% - 10px)");
  expect(mask).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
}

async function expectClearAtEnd(scroller: Locator, lastContent: Locator) {
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrollBounds = await scroller.boundingBox();
  const contentBounds = await lastContent.boundingBox();
  if (!scrollBounds || !contentBounds) throw new Error("Missing visible dialog content");
  expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(
    scrollBounds.y + scrollBounds.height - 10,
  );
  await expectBottomFade(scroller);
}

async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const screenshot = await page.screenshot();
  return page.evaluate(
    async ({ image, clip }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${image}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas context");
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(clip.x, clip.y, clip.width, clip.height).data);
    },
    { image: screenshot.toString("base64"), clip },
  );
}

async function expectGlassShadowPreserved(page: Page, scroller: Locator) {
  const box = await scroller.locator(".glass").first().boundingBox();
  if (!box) throw new Error("Missing glass list");
  const clip = { x: Math.floor(box.x) - 8, y: Math.ceil(box.y) + 20, width: 8, height: 20 };
  const masked = await pixels(page, clip);
  await scroller.evaluate((element) => {
    element.style.maskImage = "none";
  });
  const unmasked = await pixels(page, clip);
  await scroller.evaluate((element) => element.style.removeProperty("mask-image"));
  expect(
    Math.max(...masked.map((channel, index) => Math.abs(channel - unmasked[index]))),
  ).toBeLessThanOrEqual(2);
}

async function expectRenderedFade(page: Page, scroller: Locator) {
  const box = await scroller.boundingBox();
  if (!box) throw new Error("Missing scroll viewport");
  // Paint a high-contrast probe in the empty shadow gutter to observe the alpha ramp.
  await scroller.evaluate((element) => {
    element.style.backgroundColor = "rgb(255, 0, 255)";
  });
  const clip = {
    x: Math.ceil(box.x) + 1,
    y: Math.floor(box.y + box.height) - 15,
    width: 1,
    height: 15,
  };
  const sample = await pixels(page, clip);
  await scroller.evaluate((element) => {
    element.style.maskImage = "none";
  });
  const opaque = await pixels(page, clip);
  await scroller.evaluate((element) => {
    element.style.removeProperty("background-color");
    element.style.removeProperty("mask-image");
  });
  const distanceFromOpaque = (row: number) =>
    Math.abs(sample[row * 4] - opaque[row * 4]) +
    Math.abs(sample[row * 4 + 1] - opaque[row * 4 + 1]) +
    Math.abs(sample[row * 4 + 2] - opaque[row * 4 + 2]);
  expect(distanceFromOpaque(0)).toBeLessThanOrEqual(3);
  expect(distanceFromOpaque(5)).toBeLessThan(distanceFromOpaque(9));
  expect(distanceFromOpaque(9)).toBeLessThan(distanceFromOpaque(14));
}

async function expectCardEdgeUnaffected(page: Page, scroller: Locator, card: Locator) {
  const box = await card.boundingBox();
  if (!box) throw new Error("Missing final card");
  const clip = {
    x: Math.ceil(box.x),
    y: Math.floor(box.y + box.height) - 5,
    width: Math.floor(box.width),
    height: 5,
  };
  const masked = await pixels(page, clip);
  await scroller.evaluate((element) => {
    element.style.maskImage = "none";
  });
  const unmasked = await pixels(page, clip);
  await scroller.evaluate((element) => element.style.removeProperty("mask-image"));
  expect(
    Math.max(...masked.map((channel, index) => Math.abs(channel - unmasked[index]))),
  ).toBeLessThanOrEqual(2);
}

describe.each([
  { width: 390, height: 600 },
  { width: 1280, height: 900 },
])("Add Round winner selection at $width px", (viewport) => {
  it("uses only the shared dropdown while preserving winner corrections and saving", async () => {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    try {
      await startGame(page);
      await page.getByRole("button", { name: "Add round 1", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const amy = dialog.getByRole("tabpanel", { name: "Amy", exact: true });
      await amy.waitFor();
      const shortcuts = dialog.getByRole("tabpanel", { includeHidden: true }).getByRole("button", {
        name: /^(Won Round|Round Winner)$/,
        includeHidden: true,
      });
      expect(await shortcuts.count()).toBe(0);

      await amy.getByRole("button", { name: "Passed", exact: true }).click();
      await amy.getByRole("button", { name: /^Add 10 points/ }).click();
      const points = amy.getByRole("spinbutton", { name: "Points", exact: true });
      await expect.poll(() => points.getAttribute("aria-valuenow")).toBe("10");

      const winner = dialog.getByRole("button", { name: /Round Winner/ });
      await winner.click();
      await page.getByRole("option", { name: "Amy", exact: true }).click();
      await expect.poll(() => points.getAttribute("aria-valuenow")).toBe("0");
      expect(await points.getAttribute("aria-disabled")).toBe("true");
      expect(await shortcuts.count()).toBe(0);

      await winner.click();
      await page.getByRole("option", { name: "Ben", exact: true }).click();
      await expect.poll(() => points.getAttribute("aria-valuenow")).toBe("10");
      expect(await points.getAttribute("aria-disabled")).toBeNull();

      await winner.click();
      await page.getByRole("option", { name: "Choose winner", exact: true }).click();
      const save = dialog.getByRole("button", { name: "Save round", exact: true });
      expect(await save.isDisabled()).toBe(false);

      await winner.click();
      await page.getByRole("option", { name: "Amy", exact: true }).click();
      await dialog.getByRole("tab", { name: "Ben", exact: true }).click();
      const ben = dialog.getByRole("tabpanel", { name: "Ben", exact: true });
      expect(
        await ben.getByRole("button", { name: "Passed", exact: true }).getAttribute("aria-pressed"),
      ).toBe("true");
      await ben.getByRole("button", { name: "Show extra options", exact: true }).click();
      await ben.getByRole("button", { name: /^Add 5 points/ }).click();
      await page.setViewportSize(
        viewport.width === 390 ? { width: 1280, height: 900 } : { width: 390, height: 600 },
      );
      expect(await shortcuts.count()).toBe(0);
      await save.click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Add round 2", exact: true }).waitFor();
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.each(["light", "dark"] as const)("dialog bottom fade in %s mode", (colorScheme) => {
  it("fully reveals the final Add Round card at maximum scroll without fading fixed controls", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await startGame(page);
      await page.addStyleTag({
        content:
          ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 12px; --safe-area-inset-right: 18px; }",
      });
      await page.getByRole("button", { name: "Add round 1", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const panel = dialog.locator(".dialog-panel");
      const geometry = await panel.boundingBox();
      if (!geometry) throw new Error("Missing floating Phase Round");
      expect(geometry.y).toBe(36);
      expect(geometry.height).toBe(514);
      expect(geometry.x).toBeGreaterThanOrEqual(28);
      expect(geometry.x + geometry.width).toBeLessThanOrEqual(356);
      expect(await panel.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
        "none",
      );
      expect(
        await dialog
          .locator(".dialog-backdrop")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe("rgba(0, 0, 0, 0)");
      const lastContent = dialog
        .getByRole("tabpanel", { name: "Amy", exact: true })
        .getByText("Hold to decrease.", { exact: true });
      await lastContent.waitFor({ state: "attached" });
      const scroller = scrollAreaFor(lastContent);
      await expectBottomFade(scroller);
      await expectRenderedFade(page, scroller);
      const cancel = dialog.getByRole("button", { name: "Close", exact: true });
      const save = dialog.getByRole("button", { name: "Save round", exact: true });
      const footerBounds = await cancel.boundingBox();
      const saveBounds = await save.boundingBox();
      expect(
        await cancel.evaluate((element) => {
          let current: Element | null = element;
          while (current && current.getAttribute("role") !== "dialog") {
            if (getComputedStyle(current).maskImage !== "none") return false;
            current = current.parentElement;
          }
          return true;
        }),
      ).toBe(true);
      await expectClearAtEnd(scroller, lastContent);
      const lastCard = lastContent.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' glass ')][1]",
      );
      await expectClearAtEnd(scroller, lastCard);
      await expectCardEdgeUnaffected(page, scroller, lastCard);
      expect(await cancel.boundingBox()).toEqual(footerBounds);
      expect(await save.boundingBox()).toEqual(saveBounds);
      await panel.evaluate((element) => {
        element.style.transform = "translateY(-24px)";
      });
      expect((await save.boundingBox())?.y).toBe((saveBounds?.y ?? 0) - 24);
      await panel.evaluate((element) => {
        element.style.removeProperty("transform");
      });
      await dialog.getByRole("tab", { name: "Ben", exact: true }).click();
      await dialog.getByRole("button", { name: "Failed", exact: true }).click();
      await dialog.getByRole("tab", { name: "Amy", exact: true }).click();
      await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
      const failed = dialog.getByRole("button", { name: "Failed", exact: true });
      await failed.click();
      const failedBounds = await failed.boundingBox();
      if (!failedBounds) throw new Error("Missing cramped Round result");
      expect(failedBounds.height).toBeGreaterThanOrEqual(24);
      await save.focus();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const cramped = await panel.boundingBox();
      const reachableSave = await save.boundingBox();
      if (!cramped || !reachableSave) throw new Error("Missing cramped Phase actions");
      expect(reachableSave.y).toBeGreaterThanOrEqual(cramped.y + 4);
      expect(reachableSave.y + reachableSave.height).toBeLessThanOrEqual(
        cramped.y + cramped.height - 4,
      );
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await setVisibleViewport(page, { width: 390, height: 600, offsetLeft: 0, offsetTop: 0 });
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await save.boundingBox()).toEqual(saveBounds);
      await cancel.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each([
    ["Switch phase set", "Switch phase set"],
    ["Add Phase", "Add phases"],
  ])(
    "fades the footerless %s list and leaves its last row clear",
    async (buttonName, dialogName) => {
      const page = await browser.newPage({
        viewport: { width: 390, height: 600 },
        colorScheme,
        reducedMotion: "reduce",
      });
      try {
        await page.goto(`${appUrl}#/phaseCompan10n/create`);
        await page.getByRole("tab", { name: "Phases", exact: true }).click();
        await page.getByRole("button", { name: buttonName, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
        const lastRow = dialog.getByRole("button").last();
        await lastRow.waitFor();
        const scroller = scrollAreaFor(lastRow);
        await expectBottomFade(scroller);
        await expectClearAtEnd(scroller, lastRow);
      } finally {
        await page.close();
      }
    },
    30_000,
  );

  it("fades internal glass lists, including short lists with no scrolling", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 600 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await startGame(page);
      await page.getByRole("button", { name: "Open Phases Card", exact: true }).click();
      const phases = page.getByRole("region", { name: "Phases Card phase list", exact: true });
      await expectBottomFade(phases);
      await expectGlassShadowPreserved(page, phases);
      await expectClearAtEnd(phases, phases.locator(".glass"));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Open Standings", exact: true }).click();
      const standings = page.getByRole("region", { name: "Standings", exact: true });
      await expectBottomFade(standings);
      await expectGlassShadowPreserved(page, standings);
      expect(
        await standings.evaluate((element) => element.scrollHeight === element.clientHeight),
      ).toBe(true);
      await expectClearAtEnd(standings, standings.locator(".glass"));
      await page.keyboard.press("Tab");
      await standings.focus();
      expect(await standings.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      const box = await standings.locator(".glass").boundingBox();
      if (!box) throw new Error("Missing Standings");
      const clip = { x: Math.floor(box.x) - 4, y: Math.ceil(box.y) + 20, width: 10, height: 20 };
      const focused = await pixels(page, clip);
      await standings.evaluate((element) => element.blur());
      const blurred = await pixels(page, clip);
      expect(
        focused.filter((channel, index) => Math.abs(channel - blurred[index]) > 10).length,
      ).toBeGreaterThan(20);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("preserves the search top fade and clears the final player form action", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/create`);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const search = page.getByRole("dialog", { name: "Add player", exact: true });
      const results = scrollAreaFor(search.getByText("No players yet", { exact: true }));
      await expectBottomFade(results);
      expect(await results.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
        "20px",
      );
      await search.getByRole("button", { name: "Create new player" }).click();
      const editor = page.getByRole("dialog", { name: "Create player", exact: true });
      const save = editor.getByRole("button", { name: "Save", exact: true });
      await save.waitFor();
      const formRegion = editor.getByRole("region", { name: "Create player form", exact: true });
      const favorite = editor.getByRole("switch", { name: "Favorite", exact: true });
      await expectClearAtEnd(formRegion, favorite);
      const saveBounds = await save.boundingBox();
      await formRegion.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect(await save.boundingBox()).toEqual(saveBounds);
      expect(
        await save.evaluate((element) => {
          for (let owner = element.parentElement; owner; owner = owner.parentElement) {
            if (getComputedStyle(owner).maskImage !== "none") return false;
          }
          return true;
        }),
      ).toBe(true);
      await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Maya");
      await save.click();
      await search.getByPlaceholder(/^Search players/).waitFor();
    } finally {
      await page.close();
    }
  }, 30_000);

  it("fades the floating Phase Set body while keeping Close fixed", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Original", exact: true });
      const lastPhase = dialog.getByText("10", { exact: true }).locator("..");
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const closeBounds = await close.boundingBox();
      await expectClearAtEnd(scrollAreaFor(lastPhase), lastPhase);
      expect(await close.boundingBox()).toEqual(closeBounds);
      await close.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 30_000);
});
