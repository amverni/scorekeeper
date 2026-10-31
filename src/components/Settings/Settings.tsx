import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { appSettingsOptions } from "../../data/hooks/useSettings";
import { CardBackground } from "../CardBackground/CardBackground";
import { HeaderLogo } from "../Logo/HeaderLogo";
import { Button, InlineError, List } from "../ui";
import { DefaultInOrderPhasesSetting } from "./DefaultInOrderPhasesSetting";
import { DefaultPhaseSetSetting } from "./DefaultPhaseSetSetting";
import { DefaultRoundSkipPenaltySetting } from "./DefaultRoundSkipPenaltySetting";
import { DefaultSitOutPenaltySetting } from "./DefaultSitOutPenaltySetting";
import { DefaultTiebreakerSetting } from "./DefaultTiebreakerSetting";
import { ResetSettingsButton } from "./ResetSettingsButton";

export function Settings() {
  const { data: settings, isLoading, isError, refetch } = useQuery(appSettingsOptions());

  return (
    <CardBackground
      headerContent={
        <div className="relative flex h-full items-center">
          <HeaderLogo />
        </div>
      }
      mainContent={
        <div className="content-container h-full py-4">
          <div className="flex items-center justify-end pb-2">
            <ResetSettingsButton disabled={isLoading} />
          </div>
          {isError ? (
            <InlineError message="Unable to load settings." onRetry={() => refetch()} />
          ) : (
            <List allowOverflow rowVariant="compact-content" isLoading={isLoading} shimmerRows={2}>
              {settings
                ? [
                    <DefaultInOrderPhasesSetting
                      key="default-in-order-phases"
                      value={settings.gameDefaults.inOrderPhases !== false}
                    />,
                    <DefaultTiebreakerSetting
                      key="default-tiebreaker"
                      value={settings.gameDefaults.tiebreaker}
                    />,
                    <DefaultRoundSkipPenaltySetting
                      key="default-round-skip-penalty"
                      value={settings.gameDefaults.roundSkipPenalty}
                    />,
                    <DefaultSitOutPenaltySetting
                      key="default-sit-out-penalty"
                      value={settings.gameDefaults.sitOutPenalty}
                    />,
                    <DefaultPhaseSetSetting
                      key="default-phase-set"
                      value={settings.gameDefaults.phaseSetId}
                    />,
                  ]
                : null}
            </List>
          )}
        </div>
      }
      footerContent={
        <div className="content-container flex h-full">
          <Button
            as={Link}
            to="/phaseCompan10n"
            className="page-shell-button p-0"
            aria-label="Go home"
          >
            <ArrowLeft className="size-8" />
          </Button>
        </div>
      }
    />
  );
}
