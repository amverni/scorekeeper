import { Field, Label } from "@headlessui/react";
import { List, SettingListRow, Switch } from "../ui";
import { useGameSettings, useSetInOrderPhases } from "./CreateGameContext";
import { ResetSettingsButton } from "./Settings/ResetSettingsButton";
import { RoundSkipPenaltySetting } from "./Settings/RoundSkipPenaltySetting";
import { SitOutPenaltySetting } from "./Settings/SitOutPenaltySetting";
import { TiebreakerSetting } from "./Settings/TiebreakerSetting";

export function Settings() {
  const settings = useGameSettings();
  const setInOrderPhases = useSetInOrderPhases();
  return (
    <div className="py-4">
      <div className="flex items-center justify-end pb-2">
        <ResetSettingsButton />
      </div>
      <List allowOverflow>
        <Field key="inOrderPhases" className="w-full">
          <SettingListRow label={<Label>In-order phases</Label>}>
            <Switch checked={settings.inOrderPhases !== false} onChange={setInOrderPhases} />
          </SettingListRow>
        </Field>
        <TiebreakerSetting key="tiebreaker" />
        <RoundSkipPenaltySetting key="roundSkipPenalty" />
        <SitOutPenaltySetting key="sitOutPenalty" />
      </List>
    </div>
  );
}
