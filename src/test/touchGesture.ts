import type { Locator } from "playwright";

export function touchGesture(
  target: Locator,
  points: { x?: number; y: number; time: number }[],
  ending: "touchend" | "touchcancel" | null = "touchend",
) {
  return target.evaluate(
    (element, { points, ending }) => {
      return points.map((point, index) => {
        const touch = {
          identifier: 7,
          target: element,
          clientX: point.x ?? 100,
          clientY: point.y,
        };
        const ended = index === points.length - 1 && ending !== null;
        const event = new Event(index === 0 ? "touchstart" : ended ? ending : "touchmove", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperties(event, {
          touches: { value: ended ? [] : [touch] },
          changedTouches: { value: [touch] },
          timeStamp: { value: point.time },
        });
        if (ended) {
          // Safari releases implicit pointer capture before delivering touchend.
          element.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              pointerType: "touch",
              pointerId: 7,
            }),
          );
          element.dispatchEvent(
            new PointerEvent("lostpointercapture", {
              bubbles: true,
              pointerType: "touch",
              pointerId: 7,
            }),
          );
        }
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    },
    { points, ending },
  );
}
