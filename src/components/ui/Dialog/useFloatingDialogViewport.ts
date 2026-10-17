import { useLayoutEffect, useState } from "react";
import {
  getKeyboardViewport,
  getVisibleViewport,
  KEYBOARD_VIEWPORT_CHANGE,
} from "../../PageShell/useKeyboardFreeze";

const MIN_BODY_HEIGHT = 96;
const FOCUS_CLEARANCE = 8;

function updateViewportStyle(wrapper: HTMLDivElement) {
  const values = getKeyboardViewport() ?? getVisibleViewport();
  for (const [key, value] of Object.entries(values)) {
    wrapper.style.setProperty(`--dialog-viewport-${key}`, `${value}px`);
  }
}

function revealFocusedControl(panel: HTMLElement) {
  if (getKeyboardViewport()) return;
  const focused = document.activeElement;
  if (
    !(focused instanceof HTMLElement) ||
    !panel.contains(focused) ||
    !focused.matches("input, textarea, select, button, a[href], [contenteditable=true]")
  )
    return;

  const labels = focused instanceof HTMLInputElement ? Array.from(focused.labels ?? []) : [];
  for (let owner = focused.parentElement; owner; owner = owner.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) {
      const bounds = owner.getBoundingClientRect();
      const target = focused.getBoundingClientRect();
      const top = Math.min(target.top, ...labels.map((label) => label.getBoundingClientRect().top));
      const bottom = target.bottom;
      if (bottom > bounds.bottom - FOCUS_CLEARANCE) {
        owner.scrollTop += bottom - bounds.bottom + FOCUS_CLEARANCE;
      }
      if (top < bounds.top + FOCUS_CLEARANCE) {
        owner.scrollTop += top - bounds.top - FOCUS_CLEARANCE;
      }
    }
    if (owner === panel) break;
  }
}

/** Fit the overlay, retaining its unoccluded geometry during Keyboard Freeze. */
export function useFloatingDialogViewport(minBodyHeight = MIN_BODY_HEIGHT) {
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);

  function attachWrapper(node: HTMLDivElement | null) {
    // Resolve the closed position before the wrapper opens its motion/focus gate.
    if (node) {
      updateViewportStyle(node);
      node.getBoundingClientRect();
    }
    setWrapper(node);
  }

  useLayoutEffect(() => {
    if (!wrapper) return;
    const viewport = window.visualViewport;
    const panelElement = wrapper.firstElementChild;
    if (!(panelElement instanceof HTMLElement)) return;
    const panel = panelElement;
    let frame: number | undefined;

    function reveal() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        revealFocusedControl(panel);
      });
    }

    function measure() {
      if (!wrapper) return;
      const header = panel.querySelector<HTMLElement>(":scope > header");
      const actions = panel.querySelector<HTMLElement>(":scope > footer");
      const fixedHeight = (header?.offsetHeight ?? 0) + (actions?.offsetHeight ?? 0);
      const whole = wrapper.clientHeight < fixedHeight + minBodyHeight;
      const previous = panel.dataset.dialogScroll;
      panel.dataset.dialogScroll = whole ? "whole" : "body";
      if (previous === "whole" && !whole) panel.scrollTop = 0;
      reveal();
    }

    function update() {
      if (!wrapper) return;
      updateViewportStyle(wrapper);
      measure();
    }
    update();
    const observer = new ResizeObserver(measure);
    function observeFixedRegions() {
      observer.disconnect();
      if (wrapper) observer.observe(wrapper);
      observer.observe(panel);
      for (const region of panel.querySelectorAll(":scope > header, :scope > footer")) {
        observer.observe(region);
      }
      measure();
    }
    observeFixedRegions();
    const structureObserver = new MutationObserver(observeFixedRegions);
    structureObserver.observe(panel, { childList: true });
    function preserveZoom(event: TouchEvent) {
      // Headless UI's iOS document lock cancels moves without a scroll owner.
      // Internal pinch gestures must stay native, even in short content.
      if (event.touches.length > 1) event.stopPropagation();
    }
    panel.addEventListener("touchmove", preserveZoom, { passive: true });
    panel.addEventListener("focusin", reveal);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener(KEYBOARD_VIEWPORT_CHANGE, update);
    return () => {
      observer.disconnect();
      structureObserver.disconnect();
      panel.removeEventListener("touchmove", preserveZoom);
      panel.removeEventListener("focusin", reveal);
      if (frame !== undefined) cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener(KEYBOARD_VIEWPORT_CHANGE, update);
    };
  }, [wrapper, minBodyHeight]);

  return { wrapperRef: attachWrapper, wrapper };
}
