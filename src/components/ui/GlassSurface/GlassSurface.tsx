import {
  Button as HeadlessButton,
  type ButtonProps as HeadlessButtonProps,
} from "@headlessui/react";
import type { ElementType, HTMLAttributes, ReactElement } from "react";
import { mergeClassName } from "../mergeClassName";
import { interactiveClasses } from "../sharedClasses";

export type GlassSurfaceProps = HTMLAttributes<HTMLDivElement>;

const glassSurfaceButtonClasses = [
  "inline-flex items-center justify-center rounded-full relative",
  interactiveClasses,
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
].join(" ");

/**
 * An opaque surface with the shared border and shadow for compound controls whose
 * inner interactive regions should not render their own surface layers.
 */
export function GlassSurface({ className, ...props }: GlassSurfaceProps) {
  const merged = ["glass glass-control-surface", className].filter(Boolean).join(" ");
  return <div {...props} className={merged} />;
}

export function GlassSurfaceButton<TTag extends ElementType = "button">(
  props: HeadlessButtonProps<TTag>,
): ReactElement;
export function GlassSurfaceButton(props: HeadlessButtonProps<"button">) {
  const merged = mergeClassName(glassSurfaceButtonClasses, props);
  return <HeadlessButton {...props} className={merged} />;
}
