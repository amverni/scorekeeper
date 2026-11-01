import type { ButtonProps } from "@headlessui/react";
import type { Ref } from "react";
import { Button } from "../Button/Button";
import { mergeClassName } from "../mergeClassName";

export function ListRowButton(props: ButtonProps<"button"> & { ref?: Ref<HTMLButtonElement> }) {
  const className = mergeClassName(
    "size-7 shrink-0 text-text-secondary hover:bg-text-primary/5 dark:hover:bg-text-primary/10",
    props,
  );
  return <Button type="button" {...props} variant="plain" className={className} />;
}
