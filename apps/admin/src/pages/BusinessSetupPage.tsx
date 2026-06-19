import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Eye,
  EyeOff,
  FileSignature,
  Loader2,
  Palette,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Card, Pill } from "@/components/ui/primitives";
import { Field, TextInput, SaveBar } from "@/components/ui/Form";
import {
  ErrorState,
  NumberField,
  ReauthDialog,
  Select,
  Toggle,
} from "@/components/ui/controls";
import { useActiveBusiness } from "@/stores/business";
import {
  useBusinessConfig,
  useSaveBusinessConfig,
  type BusinessConfig,
} from "@/lib/settings";

type Tab = "profile" | "financial" | "identity" | "policies";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "financial", label: "Financial" },
  { key: "identity", label: "Identity" },
  { key: "policies", label: "Policies" },
];

/**
 * Business Setup — Profile / Financial / Identity / Policies tabs over
 * the active brand's business_config row. Preview-first dirty save like
 * AppearancePage; only the diff is patched.
 *
 * Sensitive fields (tin, vat_number, cac_number) are masked by default;
 * a "Reveal/Edit" click opens ReauthDialog (re-confirm the user's
 * password) before unlocking the input locally. The password gate is
 * UI-only for now (TODO: verify against /auth/verify-password once the
 * endpoint exists); the value still never leaves the page in cleartext.
 */
export function BusinessSetupPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Business Setup" },
  ]);
  const biz = useActiveBusiness();
  const cfg = useBusinessConfig();
  const save = useSaveBusinessConfig();

  const [tab, setTab] = useState<Tab>("profile");
  const [draft, setDraft] = useState<BusinessConfig | null>(null);
  useEffect(() => {
    if (cfg.data) setDraft(cfg.data);
  }, [cfg.data]);

  const dirty = useMemo(
    () =>
      !!(
        cfg.data &&
        draft &&
        JSON.stringify(cfg.data) !== JSON.stringify(draft)
      ),
    [cfg.data, draft],
  );
  const set = <K extends keyof BusinessConfig>(k: K, v: BusinessConfig[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const onSave = () => {
    if (!draft || !cfg.data) return;
    const patch: Partial<BusinessConfig> = {};
    (Object.keys(draft) as (keyof BusinessConfig)[]).forEach((k) => {
      if (JSON.stringify(draft[k]) !== JSON.stringify(cfg.data![k])) {
        (patch as Record<string, unknown>)[k] = draft[k];
      }
    });
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  };

  if (cfg.isLoading)
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading business setup…
      </div>
    );
  if (cfg.isError)
    return (
      <ErrorState
        message={(cfg.error as Error)?.message}
        onRetry={() => cfg.refetch()}
      />
    );
  if (!draft) return null;

  return (
    <div className="max-w-[860px] mx-auto pb-24">
      <div className="flex items-center gap-3 mb-1">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Building2 className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Business Setup
          </h2>
          <p className="text-text-muted text-[13px]">
            Profile, financial, identity & policies for{" "}
            <span className="text-text-primary font-semibold">{biz.name}</span>.
          </p>
        </div>
      </div>

      <div className="flex gap-1 mt-5 mb-4 bg-text-primary/[0.04] rounded-[10px] p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3.5 py-1.5 rounded-[8px] text-[12.5px] font-semibold transition-colors",
              tab === t.key
                ? "bg-accent/15 text-accent-glow"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab draft={draft} set={set} />}
      {tab === "financial" && <FinancialTab draft={draft} set={set} />}
      {tab === "identity" && <IdentityTab draft={draft} set={set} />}
      {tab === "policies" && <OperationalPoliciesTab draft={draft} set={set} />}

      {dirty && (
        <div className="sticky bottom-4 mt-6">
          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            onSave={onSave}
            onCancel={() => setDraft(cfg.data!)}
          />
        </div>
      )}
    </div>
  );
}

// ── PROFILE ────────────────────────────────────────────────
function ProfileTab({
  draft,
  set,
}: {
  draft: BusinessConfig;
  set: <K extends keyof BusinessConfig>(k: K, v: BusinessConfig[K]) => void;
}) {
  return (
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Display name">
          <TextInput
            value={draft.display_name}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </Field>
        <Field label="Legal name">
          <TextInput
            value={draft.legal_name}
            onChange={(e) => set("legal_name", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Address">
        <TextInput
          value={draft.address ?? ""}
          onChange={(e) => set("address", e.target.value || null)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Phone">
          <TextInput
            value={draft.phone ?? ""}
            onChange={(e) => set("phone", e.target.value || null)}
          />
        </Field>
        <Field label="Email">
          <TextInput
            value={draft.email ?? ""}
            onChange={(e) => set("email", e.target.value || null)}
          />
        </Field>
        <Field label="Website">
          <TextInput
            value={draft.website ?? ""}
            onChange={(e) => set("website", e.target.value || null)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <SensitiveField
          label="TIN"
          hint="Tax Identification Number"
          value={draft.tin ?? ""}
          onChange={(v) => set("tin", v || null)}
        />
        <SensitiveField
          label="CAC number"
          value={draft.cac_number ?? ""}
          onChange={(v) => set("cac_number", v || null)}
        />
        <SensitiveField
          label="VAT number"
          value={draft.vat_number ?? ""}
          onChange={(v) => set("vat_number", v || null)}
        />
      </div>
      <Field label="Mission statement" hint="Shown on the staff portal">
        <textarea
          value={draft.mission_statement ?? ""}
          onChange={(e) => set("mission_statement", e.target.value || null)}
          rows={3}
          className="w-full px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none"
        />
      </Field>
    </Card>
  );
}

// ── FINANCIAL ──────────────────────────────────────────────
function FinancialTab({
  draft,
  set,
}: {
  draft: BusinessConfig;
  set: <K extends keyof BusinessConfig>(k: K, v: BusinessConfig[K]) => void;
}) {
  // vat_rate / wht_rate come as decimal strings from the API
  // (e.g. "0.0750"); we present them as percent and convert on edit.
  const vatPct = String((parseFloat(draft.vat_rate) * 100).toFixed(2)).replace(
    /\.?0+$/,
    "",
  );
  const whtPct = String((parseFloat(draft.wht_rate) * 100).toFixed(2)).replace(
    /\.?0+$/,
    "",
  );
  return (
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="VAT rate" hint="Percent">
          <NumberField
            value={vatPct}
            onChange={(v) => set("vat_rate", String(Number(v || "0") / 100))}
            suffix="%"
          />
        </Field>
        <Field label="WHT rate" hint="Percent">
          <NumberField
            value={whtPct}
            onChange={(v) => set("wht_rate", String(Number(v || "0") / 100))}
            suffix="%"
          />
        </Field>
        <Field label="Fiscal year start">
          <Select<string>
            value={String(draft.fiscal_year_start)}
            onChange={(v) => set("fiscal_year_start", Number(v))}
            options={Array.from({ length: 12 }, (_, i) => ({
              value: String(i + 1),
              label: new Date(2000, i, 1).toLocaleString("en", {
                month: "long",
              }),
            }))}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3 py-2">
        <Toggle
          checked={draft.allow_staff_recorded_manual_payments}
          onChange={(v) => set("allow_staff_recorded_manual_payments", v)}
          label={
            <span className="text-[13px]">
              Allow staff-recorded manual payments{" "}
              <span className="text-text-faint">(off until Finance hire)</span>
            </span>
          }
        />
      </div>
      <div className="text-[12px] text-text-muted">
        Currencies, FX rates and per-gateway fees live in their dedicated tiles:
        <Link
          to="/settings/currencies"
          className="ml-1 text-accent-glow hover:underline"
        >
          Currencies & FX
        </Link>
        {" · "}
        <Link
          to="/settings/payment-gateways"
          className="text-accent-glow hover:underline"
        >
          Payment Gateways
        </Link>
        {" · "}
        <Link
          to="/settings/tax-rates"
          className="text-accent-glow hover:underline"
        >
          Tax Rates
        </Link>
        .
      </div>
      <Field
        label="Installment defaults"
        hint="Per-business defaults; products may override"
      >
        <JsonScalarEditor
          value={draft.installment_settings as Record<string, unknown>}
          onChange={(v) =>
            set(
              "installment_settings",
              v as BusinessConfig["installment_settings"],
            )
          }
        />
      </Field>
    </Card>
  );
}

// ── IDENTITY ───────────────────────────────────────────────
function IdentityTab({
  draft,
  set,
}: {
  draft: BusinessConfig;
  set: <K extends keyof BusinessConfig>(k: K, v: BusinessConfig[K]) => void;
}) {
  const voice = draft.praxis_voice_profile || {};
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="micro">Document identity</div>
        <Field
          label="Document prefix"
          hint="Locks on first issued document — manage in Document Numbering"
        >
          <TextInput value={draft.document_prefix} disabled />
        </Field>
        <div className="text-[12px] text-text-muted">
          Logo, accents, gradients and fonts live in{" "}
          <Link
            to="/settings/appearance"
            className="text-accent-glow hover:underline inline-flex items-center gap-1"
          >
            <Palette className="w-3.5 h-3.5" /> Appearance
          </Link>{" "}
          — both the platform skin (Layer A) and per-brand identity (Layer B).
        </div>
        <div className="text-[12px] text-text-muted">
          Document templates live in{" "}
          <Link
            to="/settings/document-templates"
            className="text-accent-glow hover:underline inline-flex items-center gap-1"
          >
            <FileSignature className="w-3.5 h-3.5" /> Document Templates
          </Link>
          ; bank accounts in{" "}
          <Link
            to="/settings/bank-accounts"
            className="text-accent-glow hover:underline inline-flex items-center gap-1"
          >
            <Wallet className="w-3.5 h-3.5" /> Bank Accounts
          </Link>
          .
        </div>
      </Card>

      {/* Public Identity — the dynamic hostnames + Praxis voice + viewer ticker. */}
      <Card className="p-5 space-y-4">
        <div>
          <div className="micro">Public identity</div>
          <p className="text-[12.5px] text-text-muted mt-1">
            Dynamic hostnames for this brand's storefront and sales landing
            page, plus the Praxis voice profile used when drafting campaign
            copy.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Storefront domain"
            hint="Public site, e.g. pixiegirlglobal.com"
          >
            <TextInput
              value={draft.storefront_domain || ""}
              onChange={(e) => set("storefront_domain", e.target.value || null)}
              placeholder="pixiegirlglobal.com"
            />
          </Field>
          <Field
            label="Sales subdomain"
            hint="Public sales landing host, e.g. sales.pixiegirlglobal.com"
          >
            <TextInput
              value={draft.sales_subdomain || ""}
              onChange={(e) => set("sales_subdomain", e.target.value || null)}
              placeholder="sales.pixiegirlglobal.com"
            />
          </Field>
        </div>
        <div className="text-[12px] text-text-muted">
          Point a DNS <span className="font-mono">CNAME</span> from your sales
          subdomain to the platform host. The host-based brand resolver reads
          this column on every request — no code deploy needed when you change
          the domain.
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <div className="micro">Praxis brand voice</div>
          <p className="text-[12.5px] text-text-muted mt-1">
            Loaded as a system prompt every time Praxis drafts campaign copy.
            Hard rails always on: no fabricated reviews, no banned superlatives.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Tone">
            <Select<string>
              value={voice.tone || "editorial-luxury"}
              onChange={(v) =>
                set("praxis_voice_profile", {
                  ...(voice as Record<string, unknown>),
                  tone: v,
                })
              }
              options={[
                {
                  value: "editorial-luxury",
                  label: "Pixie Global · Editorial luxury",
                },
                {
                  value: "confident-beauty-bar",
                  label: "Faitlyn · Confident beauty-bar",
                },
                { value: "warm-curatorial", label: "Warm curatorial" },
                { value: "playful-energetic", label: "Playful energetic" },
              ]}
            />
          </Field>
          <Field label="Exclamation policy">
            <Select<string>
              value={voice.exclamation_policy || "rare"}
              onChange={(v) =>
                set("praxis_voice_profile", {
                  ...(voice as Record<string, unknown>),
                  exclamation_policy: v as "never" | "rare" | "ok",
                })
              }
              options={[
                { value: "never", label: "Never" },
                { value: "rare", label: "Rare (at most one per page)" },
                { value: "ok", label: "OK (normal)" },
              ]}
            />
          </Field>
        </div>
        <Field
          label="Banned words"
          hint="Comma-separated — Praxis refuses these in every draft"
        >
          <TextInput
            value={(voice.banned_words || []).join(", ")}
            onChange={(e) =>
              set("praxis_voice_profile", {
                ...(voice as Record<string, unknown>),
                banned_words: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="cheap, amazing deal, guaranteed, best ever"
          />
        </Field>
        <Field label="No fabricated reviews">
          <Toggle
            checked={voice.no_fabricated_reviews !== false}
            onChange={(v) =>
              set("praxis_voice_profile", {
                ...(voice as Record<string, unknown>),
                no_fabricated_reviews: v,
              })
            }
            label="Refuse to invent customer reviews or testimonials"
          />
        </Field>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <div className="micro">Live viewer ticker default</div>
          <p className="text-[12.5px] text-text-muted mt-1">
            Default for every new campaign on this brand. Per-campaign override
            available in the builder.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Display policy">
            <Select<string>
              value={draft.show_viewer_count_policy || "smart"}
              onChange={(v) =>
                set(
                  "show_viewer_count_policy",
                  v as BusinessConfig["show_viewer_count_policy"],
                )
              }
              options={[
                { value: "smart", label: "Smart (auto-hide below floor)" },
                { value: "on", label: "Always show" },
                { value: "off", label: "Always hide" },
              ]}
            />
          </Field>
          <Field
            label="Viewer floor"
            hint="Below this concurrent count, smart-mode hides the number"
          >
            <NumberField
              value={String(draft.viewer_count_floor ?? 20)}
              onChange={(v) => set("viewer_count_floor", v ? Number(v) : 20)}
              allowDecimal={false}
              suffix="viewers"
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}

// ── OPERATIONAL POLICIES (the JSONB blobs on business_config) ──
function OperationalPoliciesTab({
  draft,
  set,
}: {
  draft: BusinessConfig;
  set: <K extends keyof BusinessConfig>(k: K, v: BusinessConfig[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="micro">Cancellation</div>
        <JsonScalarEditor
          value={draft.cancellation_settings as Record<string, unknown>}
          onChange={(v) =>
            set(
              "cancellation_settings",
              v as BusinessConfig["cancellation_settings"],
            )
          }
        />
      </Card>
      <Card className="p-5 space-y-3">
        <div className="micro">Loyalty defaults</div>
        <JsonScalarEditor
          value={draft.loyalty_settings as Record<string, unknown>}
          onChange={(v) =>
            set("loyalty_settings", v as BusinessConfig["loyalty_settings"])
          }
        />
      </Card>
      <Card className="p-5 space-y-3">
        <div className="micro">Intercompany</div>
        <JsonScalarEditor
          value={draft.intercompany_settings as Record<string, unknown>}
          onChange={(v) =>
            set(
              "intercompany_settings",
              v as BusinessConfig["intercompany_settings"],
            )
          }
        />
      </Card>
      <Card className="p-5">
        <div className="micro mb-2">Legal & business policies</div>
        <p className="text-[12.5px] text-text-muted leading-relaxed">
          Privacy Policy, Refund Policy, Quality Management Statement, Terms,
          Cookie Policy and similar are managed in their own editor (versioned,
          publishable). Storefront Studio reads the published ones to decide
          which appear on the public website and where.
        </p>
        <Link
          to="/settings/policies"
          className="mt-3 inline-flex items-center gap-1.5 text-accent-glow text-[13px] hover:underline"
        >
          Open Business Policies →
        </Link>
      </Card>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function SensitiveField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [askPw, setAskPw] = useState(false);
  const masked = "•".repeat(Math.max(0, value.length - 4)) + value.slice(-4);
  return (
    <>
      <Field label={label} hint={hint}>
        <div className="relative flex items-center">
          <TextInput
            value={revealed ? value : masked || ""}
            onChange={(e) => revealed && onChange(e.target.value)}
            disabled={!revealed}
            placeholder="—"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => (revealed ? setRevealed(false) : setAskPw(true))}
            className="absolute right-2 p-1 rounded text-text-muted hover:text-text-primary"
            aria-label={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </Field>
      <ReauthDialog
        open={askPw}
        onClose={() => setAskPw(false)}
        action={`edit ${label}`}
        onConfirm={() => {
          // TODO: verify against /auth/verify-password once available.
          // Until then, the dialog is the UX gate; the secret never
          // leaves the page in cleartext anyway.
          setAskPw(false);
          setRevealed(true);
        }}
      />
    </>
  );
}

/** Generic editor for a flat {string: number|boolean|string} object. */
function JsonScalarEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const v = value ?? {};
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return <div className="text-text-faint text-[12px]">No keys set.</div>;
  }
  return (
    <div className="space-y-2">
      {keys.map((k) => {
        const val = v[k];
        const set = (next: unknown) => onChange({ ...v, [k]: next });
        if (typeof val === "boolean") {
          return (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-text-muted">
                {k.replace(/_/g, " ")}
              </span>
              <Toggle checked={val} onChange={set} />
            </div>
          );
        }
        if (typeof val === "number") {
          return (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-text-muted">
                {k.replace(/_/g, " ")}
              </span>
              <div className="w-[140px]">
                <NumberField
                  value={String(val)}
                  onChange={(s) => set(s === "" ? 0 : Number(s))}
                />
              </div>
            </div>
          );
        }
        if (typeof val === "string") {
          return (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-text-muted">
                {k.replace(/_/g, " ")}
              </span>
              <div className="w-[200px]">
                <TextInput value={val} onChange={(e) => set(e.target.value)} />
              </div>
            </div>
          );
        }
        // Nested object / array — read-only display.
        return (
          <div key={k} className="flex items-start justify-between gap-3">
            <span className="text-[12.5px] text-text-muted">
              {k.replace(/_/g, " ")}
            </span>
            <code className="text-[11px] text-text-faint font-mono whitespace-pre-wrap text-right max-w-[60%]">
              {JSON.stringify(val)}
            </code>
          </div>
        );
      })}
      <p className="text-[11px] text-text-faint pt-2">
        Use{" "}
        <Pill tone="info" dot={false}>
          API
        </Pill>{" "}
        for nested edits (this editor handles flat primitives).
      </p>
    </div>
  );
}
