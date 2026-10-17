import type { ComponentProps } from "react";

interface DialogScrollAreaProps extends ComponentProps<"section"> {
  "aria-label": string;
}

/** Keeps surface shadows and the focus ring outside the masked scroll content. */
export function DialogScrollArea({ children, className, ...props }: DialogScrollAreaProps) {
  return (
    <div className="dialog-scroll-frame">
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Native scroll regions need focus for arrow and PageDown scrolling.
        tabIndex={0}
        {...props}
        className={[
          "dialog-scroll min-h-0 overflow-y-auto px-4 pt-2 pb-(--dialog-fade-height)",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </section>
    </div>
  );
}
