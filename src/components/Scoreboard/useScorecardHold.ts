import { type RefObject, useEffect, useEffectEvent } from "react";

/** Saved targets opt in with data-hold-round; native scrolling remains unclaimed. */
export function useScorecardHold(
  rootRef: RefObject<HTMLElement | null>,
  onHold: (cell: HTMLElement, origin: Element) => void,
) {
  const openEditor = useEffectEvent(onHold);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let pending: {
      pointerId: number;
      x: number;
      y: number;
      cell: HTMLElement;
    } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressClick = false;

    function cancel() {
      clearTimeout(timer);
      pending = null;
    }
    function cancelNavigation() {
      if (pending) suppressClick = true;
      cancel();
    }
    function start(event: PointerEvent) {
      suppressClick = false;
      if (pending || !event.isPrimary || event.button !== 0) {
        cancel();
        return;
      }
      const origin = event.target;
      if (!(origin instanceof Element)) return;
      const cell = origin.closest<HTMLElement>("[data-hold-round]");
      if (!cell || !root?.contains(cell)) return;
      const control = origin.closest("button, a, input, select, textarea");
      if (control && control !== cell) return;
      pending = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cell,
      };
      timer = setTimeout(() => {
        if (!pending || !cell.isConnected) return;
        suppressClick = true;
        cancel();
        // Cells are not tab stops. Restore dialog focus to their Round's keyboard control.
        root
          ?.querySelector<HTMLButtonElement>(`button[data-hold-round="${cell.dataset.holdRound}"]`)
          ?.focus({ preventScroll: true });
        openEditor(cell, origin);
      }, 600);
    }
    function move(event: PointerEvent) {
      if (
        pending?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8
      ) {
        cancelNavigation();
      }
    }
    function release(event: PointerEvent) {
      if (pending?.pointerId === event.pointerId) cancel();
    }
    function cancelPointer(event: PointerEvent) {
      if (pending?.pointerId === event.pointerId) cancelNavigation();
    }
    function click(event: MouseEvent) {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function contextMenu(event: MouseEvent) {
      if (pending || suppressClick) event.preventDefault();
    }
    function visibility() {
      if (document.hidden) cancel();
    }

    document.addEventListener("pointerdown", start, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    document.addEventListener("lostpointercapture", cancelPointer, true);
    document.addEventListener("click", click, true);
    root.addEventListener("contextmenu", contextMenu);
    root.addEventListener("scroll", cancelNavigation, true);
    root.addEventListener("wheel", cancelNavigation, { passive: true });
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", cancelPointer, true);
      document.removeEventListener("lostpointercapture", cancelPointer, true);
      document.removeEventListener("click", click, true);
      root.removeEventListener("contextmenu", contextMenu);
      root.removeEventListener("scroll", cancelNavigation, true);
      root.removeEventListener("wheel", cancelNavigation);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [rootRef]);
}
