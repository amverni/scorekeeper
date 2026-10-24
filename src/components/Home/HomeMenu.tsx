import { CloseButton } from "@headlessui/react";
import { Link, type LinkOptions } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { History, House, ListChecks, Menu, Settings, Users } from "lucide-react";
import type { ScorekeeperExperience } from "../../types";
import { Popover, PopoverButton, PopoverPanel } from "../ui";

interface MenuItem {
  label: string;
  icon: LucideIcon;
  to: LinkOptions["to"];
}

const phaseItems: MenuItem[] = [
  { label: "Games", icon: History, to: "/phaseCompan10n/games" },
  { label: "Players", icon: Users, to: "/phaseCompan10n/players" },
  { label: "Phases", icon: ListChecks, to: "/phaseCompan10n/phases" },
  { label: "Settings", icon: Settings, to: "/phaseCompan10n/settings" },
];
const genericItems: MenuItem[] = [
  { label: "Games", icon: History, to: "/scorekeeper/games" },
  { label: "Players", icon: Users, to: "/scorekeeper/players" },
];
const homeItem: MenuItem = { label: "Home", icon: House, to: "/" };

const itemClassName =
  "flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10";

export function HomeMenu({ experience }: { experience: ScorekeeperExperience }) {
  const items = [homeItem, ...(experience === "phaseCompan10n" ? phaseItems : genericItems)];
  return (
    <Popover className="relative">
      {/* The outer button keeps a fixed box at each responsive size so Headless UI's anchored
          panel never sees a size change (which would otherwise drift the
          popover when the press-scale fires). The visible glass + icon live
          in an inner span that grows uniformly from center on press. */}
      <PopoverButton
        aria-label="Menu"
        className="page-shell-button relative rounded-full group cursor-pointer focus:outline-none data-[focus]:outline-2 data-[focus]:outline-offset-2 data-focus:outline-solid data-focus:outline-text-secondary!"
      >
        <span className="absolute inset-0 inline-flex items-center justify-center rounded-full glass transition-transform group-hover:brightness-110 group-active:scale-110">
          <Menu className="size-6 relative z-10" aria-hidden="true" />
        </span>
      </PopoverButton>

      <PopoverPanel anchor="bottom end" className="z-50 min-w-44 [--anchor-gap:8px]">
        <nav className="flex flex-col">
          {items.map(({ label, icon: Icon, to }) => (
            <CloseButton key={label} as={Link} to={to} className={itemClassName}>
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {label}
            </CloseButton>
          ))}
        </nav>
      </PopoverPanel>
    </Popover>
  );
}
