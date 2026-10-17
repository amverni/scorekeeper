import { useLayoutEffect } from "react";
import { lockPageBackground } from "./lockPageBackground";

// Browser chrome changes alone should not be mistaken for a software keyboard.
const KEYBOARD_HEIGHT = 120;
const FOCUS_CLEARANCE = 8;
export const KEYBOARD_VIEWPORT_CHANGE = "scorekeeper:keyboard-viewport";

interface KeyboardViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  "layout-width": number;
  "layout-height": number;
}

let frozenViewport: KeyboardViewport | null = null;

export function getKeyboardViewport() {
  return frozenViewport;
}

export function getVisibleViewport(): KeyboardViewport {
  const viewport = window.visualViewport;
  const layout = document.documentElement;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? layout.clientWidth,
    height: viewport?.height ?? layout.clientHeight,
    "layout-width": layout.clientWidth,
    "layout-height": layout.clientHeight,
  };
}

function keyboardInput(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLInputElement) {
    return (
      !element.disabled &&
      !element.readOnly &&
      element.inputMode !== "none" &&
      /^(text|search|email|password|tel|url|number)$/.test(element.type)
    );
  }
  return (
    (element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/** Reveal the active input, then freeze content until the software keyboard closes. */
export function useKeyboardFreeze() {
  useLayoutEffect(() => {
    if (!window.visualViewport || navigator.maxTouchPoints === 0) return;
    const viewport = window.visualViewport;
    const html = document.documentElement;
    let restingViewport = getVisibleViewport();
    let releaseBackground: (() => void) | undefined;
    let offset = 0;
    let revealedInput: HTMLElement | null = null;
    let frame: number | undefined;
    const positions = new Map<HTMLElement, { top: number; left: number }>();
    const previousOffset = html.style.getPropertyValue("--keyboard-reveal-y");

    function rememberScrollOwners() {
      for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
        if (positions.has(element)) continue;
        const style = getComputedStyle(element);
        if (!/(auto|scroll|overlay|hidden)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        positions.set(element, { top: element.scrollTop, left: element.scrollLeft });
      }
    }
    const observer = new MutationObserver(rememberScrollOwners);

    function revealInput() {
      if (!frozenViewport) return;
      const input = document.activeElement;
      if (!keyboardInput(input)) return;
      const panel = input.closest(".dialog-panel");
      if (
        panel
          ?.getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSTransition && animation.transitionProperty === "transform",
          )
      )
        return;
      // Reveal clipped fields within their existing scroll owner before moving
      // the whole view. These positions become the new frozen positions.
      for (
        let owner = input.parentElement;
        owner && owner !== document.body;
        owner = owner.parentElement
      ) {
        if (!positions.has(owner) || owner.scrollHeight <= owner.clientHeight) continue;
        const bounds = owner.getBoundingClientRect();
        const target = input.getBoundingClientRect();
        if (target.bottom > bounds.bottom - FOCUS_CLEARANCE) {
          owner.scrollTop += target.bottom - bounds.bottom + FOCUS_CLEARANCE;
        } else if (target.top < bounds.top + FOCUS_CLEARANCE) {
          owner.scrollTop += target.top - bounds.top - FOCUS_CLEARANCE;
        }
        positions.set(owner, { top: owner.scrollTop, left: owner.scrollLeft });
      }
      const target = input.getBoundingClientRect();
      const top = viewport.offsetTop + FOCUS_CLEARANCE;
      const bottom = viewport.offsetTop + viewport.height - FOCUS_CLEARANCE;
      if (target.bottom > bottom) offset -= target.bottom - bottom;
      else if (target.top < top) offset += top - target.top;
      html.style.setProperty("--keyboard-reveal-y", `${offset}px`);
      revealedInput = input;
    }

    function endFreeze() {
      if (!releaseBackground) return;
      observer.disconnect();
      frozenViewport = null;
      positions.clear();
      html.removeAttribute("data-keyboard-frozen");
      if (previousOffset) html.style.setProperty("--keyboard-reveal-y", previousOffset);
      else html.style.removeProperty("--keyboard-reveal-y");
      offset = 0;
      revealedInput = null;
      releaseBackground();
      releaseBackground = undefined;
      window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_CHANGE));
    }

    function update() {
      if (viewport.scale !== 1) {
        if (
          frozenViewport &&
          restingViewport.height - viewport.height * viewport.scale <= KEYBOARD_HEIGHT
        ) {
          endFreeze();
        } else if (frozenViewport && document.activeElement !== revealedInput) {
          revealInput();
        }
        return;
      }
      const visible = getVisibleViewport();
      if (visible.width !== restingViewport.width) {
        restingViewport = {
          ...visible,
          top: 0,
          height: visible["layout-height"],
        };
        if (frozenViewport) frozenViewport = restingViewport;
      }
      const focused = keyboardInput(document.activeElement);
      const keyboardOpen =
        (focused || frozenViewport !== null) &&
        restingViewport.height - visible.height > KEYBOARD_HEIGHT;
      if (!keyboardOpen) {
        endFreeze();
        if (!focused) restingViewport = visible;
        return;
      }
      if (!releaseBackground) {
        frozenViewport = restingViewport;
        releaseBackground = lockPageBackground();
        rememberScrollOwners();
        observer.observe(document.body, { childList: true, subtree: true });
        html.setAttribute("data-keyboard-frozen", "");
      }
      window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_CHANGE));
      revealInput();
    }

    function scheduleUpdate() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        update();
      });
    }

    function preventScroll(event: Event) {
      if (!frozenViewport) return;
      const element =
        event.target instanceof HTMLElement ? event.target : document.scrollingElement;
      if (!(element instanceof HTMLElement)) return;
      const position = positions.get(element);
      if (
        position &&
        (element.scrollTop !== position.top || element.scrollLeft !== position.left)
      ) {
        element.scrollTo({ top: position.top, left: position.left, behavior: "instant" });
      }
    }

    function preventTouchScroll(event: TouchEvent) {
      if (!frozenViewport || event.touches.length !== 1) return;
      if (
        event.target instanceof Element &&
        keyboardInput(event.target.closest("input, textarea, [contenteditable]"))
      )
        return;
      event.preventDefault();
    }

    function preventWheelScroll(event: WheelEvent) {
      if (frozenViewport && !event.ctrlKey) event.preventDefault();
    }

    document.addEventListener("focusin", scheduleUpdate);
    document.addEventListener("focusout", scheduleUpdate);
    document.addEventListener("transitionend", scheduleUpdate);
    document.addEventListener("transitioncancel", scheduleUpdate);
    document.addEventListener("scroll", preventScroll, true);
    document.addEventListener("touchmove", preventTouchScroll, { passive: false });
    document.addEventListener("wheel", preventWheelScroll, { passive: false });
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      endFreeze();
      document.removeEventListener("focusin", scheduleUpdate);
      document.removeEventListener("focusout", scheduleUpdate);
      document.removeEventListener("transitionend", scheduleUpdate);
      document.removeEventListener("transitioncancel", scheduleUpdate);
      document.removeEventListener("scroll", preventScroll, true);
      document.removeEventListener("touchmove", preventTouchScroll);
      document.removeEventListener("wheel", preventWheelScroll);
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);
}
