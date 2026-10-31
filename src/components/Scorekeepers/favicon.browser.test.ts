/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { palettes } from "../Logo/themes/palettes";
import { encodePhasesCardPayload } from "../PhasesCard/phasesCardUrl";

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

async function expectFavicon(page: Page, brand: "scorekeeper" | "phaseCompan10n") {
  await expect
    .poll(() =>
      page.locator('head link[rel="icon"]').evaluateAll((links) =>
        links.map((link) => ({
          href: link.getAttribute("href"),
          type: link.getAttribute("type"),
          sizes: link.getAttribute("sizes"),
        })),
      ),
    )
    .toEqual([
      { href: `/scorekeeper/favicons/${brand}.png`, type: "image/png", sizes: "32x32" },
      { href: `/scorekeeper/favicons/${brand}.svg`, type: "image/svg+xml", sizes: "any" },
    ]);
}

describe("browser-tab favicons", () => {
  it("uses only the horizontal mark on shared Home", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(appUrl);
      await page.getByRole("heading", { name: "Scorekeepers", exact: true }).waitFor();
      await expectFavicon(page, "scorekeeper");
      expect(await page.title()).toBe("Scorekeeper");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps the horizontal mark on direct Scorekeeper routes and refresh", async () => {
    const page = await browser.newPage();
    try {
      for (const route of [
        "",
        "/create",
        "/games",
        "/players",
        "/game/missing-game",
        "/game/missing-game/edit",
      ]) {
        await page.goto(`${appUrl}#/scorekeeper${route}`);
        await expectFavicon(page, "scorekeeper");
        expect(await page.title()).toBe("Scorekeeper");
        await page.reload();
        await expectFavicon(page, "scorekeeper");
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("selects the diagonal mark on direct Phase routes and refresh, including both Phases Card share formats", async () => {
    const page = await browser.newPage();
    const data = encodePhasesCardPayload({
      v: 1,
      name: "Shared Phases",
      phases: [{ requirements: [{ type: "set", count: 3, quantity: 2, isSameColor: false }] }],
    });
    try {
      for (const route of [
        "",
        "/create",
        "/games",
        "/players",
        "/phases",
        "/settings",
        "/game/missing-game",
        "/game/missing-game/edit",
        "/phasescard",
        "/phasescard/original",
        `/phasescard/custom?data=${data}`,
      ]) {
        await page.goto(`${appUrl}#/phaseCompan10n${route}`);
        await expectFavicon(page, "phaseCompan10n");
        expect(await page.title()).toBe("Phaze Compan10n");
        await page.reload();
        await expectFavicon(page, "phaseCompan10n");
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("uses the horizontal mark for unmatched routes, even beneath the Phase prefix", async () => {
    const page = await browser.newPage();
    try {
      for (const route of ["/missing", "/phaseCompan10n/missing", "/phaseCompan10n-extra"]) {
        await page.goto(`${appUrl}#${route}`);
        await page.getByText("Not Found", { exact: true }).waitFor();
        await expectFavicon(page, "scorekeeper");
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it("updates both formats together through Home, Scorekeeper switching, and Back/Forward without reloads", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-31T16:00:00Z"));
    try {
      await page.goto(appUrl);
      const choices = page.getByRole("navigation", { name: "Scorekeepers" });
      await choices.getByRole("link", { name: "Phase Compan10n", exact: true }).click();
      await expectFavicon(page, "phaseCompan10n");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("link", { name: "Players", exact: true }).click();
      await expectFavicon(page, "phaseCompan10n");
      await page.getByRole("link", { name: "Go home", exact: true }).click();
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await expectFavicon(page, "scorekeeper");
      await choices.getByRole("link", { name: "Scorekeeper", exact: true }).click();
      await expectFavicon(page, "scorekeeper");
      expect(await page.title()).toBe("Scorekeeper");
      await page.goBack();
      await expectFavicon(page, "scorekeeper");
      await page.goBack();
      await expectFavicon(page, "phaseCompan10n");
      await page.goForward();
      await expectFavicon(page, "scorekeeper");
      await page.goForward();
      await expectFavicon(page, "scorekeeper");
      await page.evaluate(() => {
        window.location.hash = "/phaseCompan10n/settings";
      });
      await expectFavicon(page, "phaseCompan10n");
      await page.evaluate(() => {
        window.location.hash = "/phaseCompan10n/missing";
      });
      await page.getByText("Not Found", { exact: true }).waitFor();
      await expectFavicon(page, "scorekeeper");
      await page.goBack();
      await expectFavicon(page, "phaseCompan10n");
      await page.evaluate(() => {
        window.location.hash = "/";
      });
      await expectFavicon(page, "scorekeeper");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("loads matching, transparent four-stripe SVG and PNG marks in the fixed Base Logo Palettes at tab sizes", async () => {
    const page = await browser.newPage({ timezoneId: "America/New_York" });
    await page.clock.setFixedTime(new Date("2026-10-31T16:00:00Z"));
    try {
      await page.goto(appUrl);
      await page.getByRole("heading", { name: "Scorekeepers", exact: true }).waitFor();
      for (const brand of ["scorekeeper", "phaseCompan10n"] as const) {
        for (const format of ["svg", "png"]) {
          const url = `${appUrl}favicons/${brand}.${format}`;
          const response = await page.request.get(url);
          expect(response.status()).toBe(200);
          expect(response.headers()["content-type"]).toContain(
            format === "svg" ? "image/svg+xml" : "image/png",
          );
          for (const colorScheme of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme });
            for (const size of [16, 32]) {
              const pixels = await page.evaluate(
                async ({ url, size, brand, colors }) => {
                  const image = new Image();
                  image.src = url;
                  await image.decode();
                  const canvas = document.createElement("canvas");
                  canvas.width = size;
                  canvas.height = size;
                  const context = canvas.getContext("2d");
                  if (!context) throw new Error("Missing favicon canvas");
                  context.drawImage(image, 0, 0, size, size);
                  const data = context.getImageData(0, 0, size, size).data;
                  const pixel = (x: number, y: number) =>
                    Array.from(data.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
                  const samples =
                    brand === "scorekeeper"
                      ? [5, 12, 19, 26].map((y) => pixel(size / 2, Math.floor((y * size) / 32)))
                      : [8, 13, 18, 23].map((xy) =>
                          pixel(Math.floor((xy * size) / 32), Math.floor((xy * size) / 32)),
                        );
                  const expected = colors.map((color) => {
                    context.clearRect(0, 0, size, size);
                    const probe = document.createElement("span");
                    probe.style.color = color;
                    document.body.appendChild(probe);
                    context.fillStyle = getComputedStyle(probe).color;
                    probe.remove();
                    context.fillRect(0, 0, 1, 1);
                    return Array.from(context.getImageData(0, 0, 1, 1).data);
                  });
                  let stripes = 0;
                  const visited = new Set<number>();
                  for (let start = 0; start < size * size; start++) {
                    if (data[start * 4 + 3] < 200 || visited.has(start)) continue;
                    stripes++;
                    const queue = [start];
                    visited.add(start);
                    while (queue.length) {
                      const current = queue.pop();
                      if (current === undefined) throw new Error("Missing stripe pixel");
                      const x = current % size;
                      const y = Math.floor(current / size);
                      for (const [nx, ny] of [
                        [x - 1, y],
                        [x + 1, y],
                        [x, y - 1],
                        [x, y + 1],
                      ]) {
                        const next = ny * size + nx;
                        if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
                        if (data[next * 4 + 3] < 200 || visited.has(next)) continue;
                        visited.add(next);
                        queue.push(next);
                      }
                    }
                  }
                  return {
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                    corners: [
                      pixel(0, 0),
                      pixel(size - 1, 0),
                      pixel(0, size - 1),
                      pixel(size - 1, size - 1),
                    ],
                    stripes,
                    samples,
                    expected,
                  };
                },
                {
                  url,
                  size,
                  brand,
                  colors: brand === "scorekeeper" ? palettes.arcade : palettes.phaseBase,
                },
              );
              expect(pixels, `${brand}.${format} at ${size}px in ${colorScheme}`).toMatchObject({
                width: 32,
                height: 32,
                stripes: 4,
              });
              expect(pixels.corners.every((pixel) => pixel[3] === 0)).toBe(true);
              expect(pixels.samples).toEqual(pixels.expected);
            }
          }
        }
      }
    } finally {
      await page.close();
    }
  }, 60_000);
});
