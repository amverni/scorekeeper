import {
  Listbox as HeadlessListbox,
  ListboxButton as HeadlessListboxButton,
  Label as HeadlessListboxLabel,
  ListboxOption as HeadlessListboxOption,
  ListboxOptions as HeadlessListboxOptions,
  type ListboxOptionsProps as HeadlessListboxOptionsProps,
  type ListboxProps,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { mergeClassName } from "../mergeClassName";
import { interactiveClasses } from "../sharedClasses";
import "./Listbox.css";

/* ── Root ──────────────────────────────────────────────────── */

export function Listbox<TType = string, TActualType = TType extends (infer U)[] ? U : TType>(
  props: ListboxProps<"div", TType, TActualType>,
) {
  return <HeadlessListbox {...props} as="div" className={mergeClassName("relative", props)} />;
}

/* ── Trigger ───────────────────────────────────────────────── */

const buttonClasses = [
  "glass relative overflow-hidden",
  "inline-flex items-center justify-between gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium",
  "min-w-[6rem]",
  interactiveClasses,
  "hover:brightness-110",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
].join(" ");

const plainButtonClasses = [
  "relative inline-flex items-center justify-end gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium",
  "cursor-pointer text-text-primary outline-none",
  "data-[focus]:bg-black/5 dark:data-[focus]:bg-white/10",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
].join(" ");

export function ListboxButton({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "plain";
}) {
  const merged = [variant === "plain" ? plainButtonClasses : buttonClasses, className]
    .filter(Boolean)
    .join(" ");
  return (
    <HeadlessListboxButton className={merged}>
      <span className="inline-flex min-w-0 items-center gap-1.5">{children}</span>
      <span className="inline-flex shrink-0">
        <ChevronDown className="size-3.5 text-text-secondary" aria-hidden />
      </span>
    </HeadlessListboxButton>
  );
}

export function ListboxLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <HeadlessListboxLabel as="span" className={className}>
      {children}
    </HeadlessListboxLabel>
  );
}

/* ── Options panel ─────────────────────────────────────────── */

const panelClasses = [
  "glass listbox-glass rounded-xl shadow-xl",
  "z-50 w-max overscroll-contain",
  "p-1",
  "focus:outline-none",
].join(" ");

type ListboxOptionsAlign = "left" | "right";
type ListboxOptionsTransformOrigin = "top-left" | "top-right" | "top";

const panelAnimationClasses = "listbox-options";
const panelPositionClasses = "absolute top-full mt-1";
const panelAlignClasses = {
  left: "left-0",
  right: "right-0",
} satisfies Record<ListboxOptionsAlign, string>;
const panelTransformOriginClasses = {
  "top-left": "origin-top-left",
  "top-right": "origin-top-right",
  top: "origin-top",
} satisfies Record<ListboxOptionsTransformOrigin, string>;

export function ListboxOptions({
  children,
  className,
  align = "left",
  transformOrigin = "top-left",
  anchor,
  modal,
  portal,
}: {
  children: ReactNode;
  className?: string;
  align?: ListboxOptionsAlign;
  transformOrigin?: ListboxOptionsTransformOrigin;
  anchor?: HeadlessListboxOptionsProps["anchor"];
  modal?: HeadlessListboxOptionsProps["modal"];
  portal?: HeadlessListboxOptionsProps["portal"];
}) {
  const merged = [
    panelClasses,
    panelAnimationClasses,
    anchor ? "" : panelPositionClasses,
    anchor ? "" : panelAlignClasses[align],
    panelTransformOriginClasses[transformOrigin],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <HeadlessListboxOptions
      transition
      anchor={anchor}
      modal={modal}
      portal={portal}
      className={merged}
    >
      {children}
    </HeadlessListboxOptions>
  );
}

/* ── Option ────────────────────────────────────────────────── */

const optionClasses = [
  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
  "cursor-pointer select-none",
  "data-[focus]:bg-black/5 dark:data-[focus]:bg-white/10",
  "data-disabled:cursor-not-allowed data-disabled:opacity-40",
].join(" ");

export function ListboxOption<TValue>({
  children,
  value,
  className,
  selected: selectedOverride,
  disabled,
}: {
  children: ReactNode;
  value: TValue;
  className?: string;
  selected?: boolean;
  disabled?: boolean;
}) {
  const merged = [optionClasses, className].filter(Boolean).join(" ");
  return (
    <HeadlessListboxOption value={value} disabled={disabled} className={merged}>
      {({ selected: headlessSelected }) => {
        const isSelected = selectedOverride ?? headlessSelected;
        return (
          <>
            <Check
              className={["size-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0"].join(" ")}
              aria-hidden
            />
            {children}
          </>
        );
      }}
    </HeadlessListboxOption>
  );
}
