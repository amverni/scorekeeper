/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ScorekeeperId, StoredGame } from "../../types";

let server: ViteDevServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  appUrl = `http://127.0.0.1:${address.port}/scorekeeper/`;
  await server.warmupRequest("/src/main.tsx");
  await server.waitForRequestsIdle();
  browser = await webkit.launch();
}, 60_000);

it.each([
  "generic",
  "phase10",
] as const)("keeps wrapped Player identities inside shared %s Create/Edit rows", async (owner) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 900 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  const name = "Alexandria Montgomery with a very long Player name that needs several lines";
  try {
    const game = await seed(page, owner);
    await page.evaluate(`(async () => {
      const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
      await playersApi.update(${JSON.stringify(game.players[0])}, { name: ${JSON.stringify(name)} });
    })()`);
    const sizes = [];
    for (const mode of ["create", "edit"] as const) {
      await page.goto(
        `${appUrl}#${home(owner)}/${mode === "create" ? "create" : `game/${game.id}/edit`}`,
      );
      if (mode === "create") {
        await page.getByRole("button", { name, exact: true }).click();
      }
      const action = page.getByRole("button", {
        name: `${mode === "create" ? "Remove" : "Withdraw"} ${name}`,
        exact: true,
      });
      await action.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const row = playerRow(page, action);
      const bounds = await row.boundingBox();
      const identity = await row.getByText(name, { exact: true }).boundingBox();
      if (!bounds || !identity) throw new Error("Missing wrapped Player identity");
      expect(identity.height).toBeGreaterThan(40);
      expect(identity.y).toBeGreaterThanOrEqual(bounds.y);
      expect(identity.y + identity.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(identity.x + identity.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      sizes.push([bounds.width, bounds.height, identity.width, identity.height]);
    }
    expect(sizes[1]).toEqual(sizes[0]);
  } finally {
    await page.close();
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const home = (owner: ScorekeeperId) => (owner === "phase10" ? "/phaseCompan10n" : "/scorekeeper");

async function seed(page: Page, owner: ScorekeeperId) {
  await page.goto(`${appUrl}#${home(owner)}`);
  await page.getByText("No active games yet", { exact: true }).waitFor();
  return page.evaluate<StoredGame>(`(async () => {
    const { playersApi } = await import("/scorekeeper/src/data/api/players.ts");
    const bob = await playersApi.create({ name: "Bob", color: "Pacific", isFavorite: 1 });
    const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 1 });
    const cam = await playersApi.create({ name: "Cam", color: "Fairway", isFavorite: 1 });
    await playersApi.create({ name: "Dora", color: "Lupine", isFavorite: 1 });
    ${
      owner === "phase10"
        ? 'const { gamesApi: api } = await import("/scorekeeper/src/data/api/games.ts");'
        : 'const { genericGamesApi: api } = await import("/scorekeeper/src/data/api/genericGames.ts");'
    }
    return api.create({
      players: [bob.id, amy.id, cam.id],
      ${
        owner === "phase10"
          ? 'phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] }, settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 45, sitOutPenalty: 15 }'
          : 'settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false }'
      }
    });
  })()`);
}

function playerRow(page: Page, action: Locator) {
  return page.locator(".list-row-shell").filter({ has: action });
}

async function geometry(page: Page, action: Locator) {
  const row = playerRow(page, action);
  const add = page.getByRole("button", { name: "Add Player", exact: true });
  const addRow = playerRow(page, add);
  const favorites = page.getByRole("heading", { name: "Favorites", exact: true });
  const bounds = await row.boundingBox();
  const addBounds = await addRow.boundingBox();
  const favoritesBounds = await favorites.boundingBox();
  if (!bounds || !addBounds || !favoritesBounds) throw new Error("Missing Players geometry");

  const relativeBox = async (element: Locator) => {
    const box = await element.boundingBox();
    if (!box) throw new Error("Missing Player control geometry");
    return [box.x - bounds.x, box.y - bounds.y, box.width, box.height].map(
      (value) => Math.round(value * 10) / 10,
    );
  };
  return {
    row: [bounds.width, bounds.height],
    identity: await relativeBox(row.getByText("Bob", { exact: true })),
    avatar: await relativeBox(row.locator("svg").first()),
    action: await relativeBox(action),
    icon: await relativeBox(action.locator("svg")),
    handleSlot: await relativeBox(row.locator(":scope > div:last-child > div > :last-child")),
    add: [addBounds.x - bounds.x, addBounds.y - bounds.y, addBounds.width, addBounds.height],
    favoritesGap: favoritesBounds.y - (addBounds.y + addBounds.height),
    sharedGroup: await add.evaluate(
      (button) =>
        button.closest(".glass") ===
        document.querySelector("button[aria-label$='Bob']")?.closest(".glass"),
    ),
    surface: await row.evaluate((element) => {
      const style = getComputedStyle(element.parentElement ?? element);
      return [style.backgroundColor, style.borderRadius, style.boxShadow];
    }),
  };
}

function controlStyle(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      border: style.border,
      shadow: style.boxShadow,
      color: style.color,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      transform: style.transform,
      scale: style.scale,
      filter: style.filter,
    };
  });
}

async function keyboardFocus(page: Page, control: Locator) {
  await control.focus();
  const tab = process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(tab);
  await page.keyboard.press(`Shift+${tab}`);
  expect(await control.evaluate((element) => element === document.activeElement)).toBe(true);
  const focus = await controlStyle(control);
  expect(focus.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
  return focus;
}

async function interactionStates(page: Page, control: Locator) {
  await page.mouse.move(0, 0);
  const rest = await controlStyle(control);
  await control.hover();
  const hover = await controlStyle(control);
  expect(hover.background).not.toBe(rest.background);
  await page.mouse.down();
  const pressed = await controlStyle(control);
  expect(pressed.scale).not.toBe(rest.scale);
  // Release away from the action so measuring its pressed state does not activate it.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  const focus = await keyboardFocus(page, control);
  return { rest, hover, pressed, focus };
}

it.each(
  (["generic", "phase10"] as const).flatMap((owner) =>
    ([390, 1280] as const).flatMap((width) =>
      (["light", "dark"] as const).map((colorScheme) => ({ owner, width, colorScheme })),
    ),
  ),
)("shares actual Create/Edit Players geometry and controls for $owner at $width in $colorScheme", async ({
  owner,
  width,
  colorScheme,
}) => {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5_000);
  try {
    const game = await seed(page, owner);
    await page.goto(`${appUrl}#${home(owner)}/create`);
    await page.getByRole("button", { name: "Bob", exact: true }).click();
    await page.getByRole("button", { name: "Amy", exact: true }).click();
    await page.getByRole("button", { name: "Cam", exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const remove = page.getByRole("button", { name: "Remove Bob", exact: true });
    const createGeometry = await geometry(page, remove);
    expect(createGeometry.sharedGroup).toBe(true);
    const createStates = await interactionStates(page, remove);
    const reorder = page.getByRole("button", { name: "Reorder Bob", exact: true });
    expect(await reorder.evaluate((element) => getComputedStyle(element).cursor)).toBe("grab");
    expect(await controlStyle(reorder)).toEqual(createStates.rest);
    await reorder.hover();
    expect(await controlStyle(reorder)).toEqual(createStates.hover);
    await page.mouse.move(0, 0);
    expect(await keyboardFocus(page, reorder)).toEqual(createStates.focus);

    await page.goto(`${appUrl}#${home(owner)}/game/${game.id}/edit`);
    const withdraw = page.getByRole("button", { name: "Withdraw Bob", exact: true });
    await withdraw.waitFor();
    expect(await geometry(page, withdraw)).toEqual(createGeometry);
    expect(await interactionStates(page, withdraw)).toEqual(createStates);
    expect(await page.getByRole("button", { name: /Shuffle|Reset/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^Reorder / }).count()).toBe(0);

    await withdraw.click();
    const rejoin = page.getByRole("button", { name: "Rejoin Bob", exact: true });
    expect(await geometry(page, rejoin)).toEqual(createGeometry);
    expect(await interactionStates(page, rejoin)).toEqual(createStates);
    expect(
      await playerRow(page, rejoin)
        .getByText("Bob", { exact: true })
        .evaluate((element) => {
          for (let node: Element | null = element; node; node = node.parentElement) {
            if (getComputedStyle(node).filter === "grayscale(1)") return true;
          }
          return false;
        }),
    ).toBe(true);
    await rejoin.press("Enter");
    await withdraw.waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);

    await page.getByRole("button", { name: "Dora", exact: true }).click();
    const removeDora = page.getByRole("button", { name: "Remove Dora", exact: true });
    const newAction = await removeDora.boundingBox();
    const savedAction = await withdraw.boundingBox();
    const newHandle = await page
      .getByRole("button", { name: "Reorder Dora", exact: true })
      .boundingBox();
    if (!newAction || !savedAction || !newHandle) throw new Error("Missing row controls");
    expect([newAction.x, newAction.width, newAction.height]).toEqual([
      savedAction.x,
      savedAction.width,
      savedAction.height,
    ]);
    expect(newAction.y + newAction.height / 2).toBe(newHandle.y + newHandle.height / 2);
    expect(newHandle.x - newAction.x).toBe(newAction.width);
    expect(await page.getByRole("button", { name: "Dora", exact: true }).isDisabled()).toBe(true);
    expect(await interactionStates(page, removeDora)).toEqual(createStates);
    await removeDora.press("Space");
    await removeDora.waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);
