import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { portalApi, type ApiError } from "@/lib/api";

/** Public profile + payout details (§6.26: Pixie collects payout details). */
export const Route = createFileRoute("/dashboard/profile")({
  component: Profile,
});

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="micro block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-cream-faint mt-1">{hint}</p>}
    </div>
  );
}

function Profile() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["portal-me"], queryFn: portalApi.me });
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [bank, setBank] = useState({
    payout_bank_name: "",
    payout_account_number: "",
    payout_account_name: "",
  });

  useEffect(() => {
    const p = me.data;
    if (!p) return;
    setProfile({
      bio: p.bio ?? "",
      portfolio_url: p.portfolio_url ?? "",
      instagram_url: p.instagram_url ?? "",
      website_url: p.website_url ?? "",
      city: p.city,
      state: p.state ?? "",
      country_code: p.country_code,
    });
  }, [me.data]);

  const saveProfile = useMutation({
    mutationFn: () => {
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(profile)) if (v.trim()) patch[k] = v.trim();
      return portalApi.updateMe(patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-me"] }),
  });
  const saveBank = useMutation({
    mutationFn: () =>
      portalApi.updatePayoutDetails(
        Object.fromEntries(Object.entries(bank).filter(([, v]) => v.trim())),
      ),
    onSuccess: () => {
      setBank({ payout_bank_name: "", payout_account_number: "", payout_account_name: "" });
      qc.invalidateQueries({ queryKey: ["portal-me"] });
    },
  });

  if (me.isLoading)
    return <div className="h-72 rounded-xl2 bg-cream/5 animate-pulse max-w-2xl" />;

  const p = me.data!;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="max-w-2xl space-y-8">
      <section className="glass rounded-xl2 p-6 space-y-4">
        <h2 className="font-display text-[18px]">Public profile</h2>
        <Field label="Bio" hint="Shown in the public directory.">
          <textarea className="input min-h-[90px]" value={profile.bio ?? ""} onChange={set("bio")} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Portfolio URL">
            <input className="input" value={profile.portfolio_url ?? ""} onChange={set("portfolio_url")} />
          </Field>
          <Field label="Instagram">
            <input className="input" value={profile.instagram_url ?? ""} onChange={set("instagram_url")} />
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="City">
            <input className="input" value={profile.city ?? ""} onChange={set("city")} />
          </Field>
          <Field label="State">
            <input className="input" value={profile.state ?? ""} onChange={set("state")} />
          </Field>
          <Field label="Country">
            <input className="input font-mono uppercase" maxLength={3} value={profile.country_code ?? ""} onChange={set("country_code")} />
          </Field>
        </div>
        <button className="btn-primary" disabled={saveProfile.isPending} onClick={() => saveProfile.mutate()}>
          {saveProfile.isPending ? "Saving…" : saveProfile.isSuccess ? "Saved ✓" : "Save profile"}
        </button>
        {saveProfile.isError && (
          <p className="text-danger text-[12.5px]">
            {(saveProfile.error as ApiError).userMessage}
          </p>
        )}
      </section>

      <section className="glass rounded-xl2 p-6 space-y-4">
        <h2 className="font-display text-[18px]">Payout account</h2>
        <p className="text-[12.5px] text-cream-muted -mt-2">
          {p.payout_bank_name
            ? `On file: ${p.payout_bank_name} · ${p.payout_account_name ?? ""} (${p.payout_currency}). Enter new details to replace them.`
            : "Pixie pays you here after each approved payout. Nigerian bank accounts settle in NGN."}
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Bank name">
            <input
              className="input"
              value={bank.payout_bank_name}
              onChange={(e) => setBank((b) => ({ ...b, payout_bank_name: e.target.value }))}
            />
          </Field>
          <Field label="Account number">
            <input
              className="input font-mono"
              inputMode="numeric"
              value={bank.payout_account_number}
              onChange={(e) => setBank((b) => ({ ...b, payout_account_number: e.target.value }))}
            />
          </Field>
          <Field label="Account name">
            <input
              className="input"
              value={bank.payout_account_name}
              onChange={(e) => setBank((b) => ({ ...b, payout_account_name: e.target.value }))}
            />
          </Field>
        </div>
        <button
          className="btn-primary"
          disabled={
            saveBank.isPending ||
            !(bank.payout_bank_name && bank.payout_account_number && bank.payout_account_name)
          }
          onClick={() => saveBank.mutate()}
        >
          {saveBank.isPending ? "Saving…" : saveBank.isSuccess ? "Saved ✓" : "Update payout account"}
        </button>
        {saveBank.isError && (
          <p className="text-danger text-[12.5px]">
            {(saveBank.error as ApiError).userMessage}
          </p>
        )}
      </section>
    </div>
  );
}
