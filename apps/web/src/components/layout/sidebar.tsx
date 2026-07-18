import { NavLink } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { NAV_ITEMS } from "./nav-items.js";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/30 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "border-border bg-card fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r shadow-sm transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed && "md:w-[72px]",
        )}
        aria-label="Primary"
      >
        <div className="border-border flex h-[72px] shrink-0 items-center justify-between border-b px-4">
          <span
            className={cn("text-text text-lg font-bold tracking-tight", collapsed && "md:hidden")}
          >
            TxLoom
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="text-text-secondary hover:bg-hover rounded-lg p-1.5 md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-text-secondary hover:bg-hover hidden rounded-lg p-1.5 md:block"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    cn(
                      "text-text-secondary hover:bg-hover hover:text-text flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                      isActive &&
                        "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
                      {isActive ? <span className="sr-only">(current page)</span> : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-border shrink-0 border-t p-3">
          <a
            href="https://github.com/vijayg10/txloom"
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary hover:bg-hover hover:text-text flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200"
          >
            <HelpCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && "md:hidden")}>Help & support</span>
          </a>
        </div>
      </aside>
    </>
  );
}
