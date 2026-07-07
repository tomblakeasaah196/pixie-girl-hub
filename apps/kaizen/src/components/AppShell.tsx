import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { logout } from "@/lib/api";
import { NAV } from "@/components/nav";
import { cx } from "@/lib/cx";

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber to-signal-red shadow-[0_0_18px_rgba(245,166,35,0.4)]" />
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold">
          Kai<span className="text-amber">zen</span>
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fog-400">
          Ops Console
        </div>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-6 flex flex-col gap-1 px-2">
      {NAV.map(({ to, label, icon: Icon, soon, phase }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-amber/15 text-amber"
                : "text-fog-300 hover:bg-ink-700/60 hover:text-fog-100",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{label}</span>
          {soon && (
            <span
              title={phase}
              className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fog-400"
            >
              Soon
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const operator = useAuth((s) => s.operator);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-ink-950">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-line/60 bg-ink-900/60 py-5 lg:block">
        <Brand />
        <NavList />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-line/60 bg-ink-900 py-5">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} className="text-fog-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line/60 bg-ink-900/40 px-4 py-3 lg:px-8">
          <button
            className="text-fog-300 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-fog-100">
                {operator?.display_name}
              </div>
              <div className="text-xs text-fog-400">{operator?.email}</div>
            </div>
            <button
              onClick={onLogout}
              className="btn-ghost"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
