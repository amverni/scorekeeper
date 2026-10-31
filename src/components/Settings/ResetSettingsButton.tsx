import { useIsMutating } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useRef } from "react";
import { settingsKeys, useResetSettings } from "../../data/hooks/useSettings";
import { Button, InlineError } from "../ui";

interface ResetSettingsButtonProps {
  disabled: boolean;
}

export function ResetSettingsButton({ disabled }: ResetSettingsButtonProps) {
  const resetSettings = useResetSettings();
  const isSaving = useIsMutating({ mutationKey: settingsKeys.all }) > 0;
  const resetting = useRef(false);

  function handleReset() {
    if (disabled || isSaving || resetting.current) return;
    resetting.current = true;
    resetSettings.mutate(undefined, {
      onSettled: () => {
        resetting.current = false;
      },
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        className="size-10 shrink-0"
        onClick={handleReset}
        disabled={disabled || isSaving}
        aria-label="Reset settings to defaults"
        title="Reset settings to defaults"
      >
        <RotateCcw className="size-4" />
      </Button>
      {resetSettings.isError && (
        <InlineError
          message={resetSettings.error.message || "Unable to reset settings."}
          onRetry={handleReset}
        />
      )}
    </div>
  );
}
