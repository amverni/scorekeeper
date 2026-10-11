import type { Page } from "playwright";

/** Browser-boundary simulation, not evidence of native software keyboard behavior. */
export async function setVisibleViewport(
  page: Page,
  viewport: { width: number; height: number; offsetLeft: number; offsetTop: number },
) {
  await page.evaluate((viewport) => {
    const visible = window.visualViewport;
    if (!visible) throw new Error("Missing VisualViewport");
    for (const [key, value] of Object.entries(viewport)) {
      Object.defineProperty(visible, key, { configurable: true, value });
    }
    visible.dispatchEvent(new Event("resize"));
    visible.dispatchEvent(new Event("scroll"));
  }, viewport);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
