import { type RefObject, useEffectEvent, useLayoutEffect, useRef } from "react";
import { getKeyboardViewport, KEYBOARD_VIEWPORT_CHANGE } from "../../PageShell/useKeyboardFreeze";

const PULL_DISTANCE = 120;
const FLICK_DISTANCE = 48;
const FLICK_SPEED = 0.65;
const VELOCITY_WINDOW = 100;
const DIRECTION_DISTANCE = 8;
const INTERACTIVE_TARGETS = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable=false])",
  "[data-dialog-drag-exclude]",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="tablist"]',
].join(",");

function eligibleTarget(target: EventTarget | null, panel: HTMLElement, mouse: boolean) {
  if (!(target instanceof Element) || !panel.contains(target)) return null;
  if (target.closest(INTERACTIVE_TARGETS)) return null;
  const header = panel.querySelector(":scope > header");
  if (mouse && !header?.contains(target)) return null;
  if (!header?.contains(target) && !target.closest(".dialog-body, .dialog-scroll")) return null;

  // Record the nearest owner's boundary at touchstart, never during a swipe.
  for (let owner: Element | null = target; owner; owner = owner.parentElement) {
    if (owner instanceof HTMLElement) {
      const style = getComputedStyle(owner);
      if (/(auto|scroll|overlay)/.test(style.overflowX) && owner.scrollWidth > owner.clientWidth) {
        return null;
      }
      if (
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        owner.scrollHeight > owner.clientHeight
      ) {
        return {
          down: owner.scrollTop <= 0,
          up: owner.scrollHeight - owner.clientHeight - owner.scrollTop <= 1,
        };
      }
    }
    if (owner === panel) break;
  }
  return { down: true, up: true };
}

interface Gesture {
  source: "touch" | "mouse";
  id: number;
  x: number;
  y: number;
  offset: number;
  dragging: boolean;
  eligible: { down: boolean; up: boolean };
  exitDirection: -1 | 1 | null;
  lastY: number;
  direction: number;
  samples: { y: number; time: number }[];
}

/** Native scrolling owns the whole gesture unless it starts at the matching boundary. */
export function useFloatingDialogDismissal(
  panelRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  dismissible: boolean,
  onClose: () => void,
) {
  const permission = useRef(dismissible);
  const cancelRef = useRef<(() => void) | null>(null);
  const close = useEffectEvent(onClose);

  useLayoutEffect(() => {
    permission.current = dismissible;
    if (!dismissible) cancelRef.current?.();
  }, [dismissible]);

  useLayoutEffect(() => {
    const panelElement = panelRef.current;
    if (!enabled || !panelElement) return;
    const panel = panelElement;
    panel.removeAttribute("data-dialog-released");
    panel.removeAttribute("data-dialog-restoring");
    panel.removeAttribute("data-dialog-exit-direction");
    panel.style.removeProperty("--dialog-drag-offset");
    let gesture: Gesture | null = null;
    let capturedPointer: number | null = null;

    function restore(clearOffset = true) {
      if (clearOffset && gesture?.dragging) panel?.setAttribute("data-dialog-restoring", "");
      gesture = null;
      panel?.removeAttribute("data-dialog-dragging");
      if (clearOffset) panel?.style.removeProperty("--dialog-drag-offset");
      if (capturedPointer !== null && panel?.hasPointerCapture(capturedPointer)) {
        panel.releasePointerCapture(capturedPointer);
      }
      capturedPointer = null;
    }
    cancelRef.current = restore;

    function keyboardChanged() {
      if (getKeyboardViewport()) restore();
    }

    function begin(
      source: Gesture["source"],
      id: number,
      x: number,
      y: number,
      time: number,
      target: EventTarget | null,
    ) {
      if (gesture) {
        restore();
        return;
      }
      if (!permission.current || getKeyboardViewport()) return;
      const eligible = eligibleTarget(target, panel, source === "mouse");
      if (!eligible) return;
      panel.removeAttribute("data-dialog-restoring");
      gesture = {
        source,
        id,
        x,
        y,
        offset: 0,
        dragging: false,
        eligible,
        exitDirection: null,
        lastY: y,
        direction: 0,
        samples: [{ y, time }],
      };
    }

    function move(x: number, y: number, time: number) {
      const current = gesture;
      if (!current || !permission.current) return false;
      const deltaX = x - current.x;
      const deltaY = y - current.y;
      if (!current.dragging) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DIRECTION_DISTANCE) return false;
        const exitDirection = deltaY < 0 ? -1 : 1;
        if (
          Math.abs(deltaY) <= Math.abs(deltaX) * 1.2 ||
          !current.eligible[exitDirection === -1 ? "up" : "down"]
        ) {
          restore();
          return false;
        }
        current.exitDirection = exitDirection;
        current.dragging = true;
        panel?.setAttribute("data-dialog-dragging", "");
      }
      if (y !== current.lastY) current.direction = Math.sign(y - current.lastY);
      current.lastY = y;
      current.samples = current.samples.filter((sample) => sample.time >= time - VELOCITY_WINDOW);
      current.samples.push({ y, time });
      current.offset = current.exitDirection === -1 ? Math.min(0, deltaY) : Math.max(0, deltaY);
      panel?.style.setProperty("--dialog-drag-offset", `${current.offset}px`);
      return true;
    }

    function finish(x: number, y: number, time: number) {
      const current = gesture;
      if (!current) return;
      move(x, y, time);
      const first = current.samples[0];
      const elapsed = time - first.time;
      const direction = current.exitDirection ?? 1;
      const travel = current.offset * direction;
      const speed = elapsed > 0 ? ((y - first.y) * direction) / elapsed : 0;
      const dismiss =
        gesture === current &&
        permission.current &&
        current.dragging &&
        current.direction * direction > 0 &&
        travel > Math.abs(x - current.x) * 1.2 &&
        (travel >= PULL_DISTANCE || (travel >= FLICK_DISTANCE && speed >= FLICK_SPEED));
      // Flush the directly manipulated position before resuming CSS transitions.
      panel?.getBoundingClientRect();
      if (dismiss) {
        panel?.setAttribute("data-dialog-released", "");
        if (direction === -1) panel?.setAttribute("data-dialog-exit-direction", "up");
      }
      restore(!dismiss);
      if (dismiss) close();
    }

    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        restore();
        return;
      }
      const touch = event.touches[0];
      begin("touch", touch.identifier, touch.clientX, touch.clientY, event.timeStamp, event.target);
    }

    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) {
        restore();
        return;
      }
      const touch = event.touches[0];
      if (gesture?.source !== "touch" || gesture.id !== touch.identifier) return;
      if (move(touch.clientX, touch.clientY, event.timeStamp)) event.preventDefault();
    }

    function touchEnd(event: TouchEvent) {
      if (gesture?.source !== "touch") return;
      const touch = Array.from(event.changedTouches).find(
        (touch) => touch.identifier === gesture?.id,
      );
      if (touch) finish(touch.clientX, touch.clientY, event.timeStamp);
      else restore();
    }

    function pointerDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
      begin("mouse", event.pointerId, event.clientX, event.clientY, event.timeStamp, event.target);
      if (gesture?.source === "mouse") {
        capturedPointer = event.pointerId;
        panel?.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    }

    function pointerMove(event: PointerEvent) {
      if (gesture?.source !== "mouse" || gesture.id !== event.pointerId) return;
      if (move(event.clientX, event.clientY, event.timeStamp)) event.preventDefault();
    }

    function pointerUp(event: PointerEvent) {
      if (gesture?.source === "mouse" && gesture.id === event.pointerId) {
        finish(event.clientX, event.clientY, event.timeStamp);
      }
    }

    function pointerCancel(event: PointerEvent) {
      if (gesture?.source === "mouse" && gesture.id === event.pointerId) restore();
    }

    function touchCancel() {
      if (gesture?.source === "touch") restore();
    }

    panel.addEventListener("touchstart", touchStart, { passive: true });
    panel.addEventListener("touchmove", touchMove, { passive: false });
    panel.addEventListener("touchend", touchEnd, { passive: true });
    panel.addEventListener("touchcancel", touchCancel);
    panel.addEventListener("pointerdown", pointerDown);
    panel.addEventListener("pointermove", pointerMove);
    panel.addEventListener("pointerup", pointerUp);
    panel.addEventListener("pointercancel", pointerCancel);
    panel.addEventListener("lostpointercapture", pointerCancel);
    window.addEventListener(KEYBOARD_VIEWPORT_CHANGE, keyboardChanged);
    return () => {
      panel.removeEventListener("touchstart", touchStart);
      panel.removeEventListener("touchmove", touchMove);
      panel.removeEventListener("touchend", touchEnd);
      panel.removeEventListener("touchcancel", touchCancel);
      panel.removeEventListener("pointerdown", pointerDown);
      panel.removeEventListener("pointermove", pointerMove);
      panel.removeEventListener("pointerup", pointerUp);
      panel.removeEventListener("pointercancel", pointerCancel);
      panel.removeEventListener("lostpointercapture", pointerCancel);
      window.removeEventListener(KEYBOARD_VIEWPORT_CHANGE, keyboardChanged);
      restore(!panel.hasAttribute("data-dialog-released"));
      panel.removeAttribute("data-dialog-restoring");
      cancelRef.current = null;
    };
  }, [enabled, panelRef]);
}
