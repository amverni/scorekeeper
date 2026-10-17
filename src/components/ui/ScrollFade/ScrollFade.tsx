import type { ComponentProps } from "react";

const FADE_PX = 20;

const FADE_MASK = `linear-gradient(to bottom, transparent 0, black ${FADE_PX}px, black calc(100% - var(--dialog-fade-height, 0px)), transparent)`;

/**
 * Scrollable container with a top-edge fade.
 *
 * The top edge always fades from transparent to opaque so content
 * scrolling out actually fades out (alpha) rather than being painted
 * over by a colored gradient. Inside a Dialog, its shared fade height
 * also softens the bottom edge; callers leave at least that much end
 * padding. Elsewhere, the surrounding layout (e.g. CardBackground's
 * angled footer panel) covers content scrolling off the bottom.
 *
 * The matching opaque background fades with the content. Applying the
 * mask unconditionally avoids a visual pop when scrolling starts and
 * lets shadows above the container blend into its top edge.
 */
export function ScrollFade({ style, className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={["dialog-scroll overflow-y-auto bg-white dark:bg-neutral-900", className]
        .filter(Boolean)
        .join(" ")}
      style={{ ...style, maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      {...props}
    >
      {children}
    </div>
  );
}
