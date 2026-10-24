/// <reference types="node" />

import type { Browser } from "playwright";
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
  browser = await webkit.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

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
