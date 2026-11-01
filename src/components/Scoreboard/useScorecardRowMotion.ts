import { type RefObject, useLayoutEffect, useRef } from "react";

export function useScorecardRowMotion(rootRef: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<HTMLElement, number>());
  const animations = useRef(new Set<Animation>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rows = new Map(
      Array.from(
        root.querySelectorAll<HTMLElement>("[data-scorecard-round], .scoreboard-cell--dashed"),
        (row) => [row, row.offsetTop] as const,
      ),
    );
    const removed = [...previous.current.keys()].some(
      (row) => row.hasAttribute("data-scorecard-round") && !root.contains(row),
    );
    if (removed) {
      for (const animation of animations.current) animation.cancel();
      animations.current.clear();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        for (const [row, top] of rows) {
          const before = previous.current.get(row);
          if (before === undefined || before <= top) continue;
          const animation = row.animate(
            [{ translate: `0 ${before - top}px` }, { translate: "0 0" }],
            { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          );
          animations.current.add(animation);
          animation.onfinish = () => animations.current.delete(animation);
        }
      }
    }
    previous.current = rows;
  });

  useLayoutEffect(
    () => () => {
      for (const animation of animations.current) animation.cancel();
      animations.current.clear();
    },
    [],
  );
}
