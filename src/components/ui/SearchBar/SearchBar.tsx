import { Input as HeadlessInput } from "@headlessui/react";
import { Search, X } from "lucide-react";
import type { ChangeEvent, ReactNode, Ref } from "react";
import { Button } from "../Button/Button";

const inputClasses = [
  "min-w-0 flex-1 bg-transparent text-base outline-none",
  "placeholder:text-text-secondary",
].join(" ");

export interface SearchBarProps {
  /** Current search value. */
  value: string;
  /** Called with the new value on every keystroke or clear. */
  onValueChange: (value: string) => void;
  /** Placeholder text shown when the input is empty. */
  placeholder?: string;
  /** Ref forwarded to the underlying `<input>` element. */
  ref?: Ref<HTMLInputElement>;
  /** Additional className applied to the outer wrapper. */
  className?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Auto-focus the input on mount. */
  autoFocus?: boolean;
  /** Extra elements rendered after the clear button (e.g. action buttons). */
  children?: ReactNode;
}

/**
 * An opaque search bar that wraps Headless UI's `Input`.
 *
 * Renders a rounded pill with a search icon, text input, and clear button.
 * Pass `children` to append extra action buttons after the clear button.
 */
export function SearchBar({
  value,
  onValueChange,
  placeholder = "Search…",
  ref,
  className,
  disabled,
  autoFocus,
  children,
}: SearchBarProps) {
  const wrapperClasses = ["flex items-center gap-2", className].filter(Boolean).join(" ");

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onValueChange(e.target.value);
  }

  return (
    <div className={wrapperClasses}>
      <div className="glass relative flex h-9 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full px-3">
        <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
        <HeadlessInput
          ref={ref}
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={inputClasses}
        />
      </div>
      <Button
        onClick={() => onValueChange("")}
        disabled={disabled || !value}
        className="h-9 w-9 shrink-0 p-0"
        aria-label="Clear search"
      >
        <X className="h-5 w-5" />
      </Button>
      {children}
    </div>
  );
}
