import { DialogPanel, type DialogProps, Dialog as HeadlessDialog } from "@headlessui/react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./Dialog.css";
import { DialogHeader } from "./DialogHeader";
import { DialogScrollArea } from "./DialogScrollArea";

interface AppDialogProps extends Omit<DialogProps<"div">, "children"> {
  children?: ReactNode;
  afterLeave?: () => void;
  dismissible?: boolean;
  presentation?: "drawer" | "floating";
  sizing?: "content" | "workspace";
  header?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  readyToOpen?: boolean;
}

const panelClasses = [
  "dialog-panel",
  "relative",
  "isolate",
  "w-[90vw]",
  "max-w-lg",
  "flex",
  "flex-col",
  "rounded-t-2xl",
].join(" ");
const wrapperClasses = [
  "fixed",
  "inset-0",
  "z-10",
  "flex",
  "items-end",
  "justify-center",
  "pl-(--safe-area-inset-left)",
  "pr-(--safe-area-inset-right)",
].join(" ");

const DISMISS_THRESHOLD = 0.3;

function isVerticallyScrollable(element: HTMLElement) {
  const overflowY = window.getComputedStyle(element).overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight
  );
}

function getEventTargetElement(target: EventTarget | null) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function findNearestVerticalScroller(target: EventTarget | null, contentNode: HTMLDivElement) {
  let element = getEventTargetElement(target);

  while (element && element !== contentNode) {
    if (element instanceof HTMLElement && isVerticallyScrollable(element)) return element;
    element = element.parentElement;
  }

  return contentNode;
}

/**
 * Shared accessible modal boundary. Floating consumers use fixed header/actions
 * around a bounded scrolling body; the drawer default remains during migration.
 */
export function Dialog(props: AppDialogProps) {
  const {
    children,
    open,
    onClose,
    className,
    afterLeave,
    dismissible = true,
    presentation = "drawer",
    sizing = "content",
    header,
    actions,
    onBack,
    readyToOpen = true,
    ...rest
  } = props;
  const floating = presentation === "floating";
  const [rendered, setRendered] = useState(Boolean(open && readyToOpen));
  if (open && readyToOpen && !rendered) setRendered(true);

  const mergedPanelClasses = [
    panelClasses,
    floating && "dialog-panel-floating",
    floating && sizing === "workspace" && "dialog-panel-workspace",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open || !rendered) return;
    let cancelled = false;
    // Native transitions can reverse before entry finishes. Keep the focus trap
    // mounted until both surfaces settle; reopening cancels this removal.
    const animations = [
      ...(panelRef.current?.getAnimations() ?? []),
      ...(backdropRef.current?.getAnimations() ?? []),
    ];
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (cancelled) return;
      setRendered(false);
      afterLeave?.();
    });
    return () => {
      cancelled = true;
    };
  }, [open, rendered, afterLeave]);

  // Mutable drag state kept in a ref so React handlers can share it
  // without causing re-renders.
  const drag = useRef({
    startX: 0,
    startY: 0,
    offset: 0,
    active: false,
    decided: false,
    source: null as "handle" | "content" | null,
  });

  const applyOffset = useCallback((y: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (y < 0) {
      // Dragging up — stretch effect with rubber-band resistance
      const stretch = Math.sqrt(Math.abs(y)) * 0.003;
      drag.current.offset = 0;
      panel.style.transformOrigin = "bottom";
      panel.style.transform = `scaleY(${1 + stretch})`;
    } else {
      drag.current.offset = y;
      panel.style.transformOrigin = "";
      panel.style.transform = `translateY(${y}px)`;
    }
    panel.style.transition = "none";
    panel.style.userSelect = "none";
  }, []);

  const finishGesture = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const d = drag.current;
    const threshold = panel.offsetHeight * DISMISS_THRESHOLD;

    if (dismissible && d.offset > threshold) {
      panel.style.transition = "transform 200ms ease-out";
      panel.style.transform = `translateY(${panel.offsetHeight}px)`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onClose?.(false);
      };
      panel.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 250);
    } else {
      panel.style.transition = "transform 200ms ease-out";
      panel.style.transform = "translateY(0) scaleY(1)";
      panel.addEventListener(
        "transitionend",
        () => {
          panel.style.transform = "";
          panel.style.transition = "";
          panel.style.transformOrigin = "";
          panel.style.userSelect = "";
        },
        { once: true },
      );
    }

    d.active = false;
    d.decided = false;
    d.source = null;
    d.offset = 0;
  }, [dismissible, onClose]);

  // ── Handle bar: pointer events ──────────────────────────────
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!dismissible || e.button !== 0) return;
      e.preventDefault();
      const d = drag.current;
      d.startY = e.clientY;
      d.offset = 0;
      d.active = true;
      d.decided = true;
      d.source = "handle";
      if (e.target instanceof HTMLElement) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [dismissible],
  );

  const onHandlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dismissible || drag.current.source !== "handle") return;
      applyOffset(e.clientY - drag.current.startY);
    },
    [applyOffset, dismissible],
  );

  const onHandlePointerUp = useCallback(() => {
    if (drag.current.source !== "handle") return;
    finishGesture();
  }, [finishGesture]);

  // ── Content area: native touch listeners via callback ref ──
  // React synthetic touch events are passive in some browsers, so
  // preventDefault() is silently ignored. We attach native listeners
  // with { passive: false } via a callback ref to guarantee we can
  // prevent scrolling while dragging.
  const contentCleanup = useRef<(() => void) | null>(null);

  const contentCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Tear down previous listeners
      contentCleanup.current?.();
      contentCleanup.current = null;
      contentRef.current = node;
      if (!node) return;

      const onTouchStart = (e: TouchEvent) => {
        if (!dismissible) return;
        const d = drag.current;
        if (d.source === "handle") return;
        d.startX = e.touches[0].clientX;
        d.startY = e.touches[0].clientY;
        d.offset = 0;
        d.active = false;
        d.decided = false;
        d.source = null;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!dismissible) return;
        const d = drag.current;
        if (d.source === "handle") return;
        const deltaX = e.touches[0].clientX - d.startX;
        const delta = e.touches[0].clientY - d.startY;

        if (!d.decided) {
          if (Math.abs(delta) < 8) return;
          // Horizontally-dominant gestures should yield here so nested horizontal
          // interactions can opt out of swipe-to-dismiss and handle the drag.
          const scroller = findNearestVerticalScroller(e.target, node);
          if (delta > 0 && Math.abs(delta) > Math.abs(deltaX) && scroller.scrollTop <= 0) {
            d.decided = true;
            d.active = true;
            d.source = "content";
          } else {
            d.decided = true;
            return;
          }
        }

        if (!d.active) return;
        e.preventDefault();
        applyOffset(delta);
      };

      const onTouchEnd = () => {
        const d = drag.current;
        if (d.source === "handle") return;
        if (!d.active) {
          d.decided = false;
          return;
        }
        finishGesture();
      };

      node.addEventListener("touchstart", onTouchStart, { passive: true });
      node.addEventListener("touchmove", onTouchMove, { passive: false });
      node.addEventListener("touchend", onTouchEnd, { passive: true });

      contentCleanup.current = () => {
        node.removeEventListener("touchstart", onTouchStart);
        node.removeEventListener("touchmove", onTouchMove);
        node.removeEventListener("touchend", onTouchEnd);
      };
    },
    [applyOffset, dismissible, finishGesture],
  );

  return rendered ? (
    <HeadlessDialog
      {...rest}
      static
      open={rendered}
      data-dialog-open={Boolean(open)}
      onClose={(value) => {
        if (dismissible) onClose?.(value);
      }}
      className="relative z-50"
    >
      <div
        ref={backdropRef}
        className={["dialog-backdrop fixed inset-0 backdrop-blur-xs", !floating && "bg-black/15"]
          .filter(Boolean)
          .join(" ")}
      />

      <div className={floating ? "dialog-floating-wrapper" : wrapperClasses}>
        <DialogPanel ref={panelRef} className={mergedPanelClasses}>
          {floating ? (
            <>
              <DialogHeader
                onClose={() => onClose?.(false)}
                onBack={onBack}
                dismissible={dismissible}
              >
                {header}
              </DialogHeader>
              <div
                className={["min-h-0 flex flex-col px-4", sizing === "workspace" && "flex-1"]
                  .filter(Boolean)
                  .join(" ")}
              >
                <DialogScrollArea
                  aria-label={rest["aria-label"] ?? "Dialog content"}
                  className={["overscroll-none pb-4", sizing === "workspace" && "flex-1"]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {children}
                </DialogScrollArea>
              </div>
              {actions && <footer className="shrink-0 p-4 pt-0">{actions}</footer>}
            </>
          ) : (
            <>
              <div aria-hidden="true" className="glass dialog-glass" />
              <div
                className="flex shrink-0 cursor-grab justify-center pt-2.5 pb-1 touch-none select-none active:cursor-grabbing"
                aria-hidden="true"
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <div className="h-1 w-9 rounded-full bg-gray-400/50 dark:bg-gray-500/50" />
              </div>
              <section
                ref={contentCallbackRef}
                className="dialog-content dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-none"
              >
                {children}
              </section>
            </>
          )}
        </DialogPanel>
      </div>
    </HeadlessDialog>
  ) : null;
}
