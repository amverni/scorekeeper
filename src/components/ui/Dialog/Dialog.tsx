import { DialogPanel, type DialogProps, Dialog as HeadlessDialog } from "@headlessui/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import "./Dialog.css";
import { DialogHeader } from "./DialogHeader";
import { DialogScrollArea } from "./DialogScrollArea";
import { useDialogBackgroundLock } from "./useDialogBackgroundLock";
import { useFloatingDialogDismissal } from "./useFloatingDialogDismissal";
import { useFloatingDialogViewport } from "./useFloatingDialogViewport";

interface AppDialogProps extends Omit<DialogProps<"div">, "children"> {
  children?: ReactNode;
  afterLeave?: () => void;
  dismissible?: boolean;
  showCloseButton?: boolean;
  draggable?: boolean;
  sizing?: "content" | "workspace";
  bodyScroll?: "shared" | "custom";
  minBodyHeight?: number;
  header?: ReactNode;
  headerAction?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  readyToOpen?: boolean;
}

const panelClasses = [
  "dialog-panel dialog-panel-floating",
  "relative isolate",
  "w-[90vw] max-w-lg",
  "flex flex-col rounded-2xl",
].join(" ");

/** Shared accessible floating modal with a bounded body and fixed header/actions. */
export function Dialog(props: AppDialogProps) {
  const {
    children,
    open,
    onClose,
    className,
    afterLeave,
    dismissible = true,
    showCloseButton = true,
    draggable = true,
    sizing = "content",
    bodyScroll = "shared",
    minBodyHeight,
    header,
    headerAction,
    actions,
    onBack,
    backLabel,
    readyToOpen = true,
    ...rest
  } = props;
  const [rendered, setRendered] = useState(Boolean(open && readyToOpen));
  if (open && readyToOpen && !rendered) setRendered(true);
  const { wrapperRef, wrapper } = useFloatingDialogViewport(minBodyHeight);
  useDialogBackgroundLock(rendered);

  const mergedPanelClasses = [
    panelClasses,
    sizing === "workspace" && "dialog-panel-workspace",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useFloatingDialogDismissal(panelRef, rendered && Boolean(open), dismissible && draggable, () =>
    onClose?.(false),
  );

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

  return rendered ? (
    <HeadlessDialog
      {...rest}
      static
      open={wrapper !== null}
      data-dialog-open={Boolean(open) && wrapper !== null}
      data-dialog-ready={wrapper !== null}
      onClose={(value) => {
        if (dismissible) onClose?.(value);
      }}
      className="relative z-50"
    >
      <div ref={backdropRef} className="dialog-backdrop fixed inset-0 backdrop-blur-xs" />

      <div ref={wrapperRef} className="dialog-floating-wrapper">
        <DialogPanel ref={panelRef} className={mergedPanelClasses}>
          <DialogHeader
            headerAction={headerAction}
            onClose={() => onClose?.(false)}
            onBack={onBack}
            backLabel={backLabel}
            dismissible={dismissible}
            showCloseButton={showCloseButton}
          >
            {header}
          </DialogHeader>
          <div
            className={[
              "dialog-body min-h-0 flex flex-col px-4",
              bodyScroll === "custom" && "dialog-body-custom",
              sizing === "workspace" && "flex-1",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {bodyScroll === "custom" ? (
              children
            ) : (
              <DialogScrollArea
                aria-label={rest["aria-label"] ?? "Dialog content"}
                className={["overscroll-none pb-4", sizing === "workspace" && "flex-1"]
                  .filter(Boolean)
                  .join(" ")}
              >
                {children}
              </DialogScrollArea>
            )}
          </div>
          {actions && <footer className="shrink-0 p-4 pt-0">{actions}</footer>}
        </DialogPanel>
      </div>
    </HeadlessDialog>
  ) : null;
}
