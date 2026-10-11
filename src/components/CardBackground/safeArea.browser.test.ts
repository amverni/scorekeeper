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

async function openPage(
  height: number,
  colorScheme: "light" | "dark" = "light",
  width = 390,
  hasTouch = true,
) {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme,
    hasTouch,
    timezoneId: "America/New_York",
  });
  await page.clock.setFixedTime(new Date("2026-10-06T16:00:00Z"));
  await page.goto(`${appUrl}#/phaseCompan10n/create`);
  await page.getByRole("link", { name: "Cancel", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function bounds(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing visible element: ${selector}`);
  return box;
}

async function readPixels(page: Page, x: number, y: number, width: number, height: number) {
  const screenshot = await page.screenshot();
  return page.evaluate(
    async ({ image, x, y, width, height }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${image}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas context");
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(x, y, width, height).data);
    },
    { image: screenshot.toString("base64"), x, y, width, height },
  );
}

describe("safe-area layout in WebKit", () => {
  it.each([
    "light",
    "dark",
  ] as const)("uses compact footer geometry while containing pressed controls in %s mode", async (colorScheme) => {
    for (const [width, height] of [
      [390, 600],
      [390, 700],
      [390, 701],
      [390, 844],
      [390, 900],
      [844, 390],
      [1280, 900],
    ]) {
      const page = await openPage(height, colorScheme, width, width < 1024);
      try {
        const size = height <= 700 ? 44 : 56;
        const button = page.getByRole("link", { name: "Cancel", exact: true });
        const resting = await button.boundingBox();
        expect(resting?.width).toBe(size);
        expect(resting?.height).toBe(resting?.width);
        const footer = await bounds(page, ".page-shell-footer");
        expect(footer.height).toBeCloseTo(Math.max(height * 0.15, 50 + size + 6 + 8), 1);
        expect(
          await page.locator(".page-shell-footer > .content-container").evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.paddingLeft, style.paddingRight];
          }),
        ).toEqual(["16px", "16px"]);
        expect(await button.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(
          colorScheme === "light" ? "0px 2px 10px" : "0px 8px 28px",
        );

        await button.hover();
        await page.mouse.down();
        await expect
          .poll(async () => (await button.boundingBox())?.width)
          .toBeCloseTo(size * 1.1, 1);
        const pressed = await button.boundingBox();
        if (!pressed) throw new Error("Pressed button is not visible");
        const disclaimer = await bounds(page, ".card-panel-disclaimer");
        // The control stays contained; its decorative shadow need not be.
        expect(pressed.y).toBeGreaterThanOrEqual(footer.y + 50);
        expect(pressed.y + pressed.height).toBeLessThanOrEqual(disclaimer.y);
        expect(pressed.x).toBeGreaterThanOrEqual(0);
        expect(pressed.x + pressed.width).toBeLessThanOrEqual(width);
        expect(await bounds(page, ".page-shell-footer")).toEqual(footer);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      } finally {
        await page.close();
      }
    }
  }, 60_000);

  it.each([
    "light",
    "dark",
  ] as const)("keeps pressed controls at both footer edges outside device insets in %s mode", async (colorScheme) => {
    for (const height of [600, 701, 900]) {
      const page = await openPage(height, colorScheme);
      try {
        for (const { route, name } of [
          { route: "/create", name: "Cancel" },
          { route: "", name: "Create Game" },
        ]) {
          await page.goto(`${appUrl}#/phaseCompan10n${route}`);
          const button = page.getByRole("link", { name, exact: true });
          await button.waitFor();
          // Desktop WebKit does not expose device cutouts; supply their layout variables.
          await page.addStyleTag({
            content:
              ":root { --safe-area-inset-top: 47px; --safe-area-inset-bottom: 34px; --safe-area-inset-left: 44px; --safe-area-inset-right: 44px; }",
          });
          const size = height <= 700 ? 44 : 56;
          const footer = await bounds(page, ".page-shell-footer");
          expect(footer.height).toBeCloseTo(Math.max(height * 0.15, 50 + size + 6 + 8) + 34, 1);
          await button.hover();
          await page.mouse.down();
          await expect
            .poll(async () => (await button.boundingBox())?.width)
            .toBeCloseTo(size * 1.1, 1);
          const pressed = await button.boundingBox();
          if (!pressed) throw new Error("Pressed button is not visible");
          const disclaimer = await bounds(page, ".card-panel-disclaimer");
          expect(pressed.y).toBeGreaterThanOrEqual(footer.y + 50);
          expect(pressed.y + pressed.height).toBeLessThanOrEqual(disclaimer.y);
          expect(disclaimer.y + disclaimer.height).toBeLessThanOrEqual(height - 34);
          expect(pressed.x).toBeGreaterThanOrEqual(44);
          expect(pressed.x + pressed.width).toBeLessThanOrEqual(390 - 44);
          await page.mouse.move(0, 0);
          await page.mouse.up();
        }
      } finally {
        await page.close();
      }
    }
  }, 60_000);

  it.each([
    "light",
    "dark",
  ] as const)("paints full-opacity stripes inside and beyond the logo area in %s mode without moving content", async (colorScheme) => {
    const page = await openPage(700, colorScheme);
    try {
      await page.addStyleTag({
        content:
          ":root { --safe-area-inset-top: 47px; --safe-area-inset-left: 44px; --safe-area-inset-right: 44px; }",
      });
      const logo = await page.getByRole("img", { name: "Phaze Compan10n" }).boundingBox();
      expect(logo).toEqual({ x: 44, y: 47, width: 302, height: 74 });
      expect(await page.getByRole("button", { name: /^(Tips|Info)$/ }).count()).toBe(0);

      const opaqueColors = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Missing canvas context");
        const theme = getComputedStyle(document.documentElement);
        return ["red", "blue", "green", "yellow"].map((color, index) => {
          context.fillStyle = theme.getPropertyValue(`--color-pt-${color}-500`).trim();
          context.fillRect(index, 0, 1, 1);
          return Array.from(context.getImageData(index, 0, 1, 1).data).slice(0, 3);
        });
      });
      // Sample the left inset, normal logo area, and right viewport edge.
      for (const x of [20, 60, 385]) {
        const pixels = await readPixels(page, x, 0, 1, 152);
        for (const color of opaqueColors) {
          const hasOpaqueStripe = pixels.some(
            (_, index) =>
              index % 4 === 0 &&
              color.every((channel, offset) => Math.abs(pixels[index + offset] - channel) <= 3),
          );
          expect(hasOpaqueStripe, `Opaque stripe ${color} at x=${x}`).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Add player", exact: true })
        .getByRole("button", { name: "Create new player", exact: true })
        .waitFor();
      expect(await bounds(page, '.card-header-logo svg[role="img"]')).toEqual(logo);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps the dialog's glass continuous below the viewport during dragging without extending content", async () => {
    const page = await openPage(700);
    try {
      await page.addStyleTag({
        content: ":root { --safe-area-inset-bottom: 34px; }",
      });
      await page.getByRole("button", { name: "Add Player", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add player", exact: true });
      await dialog.waitFor({ state: "attached" });
      await expect.poll(async () => (await bounds(page, ".dialog-glass")).y).toBe(141);
      const surface = await bounds(page, ".dialog-glass");
      expect(surface.width).toBe(351);
      expect(surface.y + surface.height).toBeGreaterThanOrEqual(1400);
      const content = await dialog.locator("section").boundingBox();
      if (!content) throw new Error("Missing dialog content");
      expect(content.y + content.height).toBeLessThanOrEqual(666);
      expect(
        await page
          .locator(".dialog-glass")
          .evaluate((element) => getComputedStyle(element).pointerEvents),
      ).toBe("none");

      // Drag the visible handle, first stretching upward, then below dismissal threshold.
      await page.mouse.move(195, surface.y + 14);
      await page.mouse.down();
      await page.mouse.move(195, surface.y - 26, { steps: 4 });
      expect((await bounds(page, ".dialog-glass")).y).toBeLessThan(surface.y);
      await page.mouse.move(195, surface.y + 94, { steps: 4 });
      const dragged = await bounds(page, ".dialog-glass");
      expect(dragged.y).toBeCloseTo(surface.y + 80, 1);
      expect(dragged.y + dragged.height).toBeGreaterThan(1400);
      await page.mouse.up();
      await expect.poll(async () => (await bounds(page, ".dialog-glass")).y).toBe(141);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await expect
        .poll(async () =>
          page
            .getByRole("button", { name: "Add Player", exact: true })
            .evaluate((element) => element === document.activeElement),
        )
        .toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps rows exposed above the footer diagonal tappable while footer controls still work", async () => {
    const page = await openPage(500);
    try {
      await page.goto(`${appUrl}#/phaseCompan10n/phases`);
      await page.getByRole("tab", { name: "Phases", exact: true }).click();
      const row = page.getByText("1 run of 9", { exact: true });
      await row.waitFor();
      const footer = await bounds(page, ".page-shell-footer");
      const clickY = footer.y + 25;
      await row.evaluate((element, y) => {
        let parent = element.parentElement;
        while (parent) {
          if (
            parent.scrollHeight > parent.clientHeight &&
            getComputedStyle(parent).overflowY === "auto"
          ) {
            const rowBounds = element.getBoundingClientRect();
            parent.scrollTop += rowBounds.y + rowBounds.height / 2 - y;
            return;
          }
          parent = parent.parentElement;
        }
        throw new Error("Missing scrollable phase list");
      }, clickY);
      // The right end of the same row is hidden by the painted footer.
      await page.mouse.click(300, clickY);
      expect(await page.getByRole("dialog").count()).toBe(0);
      // This visible part of the row lies inside the footer's rectangular bounds,
      // but outside its painted diagonal. A transparent layer must not catch it.
      await page.mouse.click(40, clickY);
      const dialog = page.getByRole("dialog", { name: "1 run of 9", exact: true });
      await expect.poll(() => dialog.count()).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      await page.getByRole("link", { name: "Create Game", exact: true }).waitFor();
    } finally {
      await page.close();
    }
  }, 30_000);
});

describe("responsive header logos in WebKit", () => {
  it.each([
    { width: 320, height: 568, logoHeight: 54.2 },
    { width: 375, height: 600, logoHeight: 59 },
    { width: 390, height: 700, logoHeight: 74 },
    { width: 844, height: 390, logoHeight: 27.5 },
    { width: 1280, height: 900, logoHeight: 100 },
  ])("uses the largest fitting header logo with 5px extra clearance at $width x $height", async ({
    width,
    height,
    logoHeight,
  }) => {
    const page = await openPage(height, "light", width);
    try {
      const logo = await bounds(page, 'svg[role="img"]');
      expect(logo.y).toBeGreaterThanOrEqual(0);
      expect(logo.height).toBeCloseTo(logoHeight, 1);
      expect(logo.height).toBeLessThanOrEqual(100);
      expect(logo.width).toBeCloseTo(width, 1);
      expect(logo.y + logo.height).toBeLessThanOrEqual(height * 0.15);
      expect((await bounds(page, ".page-shell-header")).height).toBeCloseTo(height * 0.15, 1);
      const logoLayer = await bounds(page, ".card-header-logo");
      expect(logo.y + logo.height / 2).toBeCloseTo(logoLayer.y + logoLayer.height / 2, 1);
      expect(logo.x + logo.width / 2).toBeCloseTo(width / 2, 1);
      expect(await page.getByRole("button", { name: /^(Tips|Info)$/ }).count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally {
      await page.close();
    }
  });

  it("refits on rotation and grows back to the 100px cap without a minimum", async () => {
    const page = await openPage(900);
    try {
      for (const { width, height, logoHeight } of [
        { width: 844, height: 390, logoHeight: 27.5 },
        { width: 320, height: 568, logoHeight: 54.2 },
        { width: 390, height: 844, logoHeight: 95.6 },
        { width: 1440, height: 1200, logoHeight: 100 },
      ]) {
        await page.setViewportSize({ width, height });
        await expect
          .poll(async () => (await bounds(page, 'svg[role="img"]')).height)
          .toBeCloseTo(logoHeight, 1);
        expect((await bounds(page, 'svg[role="img"]')).y).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await page.close();
    }
  });

  it("fits narrow safe-area widths proportionally and recovers when space returns", async () => {
    const page = await openPage(900);
    try {
      await page.addStyleTag({
        content:
          ":root { --safe-area-inset-top: 47px; --safe-area-inset-left: 120px; --safe-area-inset-right: 120px; }",
      });
      // The 420 x 159.44 word area must fit in the remaining 150px.
      await expect
        .poll(async () => (await bounds(page, 'svg[role="img"]')).height)
        .toBeCloseTo((150 * 159.44) / 420, 1);
      const logo = await bounds(page, 'svg[role="img"]');
      expect(logo.x).toBeCloseTo(120, 1);
      expect(logo.width).toBeCloseTo(150, 1);
      expect(logo.y).toBeGreaterThanOrEqual(47);

      await page.addStyleTag({
        content: ":root { --safe-area-inset-left: 390px; --safe-area-inset-right: 0px; }",
      });
      await expect
        .poll(() =>
          page
            .locator('svg[role="img"]')
            .evaluate((element) => element.getBoundingClientRect().height),
        )
        .toBe(0);
      expect(await page.locator('svg[role="img"]').getAttribute("viewBox")).not.toMatch(
        /NaN|Infinity/,
      );

      await page.addStyleTag({
        content: ":root { --safe-area-inset-left: 0px; --safe-area-inset-right: 0px; }",
      });
      await expect.poll(async () => (await bounds(page, 'svg[role="img"]')).height).toBe(100);
    } finally {
      await page.close();
    }
  });

  it("shares compact sizing across header pages without changing the Home logo", async () => {
    const page = await openPage(600, "light", 375);
    try {
      for (const route of ["/create", "/players", "/phases", "/settings", "/phasescard"]) {
        await page.goto(`${appUrl}#/phaseCompan10n${route}`);
        await expect
          .poll(async () => (await bounds(page, '.page-shell-header svg[role="img"]')).height)
          .toBe(59);
      }
      await page.goto(`${appUrl}#/phaseCompan10n`);
      expect((await bounds(page, '.page-shell-main svg[role="img"]')).height).toBe(120);
    } finally {
      await page.close();
    }
  });
});
