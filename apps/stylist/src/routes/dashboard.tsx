import { useState } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut } from "lucide-react";
import {
  portalApi,
  getStylistToken,
  setStylistToken,
  type ApiError,
} from "@/lib/api";

/**
 * Partner dashboard layout (§6.26 section C): auth guard + sub-nav +
 * notifications. The stylist token is scoped server-side to their own rows
 * (hub_stylist role) — the layout only decides what to render.
 */
export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Partner dashboard — Pixie Girl Style" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DashboardLayout,
});

const NAV = [
  ["/dashboard", "Overview"],
  ["/dashboard/offers", "Offers"],
  ["/dashboard/jobs", "Jobs"],
  ["/dashboard/earnings", "Earnings"],
  ["/dashboard/referrals", "Referrals"],
  ["/dashboard/badge", "Badge"],
  ["/dashboard/contract", "Contract"],
  ["/dashboard/profile", "Profile"],
] as const;

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal-notifications"],
    queryFn: () => portalApi.notifications(),
  });
  return (
    <div className="absolute right-0 top-12 w-[340px] max-h-[420px] overflow-y-auto glass rounded-xl2 p-3 z-50">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="micro">Notifications</span>
        <button
          className="text-[11px] text-cream-muted hover:text-cream"
          onClick={async () => {
            await portalApi.markAllNotificationsRead();
            qc.invalidateQueries({ queryKey: ["portal-notifications"] });
            qc.invalidateQueries({ queryKey: ["portal-me"] });
            onClose();
          }}
        >
          Mark all read
        </button>
      </div>
      {q.isLoading && (
        <div className="space-y-2 p-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-cream/5 animate-pulse" />
          ))}
        </div>
      )}
      {(q.data ?? []).map((n) => (
        <div
          key={n.notification_id}
          className={`px-3 py-2.5 rounded-xl mb-1 ${n.read_at ? "opacity-55" : "bg-cream/[0.04]"}`}
        >
          <p className="text-[12.5px] font-semibold">{n.title}</p>
          {n.body && <p className="text-[11.5px] text-cream-muted">{n.body}</p>}
          <p className="text-[10px] text-cream-faint mt-1">
            {new Date(n.created_at).toLocaleString()}
          </p>
        </div>
      ))}
      {q.data && q.data.length === 0 && (
        <p className="text-[12px] text-cream-faint p-3">Nothing yet.</p>
      )}
    </div>
  );
}

function DashboardLayout() {
  const navigate = useNavigate();
  const [bellOpen, setBellOpen] = useState(false);
  const me = useQuery({
    queryKey: ["portal-me"],
    queryFn: portalApi.me,
    retry: false,
    enabled: typeof window !== "undefined" && !!getStylistToken(),
  });

  if (typeof window !== "undefined" && !getStylistToken()) {
    navigate({ to: "/login" });
    return null;
  }
  if (me.isError) {
    const status = (me.error as ApiError).httpStatus;
    if (status === 401) {
      setStylistToken(null);
      navigate({ to: "/login" });
      return null;
    }
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-danger text-[14px] mb-4">
          {(me.error as ApiError).userMessage}
        </p>
        <button className="btn-ghost" onClick={() => me.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const p = me.data;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-start justify-between gap-4 mb-6 relative">
        <div>
          <p className="micro mb-1">Partner dashboard</p>
          <h1 className="font-display text-[28px] leading-tight">
            {p ? p.display_name : "…"}
          </h1>
          {p && (
            <p className="text-[12px] text-cream-faint font-mono mt-0.5">
              {p.partner_code}
              {p.tier_label && <> · {p.tier_label}</>}
              {p.on_probation && " · probation"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="relative grid place-items-center w-10 h-10 rounded-full glass"
            onClick={() => setBellOpen((v) => !v)}
            aria-label="Notifications"
          >
            <Bell className="w-4.5 h-4.5" />
            {p && p.unread_notifications > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-accent text-[10px] font-bold">
                {p.unread_notifications}
              </span>
            )}
          </button>
          <button
            className="grid place-items-center w-10 h-10 rounded-full glass"
            aria-label="Sign out"
            onClick={() => {
              setStylistToken(null);
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
          {bellOpen && <NotificationsPanel onClose={() => setBellOpen(false)} />}
        </div>
      </div>

      <nav className="flex gap-1.5 flex-wrap mb-8">
        {NAV.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/dashboard" }}
            activeProps={{
              className: "!bg-accent-deep !text-cream !border-accent-deep",
            }}
            className="px-4 py-2 rounded-full text-[12.5px] font-semibold text-cream-muted border border-line no-underline hover:text-cream transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
