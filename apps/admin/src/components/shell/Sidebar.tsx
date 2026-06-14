import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { MODULE_BY_KEY, GROUP_ORDER, GROUP_LABELS, type ModuleGroup } from "@/lib/modules";
import { useNavStore, moreKeys } from "@/stores/nav";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { AccountMenu } from "./AccountMenu";

/**
 * Sidebar (canon §3.1): brand · business switcher · Priority (top-10) +
 * collapsible More (grouped) · account menu · floating collapse handle.
 * Active app highlights AND auto-scrolls into view. Mobile = drawer.
 */
export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUiStore();
  const isDesktop = useIsDesktop();
  const collapsed = isDesktop && sidebarCollapsed;
  const location = useLocation();
  const top = useNavStore((s) => s.top);
  const more = moreKeys(top);
  const [moreOpen, setMoreOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Auto-expand More if the active route lives inside it.
  const activeInMore = more.some((k) => location.pathname.startsWith(MODULE_BY_KEY[k]!.route));
  const showMore = moreOpen || activeInMore;

  // Scroll the active item into view on navigation (canon §3.1).
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [location.pathname]);

  const item = (key: string) => {
    const m = MODULE_BY_KEY[key]!;
    const Icon = m.icon;
    return (
      <NavLink
        key={key}
        to={m.route}
        onClick={() => !isDesktop && setMobileSidebarOpen(false)}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 p-[10px_12px] m-[1px_2px] rounded-[11px] text-[13.5px] font-medium whitespace-nowrap transition-all border-l-2 border-transparent",
            isActive
              ? "text-accent-glow bg-surface/70 border-l-accent"
              : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.04]",
            collapsed && "justify-center p-[10px_0] m-[1px_0]",
          )
        }
        data-active={location.pathname.startsWith(m.route) || undefined}
        title={collapsed ? m.label : undefined}
      >
        <Icon className="w-[18px] h-[18px] opacity-90 shrink-0" />
        {!collapsed && <span className="truncate">{m.label}</span>}
      </NavLink>
    );
  };

  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: more.filter((k) => MODULE_BY_KEY[k]!.group === (g as ModuleGroup)),
  })).filter((x) => x.items.length);

  return (
    <>
      {!isDesktop && mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={() => setMobileSidebarOpen(false)} />
      )}
      <aside
        className={cn(
          "fixed top-0 left-0 bottom-0 z-50 flex flex-col glass border-r transition-[width,transform] duration-300 ease-brand",
          collapsed ? "w-[var(--side-c)]" : "w-[var(--side-w)]",
          !isDesktop && (mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"),
        )}
      >
        {/* brand */}
        <Link to="/" className="flex items-center gap-3 p-[18px] border-b hairline shrink-0 group">
          <span className="w-10 h-10 rounded-full grid place-items-center font-display text-[19px] text-accent-glow border border-accent/45 bg-accent/[0.08] group-hover:shadow-glow transition-shadow shrink-0">P</span>
          {!collapsed && (
            <span className="font-display text-[19px] tracking-wide leading-tight">
              Pixie Girl <span className="text-accent-glow">Hub</span>
              <span className="block font-body text-[8.5px] tracking-[0.22em] uppercase text-text-faint font-semibold mt-0.5">Group ERP</span>
            </span>
          )}
          {!isDesktop && (
            <button onClick={(e) => { e.preventDefault(); setMobileSidebarOpen(false); }} className="ml-auto p-2 text-text-faint hover:text-text-primary" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          )}
        </Link>

        <BusinessSwitcher collapsed={collapsed} />

        <nav ref={navRef} className="flex-1 overflow-y-auto p-[8px_10px_16px] scroll-smooth">
          {!collapsed && <div className="micro p-[14px_12px_6px]">Priority</div>}
          {top.map(item)}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={cn("flex items-center gap-3 w-[calc(100%_-_4px)] p-[10px_12px] m-[4px_2px] rounded-[11px] text-[13px] font-semibold text-text-faint hover:text-text-primary hover:bg-text-primary/[0.04] transition-all", collapsed && "justify-center")}
          >
            {showMore ? <ChevronUp className="w-[18px] shrink-0" /> : <ChevronDown className="w-[18px] shrink-0" />}
            {!collapsed && <span>More · {more.length}</span>}
          </button>
          {showMore &&
            groups.map(({ g, items }) => (
              <div key={g}>
                {!collapsed && <div className="micro p-[14px_12px_6px]">{GROUP_LABELS[g]}</div>}
                {items.map(item)}
              </div>
            ))}
        </nav>

        <AccountMenu collapsed={collapsed} />

        {isDesktop && (
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute top-[84px] -right-[13px] w-[26px] h-[26px] rounded-full grid place-items-center text-accent-glow bg-surface/95 backdrop-blur border border-accent/35 shadow-[0_4px_14px_rgb(0_0_0/0.4)] transition-transform duration-300 ease-brand hover:scale-[1.18] hover:shadow-glow"
          >
            <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform duration-300 ease-brand", collapsed && "rotate-180")} />
          </button>
        )}
      </aside>
    </>
  );
}
