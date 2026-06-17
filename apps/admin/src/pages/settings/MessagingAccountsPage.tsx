import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plug,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  Edit3,
  Power,
  PowerOff,
  Sparkles,
  ShieldCheck,
  Mail,
  MessageSquare,
  Instagram,
  Facebook,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import { Card } from "@/components/ui/primitives";
import {
  messagingAccountsApi,
  PLATFORM_META,
  type MessagingAccount,
  type MessagingPlatform,
  type UpsertInput,
} from "@/lib/messaging-accounts-api";

/**
 * Messaging Accounts admin — `/settings/messaging-accounts`.
 *
 * Without rows in this table the smartcomm webhook ingester silently
 * drops inbound DMs ("no messaging_accounts row" warning). This page
 * is the CEO's "wire up the actual phone numbers" step.
 *
 * Per brand, per platform: paste the Meta phone_number_id / IG Business
 * Account ID / FB Page ID / inbound mailbox, attach the access token,
 * hit "Test" to confirm the token authenticates against Meta Graph
 * (or that the email domain's MX records resolve).
 */

const PLATFORM_ICON: Record<MessagingPlatform, React.FC<{ className?: string }>> = {
  whatsapp: MessageSquare,
  instagram: Instagram,
  facebook: Facebook,
  email: Mail,
};

export function MessagingAccountsPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Messaging Accounts" },
  ]);
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const accountsQ = useQuery({
    queryKey: ["messaging-accounts", business.key],
    queryFn: () => messagingAccountsApi.list(),
  });

  const byPlatform = useMemo(() => {
    const m = new Map<MessagingPlatform, MessagingAccount[]>();
    for (const a of accountsQ.data ?? []) {
      if (a.business !== business.key) continue;
      const arr = m.get(a.platform) ?? [];
      arr.push(a);
      m.set(a.platform, arr);
    }
    return m;
  }, [accountsQ.data, business.key]);

  const [editing, setEditing] = useState<{
    platform: MessagingPlatform;
    existing?: MessagingAccount;
  } | null>(null);

  const setActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      messagingAccountsApi.setActive(id, is_active),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["messaging-accounts", business.key] }),
  });
  const removeAcc = useMutation({
    mutationFn: (id: string) => messagingAccountsApi.remove(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["messaging-accounts", business.key] }),
  });

  return (
    <div className="max-w-[980px] space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Plug className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Messaging Accounts
            <span className="text-text-faint text-[14px] ml-2">
              · {business.name}
            </span>
          </h2>
          <p className="text-text-muted text-[13px]">
            Connect this brand&rsquo;s WhatsApp number, Instagram account, FB
            page, and inbound mailbox. Without these rows, the inbox
            doesn&rsquo;t receive DMs.
          </p>
        </div>
      </header>

      <div className="rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3 text-[12.5px] text-text-muted flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 mt-[2px] text-accent-glow shrink-0" />
        <div>
          <span className="text-text-primary font-medium">
            Access tokens are encrypted at rest.
          </span>{" "}
          The token you paste here is AES-256-GCM encrypted via{" "}
          <code className="font-mono text-[11px] bg-panel-2 px-1 rounded">
            encryption.service
          </code>
          . The list view only shows a &ldquo;key on file&rdquo; flag, never
          the raw token.
        </div>
      </div>

      {(["whatsapp", "instagram", "facebook", "email"] as const).map((p) => {
        const Icon = PLATFORM_ICON[p];
        const meta = PLATFORM_META[p];
        const accounts = byPlatform.get(p) ?? [];
        return (
          <section key={p}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border hairline">
                  <Icon className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-display text-[15px] leading-tight">
                    {meta.label}
                  </h3>
                  <p className="text-[11.5px] text-text-faint">
                    {meta.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditing({ platform: p })}
                className="rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              {accountsQ.isLoading ? (
                <div className="p-4">
                  <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
                </div>
              ) : accounts.length === 0 ? (
                <p className="p-5 text-center text-[12.5px] text-text-faint italic">
                  No {meta.label.toLowerCase()} account connected. Hit{" "}
                  <span className="text-text-muted">Connect</span> to add one.
                </p>
              ) : (
                accounts.map((acc, i) => (
                  <AccountRow
                    key={acc.account_id}
                    account={acc}
                    isLast={i === accounts.length - 1}
                    onEdit={() =>
                      setEditing({ platform: p, existing: acc })
                    }
                    onToggleActive={() =>
                      setActive.mutate({
                        id: acc.account_id,
                        is_active: !acc.is_active,
                      })
                    }
                    onRemove={() => {
                      if (
                        window.confirm(
                          `Remove ${acc.display_name}? Inbound DMs to ${acc.external_account_id} will stop arriving.`,
                        )
                      ) {
                        removeAcc.mutate(acc.account_id);
                      }
                    }}
                  />
                ))
              )}
            </Card>
          </section>
        );
      })}

      {editing && (
        <AccountEditor
          brand={business.key}
          platform={editing.platform}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({
              queryKey: ["messaging-accounts", business.key],
            });
          }}
        />
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────

function AccountRow({
  account,
  isLast,
  onEdit,
  onToggleActive,
  onRemove,
}: {
  account: MessagingAccount;
  isLast: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}) {
  const [testStatus, setTestStatus] = useState<
    | { stage: "idle" }
    | { stage: "running" }
    | { stage: "ok"; message: string }
    | { stage: "fail"; message: string }
  >({ stage: "idle" });

  async function runTest() {
    setTestStatus({ stage: "running" });
    try {
      const r = await messagingAccountsApi.test(account.account_id);
      const msg = r.provider_name
        ? `Authenticated as "${r.provider_name}" (${r.provider_id ?? "ok"}).`
        : r.mx_records?.length
          ? `MX OK — primary: ${r.mx_records[0].exchange}`
          : "Provider responded.";
      setTestStatus({ stage: "ok", message: msg });
    } catch (e: unknown) {
      setTestStatus({
        stage: "fail",
        message: e instanceof Error ? e.message : "Test failed.",
      });
    }
  }

  return (
    <div
      className={`p-4 ${!isLast ? "border-b hairline" : ""} ${!account.is_active ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13.5px] truncate">
              {account.display_name}
            </span>
            {account.has_access_token ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-widest text-green-300 border border-green-500/30 rounded-full px-1.5 py-[1px]">
                <Check className="w-3 h-3" />
                Token
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-widest text-amber-300 border border-amber-400/30 rounded-full px-1.5 py-[1px]">
                <AlertCircle className="w-3 h-3" />
                No token
              </span>
            )}
            {!account.is_active && (
              <span className="text-[10.5px] uppercase tracking-widest text-text-faint border hairline rounded-full px-1.5 py-[1px]">
                Disabled
              </span>
            )}
          </div>
          <code className="block mt-0.5 text-[11.5px] font-mono text-text-faint truncate">
            {account.external_account_id}
          </code>
          {account.last_inbound_at && (
            <p className="text-[11px] text-text-faint mt-1">
              Last inbound:{" "}
              {new Date(account.last_inbound_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={runTest}
            disabled={testStatus.stage === "running"}
            className="rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[11.5px] hover:border-accent/40 inline-flex items-center gap-1.5"
            title="Ping the provider with the saved token"
          >
            {testStatus.stage === "running" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3 text-accent-glow" />
            )}
            Test
          </button>
          <button
            onClick={onEdit}
            className="rounded-lg bg-panel-2 border hairline p-1.5 hover:border-accent/40"
            title="Edit"
          >
            <Edit3 className="w-3.5 h-3.5 text-text-muted" />
          </button>
          <button
            onClick={onToggleActive}
            className="rounded-lg bg-panel-2 border hairline p-1.5 hover:border-accent/40"
            title={account.is_active ? "Disable" : "Enable"}
          >
            {account.is_active ? (
              <Power className="w-3.5 h-3.5 text-green-300" />
            ) : (
              <PowerOff className="w-3.5 h-3.5 text-text-faint" />
            )}
          </button>
          <button
            onClick={onRemove}
            className="rounded-lg bg-panel-2 border hairline p-1.5 hover:border-danger/40"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
          </button>
        </div>
      </div>

      {testStatus.stage === "ok" && (
        <div className="mt-2 ml-0 inline-flex items-start gap-1.5 rounded-lg border border-green-500/30 bg-green-500/5 px-2.5 py-1.5 text-[11.5px] text-green-300">
          <Check className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          {testStatus.message}
        </div>
      )}
      {testStatus.stage === "fail" && (
        <div className="mt-2 inline-flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11.5px] text-danger">
          <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          {testStatus.message}
        </div>
      )}
    </div>
  );
}

// ── Editor modal ───────────────────────────────────────────

function AccountEditor({
  brand,
  platform,
  existing,
  onClose,
  onSaved,
}: {
  brand: string;
  platform: MessagingPlatform;
  existing?: MessagingAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = PLATFORM_META[platform];
  const [form, setForm] = useState<UpsertInput>({
    platform,
    external_account_id: existing?.external_account_id ?? "",
    display_name: existing?.display_name ?? "",
    webhook_verify_token: existing?.webhook_verify_token ?? "",
    access_token: "",
    is_active: existing?.is_active ?? true,
  });
  const save = useMutation({
    mutationFn: () =>
      messagingAccountsApi.upsert({
        ...form,
        access_token: form.access_token || undefined,
        webhook_verify_token: form.webhook_verify_token || undefined,
      }),
    onSuccess: onSaved,
  });

  const canSave = !!form.external_account_id && !!form.display_name;

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px]">
      <div className="w-[min(560px,94vw)] dropglass rounded-2xl overflow-hidden border hairline">
        <div className="p-5 border-b hairline flex items-center gap-2">
          <h3 className="font-display text-[17px] flex-1">
            {existing ? "Edit" : "Connect"} {meta.label}
            <span className="text-text-faint text-[13px] ml-2">· {brand}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-[18px]"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field
            label="External account ID"
            required
            value={form.external_account_id}
            onChange={(v) => setForm({ ...form, external_account_id: v })}
            placeholder={meta.placeholder_id}
            disabled={!!existing}
          />
          {existing && (
            <p className="text-[10.5px] text-text-faint -mt-2">
              The provider ID is the row&rsquo;s identity; create a new
              account if you need to change it.
            </p>
          )}
          <Field
            label="Display name"
            required
            value={form.display_name}
            onChange={(v) => setForm({ ...form, display_name: v })}
            placeholder={meta.placeholder_name}
          />
          {platform !== "email" && (
            <Field
              label={
                existing && existing.has_access_token
                  ? "Replace access token (leave blank to keep current)"
                  : "Access token (Meta Page / System User token)"
              }
              value={form.access_token ?? ""}
              onChange={(v) => setForm({ ...form, access_token: v })}
              placeholder="EAA…"
              type="password"
            />
          )}
          {platform !== "email" && (
            <Field
              label="Webhook verify token (Meta GET handshake)"
              value={form.webhook_verify_token ?? ""}
              onChange={(v) =>
                setForm({ ...form, webhook_verify_token: v })
              }
              placeholder="Random string the GET handshake echoes"
            />
          )}
          <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
            <input
              type="checkbox"
              checked={form.is_active !== false}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="accent-accent"
            />
            Active (receive inbound)
          </label>
          {save.isError && (
            <p className="text-[12px] text-danger inline-flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Couldn&rsquo;t save. Check the external ID isn&rsquo;t already
              registered to another brand.
            </p>
          )}
        </div>
        <div className="p-4 border-t hairline flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {existing ? "Save" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  disabled,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 disabled:opacity-60 font-mono"
      />
    </label>
  );
}
