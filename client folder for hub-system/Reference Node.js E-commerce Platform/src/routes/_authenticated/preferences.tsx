import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const Route = createFileRoute("/_authenticated/preferences")({
  head: () => ({
    meta: [
      { title: "Email Preferences — Faitlyn Hair" },
      { name: "description", content: "Choose which Faitlyn emails reach your inbox." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreferencesPage,
});

type Prefs = {
  email_order_updates: boolean;
  email_concierge: boolean;
  email_marketing: boolean;
  email_loyalty: boolean;
};

const CHANNELS: { key: keyof Prefs; title: string; desc: string; essential?: boolean }[] = [
  {
    key: "email_order_updates",
    title: "Order updates",
    desc: "Confirmation, preparation, shipping, delivery and cancellation notices for every order you place.",
  },
  {
    key: "email_concierge",
    title: "Concierge replies",
    desc: "Personal responses from our atelier team on bespoke requests and consultations.",
  },
  {
    key: "email_loyalty",
    title: "Loyalty & referrals",
    desc: "Points earned, referral credit, and tier upgrades. Never promotional.",
  },
  {
    key: "email_marketing",
    title: "New drops & dispatches",
    desc: "Limited collections, editorials, and atelier news. Sent sparingly — never more than monthly.",
  },
];

function PreferencesPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("email_order_updates, email_concierge, email_marketing, email_loyalty")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPrefs({
          email_order_updates: data?.email_order_updates ?? true,
          email_concierge: data?.email_concierge ?? true,
          email_marketing: data?.email_marketing ?? false,
          email_loyalty: data?.email_loyalty ?? true,
        });
      });
  }, [user]);

  async function save(next: Prefs) {
    if (!user) return;
    setPrefs(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update(next)
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Preferences saved");
  }

  function toggle(key: keyof Prefs) {
    if (!prefs) return;
    save({ ...prefs, [key]: !prefs[key] });
  }

  async function unsubscribeAll() {
    if (!prefs) return;
    save({
      email_order_updates: false,
      email_concierge: false,
      email_marketing: false,
      email_loyalty: false,
    });
  }

  return (
    <div className="min-h-screen text-cream">
      <SiteHeader />
      <main className="pt-40 pb-24 px-6">
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link
              to="/account"
              className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe/70 hover:text-cream"
            >
              ← Back to account
            </Link>
            <p className="mt-8 text-[0.62rem] tracking-[0.5em] uppercase text-rose">
              Inbox · curated
            </p>
            <h1 className="font-display text-5xl md:text-7xl mt-3 leading-[0.95]">
              Email <em className="disrupt-rose">preferences</em>
            </h1>
            <p className="mt-5 text-cream/65 max-w-xl leading-relaxed">
              Decide exactly what lands in your inbox from {user?.email}. Toggle anything off, anytime.
              Order and concierge messages are highly recommended — without them you may miss a delivery
              or a reply from the atelier.
            </p>
          </motion.div>

          <div className="mt-14 space-y-3">
            {!prefs && (
              <div className="h-24 border border-taupe/10 animate-pulse bg-card/30" />
            )}
            {prefs &&
              CHANNELS.map((c, i) => (
                <motion.div
                  key={c.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.05 * i }}
                  className="group border border-taupe/15 bg-card/40 backdrop-blur-sm p-6 md:p-7 flex items-start justify-between gap-6 hover:border-taupe/35 transition-colors"
                >
                  <div className="min-w-0">
                    <h3 className="font-display text-2xl md:text-3xl">{c.title}</h3>
                    <p className="text-sm text-cream/60 mt-2 leading-relaxed max-w-lg">{c.desc}</p>
                  </div>
                  <Toggle
                    checked={prefs[c.key]}
                    onChange={() => toggle(c.key)}
                    disabled={saving}
                  />
                </motion.div>
              ))}
          </div>

          {prefs && (
            <div className="mt-14 pt-10 border-t border-taupe/15 flex flex-wrap items-center justify-between gap-6">
              <p className="text-xs text-cream/55 max-w-md leading-relaxed">
                Unsubscribing from everything is permanent until you re-enable a channel here. We'll still
                send legally required account notices.
              </p>
              <button
                onClick={unsubscribeAll}
                className="text-[0.62rem] tracking-[0.4em] uppercase text-rose/90 hover:text-rose border-b border-rose/40 hover:border-rose pb-1 transition-colors"
              >
                Unsubscribe from all
              </button>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      className={`relative shrink-0 w-14 h-7 rounded-full border transition-all ${
        checked
          ? "bg-taupe/90 border-taupe"
          : "bg-ink border-taupe/30 hover:border-taupe/60"
      } disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
          checked ? "translate-x-7 bg-ink" : "translate-x-0 bg-taupe/60"
        }`}
      />
    </button>
  );
}
