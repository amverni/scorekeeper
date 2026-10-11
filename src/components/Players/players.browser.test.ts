/// <reference types="node" />

import type { Browser, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setVisibleViewport } from "../../test/visualViewport";
import type { Player } from "../../types";

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

describe.each(["scorekeeper", "phaseCompan10n"])("%s focused Player modal", (experience) => {
  it.each([
    "light",
    "dark",
  ] as const)("keeps fields and fixed actions reachable, falls back to whole-modal scrolling, and restores in %s", async (colorScheme) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${appUrl}#/${experience}/players`);
      await page.getByRole("button", { name: "Create new player" }).click();
      const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await name.waitFor();
      await name.fill("Keyboard pilot");
      await name.evaluate((element) => {
        if (!(element instanceof HTMLInputElement)) throw new Error("Missing Player name input");
        element.setSelectionRange(2, 8);
      });
      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      expect(
        await name.evaluate((element) =>
          element instanceof HTMLInputElement ? [element.selectionStart, element.selectionEnd] : [],
        ),
      ).toEqual([2, 8]);
      const panel = dialog.locator(".dialog-panel");
      const bounds = await panel.boundingBox();
      if (!bounds) throw new Error("Missing Player modal");
      expect(bounds.y).toBe(76);
      expect(bounds.y + bounds.height).toBe(464);
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const initialSave = await save.boundingBox();
      const initialClose = await close.boundingBox();
      const region = dialog.getByRole("region", { name: "Create player", exact: true });
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await save.boundingBox()).toEqual(initialSave);
      expect(await close.boundingBox()).toEqual(initialClose);
      expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

      for (const height of [257, 258]) {
        await setVisibleViewport(page, { width: 390, height, offsetLeft: 0, offsetTop: 60 });
        await save.scrollIntoViewIfNeeded();
        const scrollTop = await panel.evaluate((element) => element.scrollTop);
        if (height === 257) expect(scrollTop).toBeGreaterThan(0);
        else expect(scrollTop).toBe(0);
      }

      await setVisibleViewport(page, { width: 390, height: 180, offsetLeft: 0, offsetTop: 60 });
      await save.scrollIntoViewIfNeeded();
      const cramped = await panel.boundingBox();
      const visibleSave = await save.boundingBox();
      if (!cramped || !visibleSave) throw new Error("Missing cramped controls");
      expect(cramped.y).toBe(76);
      expect(cramped.height).toBe(148);
      expect(visibleSave.y).toBeGreaterThanOrEqual(cramped.y + 4);
      expect(visibleSave.y + visibleSave.height).toBeLessThanOrEqual(
        cramped.y + cramped.height - 4,
      );
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await page.mouse.move(
        visibleSave.x + visibleSave.width / 2,
        visibleSave.y + visibleSave.height / 2,
      );
      await page.mouse.down();
      const pressed = await save.boundingBox();
      if (!pressed) throw new Error("Missing pressed Save control");
      expect(pressed.height).toBeGreaterThan(visibleSave.height);
      expect(pressed.y).toBeGreaterThanOrEqual(cramped.y);
      expect(pressed.y + pressed.height).toBeLessThanOrEqual(cramped.y + cramped.height);
      await page.mouse.move(cramped.x + 8, cramped.y + 8);
      await page.mouse.up();
      await save.focus();
      await name.focus();
      await expect
        .poll(() =>
          name.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              element === document.activeElement &&
              element.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              )
            );
          }),
        )
        .toBe(true);
      const label = dialog.getByText("Name", { exact: true });
      const labelBounds = await label.boundingBox();
      if (!labelBounds) throw new Error("Missing focused field label");
      expect(labelBounds.y).toBeGreaterThanOrEqual(76);
      expect(await name.inputValue()).toBe("Keyboard pilot");

      await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
      const restoredClose = await close.boundingBox();
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await close.boundingBox()).toEqual(restoredClose);
      await setVisibleViewport(page, { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      await save.click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Keyboard pilot", exact: true }).waitFor();
      await page.getByRole("button", { name: "Create new player" }).click();
      await name.waitFor();
      expect(await name.inputValue()).toBe("");
      await close.click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  }, 60_000);
});

it("keeps a focused Player draft recoverable through a pending and failed save", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByRole("button", { name: "Create new player" }).click();
    const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Recoverable keyboard pilot");
    await setVisibleViewport(page, { width: 390, height: 420, offsetLeft: 0, offsetTop: 60 });
    await page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === "players") {
          IDBObjectStore.prototype.add = add;
          throw new DOMException("Player storage unavailable", "UnknownError");
        }
        return add.apply(this, args);
      };
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("phase10-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("players", "readwrite");
          let held = true;
          window.addEventListener(
            "release-player-storage",
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
            if (held) transaction.objectStore("players").get("fixture").onsuccess = hold;
          };
          hold();
          resolve();
        };
      });
    });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("button", { name: "Saving...", exact: true }).waitFor();
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    expect(await close.isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    expect(await dialog.getAttribute("data-dialog-open")).toBe("true");
    await page.evaluate(() => window.dispatchEvent(new Event("release-player-storage")));
    await dialog
      .getByRole("alert")
      .getByText("Player storage unavailable", { exact: true })
      .waitFor();
    expect(await name.inputValue()).toBe("Recoverable keyboard pilot");
    expect(await close.isEnabled()).toBe(true);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Recoverable keyboard pilot", exact: true }).waitFor();
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("release-player-storage")));
    await page.close();
  }
}, 60_000);

it("manages saved Players without displaying or writing lifetime Win Counts", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByRole("button", { name: "Create new player" }).click();
    const createDialog = page.getByRole("dialog", { name: "Create player", exact: true });
    await createDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Amy");
    expect(await createDialog.innerText()).not.toMatch(/\bwins?\b/i);
    await createDialog.getByRole("button", { name: "Save", exact: true }).click();
    await createDialog.waitFor({ state: "detached" });
    const [created] = await readPlayers(page);
    expect(created).toMatchObject({ name: "Amy", isFavorite: 0 });
    expect(created).not.toHaveProperty("wins");

    await page.getByRole("button", { name: "Add Amy to favorites", exact: true }).click();
    await expect.poll(async () => (await readPlayers(page))[0]?.isFavorite).toBe(1);
    await page.getByRole("button", { name: "Amy", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit player", exact: true });
    await editDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Amelia");
    expect(await editDialog.innerText()).not.toMatch(/\bwins?\b/i);
    await editDialog.getByRole("button", { name: "Save", exact: true }).click();
    await editDialog.waitFor({ state: "detached" });
    expect(await readPlayers(page)).toEqual([{ ...created, name: "Amelia", isFavorite: 1 }]);

    await page.reload();
    await page.getByRole("button", { name: "Amelia", exact: true }).waitFor();
    expect(await page.locator("body").innerText()).not.toMatch(/\bwins?\b/i);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Amelia", exact: true }).click();
    await page.getByText("No players yet", { exact: true }).waitFor();
    expect(await readPlayers(page)).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);

it("keeps the Player row visible with an alert when an Active Game blocks deletion", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    await seedPlayersWithActiveGame(page);

    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByRole("button", { name: "Amy", exact: true }).waitFor();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Amy", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Cannot delete this Player while an Active Game references them.",
      })
      .waitFor({ timeout: 3_000 });
    expect((await readPlayers(page)).map((player) => player.name)).toEqual(["Amy", "Bob"]);
    const alertBounds = await page.getByRole("alert").boundingBox();
    const bobBounds = await page.getByRole("button", { name: "Bob", exact: true }).boundingBox();
    if (!alertBounds || !bobBounds) throw new Error("Missing deletion error or Player row");
    expect(alertBounds.y + alertBounds.height).toBeLessThanOrEqual(bobBounds.y);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);

it("keeps the Player editor open with an alert when an Active Game blocks deletion", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${appUrl}#/scorekeeper/players`);
    await page.getByText("No players yet", { exact: true }).waitFor();
    await seedPlayersWithActiveGame(page);
    await page.reload();
    await page.getByRole("button", { name: "Amy", exact: true }).waitFor({ timeout: 3_000 });

    await page.getByRole("button", { name: "Amy", exact: true }).click({ timeout: 3_000 });
    const editDialog = page.getByRole("dialog", { name: "Edit player", exact: true });
    await editDialog.waitFor({ state: "attached", timeout: 3_000 });
    page.once("dialog", (dialog) => dialog.accept());
    await editDialog.getByRole("button", { name: "Delete player", exact: true }).click();
    await editDialog
      .getByRole("alert")
      .filter({
        hasText: "Cannot delete this Player while an Active Game references them.",
      })
      .waitFor({ timeout: 3_000 });
    expect(await editDialog.count()).toBe(1);
    expect((await readPlayers(page)).map((player) => player.name)).toEqual(["Amy", "Bob"]);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);

function seedPlayersWithActiveGame(page: Page) {
  return page.evaluate(`
    Promise.all([
      import("/scorekeeper/src/data/api/games.ts"),
      import("/scorekeeper/src/data/api/players.ts")
    ]).then(async ([{ gamesApi }, { playersApi }]) => {
      const amy = await playersApi.create({ name: "Amy", color: "#123456", isFavorite: 0 });
      const bob = await playersApi.create({ name: "Bob", color: "#abcdef", isFavorite: 0 });
      await gamesApi.create({
        scorekeeper: "phase10",
        phaseSet: {
          id: "blocked-delete-phases",
          type: "temporary",
          name: "Blocked delete",
          phases: ["phase-1"]
        },
        players: [amy.id, bob.id],
        settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 }
      });
    })
  `);
}

function readPlayers(page: Page) {
  // Keep this import in the browser rather than Vitest's SSR module loader.
  return page.evaluate<Player[]>(`
    import("/scorekeeper/src/data/api/players.ts").then(({ playersApi }) =>
      playersApi.getAll()
    )
  `);
}
