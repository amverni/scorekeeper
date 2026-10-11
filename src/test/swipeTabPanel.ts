import type { Locator } from "playwright";

export async function swipeTabPanel(panel: Locator, direction: "left" | "right") {
  await panel.evaluate((element, direction) => {
    const bounds = element.getBoundingClientRect();
    const start = direction === "left" ? bounds.right - 20 : bounds.left + 20;
    const end = direction === "left" ? bounds.left + 20 : bounds.right - 20;
    for (const [type, clientX] of [
      ["touchstart", start],
      ["touchmove", end],
      ["touchend", end],
    ] as const) {
      const touch = {
        identifier: 1,
        target: element,
        clientX,
        clientY: bounds.y + bounds.height / 2,
      };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    }
  }, direction);
}
