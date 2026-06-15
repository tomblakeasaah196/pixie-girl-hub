import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Plug } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, NumberField, Select, Toggle } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useBusinessConfig,
  useConfigureGateway,
  usePaymentGateways,
  useSaveBusinessConfig,
  useSetGatewayActive,
  useSetGatewayRole,
  type PaymentGateway,
} from "@/lib/settings";

/**
 * Settings → Payment gateways. One card per known provider (merged with
 * configured rows). Secrets are write-only. A fee schedule lives in
 * business config keyed by provider.
 */

const PROVIDERS: PaymentGateway["provider"][] = ["paystack", "opay", "nomba", "stripe"];
const PROVIDER_LABEL: Record<PaymentGateway["provider"], string> = {
  paystack: "Paystack",
  opay: "OPay",
  nomba: "Nomba",
  stripe: "Stripe",
};
const ROLE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "fallback", label: "Fallback" },
  { value: "standalone", label: "Standalone" },
];

interface GatewayFee {
  pct?: number | string;
  fixed?: number | string;
  cap_ngn?: number | string;
}

export function PaymentGatewaysPage() {
  const active = useActiveBusiness();
  const query = usePaymentGateways();

  const byProvider = new Map((query.data ?? []).map((g) => [g.provider, g]));
  const cards: { provider: PaymentGateway["provider"]; row?: PaymentGateway }[] = PROVIDERS.map(
    (p) => ({ provider: p, row: byProvider.get(p) }),
  );

  const [configuring, setConfiguring] = useState<PaymentGateway["provider"] | null>(null);

  return (
    <div className="max-w-[960px] space-y-7 pb-24">
      <header>
        <div className="flex items-center gap-2.5 mb-1.5">
          <h1 className="font-display text-[22px] font-medium">Payment gateways</h1>
          <Pill tone="accent" dot={false}>
            Editing for: {active.name}
          </Pill>
        </div>
        <p className="text-xs text-text-muted">
          Connect providers, set roles, and manage write-only credentials. Secrets
          are never displayed once saved.
        </p>
      </header>

      {query.isError ? (
        <Card>
          <ErrorState onRetry={() => query.refetch()} />
        </Card>
      ) : query.isLoading ? (
        <div className="flex items-center gap-2 text-text-muted py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading gateways…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <GatewayCard
              key={c.provider}
              provider={c.provider}
              row={c.row}
              onConfigure={() => setConfiguring(c.provider)}
            />
          ))}
        </div>
      )}

      <div className="h-px bg-text-primary/10" />
      <FeeSchedule />

      <ConfigureDrawer
        provider={configuring}
        row={configuring ? byProvider.get(configuring) : undefined}
        onClose={() => setConfiguring(null)}
      />
    </div>
  );
}

function GatewayCard({
  provider,
  row,
  onConfigure,
}: {
  provider: PaymentGateway["provider"];
  row?: PaymentGateway;
  onConfigure: () => void;
}) {
  const setActive = useSetGatewayActive();
  const setRole = useSetGatewayRole();

  const configured = !!row;
  const hasCreds = row?.has_credentials ?? false;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[17px] font-medium">{PROVIDER_LABEL[provider]}</div>
          {!configured && <div className="text-[12px] text-text-faint mt-0.5">Not configured</div>}
        </div>
        {configured ? (
          <Toggle
            checked={row!.is_active}
            disabled={setActive.isPending}
            onChange={(v) => setActive.mutate({ provider, is_active: v })}
          />
        ) : (
          <Pill tone="neutral" dot={false}>
            Inactive
          </Pill>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select
            value={(row?.role ?? "standalone") as string}
            onChange={(v) => setRole.mutate({ provider, role: v })}
            options={ROLE_OPTIONS}
            disabled={!configured || setRole.isPending}
          />
        </Field>
        <div>
          <span className="micro block mb-2">Credentials</span>
          {hasCreds ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-success">
              <CheckCircle2 className="w-4 h-4" /> Configured
            </span>
          ) : (
            <span className="text-[13px] text-text-faint">Not configured</span>
          )}
        </div>
      </div>

      <div>
        <span className="micro block mb-2">Supported currencies</span>
        {row?.supported_currencies?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {row.supported_currencies.map((c) => (
              <span
                key={c}
                className="px-2 py-1 rounded-[8px] text-[11px] font-semibold font-mono border border-line text-text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-text-faint">—</span>
        )}
      </div>

      <Button
        variant={hasCreds ? "secondary" : "primary"}
        icon={<KeyRound className="w-4 h-4" />}
        onClick={onConfigure}
        className="w-full"
      >
        {hasCreds ? "Rotate credentials" : "Configure"}
      </Button>
    </Card>
  );
}

function ConfigureDrawer({
  provider,
  row,
  onClose,
}: {
  provider: PaymentGateway["provider"] | null;
  row?: PaymentGateway;
  onClose: () => void;
}) {
  const configure = useConfigureGateway();
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [currencies, setCurrencies] = useState("");

  // Reset write-only fields each time the drawer opens for a provider.
  useEffect(() => {
    if (!provider) return;
    setPublicKey("");
    setSecretKey("");
    setWebhookSecret("");
    setCurrencies((row?.supported_currencies ?? []).join(", "));
  }, [provider, row]);

  const submit = () => {
    if (!provider) return;
    const credentials: Record<string, string> = {};
    if (publicKey.trim()) credentials.public_key = publicKey.trim();
    if (secretKey.trim()) credentials.secret_key = secretKey.trim();
    if (webhookSecret.trim()) credentials.webhook_secret = webhookSecret.trim();
    const supported = currencies
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    configure.mutate(
      {
        provider,
        credentials: Object.keys(credentials).length ? credentials : undefined,
        supported_currencies: supported,
        role: row?.role,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Drawer
      open={!!provider}
      onClose={onClose}
      title={provider ? `Configure ${PROVIDER_LABEL[provider]}` : "Configure"}
      subtitle="Credentials are write-only"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={configure.isPending}
            onClick={submit}
            icon={configure.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            Save credentials
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-text-muted">
          Existing secrets are never shown. Leave a field blank to keep the
          current value; fill it to rotate.
        </p>
        <Field label="Public key">
          <PasswordInput value={publicKey} onChange={setPublicKey} placeholder="pk_live_…" autoComplete="off" />
        </Field>
        <Field label="Secret key">
          <PasswordInput value={secretKey} onChange={setSecretKey} placeholder="sk_live_…" autoComplete="new-password" />
        </Field>
        <Field label="Webhook secret">
          <PasswordInput value={webhookSecret} onChange={setWebhookSecret} placeholder="whsec_…" autoComplete="new-password" />
        </Field>
        <Field label="Supported currencies" hint="comma-separated, e.g. NGN, USD">
          <input
            value={currencies}
            onChange={(e) => setCurrencies(e.target.value)}
            placeholder="NGN, USD"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50"
          />
        </Field>
        {configure.isError && (
          <p className="text-[12px] text-danger">
            {configure.error instanceof Error ? configure.error.message : "Could not save credentials."}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type="password"
      value={value}
      autoComplete={autoComplete}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 font-mono"
    />
  );
}

// ──────────────────────────────────────────────────────────────
// Fee schedule
// ──────────────────────────────────────────────────────────────

function FeeSchedule() {
  const config = useBusinessConfig();
  const save = useSaveBusinessConfig();

  const serverFees = (config.data?.payment_gateway_fees ?? {}) as Record<string, GatewayFee>;
  const [draft, setDraft] = useState<Record<string, GatewayFee>>({});

  useEffect(() => {
    setDraft(serverFees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data]);

  const setField = (provider: string, key: keyof GatewayFee, v: string) => {
    setDraft((d) => ({ ...d, [provider]: { ...d[provider], [key]: v } }));
  };

  const submit = () => {
    // Normalise blank strings to numbers where present.
    const out: Record<string, GatewayFee> = {};
    for (const p of PROVIDERS) {
      const f = draft[p];
      if (!f) continue;
      const entry: GatewayFee = {};
      if (f.pct !== "" && f.pct != null) entry.pct = Number(f.pct);
      if (f.fixed !== "" && f.fixed != null) entry.fixed = Number(f.fixed);
      if (f.cap_ngn !== "" && f.cap_ngn != null) entry.cap_ngn = Number(f.cap_ngn);
      if (Object.keys(entry).length) out[p] = entry;
    }
    save.mutate({ payment_gateway_fees: out });
  };

  const str = (v: number | string | undefined) => (v == null ? "" : String(v));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="micro">Fee schedule</div>
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending}
          onClick={submit}
          icon={save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
        >
          Save fees
        </Button>
      </div>

      {config.isError ? (
        <Card>
          <ErrorState onRetry={() => config.refetch()} />
        </Card>
      ) : config.isLoading ? (
        <div className="flex items-center gap-2 text-text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading fees…
        </div>
      ) : (
        <Card className="p-5 space-y-4">
          {PROVIDERS.map((p) => {
            const f = draft[p] ?? {};
            return (
              <div key={p} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-text-faint" />
                  <span className="text-[13px] font-semibold">{PROVIDER_LABEL[p]}</span>
                </div>
                <Field label="Percent">
                  <NumberField value={str(f.pct)} onChange={(v) => setField(p, "pct", v)} suffix="%" placeholder="1.5" />
                </Field>
                <Field label="Fixed">
                  <NumberField value={str(f.fixed)} onChange={(v) => setField(p, "fixed", v)} placeholder="100" />
                </Field>
                <Field label="Cap (NGN)">
                  <NumberField value={str(f.cap_ngn)} onChange={(v) => setField(p, "cap_ngn", v)} placeholder="2000" />
                </Field>
              </div>
            );
          })}
          {save.isError && (
            <p className="text-[12px] text-danger">
              {save.error instanceof Error ? save.error.message : "Could not save fees."}
            </p>
          )}
        </Card>
      )}
    </section>
  );
}
