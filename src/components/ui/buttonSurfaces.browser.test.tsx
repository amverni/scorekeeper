/// <reference types="node" />

import type { Browser, Locator, Page } from "playwright";
import { webkit } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RandomPhasesButton } from "../Create/Phases/RandomPhasesButton";
import { RoundResultSection } from "../Scoreboard/RoundResultSection";
import { TiebreakerEntrySection } from "../Scoreboard/TiebreakerEntrySection";
import { Button } from "./Button/Button";
import { ColorPicker } from "./ColorPicker/ColorPicker";
import { Input } from "./Input/Input";
import { Listbox, ListboxButton } from "./Listbox/Listbox";
import { SearchBar } from "./SearchBar/SearchBar";
import { WheelSelector } from "./WheelSelector/WheelSelector";

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

function surface(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.getPropertyValue("backdrop-filter"),
      filter: style.filter,
      hasShine: !["none", "normal"].includes(getComputedStyle(element, "::after").content),
      opacity: style.opacity,
      color: style.color,
    };
  });
}

async function expectOpaque(locator: Locator, background: string) {
  expect(await surface(locator)).toMatchObject({
    background,
    backgroundImage: "none",
    backdropFilter: "none",
    filter: "none",
    hasShine: false,
  });
  const edges = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderTopWidth, shadow: style.boxShadow };
  });
  expect(edges.border).toBe("1px");
  expect(edges.shadow).not.toBe("none");
}

async function mountSurfaceExamples(page: Page) {
  const markup = renderToStaticMarkup(
    <>
      <Button className="px-4 py-2">Neutral action</Button>
      <Button className="px-4 py-2" disabled>
        Disabled action
      </Button>
      <Button className="glass-danger px-4 py-2 text-white">Delete action</Button>
      <RandomPhasesButton onRandom={() => {}} />
      <Listbox value="Example" onChange={() => {}}>
        <ListboxButton>Example</ListboxButton>
      </Listbox>
      <RoundResultSection
        value="completed"
        onChange={() => {}}
        expanded
        onToggleExpand={() => {}}
      />
      <div className="glass relative rounded-xl p-4" data-testid="non-button-glass">
        Opaque panel
      </div>
      <SearchBar value="" onValueChange={() => {}} placeholder="Surface search" />
      <Input className="glass rounded-xl px-3 py-2" aria-label="Surface field" />
      <ColorPicker value="red" onChange={() => {}} />
      <WheelSelector
        value={0}
        onChange={() => {}}
        min={0}
        max={10}
        step={1}
        label="Surface count"
      />
      <div className="glass listbox-glass rounded-xl" data-testid="dropdown-surface">
        Dropdown options
      </div>
      <div className="glass popover-glass rounded-xl" data-testid="popover-surface">
        Popover content
      </div>
      <div className="glass toast-glass rounded-xl" data-testid="toast-surface">
        Unable to save
      </div>
      {(["fewestWilds", "fewestSkips", "mostSkipped"] as const).map((tiebreaker) => (
        <section key={tiebreaker} data-testid={tiebreaker}>
          <TiebreakerEntrySection
            tiebreaker={tiebreaker}
            value={2}
            onChange={() => {}}
            onQuickIncrement={() => {}}
            onQuickDecrement={() => {}}
            onQuickReset={() => {}}
            quickCounts={{ p5: 0, p10: 0, skipCard: 0, wild: 0 }}
            result="completed"
            isRoundWinner={false}
          />
        </section>
      ))}
    </>,
  );
  await page.evaluate((html) => {
    const host = document.createElement("div");
    host.id = "button-surface-examples";
    host.style.cssText =
      "position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:start;gap:16px;padding:24px;background:var(--color-app-background);overflow:auto";
    host.innerHTML = html;
    document.body.appendChild(host);
  }, markup);
}

describe.each(["light", "dark"] as const)("opaque shared surfaces in %s mode", (colorScheme) => {
  it("uses solid neutral surfaces for links, nested icons, dropdowns, and compound controls", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      hasTouch: true,
    });
    const background = colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(38, 38, 38)";
    const color = colorScheme === "light" ? "rgb(26, 26, 26)" : "rgb(255, 255, 255)";
    try {
      await page.goto(`${appUrl}#/phaseCompan10n`);
      const phases = page.getByRole("link", { name: "Open Phases Card" });
      await phases.waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const control of [
        phases,
        page.getByRole("link", { name: "Create Game" }),
        page.getByRole("button", { name: "Menu", exact: true }).locator(":scope > .glass"),
      ]) {
        expect(await surface(control)).toMatchObject({
          background,
          backdropFilter: "none",
          opacity: "1",
          color,
        });
      }
      const phasesBounds = await phases.boundingBox();
      expect(phasesBounds?.height).toBe(56);
      expect(phasesBounds?.width).toBeGreaterThanOrEqual(48);
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("link", { name: "Players", exact: true }).waitFor();
      await page.keyboard.press("Escape");

      await mountSurfaceExamples(page);
      const examples = page.locator("#button-surface-examples");
      for (const control of [
        examples.getByRole("button", { name: "Neutral action", exact: true }),
        examples.getByRole("button", { name: "Example", exact: true }),
        examples.getByRole("group", { name: "Random phase count picker" }),
        examples.getByRole("button", { name: "Failed", exact: true }),
      ]) {
        expect(await surface(control)).toMatchObject({
          background,
          backdropFilter: "none",
          opacity: "1",
          color,
        });
      }
      const disabled = examples.getByRole("button", { name: "Disabled action" });
      expect(await disabled.isDisabled()).toBe(true);
      expect(await surface(disabled)).toMatchObject({ background, opacity: "0.4" });
      const failed = examples.getByRole("button", { name: "Failed", exact: true });
      await failed.evaluate((element) => element.setAttribute("disabled", ""));
      await expect.poll(() => surface(failed)).toMatchObject({ background, opacity: "0.5" });
      await expect.poll(async () => (await surface(failed.locator("span"))).opacity).toBe("1");
      await expectOpaque(
        examples.getByTestId("non-button-glass"),
        colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)",
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it("retains opaque destructive and selected-result colors without recoloring panels", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n`);
      await page.getByRole("link", { name: "Open Phases Card" }).waitFor();
      await mountSurfaceExamples(page);
      const examples = page.locator("#button-surface-examples");
      expect(await surface(examples.getByRole("button", { name: "Delete action" }))).toMatchObject({
        background: "rgb(230, 10, 10)",
        backdropFilter: "none",
        color: "rgb(255, 255, 255)",
      });
      const passed = examples.getByRole("button", { name: "Passed", exact: true });
      expect(await passed.getAttribute("aria-pressed")).toBe("true");
      expect(
        await passed.evaluate((element) => {
          const style = getComputedStyle(element);
          const reference = document.createElement("span");
          reference.style.backgroundColor = "var(--color-pt-green-500)";
          element.appendChild(reference);
          const matches = style.backgroundColor === getComputedStyle(reference).backgroundColor;
          reference.remove();
          return matches;
        }),
      ).toBe(true);
      const panel = await surface(examples.getByTestId("non-button-glass"));
      expect(panel.background).toBe(
        colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)",
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  it("uses solid unfiltered search, field, numeric, floating, and error surfaces without shine", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n`);
      await page.getByRole("link", { name: "Open Phases Card" }).waitFor();
      await mountSurfaceExamples(page);
      const examples = page.locator("#button-surface-examples");
      const background = colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)";
      for (const panel of [
        examples.getByTestId("non-button-glass"),
        examples.locator(".glass:has(> input[placeholder='Surface search'])"),
        examples.getByRole("textbox", { name: "Surface field" }),
        examples.getByRole("radiogroup", { name: "Avatar color" }),
        examples
          .getByRole("spinbutton", { name: "Surface count", exact: true })
          .locator(".wheel-selector__pill"),
        examples.getByTestId("dropdown-surface"),
        examples.getByTestId("popover-surface"),
      ]) {
        await expectOpaque(panel, background);
      }
      for (const button of [
        examples.getByRole("button", { name: "Neutral action", exact: true }),
        examples.getByRole("button", { name: "Delete action", exact: true }),
        examples.getByRole("button", { name: "Passed", exact: true }),
      ]) {
        expect(await surface(button)).toMatchObject({
          backdropFilter: "none",
          filter: "none",
          hasShine: false,
        });
      }
      const neutral = examples.getByRole("button", { name: "Neutral action", exact: true });
      await neutral.hover();
      await expectOpaque(
        neutral,
        colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(38, 38, 38)",
      );
      const toast = examples.getByTestId("toast-surface");
      await expectOpaque(toast, "rgb(230, 10, 10)");
      expect((await surface(toast)).color).toBe("rgb(255, 255, 255)");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps real searches, modals, moving tabs, and menus opaque in both Scorekeepers while retaining modal blur", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      const background = colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)";
      for (const experience of ["phaseCompan10n", "scorekeeper"]) {
        await page.goto(`${appUrl}#/${experience}/players`);
        const search = page.locator(".glass:has(> input[type='text']):has(> svg)");
        await search.waitFor();
        await expectOpaque(search, background);
        await page.getByRole("button", { name: "Create new player", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Create player", exact: true });
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        await close.waitFor();
        await expectOpaque(dialog.getByRole("textbox", { name: "Name", exact: true }), background);
        expect(
          await dialog
            .locator(".dialog-panel")
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe(background);
        expect(
          await dialog
            .locator(".dialog-backdrop")
            .evaluate((element) => getComputedStyle(element).backdropFilter),
        ).toContain("blur(");
        await close.click();
        await dialog.waitFor({ state: "detached" });

        await page.goto(`${appUrl}#/${experience}/create`);
        const tabs = page.getByRole("tablist").first();
        const indicator = tabs.locator(".glass-tab-indicator");
        await indicator.waitFor();
        await expectOpaque(tabs, background);
        await expectOpaque(indicator, background);
        const nextTab = tabs.getByRole("tab").nth(1);
        await nextTab.click();
        await expect.poll(() => nextTab.getAttribute("aria-selected")).toBe("true");
        const target = await nextTab.boundingBox();
        if (!target) throw new Error("Missing selected-tab bounds");
        await expect.poll(async () => (await indicator.boundingBox())?.x).toBeCloseTo(target.x, 0);
        await expect
          .poll(async () => (await indicator.boundingBox())?.width)
          .toBeCloseTo(target.width, 0);
        await expectOpaque(indicator, background);

        await page.goto(`${appUrl}#/${experience}`);
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page.getByRole("link", { name: "Players", exact: true }).waitFor();
        await expectOpaque(page.locator(".popover-glass:visible"), background);
        await page.keyboard.press("Escape");
      }
      await page.goto(`${appUrl}#/phaseCompan10n/settings`);
      await page.locator("button[aria-haspopup='listbox']").first().click();
      const options = page.locator(".listbox-glass:visible");
      await options.waitFor();
      await expectOpaque(options, background);
      await page.keyboard.press("Escape");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps selected count quick-buttons opaque without losing their blue accent or pressed state", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme,
    });
    try {
      await page.goto(`${appUrl}#/phaseCompan10n`);
      await page.getByRole("link", { name: "Open Phases Card" }).waitFor();
      await mountSurfaceExamples(page);
      const examples = page.locator("#button-surface-examples");
      const background = colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(38, 38, 38)";
      for (const tiebreaker of ["fewestWilds", "fewestSkips", "mostSkipped"]) {
        const counts = examples.getByTestId(tiebreaker);
        const selected = counts.getByRole("button", { name: "Set to 2", exact: true });
        await expectOpaque(selected, background);
        expect(await selected.getAttribute("aria-pressed")).toBe("true");
        expect(
          await selected.evaluate((element) => {
            const reference = document.createElement("span");
            reference.style.backgroundColor = "var(--color-pt-blue-500)";
            element.appendChild(reference);
            const cap = element.querySelector(".tiebreaker-quick-card__cap");
            const blue = cap
              ? getComputedStyle(cap).backgroundColor ===
                getComputedStyle(reference).backgroundColor
              : false;
            reference.remove();
            return blue;
          }),
        ).toBe(true);
        const unselected = counts.getByRole("button", { name: "Set to 1", exact: true });
        await expectOpaque(unselected, background);
        expect(await unselected.getAttribute("aria-pressed")).toBe("false");
      }
    } finally {
      await page.close();
    }
  }, 30_000);
});
