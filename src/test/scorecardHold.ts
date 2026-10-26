import type { Locator, Page } from "playwright";

export async function holdScorecard(
  page: Page,
  target: Locator,
  ready: Locator,
  pointerType: "mouse" | "touch" = "mouse",
) {
  await target.scrollIntoViewIfNeeded();
  if (pointerType === "mouse") {
    await target.hover();
    await page.mouse.down();
  } else {
    await target.dispatchEvent("pointerdown", {
      pointerType: "touch",
      pointerId: 7,
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
  }
  try {
    await ready.waitFor();
  } finally {
    if (pointerType === "mouse") await page.mouse.up();
    else
      await page.locator("body").dispatchEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        isPrimary: true,
      });
  }
}
