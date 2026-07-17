import { Menu, Search, Sun, Moon, LogOut, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { MODULES } from "@/lib/modules";
import { hardRefresh } from "@/lib/hardRefresh";
import { ClockWidget } from "./ClockWidget";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { ACCOUNT_MENU_ITEMS, useAccountMenu } from "./useAccountMenu";
import { AccountMenuModals } from "./AccountMenuModals";
import { usePageActionsSlotRef } from "./PageActions";

/** Sticky top bar (canon §3.2): module title+desc · page actions · clock-in · ⌘K search · bell · refresh · theme. */
export function TopBar() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen, setPaletteOpen, theme, toggleTheme } =
    useUiStore();
  const isDesktop = useIsDesktop();
  const menu = useAccountMenu();
  const { user, onItem, onSignOut } = menu;
  const [accountOpen, setAccountOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const slotRef = usePageActionsSlotRef();

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: MouseEvent) =>
      !accountRef.current?.contains(e.target as Node) &&
      setAccountOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountOpen]);

  const handleHardRefresh = () => {
    setRefreshing(true);
    void hardRefresh();
  };

  const mod = MODULES.find((m) => pathname.startsWith(m.route));
  const title = pathname === "/" ? "Hub" : (mod?.label ?? "Hub");
  const desc =
    pathname === "/" ? "Your command center" : (mod?.description ?? "");

  return (
    <>
      {/* Bar background spans the viewport; its content aligns to the same
          centered container as the page body so nothing is misaligned. */}
      <header className="sticky top-0 z-30 glass border-b">
        <div className="mx-auto w-full max-w-[var(--content-max)] flex items-center gap-3.5 p-[12px_34px] max-md:p-[10px_16px]">
          {!isDesktop && (
            <button
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Menu"
              className="grid place-items-center w-[38px] h-[38px] rounded-[11px] bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/10 hover:text-text-primary transition-all"
            >
              <Menu className="w-[18px]" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[21px] font-medium leading-tight truncate max-md:text-lg">
              {title}
            </h1>
            <div className="text-[11.5px] text-text-faint max-md:hidden">
              {desc}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {/* Desktop page-action slot — pages portal their primary CTA here. */}
            {isDesktop && (
              <div
                ref={slotRef}
                className="flex items-center gap-2 empty:hidden mr-1"
              />
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2.5 h-[38px] w-[min(420px,32vw)] px-[13px] rounded-[11px] bg-text-primary/[0.05] border border-transparent text-text-faint text-[12.5px] transition-all hover:bg-text-primary/[0.08] hover:border-accent/30 max-md:w-[38px] max-md:px-0 max-md:justify-center"
            >
              <Search className="w-[15px]" />
              <span className="max-md:hidden">Search Hub…</span>
              <kbd className="ml-auto font-mono text-[10px] border border-line rounded-md px-1.5 py-px max-md:hidden">
                ⌘K
              </kbd>
            </button>
            {isDesktop && <ClockWidget compact={!isDesktop} />}
            <NotificationBell />
            {isDesktop && (
              <button
                onClick={handleHardRefresh}
                disabled={refreshing}
                aria-label="Hard refresh"
                title="Hard refresh"
                className="grid place-items-center w-[38px] h-[38px] rounded-[11px] bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/10 hover:text-text-primary transition-all disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("w-[18px]", refreshing && "animate-spin")}
                />
              </button>
            )}
            {isDesktop && (
              <button
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="grid place-items-center w-[38px] h-[38px] rounded-[11px] bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/10 hover:text-text-primary transition-all"
              >
                {theme === "dark" ? (
                  <Sun className="w-[18px]" />
                ) : (
                  <Moon className="w-[18px]" />
                )}
              </button>
            )}
            {!isDesktop && user && (
              <div className="relative" ref={accountRef}>
                <button
                  aria-label="Account"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((o) => !o)}
                  className="w-[38px] h-[38px] rounded-full overflow-hidden grid place-items-center font-display font-semibold text-[13px] text-white bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] shrink-0"
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    initials(user.name)
                  )}
                </button>
                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute z-[65] top-full right-0 mt-2 w-[230px] p-2 rounded-[15px] dropglass animate-fade-in"
                  >
                    <div className="flex items-center gap-[11px] p-[10px_10px_12px] border-b hairline mb-1.5">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] grid place-items-center shrink-0">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="font-display font-semibold text-white text-[14px]">
                            {initials(user.name)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-[13.5px] truncate">
                          {user.name}
                        </div>
                        <div className="text-[11px] text-text-faint truncate">
                          {user.email}
                        </div>
                      </div>
                    </div>
                    {ACCOUNT_MENU_ITEMS.map((it) => (
                      <button
                        key={it.key}
                        role="menuitem"
                        onClick={() => {
                          setAccountOpen(false);
                          onItem(it.key);
                        }}
                        className="w-full flex items-center gap-[11px] p-[9px_10px] rounded-[10px] text-[13px] font-medium text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-all"
                      >
                        <it.icon className="w-4 h-4" />
                        {it.label}
                      </button>
                    ))}
                    <div className="h-px bg-line/30 my-1.5 mx-1" />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        void onSignOut();
                      }}
                      className={cn(
                        "w-full flex items-center gap-[11px] p-[9px_10px] rounded-[10px] text-[13px] font-medium text-danger hover:bg-danger/10 transition-all",
                      )}
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <AccountMenuModals menu={menu} />
    </>
  );
}
