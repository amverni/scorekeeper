import { Tab, TabGroup } from "@headlessui/react";
import { ListChecks, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { ScorekeeperExperience } from "../../types";
import { SwipeableTabPanels, TabList, tabClasses } from "../ui";

interface GameSetupTabsProps {
  experience: ScorekeeperExperience;
  selectedIndex: number;
  onChange: (index: number) => void;
  error?: ReactNode;
  children: ReactNode;
}

export function GameSetupTabs({
  experience,
  selectedIndex,
  onChange,
  error,
  children,
}: GameSetupTabsProps) {
  const tabs =
    experience === "phaseCompan10n"
      ? [
          { label: "Players", icon: Users },
          { label: "Phases", icon: ListChecks },
          { label: "Settings", icon: Settings },
        ]
      : [
          { label: "Players", icon: Users },
          { label: "Settings", icon: Settings },
        ];
  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={onChange}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="content-container w-full shrink-0 pt-2 pb-3">
        <TabList>
          {tabs.map(({ label, icon: Icon }) => (
            <Tab
              key={label}
              className={[tabClasses, "data-focus:outline-text-secondary!"].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Icon className="size-4" aria-hidden />
                {label}
              </span>
            </Tab>
          ))}
        </TabList>
      </div>
      {error}
      <SwipeableTabPanels
        selectedIndex={selectedIndex}
        onChange={onChange}
        className="mx-auto w-full max-w-lg min-h-0 flex-1"
      >
        {children}
      </SwipeableTabPanels>
    </TabGroup>
  );
}
