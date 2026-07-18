import { useLocation } from "react-router-dom";
import { Bell, Menu } from "lucide-react";
import { SearchInput } from "../ui/search-input.js";
import { NAV_ITEMS } from "./nav-items.js";

interface TopNavbarProps {
  onOpenMobile: () => void;
}

export function TopNavbar({ onOpenMobile }: TopNavbarProps) {
  const location = useLocation();
  const active = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to));

  return (
    <header className="border-border bg-card flex h-[72px] shrink-0 items-center justify-between border-b px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="text-text-secondary hover:bg-hover rounded-lg p-2 md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-text truncate text-base font-semibold sm:text-lg">
          {active?.label ?? "TxLoom"}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden sm:block">
          <SearchInput aria-label="Search" placeholder="Search…" />
        </div>
        <button
          type="button"
          className="text-text-secondary hover:bg-hover rounded-full p-2"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
