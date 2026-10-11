import { Field, Fieldset, Label, Legend } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, Trash } from "lucide-react";
import { useId, useState } from "react";
import { playersApi } from "../../data/api/players";
import { getRandomColorName } from "../../data/constants/colors";
import { useCreatePlayer, useDeletePlayer, useUpdatePlayer } from "../../data/hooks/usePlayers";
import type { Player } from "../../types";
import { Button } from "../ui/Button/Button";
import { ColorPicker } from "../ui/ColorPicker/ColorPicker";
import { Dialog } from "../ui/Dialog/Dialog";
import { InlineError } from "../ui/InlineError/InlineError";
import { Input } from "../ui/Input/Input";
import { List } from "../ui/List/List";
import { Switch } from "../ui/Switch/Switch";

export interface PlayerEditorProps {
  /** Pre-filled player name (e.g. from the search box). */
  defaultName?: string;
  /** Existing player to edit. When provided, the form operates in edit mode. */
  player?: Player;
  /** Called when the user navigates back to the previous view. */
  onBack: () => void;
  /** Called after a player is successfully created. */
  onCreated?: (player: Player) => void;
  /** Called after a player is successfully deleted (edit mode only). */
  onDeleted?: () => void;
  dialog?: {
    open: boolean;
    onClose: () => void;
    afterLeave: () => void;
  };
}

export function PlayerEditor({
  defaultName,
  player,
  onBack,
  onCreated,
  onDeleted,
  dialog,
}: PlayerEditorProps) {
  const isEditing = !!player;
  const createPlayer = useCreatePlayer();
  const updatePlayer = useUpdatePlayer();
  const deletePlayer = useDeletePlayer();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameErrorId = useId();
  const formId = useId();

  const form = useForm({
    defaultValues: {
      name: player?.name ?? defaultName ?? "",
      color: player?.color ?? getRandomColorName(),
      isFavorite: player?.isFavorite ?? 0,
    },
    validators: {
      onSubmitAsync: async ({ value }) => {
        const errors = await playersApi.validate(
          {
            name: value.name.trim(),
            color: value.color,
            isFavorite: value.isFavorite,
          },
          player?.id,
        );

        if (errors?.name) {
          return { fields: { name: errors.name } };
        }
        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      const data = {
        name: value.name.trim(),
        color: value.color,
        isFavorite: value.isFavorite,
      };

      if (isEditing) {
        const updated = await updatePlayer.mutateAsync({ id: player.id, updates: data });
        onCreated?.(updated);
      } else {
        const created = await createPlayer.mutateAsync(data);
        onCreated?.(created);
      }
      onBack();
    },
  });

  function handleDelete() {
    if (!player || deletePlayer.isPending) return;
    if (!window.confirm(`Delete ${player.name}?`)) return;
    setSubmitError(null);
    deletePlayer.mutate(player.id, {
      onSuccess: () => {
        onDeleted?.();
        onBack();
      },
      onError: (error) => setSubmitError(error.message),
    });
  }

  const actions = (
    <form.Subscribe
      selector={(state) => [state.canSubmit && !!state.values.name.trim(), state.isSubmitting]}
    >
      {([canSubmit, isSubmitting]) => (
        <div className="flex flex-col gap-2">
          {submitError && <InlineError message={submitError} />}
          <div className="flex gap-2">
            {isEditing && (
              <Button
                type="button"
                onClick={handleDelete}
                className="glass-danger px-4 py-2 text-sm text-white"
                aria-label="Delete player"
                disabled={deletePlayer.isPending || isSubmitting}
              >
                <Trash className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="submit"
              form={formId}
              disabled={!canSubmit || isSubmitting || deletePlayer.isPending}
              className="w-full px-4 py-2 text-sm active:scale-102!"
            >
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </form.Subscribe>
  );

  const content = (
    <div className={dialog ? "flex flex-col" : "relative flex h-full flex-col"}>
      {/* Header */}
      {!dialog && (
        <div className="flex items-center gap-2 p-3 pb-0">
          <Button onClick={onBack} className="h-9 w-9 shrink-0 p-0" aria-label="Back to search">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-base font-medium text-text-secondary">
            {isEditing ? "Edit Player" : "New Player"}
          </h2>
        </div>
      )}

      {/* Form */}
      <form
        id={formId}
        className={
          dialog ? "flex flex-col" : "dialog-scroll flex flex-1 flex-col overflow-y-auto p-4"
        }
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSubmitError(null);
          form.handleSubmit().catch((error: unknown) => {
            setSubmitError(error instanceof Error ? error.message : "Unable to save player");
          });
        }}
      >
        <Fieldset className={dialog ? "flex flex-col gap-4" : "flex flex-1 flex-col gap-4"}>
          <Legend className="sr-only">{isEditing ? "Edit Player" : "New Player"}</Legend>

          {/* Name */}
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (!value.trim() ? "Name is required" : undefined),
            }}
          >
            {(field) => {
              const nameError = field.state.meta.errors[0];
              const hasError = nameError !== undefined;
              return (
                <Field className="flex flex-col gap-1">
                  <Label className="text-sm font-medium text-text-secondary">Name</Label>
                  <Input
                    type="text"
                    autoFocus
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Player name"
                    invalid={hasError}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? nameErrorId : undefined}
                    className={[
                      "glass rounded-xl px-3 py-2 transition-colors",
                      hasError ? "glass-error" : "",
                    ].join(" ")}
                  />
                  {hasError && (
                    <p
                      id={nameErrorId}
                      className="text-sm text-red-700 dark:text-red-300"
                      role="alert"
                    >
                      {String(nameError)}
                    </p>
                  )}
                </Field>
              );
            }}
          </form.Field>

          {/* Color */}
          <form.Field name="color">
            {(field) => (
              <Field>
                <ColorPicker value={field.state.value} onChange={field.handleChange} />
              </Field>
            )}
          </form.Field>

          {/* Options */}
          <List>
            <form.Field key="favorite" name="isFavorite">
              {(field) => (
                <Field className="flex w-full items-center justify-between">
                  <Label className="cursor-pointer text-sm text-text-secondary">Favorite</Label>
                  <Switch
                    checked={field.state.value === 1}
                    onChange={(checked: boolean) => field.handleChange(checked ? 1 : 0)}
                    className="data-checked:bg-amber-400!"
                  />
                </Field>
              )}
            </form.Field>
          </List>

          {/* Spacer */}
          {!dialog && <div className="flex-1" />}

          {/* Actions */}
          {!dialog && actions}
        </Fieldset>
      </form>
    </div>
  );

  if (!dialog) return content;
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Dialog
          open={dialog.open}
          onClose={dialog.onClose}
          afterLeave={dialog.afterLeave}
          dismissible={!isSubmitting && !deletePlayer.isPending}
          aria-label={isEditing ? "Edit player" : "Create player"}
          presentation="floating"
          sizing="workspace"
          header={
            <h2 className="text-base font-medium text-text-secondary">
              {isEditing ? "Edit Player" : "New Player"}
            </h2>
          }
          actions={actions}
        >
          {content}
        </Dialog>
      )}
    </form.Subscribe>
  );
}
