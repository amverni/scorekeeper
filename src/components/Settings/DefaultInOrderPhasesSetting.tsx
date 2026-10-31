import { Field, Label } from "@headlessui/react";
import { useIsMutating } from "@tanstack/react-query";
import { useRef } from "react";
import { settingsKeys, useSetDefaultInOrderPhases } from "../../data/hooks/useSettings";
import { InlineError, SettingListRow, Switch } from "../ui";

export function DefaultInOrderPhasesSetting({ value }: { value: boolean }) {
  const setDefaultInOrderPhases = useSetDefaultInOrderPhases();
  const isSaving = useIsMutating({ mutationKey: settingsKeys.all }) > 0;
  const saving = useRef(false);

  function handleChange(inOrderPhases: boolean) {
    if (saving.current || isSaving) return;
    saving.current = true;
    setDefaultInOrderPhases.mutate(inOrderPhases, {
      onSettled: () => {
        saving.current = false;
      },
    });
  }

  return (
    <Field className="flex w-full flex-col gap-2">
      <SettingListRow label={<Label>In-order phases</Label>}>
        <Switch checked={value} onChange={handleChange} disabled={isSaving} />
      </SettingListRow>
      {setDefaultInOrderPhases.isError && (
        <InlineError
          message={setDefaultInOrderPhases.error.message || "Unable to save In-order phases."}
          onRetry={() => {
            if (setDefaultInOrderPhases.variables !== undefined) {
              handleChange(setDefaultInOrderPhases.variables);
            }
          }}
        />
      )}
    </Field>
  );
}
