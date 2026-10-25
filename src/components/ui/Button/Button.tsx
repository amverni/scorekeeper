import { type ButtonProps, Button as HeadlessButton } from "@headlessui/react";
import type { ComponentPropsWithRef, ElementType, ReactElement } from "react";
import { mergeClassName } from "../mergeClassName";
import { interactiveClasses } from "../sharedClasses";

const baseClasses = [
  "inline-flex items-center justify-center rounded-full relative",
  "hover:brightness-110 active:scale-110",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
].join(" ");

const variantClasses = {
  default: ["glass", interactiveClasses].join(" "),
  ready: [
    "glass glass-ready",
    interactiveClasses,
    "data-focus:outline-solid data-focus:outline-text-secondary!",
  ].join(" "),
  plain:
    "cursor-pointer focus:outline-none data-[focus]:outline-solid data-[focus]:outline-2 data-[focus]:outline-offset-2 data-[focus]:outline-current",
};

type StyledButtonProps<TTag extends ElementType = "button"> = ButtonProps<TTag> & {
  ref?: ComponentPropsWithRef<TTag>["ref"];
  variant?: "default" | "plain" | "ready";
};

/**
 * A theme-aware button that wraps Headless UI's `Button`.
 *
 * Accepts the same props as `@headlessui/react`'s `Button` and layers on
 * the app's shared surface styling by default. Use `variant="plain"` for
 * surface-free actions with a current-color keyboard focus outline, or
 * `variant="ready"` to highlight enabled actions while keeping disabled ones neutral.
 */
export function Button<TTag extends ElementType = "button">(
  props: StyledButtonProps<TTag>,
): ReactElement;
export function Button({ variant = "default", ...props }: StyledButtonProps) {
  const merged = mergeClassName([baseClasses, variantClasses[variant]].join(" "), props);
  return <HeadlessButton {...props} className={merged} />;
}
