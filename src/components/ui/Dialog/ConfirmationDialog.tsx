import { Description, DialogTitle } from "@headlessui/react";
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: string;
  actions: ReactNode;
  children?: ReactNode;
  dismissible?: boolean;
  onClose: () => void;
  afterLeave?: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  message,
  actions,
  children,
  dismissible = true,
  onClose,
  afterLeave,
}: ConfirmationDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      afterLeave={afterLeave}
      dismissible={dismissible}
      showCloseButton={false}
      draggable={false}
      className="dialog-panel-confirmation"
      header={<DialogTitle className="text-lg font-semibold">{title}</DialogTitle>}
      actions={actions}
    >
      <Description className="text-center text-text-secondary">{message}</Description>
      {children}
    </Dialog>
  );
}
