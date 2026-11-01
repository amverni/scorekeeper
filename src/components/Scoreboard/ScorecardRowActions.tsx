import { Trash2 } from "lucide-react";
import { type RefObject, useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";

interface RowActionTarget {
  roundNumber: number;
  side: "left" | "right";
  row: HTMLElement;
  space: HTMLElement;
  width: number;
  onClose: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}

type RowAction = RowActionTarget &
  (
    | { state: "tracking" | "exposed"; armed: boolean }
    | { state: "closing" | "settling" | "confirming"; armed: false }
  );

interface ScorecardRowActionsProps {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  confirming: boolean;
  onDelete: (roundNumber: number) => void;
}

function focusRoundControl(root: HTMLElement | null, roundNumber: number) {
  root
    ?.querySelector<HTMLButtonElement>(`button[data-hold-round="${roundNumber}"]`)
    ?.focus({ preventScroll: true });
}

export function ScorecardRowActions({
  rootRef,
  enabled,
  confirming,
  onDelete,
}: ScorecardRowActionsProps) {
  const [action, setAction] = useState<RowAction | null>(null);
  const getOnDelete = useEffectEvent(() => onDelete);
  const isConfirming = useEffectEvent(() => confirming);
  const closeConfirmation = useEffectEvent(() => {
    if (action?.state === "confirming") action.onClose();
  });

  useEffect(() => {
    if (confirming) return;
    // Let modal background unlocking restore its captured scroll positions first.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(closeConfirmation);
    });
    return () => cancelAnimationFrame(frame);
  }, [confirming]);

  useEffect(() => {
    const root = rootRef.current;
    const grid = root?.querySelector<HTMLElement>(".scoreboard");
    if (!root || !grid) return;
    let pending: {
      x: number;
      y: number;
      scrollLeft: number;
      atLeft: boolean;
      atRight: boolean;
      cell: HTMLElement;
      row: HTMLElement;
      onDelete: () => void;
      side: "left" | "right" | null;
      scrolling: boolean;
      moved: boolean;
      initialDistance: number;
      dismissOnTap: boolean;
    } | null = null;
    let current: RowAction | null = null;
    let closing: RowAction | null = null;
    let animationFrame: number | null = null;
    let lastScrollLeft = root.scrollLeft;
    let lastScrollTop = root.scrollTop;
    let pointerId: number | null = null;
    let suppressClick = false;
    let viewportWidth = 0;
    let contentWidth = 0;

    function positionRow(row: HTMLElement, offset: number) {
      row.style.setProperty("--scorecard-row-offset", `${offset}px`);
      if (offset === 0) delete row.dataset.scorecardRowAction;
    }

    function clear() {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      const row = current?.row ?? closing?.row ?? pending?.row;
      pending = null;
      current = null;
      closing = null;
      pointerId = null;
      if (row) positionRow(row, 0);
      setAction(null);
    }

    function settle(width: number, finalState: "exposed" | "confirming" = "exposed") {
      if (!current || !root) return;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      const from = current.width;
      closing = {
        ...current,
        state: finalState === "confirming" ? "confirming" : width === 0 ? "closing" : "settling",
        armed: false,
      };
      current = null;
      pending = null;
      setAction(closing);

      function draw(value: number) {
        if (!closing) return;
        const signedWidth = closing.side === "left" ? -value : value;
        positionRow(closing.row, signedWidth);
        closing.space.style.setProperty("--scorecard-action-width", `${value}px`);
        closing = { ...closing, width: value };
        setAction(closing);
      }

      function complete() {
        if (!closing) return;
        animationFrame = null;
        if (width === 0) {
          clear();
          return;
        }
        current = { ...closing, width, state: finalState, armed: false };
        closing = null;
        setAction(current);
      }

      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        Math.abs(from - width) <= 1
      ) {
        draw(width);
        complete();
        return;
      }
      const started = performance.now();
      const duration = Math.min(900, 180 + Math.abs(width - from) * 2);
      function animate(now: number) {
        if (!closing) return;
        const progress = Math.min(1, (now - started) / duration);
        draw(from + (width - from) * (1 - (1 - progress) ** 3));
        if (progress === 1) complete();
        else animationFrame = requestAnimationFrame(animate);
      }
      animationFrame = requestAnimationFrame(animate);
    }

    function closeAnimated() {
      if (!current && closing) {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        current = closing;
        closing = null;
      }
      if (current && !current.row.isConnected) clear();
      else settle(0);
    }

    function requestConfirmation() {
      if (!current && closing?.state === "settling") {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        current = closing;
        closing = null;
      }
      if (!current || current.state === "confirming" || !root) return;
      const requestDelete = current.onDelete;
      current = { ...current, state: "confirming", armed: false };
      pending = null;
      pointerId = null;
      setAction(current);
      focusRoundControl(root, current.roundNumber);
      settle(root.clientWidth, "confirming");
      requestDelete();
    }

    function layout() {
      if (!root || !grid) return;
      const width = root.clientWidth;
      const gridWidth = root.scrollWidth;
      if (width === viewportWidth && gridWidth === contentWidth) return;
      viewportWidth = width;
      contentWidth = gridWidth;
      root.style.setProperty("--scorecard-reveal-capacity", `${width}px`);
      root.style.setProperty("--scorecard-column-offset", `${root.scrollLeft}px`);
      const visible = current ?? closing;
      if (visible?.state === "confirming") {
        current = visible;
        closing = null;
        settle(width, "confirming");
      } else if (visible?.state === "closing") closeAnimated();
      else clear();
    }

    function start(target: EventTarget | null, x: number, y: number) {
      if (!enabled || isConfirming()) return;
      if (target instanceof Element && target.closest(".scorecard-row-action")) {
        suppressClick = false;
        pending = null;
        return;
      }
      if (closing) {
        suppressClick = true;
        if (target instanceof Element && target.closest("[data-action-round]")) closeAnimated();
        return;
      }
      suppressClick = false;
      if (!(target instanceof Element)) {
        clear();
        return;
      }
      const cell = target.closest<HTMLElement>("[data-action-round]");
      const control = target.closest("button, a, input, select, textarea");
      if (!cell || !root?.contains(cell) || (control && !control.hasAttribute("data-hold-round"))) {
        clear();
        return;
      }
      const row = cell.closest<HTMLElement>("[data-scorecard-round]");
      if (!row) throw new Error("Missing saved Round");
      const deleteHandler = getOnDelete();
      const roundNumber = Number(cell.dataset.actionRound);
      const previous = current?.row === row ? current : null;
      suppressClick = current !== null;
      pending = {
        x,
        y,
        cell,
        row,
        onDelete: () => deleteHandler(roundNumber),
        scrollLeft: root.scrollLeft,
        atLeft: root.scrollLeft <= 1,
        atRight: root.scrollWidth - root.clientWidth - root.scrollLeft <= 1,
        side: previous?.side ?? null,
        scrolling: false,
        moved: false,
        initialDistance: previous?.width ?? 0,
        dismissOnTap: current !== null,
      };
    }

    function reveal(
      row: HTMLElement,
      roundNumber: number,
      side: "left" | "right",
      distance: number,
      onDelete: () => void,
    ) {
      if (!root) return;
      const space = row.querySelector<HTMLElement>(`[data-scorecard-action="${side}"]`);
      if (!space) throw new Error("Missing saved Round action space");
      const width = Math.min(root.clientWidth, distance);
      space.style.setProperty("--scorecard-action-width", `${width}px`);
      if (width > 0) row.dataset.scorecardRowAction = "";
      else delete row.dataset.scorecardRowAction;
      row.style.setProperty("--scorecard-row-offset", `${side === "left" ? -width : width}px`);
      current =
        width > 0
          ? {
              row,
              roundNumber,
              side,
              space,
              width,
              state: "tracking",
              armed: distance >= Math.max(120, root.clientWidth * 0.4),
              onClose: closeAnimated,
              onConfirm: requestConfirmation,
              onDelete,
            }
          : null;
      setAction(current);
    }

    function move(x: number, y: number, mouse: boolean) {
      if (!pending || !root) return false;
      const dx = x - pending.x;
      const dy = y - pending.y;
      if (!pending.moved) {
        if (Math.hypot(dx, dy) <= 8) return false;
        pending.moved = true;
        suppressClick = true;
        if (current && current.row !== pending.row) {
          positionRow(current.row, 0);
          current = null;
          setAction(null);
        }
        if (Math.abs(dy) >= Math.abs(dx)) {
          clear();
          return false;
        }
      }
      if (!pending.side && !pending.scrolling) {
        if (dx > 0 && pending.atLeft) pending.side = "left";
        else if (dx < 0 && pending.atRight) pending.side = "right";
        else pending.scrolling = true;
      }
      if (pending.scrolling) {
        if (mouse) root.scrollLeft = pending.scrollLeft - dx;
        return mouse;
      }
      if (!pending.side) return false;
      if (pending.row.dataset.scorecardRound !== pending.cell.dataset.actionRound) {
        clear();
        return false;
      }
      const distance = Math.max(0, pending.initialDistance + (pending.side === "left" ? dx : -dx));
      reveal(
        pending.row,
        Number(pending.cell.dataset.actionRound),
        pending.side,
        distance,
        pending.onDelete,
      );
      return true;
    }

    function finish() {
      const dismiss = pending?.dismissOnTap && !pending.moved;
      pending = null;
      if (dismiss) {
        closeAnimated();
        return;
      }
      if (!current || !root) return;
      if (current.armed) {
        requestConfirmation();
      } else settle(current.width < 32 ? 0 : 64);
    }

    function wheel() {
      if (!isConfirming()) clear();
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
      if (event.target instanceof Element && event.target.closest(".scorecard-row-action")) {
        return;
      }
      if (current) event.preventDefault();
      finish();
    }
    function click(event: MouseEvent) {
      if (
        event.detail === 0 &&
        (current || closing) &&
        event.target instanceof Element &&
        event.target.closest("[data-scorecard-round]") &&
        !event.target.closest(".scorecard-row-action")
      ) {
        closeAnimated();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function outside(event: PointerEvent) {
      if (isConfirming()) return;
      if (event.target instanceof Node && !root?.contains(event.target)) clear();
    }
    function cancelGesture() {
      if (current?.state !== "confirming" && closing?.state !== "confirming") clear();
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || isConfirming()) return;
      const visible = current ?? closing;
      if (
        visible &&
        root?.querySelector(".scorecard-row-action")?.contains(document.activeElement)
      ) {
        focusRoundControl(root, visible.roundNumber);
      }
      clear();
    }
    function visibility() {
      if (document.hidden) cancelGesture();
    }
    function scroll() {
      if (!root) return;
      const left = root.scrollLeft;
      const top = root.scrollTop;
      if (left === lastScrollLeft && top === lastScrollTop) return;
      lastScrollLeft = left;
      lastScrollTop = top;
      root.style.setProperty("--scorecard-column-offset", `${left}px`);
      const visible = current ?? closing;
      if (!pending?.scrolling && visible?.state !== "confirming" && visible?.state !== "closing")
        clear();
    }

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(root);
    observer.observe(grid);
    root.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp);
    root.addEventListener("touchstart", touchStart, { passive: true });
    root.addEventListener("touchmove", touchMove, { passive: false });
    root.addEventListener("touchend", touchEnd, { passive: false });
    root.addEventListener("touchcancel", clear);
    root.addEventListener("pointercancel", clear);
    root.addEventListener("scroll", scroll);
    root.addEventListener("wheel", wheel, { passive: true });
    root.addEventListener("click", click, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("resize", cancelGesture);
    return () => {
      observer.disconnect();
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
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("resize", cancelGesture);
    };
  }, [rootRef, enabled]);

  if (!enabled || !action) return null;
  return createPortal(
    <Button
      type="button"
      variant="plain"
      aria-label={`Delete Round ${action.roundNumber}`}
      disabled={action.state === "closing" || action.state === "confirming"}
      className={[
        "scorecard-row-action min-h-11 overflow-hidden text-white active:scale-100! disabled:opacity-100! data-[focus]:outline-offset-[-3px]",
      ].join(" ")}
      onClick={() => {
        action.onConfirm();
      }}
    >
      <span className="scorecard-row-action__surface">
        <Trash2 className="size-5 shrink-0" aria-hidden />
      </span>
      {action.armed && <span className="sr-only">Release to confirm deletion</span>}
    </Button>,
    action.space,
  );
}
