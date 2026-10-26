import { Trash2 } from "lucide-react";
import { type RefObject, useEffect, useEffectEvent, useState } from "react";
import { Button } from "../ui";

interface RowAction {
  roundNumber: number;
  side: "left" | "right";
  top: number;
  height: number;
  left: number;
  width: number;
  armed: boolean;
}

interface ScorecardRowActionsProps {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onDelete: (roundNumber: number) => void;
}

function focusRoundControl(root: HTMLElement | null, roundNumber: number) {
  root
    ?.querySelector<HTMLButtonElement>(`button[data-hold-round="${roundNumber}"]`)
    ?.focus({ preventScroll: true });
}

export function ScorecardRowActions({ rootRef, enabled, onDelete }: ScorecardRowActionsProps) {
  const [action, setAction] = useState<RowAction | null>(null);
  const requestDelete = useEffectEvent(onDelete);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    let pending: {
      x: number;
      y: number;
      scrollLeft: number;
      atLeft: boolean;
      atRight: boolean;
      cell: HTMLElement;
      side: "left" | "right" | null;
      scrolling: boolean;
    } | null = null;
    let current: RowAction | null = null;
    let pointerId: number | null = null;
    let suppressClick = false;

    function clear() {
      pending = null;
      current = null;
      pointerId = null;
      setAction(null);
    }

    function start(target: EventTarget | null, x: number, y: number) {
      if (target instanceof Element && target.closest(".scorecard-row-action")) {
        suppressClick = false;
        pending = null;
        current = null;
        return;
      }
      clear();
      suppressClick = false;
      if (!(target instanceof Element)) return;
      const cell = target.closest<HTMLElement>("[data-action-round]");
      const control = target.closest("button, a, input, select, textarea");
      if (!cell || !root?.contains(cell) || (control && !control.hasAttribute("data-hold-round"))) {
        return;
      }
      pending = {
        x,
        y,
        cell,
        scrollLeft: root.scrollLeft,
        atLeft: root.scrollLeft <= 1,
        atRight: root.scrollWidth - root.clientWidth - root.scrollLeft <= 1,
        side: null,
        scrolling: false,
      };
    }

    function move(x: number, y: number, mouse: boolean) {
      if (!pending || !root) return false;
      const dx = x - pending.x;
      const dy = y - pending.y;
      if (!pending.side && !pending.scrolling) {
        if (Math.hypot(dx, dy) <= 8) return false;
        suppressClick = true;
        if (Math.abs(dy) >= Math.abs(dx)) {
          pending = null;
          return false;
        }
        if (dx > 0 && pending.atLeft) pending.side = "left";
        else if (dx < 0 && pending.atRight) pending.side = "right";
        else pending.scrolling = true;
      }
      if (pending.scrolling) {
        if (mouse) root.scrollLeft = pending.scrollLeft - dx;
        return mouse;
      }
      if (!pending.side) return false;
      const distance = Math.max(0, pending.side === "left" ? dx : -dx);
      const bounds = root.getBoundingClientRect();
      const cellBounds = pending.cell.getBoundingClientRect();
      const width = Math.min(root.clientWidth, distance);
      current = {
        roundNumber: Number(pending.cell.dataset.actionRound),
        side: pending.side,
        top: cellBounds.top - bounds.top - root.clientTop + root.scrollTop,
        height: cellBounds.height,
        left:
          root.scrollLeft + (pending.side === "left" ? 0 : root.clientWidth - Math.max(44, width)),
        width: Math.max(44, width),
        armed: distance >= Math.max(120, root.clientWidth * 0.4),
      };
      setAction(distance >= 16 ? current : null);
      if (distance < 16) current = null;
      return true;
    }

    function finish() {
      pending = null;
      if (!current || !root) return;
      if (current.armed) {
        const roundNumber = current.roundNumber;
        clear();
        focusRoundControl(root, roundNumber);
        requestDelete(roundNumber);
      } else {
        current = {
          ...current,
          width: 64,
          left: root.scrollLeft + (current.side === "left" ? 0 : root.clientWidth - 64),
        };
        setAction(current);
      }
    }

    function pointerDown(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      if (!event.isPrimary || event.button !== 0) {
        clear();
        return;
      }
      start(event.target, event.clientX, event.clientY);
      pointerId = event.pointerId;
    }
    function pointerMove(event: PointerEvent) {
      if (event.pointerId === pointerId && move(event.clientX, event.clientY, true)) {
        event.preventDefault();
      }
    }
    function pointerUp(event: PointerEvent) {
      if (event.pointerId === pointerId) {
        pointerId = null;
        finish();
      }
    }
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        clear();
        return;
      }
      const touch = event.touches[0];
      start(event.target, touch.clientX, touch.clientY);
    }
    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) {
        clear();
        return;
      }
      const touch = event.touches[0];
      if (move(touch.clientX, touch.clientY, false)) event.preventDefault();
    }
    function touchEnd(event: TouchEvent) {
      if (current) event.preventDefault();
      finish();
    }
    function click(event: MouseEvent) {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root?.contains(event.target)) clear();
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (
        current &&
        root?.querySelector(".scorecard-row-action")?.contains(document.activeElement)
      ) {
        focusRoundControl(root, current.roundNumber);
      }
      clear();
    }
    function visibility() {
      if (document.hidden) clear();
    }
    function scroll() {
      // Native column scrolling never graduates into an action in the same gesture.
      if (!pending?.scrolling) clear();
    }

    root.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp);
    root.addEventListener("touchstart", touchStart, { passive: true });
    root.addEventListener("touchmove", touchMove, { passive: false });
    root.addEventListener("touchend", touchEnd, { passive: false });
    root.addEventListener("touchcancel", clear);
    root.addEventListener("pointercancel", clear);
    root.addEventListener("scroll", scroll);
    root.addEventListener("wheel", clear, { passive: true });
    root.addEventListener("click", click, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", clear);
    window.addEventListener("resize", clear);
    return () => {
      clear();
      root.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      root.removeEventListener("touchstart", touchStart);
      root.removeEventListener("touchmove", touchMove);
      root.removeEventListener("touchend", touchEnd);
      root.removeEventListener("touchcancel", clear);
      root.removeEventListener("pointercancel", clear);
      root.removeEventListener("scroll", scroll);
      root.removeEventListener("wheel", clear);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", clear);
      window.removeEventListener("resize", clear);
    };
  }, [rootRef, enabled]);

  if (!enabled || !action) return null;
  return (
    <Button
      type="button"
      variant="plain"
      aria-label={`Delete Round ${action.roundNumber}`}
      className={[
        "scorecard-row-action absolute z-1 min-h-11 overflow-hidden rounded-none bg-pt-red-500 text-white active:scale-100",
        action.armed ? "scorecard-row-action--armed" : "",
      ].join(" ")}
      style={{ top: action.top, left: action.left, width: action.width, height: action.height }}
      onClick={() => {
        setAction(null);
        focusRoundControl(rootRef.current, action.roundNumber);
        onDelete(action.roundNumber);
      }}
    >
      <Trash2 className="size-5 shrink-0" aria-hidden />
      {action.armed && <span className="sr-only">Release to confirm deletion</span>}
    </Button>
  );
}
