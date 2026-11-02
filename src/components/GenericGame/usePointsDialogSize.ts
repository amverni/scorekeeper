import { useLayoutEffect, useState } from "react";

export function usePointsDialogSize() {
  const [form, setForm] = useState<HTMLFormElement | null>(null);

  useLayoutEffect(() => {
    if (!form) return;
    const panel = form.closest<HTMLElement>(".dialog-panel");
    const entries = Array.from(form.querySelectorAll<HTMLElement>(".points-entry"));
    if (!panel || entries.length === 0) return;
    let frame: number | undefined;

    function measure() {
      if (!panel) return;
      let preferredHeight = 0;
      for (const entry of entries) {
        const layout = entry.querySelector<HTMLElement>(".points-entry-layout");
        const summary = entry.querySelector<HTMLElement>(".points-summary");
        const key = entry.querySelector<HTMLElement>(".points-key");
        if (!layout || !summary || !key) continue;
        const style = getComputedStyle(layout);
        const width =
          layout.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const keySize = Math.min(parseFloat(getComputedStyle(key).maxHeight), width / 3.4);
        // Four key rows plus gaps and press clearance, matching the keypad's size budget.
        preferredHeight = Math.max(
          preferredHeight,
          summary.scrollHeight +
            keySize * 4.5 +
            parseFloat(style.rowGap) +
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom),
        );
      }
      const chromeHeight = panel.offsetHeight - entries[0].offsetHeight;
      panel.style.setProperty(
        "--points-preferred-height",
        `${Math.ceil(chromeHeight + preferredHeight)}px`,
      );
    }

    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    for (const entry of entries) {
      observer.observe(entry);
      const summary = entry.querySelector(".points-summary");
      if (summary) observer.observe(summary);
    }
    for (const region of panel.querySelectorAll(":scope > header, :scope > footer")) {
      observer.observe(region);
    }
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      panel.style.removeProperty("--points-preferred-height");
    };
  }, [form]);

  return setForm;
}
