import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../Button/Button";

interface DialogHeaderProps {
  children?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  dismissible: boolean;
}

export function DialogHeader({
  children,
  onClose,
  onBack,
  backLabel = "Go back",
  dismissible,
}: DialogHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-3 px-4 py-2">
      {onBack && (
        <Button
          onClick={onBack}
          disabled={!dismissible}
          className="size-11 shrink-0 p-0 data-focus:outline-solid data-focus:outline-text-primary!"
          aria-label={backLabel}
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        onClick={onClose}
        disabled={!dismissible}
        className="size-11 shrink-0 p-0 data-focus:outline-solid data-focus:outline-text-primary!"
        aria-label="Close"
      >
        <X aria-hidden="true" className="size-5" />
      </Button>
    </header>
  );
}
