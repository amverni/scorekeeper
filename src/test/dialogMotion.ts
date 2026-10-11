import type { Page } from "playwright";

interface DialogSlide {
  duration: number;
  samples: {
    time: number;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
  }[];
}

declare global {
  interface Window {
    __dialogSlideObservation?: Promise<DialogSlide>;
  }
}

/** Pause the native slide at its first style change, without replacing its timing. */
export async function sampleDialogSlide(
  page: Page,
  action: () => Promise<unknown>,
  sampleTimes: readonly number[] = [0, 40, 150, 225],
) {
  await page.evaluate((sampleTimes) => {
    window.__dialogSlideObservation = new Promise<DialogSlide>((resolve, reject) => {
      const observer = new MutationObserver(observe);
      function cleanup() {
        observer.disconnect();
        document.removeEventListener("transitionrun", observe);
        clearTimeout(timeout);
      }
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Missing native dialog slide"));
      }, 30_000);

      function observe() {
        const panel = document.querySelector(".dialog-panel");
        if (!(panel instanceof HTMLElement)) return;
        const animation = panel
          .getAnimations()
          .find(
            (animation) =>
              animation instanceof CSSTransition && animation.transitionProperty === "transform",
          );
        if (!animation?.effect) return;
        cleanup();
        const duration = animation.effect.getComputedTiming().duration;
        if (typeof duration !== "number") {
          reject(new Error("Missing dialog slide duration"));
          return;
        }
        animation.pause();
        // Reaching the exact end resolves after-leave promises even when paused.
        const samples = [...sampleTimes, duration].map((requestedTime) => {
          const time = Math.min(requestedTime, Math.max(0, duration - 0.001));
          animation.currentTime = time;
          const rect = panel.getBoundingClientRect();
          const transform = new DOMMatrix(getComputedStyle(panel).transform);
          return {
            time,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            scaleX: transform.a,
            scaleY: transform.d,
          };
        });
        animation.currentTime = duration / 2;
        resolve({ duration, samples });
      }
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-dialog-open"],
      });
      document.addEventListener("transitionrun", observe);
    });
  }, sampleTimes);
  const observation = page.evaluate(async () => {
    if (!window.__dialogSlideObservation) throw new Error("Missing dialog slide observer");
    try {
      return await window.__dialogSlideObservation;
    } finally {
      delete window.__dialogSlideObservation;
    }
  });
  const [, slide] = await Promise.all([action(), observation]);
  return slide;
}
