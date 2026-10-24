import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../Button/Button";

interface DialogHeaderProps {
  children?: ReactNode;
  headerAction?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  dismissible: boolean;
  showCloseButton?: boolean;
}

export function DialogHeader({
  children,
  headerAction,
  onClose,
  onBack,
  backLabel = "Go back",
  dismissible,
  showCloseButton = true,
}: DialogHeaderProps) {
  if (!showCloseButton && !onBack && !headerAction) {
    return <header className="shrink-0 px-4 py-4 text-center">{children}</header>;
  }
  return (
    <header className="grid shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3 px-4 py-2">
      <div className="flex size-11 items-center justify-center">
        {onBack ? (
          <Button
            onClick={onBack}
            disabled={!dismissible}
            className="size-11 shrink-0 p-0 data-focus:outline-solid data-focus:outline-text-primary!"
            aria-label={backLabel}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Button>
        ) : (
          headerAction
        )}
      </div>
      <div className="col-start-2 min-w-0 text-center *:truncate">{children}</div>
      {showCloseButton && (
        <Button
          onClick={onClose}
          disabled={!dismissible}
          className="size-11 shrink-0 p-0 data-focus:outline-solid data-focus:outline-text-primary!"
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-5" />
        </Button>
      )}
    </header>
  );
}
