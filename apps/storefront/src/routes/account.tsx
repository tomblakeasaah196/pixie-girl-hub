import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  bootstrapAuth,
  getMe,
  getMyOrders,
  logout,
  type CustomerProfile,
} from "@/lib/auth";
import { fmt } from "@/lib/storefront";
import { Section, ErrorState } from "@/components/parts";
import { RetentionPanel } from "@/components/retention";

export const Route = createFileRoute("/account")({ component: AccountPage });

interface OrderRow {
  order_number: string;
  status: string;
  total_ngn: string;
  display_currency?: string;
  display_total?: string | null;
  created_at: string;
  public_tracking_token?: string;
}

function AccountPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const ok = await bootstrapAuth();
      if (!active) return;
      if (!ok) {
        navigate({ to: "/auth" });
        return;
      }
      try {
        const [p, o] = await Promise.all([getMe(), getMyOrders()]);
        if (!active) return;
        setProfile(p);
        setOrders(o);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  async function signOut() {
    await logout();
    navigate({ to: "/" });
  }

  if (state === "loading")
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading your account...</p>
      </Section>
    );
  if (state === "error")
    return (
      <Section>
        <ErrorState onRetry={() => window.location.reload()} />
      </Section>
    );

  return (
    <Section className="max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-caption">Account</p>
          <h1 className="mt-2 text-h3 font-display">
            {profile?.display_name || profile?.email}
          </h1>
          {profile?.email ? (
            <p className="text-body-sm text-muted-foreground">{profile.email}</p>
          ) : null}
        </div>
        <button
          onClick={signOut}
          className="rounded-full border border-border px-4 py-1.5 text-body-sm hover:bg-secondary"
        >
          Sign out
        </button>
      </div>

      {/* Loyalty · referral · rewards (§6.23) */}
      <RetentionPanel />

      <h2 className="mt-10 text-h5 font-display">Orders</h2>
      {orders.length === 0 ? (
        <p className="mt-4 text-body text-muted-foreground">
          You have no orders yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {orders.map((o) => (
            <li key={o.order_number} className="flex items-center justify-between py-3">
              <div>
                <p className="text-body">{o.order_number}</p>
                <p className="text-body-sm capitalize text-muted-foreground">
                  {String(o.status).replace(/_/g, " ")} -{" "}
                  {new Date(o.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-body-sm">
                  {o.display_currency === "USD" && o.display_total
                    ? fmt(o.display_total, "USD")
                    : fmt(o.total_ngn, "NGN")}
                </span>
                {o.public_tracking_token ? (
                  <Link
                    to="/track/$token"
                    params={{ token: o.public_tracking_token }}
                    className="text-body-sm underline"
                  >
                    Track
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
