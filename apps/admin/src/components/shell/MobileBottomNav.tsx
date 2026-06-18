import { useRef, useCallback, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import { MODULE_BY_KEY, type AppModule } from "@/lib/modules";
import { useNavStore } from "@/stores/nav";

// ── Context map ────────────────────────────────────────────────────────────────
// Each route prefix maps to up to 4 module keys shown alongside the Hub tab.

const CONTEXT_MAP: [test: (p: string) => boolean, keys: string[]][] = [
  [(p) => p.startsWith("/contacts"), ["contacts", "crm", "smartcomm", "tasks"]],
  [(p) => p.startsWith("/crm"), ["crm", "contacts", "calendar", "sales"]],
  [
    (p) => p.startsWith("/sales") || p.startsWith("/invoicing"),
    ["sales", "invoicing", "contacts", "crm"],
  ],
  [
    (p) => p.startsWith("/stock") || p.startsWith("/catalogue"),
    ["catalogue", "stock", "purchasing", "contacts"],
  ],
  [
    (p) => p.startsWith("/procurement") || p.startsWith("/purchasing"),
    ["purchasing", "catalogue", "stock", "contacts"],
  ],
  [(p) => p.startsWith("/logistics"), ["logistics", "sales", "stock", "contacts"]],
  [(p) => p.startsWith("/expenses"), ["expenses", "purchasing", "invoicing", "contacts"]],
  [
    (p) => p.startsWith("/hr") || p.startsWith("/payroll"),
    ["hr", "tasks", "contacts", "calendar"],
  ],
  [(p) => p.startsWith("/praxis"), ["praxis", "contacts", "sales", "stock"]],
  [
    (p) => p.startsWith("/smartcomm") || p.startsWith("/messaging"),
    ["smartcomm", "contacts", "crm", "tasks"],
  ],
  [(p) => p.startsWith("/settings"), ["settings", "contacts", "sales", "stock"]],
];

// ── Resolve tabs ───────────────────────────────────────────────────────────────

interface BottomTab {
  key: string;
  label: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
}

function resolveModuleTabs(keys: string[]): BottomTab[] {
  return keys
    .map((k) => MODULE_BY_KEY[k])
    .filter((m): m is AppModule => !!m)
    .map((m) => ({
      key: m.key,
      label: m.label.split(" ")[0],
      route: m.route,
      icon: m.icon,
    }));
}

function tabsForRoute(pathname: string, pinned: string[], topKeys: string[]): BottomTab[] {
  // On Command Center (/): show pinned modules or default top-4
  if (pathname === "/") {
    const keys = pinned.length ? pinned : topKeys.slice(0, 4);
    return resolveModuleTabs(keys);
  }

  // Check the context map
  for (const [test, keys] of CONTEXT_MAP) {
    if (test(pathname)) {
      return resolveModuleTabs(keys);
    }
  }

  // Default: user's pinned modules or top-4 from nav store
  const keys = pinned.length ? pinned : topKeys.slice(0, 4);
  return resolveModuleTabs(keys);
}

// ── Pin toast ──────────────────────────────────────────────────────────────────

function PinToast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-[200]",
        "glass rounded-[10px] px-4 py-2 shadow-glass",
        "text-[12px] font-semibold text-text-primary",
        "transition-all duration-200",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2 pointer-events-none",
      )}
    >
      {message}
    </div>
  );
}

// ── Tab button with long-press ─────────────────────────────────────────────────

interface TabItemProps {
  tab: BottomTab;
  active: boolean;
  onLongPress: (key: string) => void;
}

function TabItem({ tab, active, onLongPress }: TabItemProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const longPressedRef = useRef(false);

  const onPointerDown = useCallback(() => {
    longPressedRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      onLongPress(tab.key);
    }, 500);
  }, [tab.key, onLongPress]);

  const onPointerUp = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  const onPointerCancel = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  const Icon = tab.icon;

  return (
    <NavLink
      to={tab.route}
      onClick={(e) => {
        // If it was a long press, prevent navigation
        if (longPressedRef.current) {
          e.preventDefault();
          longPressedRef.current = false;
        }
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "flex flex-col items-center gap-1 py-2.5 select-none touch-none",
        "transition-colors",
        active ? "text-accent-glow" : "text-text-faint hover:text-text-muted",
      )}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[9.5px] font-semibold uppercase tracking-wide">
        {tab.label}
      </span>
    </NavLink>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Mobile bottom nav: Hub (constant) + 4 context-aware module tabs. */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const pinnedBottomNav = useNavStore((s) => s.pinnedBottomNav);
  const top = useNavStore((s) => s.top);
  const toggleBottomNavPin = useNavStore((s) => s.toggleBottomNavPin);

  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const moduleTabs = tabsForRoute(pathname, pinnedBottomNav, top);

  const handleLongPress = useCallback(
    (key: string) => {
      // Haptic feedback
      navigator.vibrate?.(15);
      const pinned = toggleBottomNavPin(key);
      const mod = MODULE_BY_KEY[key];
      const label = mod ? mod.label.split(" ")[0] : key;
      setToast({
        msg: pinned ? `Pinned ${label} to bottom bar` : `Unpinned ${label} from bottom bar`,
        key: Date.now(),
      });
    },
    [toggleBottomNavPin],
  );

  return (
    <>
      <PinToast message={toast?.msg ?? ""} visible={!!toast} />
      <nav
        className="flex lg:hidden fixed bottom-0 inset-x-0 z-[60] glass border-t pb-[max(8px,env(safe-area-inset-bottom,0px))]"
        aria-label="Bottom navigation"
      >
        <div className="grid grid-cols-5 w-full">
          {/* Hub tab — always first, always present */}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 py-2.5 transition-colors relative",
                isActive
                  ? "text-accent-glow"
                  : "text-text-faint hover:text-text-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <LayoutGrid className="w-5 h-5" />
                  {!isActive && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent/50" />
                  )}
                </span>
                <span className="text-[9.5px] font-semibold uppercase tracking-wide">
                  Hub
                </span>
              </>
            )}
          </NavLink>

          {/* 4 context-aware module tabs */}
          {moduleTabs.slice(0, 4).map((tab) => {
            const active =
              pathname.startsWith(tab.route) && tab.route !== "/";
            return (
              <TabItem
                key={tab.key}
                tab={tab}
                active={active}
                onLongPress={handleLongPress}
              />
            );
          })}
        </div>
      </nav>
    </>
  );
}
