import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_GAME_SETTINGS } from "../../data/constants/gameSettings";
import { phaseSetPhasesOptions } from "../../data/hooks/usePhaseSets";
import { appSettingsOptions } from "../../data/hooks/useSettings";
import type {
  AppGameDefaults,
  GameSettings,
  GameTiebreaker,
  Phase,
  PhaseId,
  PhaseSetId,
  Player,
} from "../../types";
import { PlayerSelectionProvider } from "./PlayerSelectionContext";

interface CreateGameContextValue {
  phases: Phase[];
  addPhase: (phase: Phase) => void;
  removePhase: (id: PhaseId) => void;
  reorderPhases: (phases: Phase[]) => void;
  setPhases: (phases: Phase[]) => void;
  defaultPhaseSetId: PhaseSetId;
  settings: GameSettings;
  setInOrderPhases: (value: boolean) => void;
  setTiebreaker: (tiebreaker: GameTiebreaker) => void;
  setRoundSkipPenalty: (value: number) => void;
  setSitOutPenalty: (value: number) => void;
  resetSettings: () => void;
}

const CreateGameContext = createContext<CreateGameContextValue | null>(null);

function resolveDefaultGameSettings(settings?: AppGameDefaults): GameSettings {
  if (!settings) return { ...DEFAULT_GAME_SETTINGS, inOrderPhases: true };
  const { tiebreaker, roundSkipPenalty, sitOutPenalty } = settings;
  return { tiebreaker, roundSkipPenalty, sitOutPenalty, inOrderPhases: true };
}

export function CreateGameProvider({ children }: { children: ReactNode }) {
  const { data: appSettings } = useQuery(appSettingsOptions());
  const defaultPhaseSetId = appSettings?.gameDefaults.phaseSetId ?? "";
  const { data: defaultPhases } = useQuery({
    ...phaseSetPhasesOptions(defaultPhaseSetId),
    enabled: appSettings !== undefined,
  });
  const [players, setPlayers] = useState<Player[]>([]);
  const [phases, setGamePhases] = useState<Phase[]>([]);
  const settingsForm = useForm({ defaultValues: { settings: resolveDefaultGameSettings() } });
  const settings = useStore(settingsForm.store, (state) => state.values.settings);
  const setSettings = (update: GameSettings | ((previous: GameSettings) => GameSettings)) =>
    settingsForm.setFieldValue("settings", update);
  const initializedSettingsRef = useRef(false);
  const initializedPhasesRef = useRef(false);
  const phasesDirtyRef = useRef(false);
  const settingsDirtyRef = useRef(false);

  useEffect(() => {
    if (!appSettings || initializedSettingsRef.current || settingsDirtyRef.current) return;
    initializedSettingsRef.current = true;
    settingsForm.setFieldValue("settings", resolveDefaultGameSettings(appSettings.gameDefaults));
  }, [appSettings, settingsForm]);

  useEffect(() => {
    if (!defaultPhases || initializedPhasesRef.current || phasesDirtyRef.current) return;
    if (defaultPhases.length === 0) return;
    initializedPhasesRef.current = true;
    setGamePhases(defaultPhases);
  }, [defaultPhases]);

  const value: CreateGameContextValue = {
    phases,
    addPhase: (phase) => {
      phasesDirtyRef.current = true;
      setGamePhases((prev) => (prev.some((p) => p.id === phase.id) ? prev : [...prev, phase]));
    },
    removePhase: (id) => {
      phasesDirtyRef.current = true;
      setGamePhases((prev) => prev.filter((p) => p.id !== id));
    },
    reorderPhases: (phases) => {
      phasesDirtyRef.current = true;
      setGamePhases(phases);
    },
    setPhases: (phases) => {
      phasesDirtyRef.current = true;
      setGamePhases(phases);
    },
    defaultPhaseSetId,
    settings,
    setInOrderPhases: (inOrderPhases) => {
      settingsDirtyRef.current = true;
      setSettings((prev) => ({ ...prev, inOrderPhases }));
    },
    setTiebreaker: (tiebreaker) => {
      settingsDirtyRef.current = true;
      setSettings((prev) => ({ ...prev, tiebreaker }));
    },
    setRoundSkipPenalty: (roundSkipPenalty) => {
      settingsDirtyRef.current = true;
      setSettings((prev) => ({ ...prev, roundSkipPenalty }));
    },
    setSitOutPenalty: (sitOutPenalty) => {
      settingsDirtyRef.current = true;
      setSettings((prev) => ({ ...prev, sitOutPenalty }));
    },
    resetSettings: () => {
      if (!appSettings) {
        settingsDirtyRef.current = false;
        setSettings(resolveDefaultGameSettings());
        return;
      }

      initializedSettingsRef.current = true;
      settingsDirtyRef.current = true;
      setSettings(resolveDefaultGameSettings(appSettings.gameDefaults));
    },
  };

  return (
    <PlayerSelectionProvider
      value={{
        players,
        addPlayer: (player) =>
          setPlayers((prev) => (prev.some((p) => p.id === player.id) ? prev : [...prev, player])),
        removePlayer: (id) => setPlayers((prev) => prev.filter((p) => p.id !== id)),
        reorderPlayers: setPlayers,
      }}
    >
      <CreateGameContext.Provider value={value}>{children}</CreateGameContext.Provider>
    </PlayerSelectionProvider>
  );
}

function useCreateGameContext(): CreateGameContextValue {
  const ctx = useContext(CreateGameContext);
  if (!ctx) throw new Error("useCreateGame must be used within a CreateGameProvider");
  return ctx;
}

export function useGamePhases(): Phase[] {
  const { phases } = useCreateGameContext();
  return phases;
}

export function useAddPhase(): (phase: Phase) => void {
  const { addPhase } = useCreateGameContext();
  return addPhase;
}

export function useRemovePhase(): (id: PhaseId) => void {
  const { removePhase } = useCreateGameContext();
  return removePhase;
}

export function useReorderPhases(): (phases: Phase[]) => void {
  const { reorderPhases } = useCreateGameContext();
  return reorderPhases;
}

export function useSetPhases(): (phases: Phase[]) => void {
  const { setPhases } = useCreateGameContext();
  return setPhases;
}

export function useDefaultPhaseSetId(): PhaseSetId {
  const { defaultPhaseSetId } = useCreateGameContext();
  return defaultPhaseSetId;
}

export function useGameSettings(): GameSettings {
  const { settings } = useCreateGameContext();
  return settings;
}

export function useSetTiebreaker(): (tiebreaker: GameTiebreaker) => void {
  const { setTiebreaker } = useCreateGameContext();
  return setTiebreaker;
}

export function useSetInOrderPhases(): (value: boolean) => void {
  return useCreateGameContext().setInOrderPhases;
}

export function useSetRoundSkipPenalty(): (value: number) => void {
  const { setRoundSkipPenalty } = useCreateGameContext();
  return setRoundSkipPenalty;
}

export function useSetSitOutPenalty(): (value: number) => void {
  const { setSitOutPenalty } = useCreateGameContext();
  return setSitOutPenalty;
}

export function useResetGameSettings(): () => void {
  const { resetSettings } = useCreateGameContext();
  return resetSettings;
}
