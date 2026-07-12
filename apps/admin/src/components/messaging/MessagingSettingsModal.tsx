import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Instagram,
  Facebook,
  Mail,
  Send,
  Server,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Loader2,
  Check,
  AlertCircle,
  Plug,
  Trash2,
  Sparkles,
  ExternalLink,
  ChevronRight,
  History,
  Info,
  Save,
  Wallet,
  MessagesSquare,
  MessageCircle,
  LayoutTemplate,
  Copy,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useActiveBusiness } from "@/stores/business";
import { useAuthStore } from "@/stores/auth";
import {
  messagingAccountsApi,
  PLATFORM_META,
  type MessagingAccount,
  type MessagingPlatform,
  type UpsertInput,
  type RevealableField,
  type SecretReveal,
} from "@/lib/messaging-accounts-api";
import { formatDateTime } from "@/lib/format";
import { ChannelPolicyTab } from "./ChannelPolicyTab";
import { ChannelAccessTab } from "./ChannelAccessTab";
import { CommsStudioTab } from "./CommsStudioTab";
import { QuickRepliesTab } from "./QuickRepliesTab";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab";
import { WhatsAppBusinessProfile } from "./WhatsAppBusinessProfile";
import { WhatsAppCallingSettings } from "./WhatsAppCallingSettings";

/**
 * Messaging settings — every configuration concern the Messaging module
 * owns, in one place. Opens from the gear icon in the ChannelList header.
 * RBAC-gated per section at the caller AND per rail item below, since a
 * role can hold some of these permissions without holding all of them
 * (e.g. Channel Policy without messaging_accounts edit access).
 *
 * Layout:
 *  · left rail, two groups —
 *    CONNECTIONS: WhatsApp, Instagram, Facebook, Email account wiring
 *      (the original "WhatsApp integrations" modal).
 *    CONFIGURATION: Channel Policy, Automations (Comms Studio), Quick
 *      Replies, WhatsApp Templates — folded in from Settings so each
 *      module carries its own settings instead of Settings carrying
 *      everything.
 *  · right pane — whichever section is active.
 */

type ConnectionTab = MessagingPlatform;
type ConfigTab =
  | "channel-policy"
  | "channel-access"
  | "automations"
  | "quick-replies"
  | "whatsapp-templates";
type ActiveTab = ConnectionTab | ConfigTab;

const CONNECTION_ICON: Record<
  ConnectionTab,
  React.FC<{ className?: string }>
> = {
  whatsapp: MessageSquare,
  instagram: Instagram,
  facebook: Facebook,
  email: Mail,
  email_outbound: Send,
};

const CONNECTIONS: ConnectionTab[] = [
  "whatsapp",
  "instagram",
  "facebook",
  "email",
  "email_outbound",
];

const CONFIG_ITEMS: {
  key: ConfigTab;
  label: string;
  icon: React.FC<{ className?: string }>;
  /** access.catalog.js module key this section's backend routes enforce. */
  permissionModule: string;
  /** CEO-only sections (backend routes gated by requireCeo). */
  ceoOnly?: boolean;
}[] = [
  {
    key: "channel-access",
    label: "Channel Access",
    icon: ShieldCheck,
    permissionModule: "smartcomm",
    ceoOnly: true,
  },
  {
    key: "channel-policy",
    label: "Channel Policy",
    icon: Wallet,
    permissionModule: "outbound_policy",
  },
  {
    key: "automations",
    label: "Automations",
    icon: MessagesSquare,
    permissionModule: "comms_studio",
  },
  {
    key: "quick-replies",
    label: "Quick Replies",
    icon: MessageCircle,
    permissionModule: "smartcomm",
  },
  {
    key: "whatsapp-templates",
    label: "WhatsApp Templates",
    icon: LayoutTemplate,
    permissionModule: "messaging_accounts",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which tab should open first — defaults to whatsapp. */
  initialTab?: ActiveTab;
}

export function MessagingSettingsModal({
  open,
  onClose,
  initialTab,
}: Props) {
  const business = useActiveBusiness();
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => !!s.user?.isCeo);
  const qc = useQueryClient();

  const canConnections = can("messaging_accounts", "edit");
  const visibleConfigItems = useMemo(
    () =>
      CONFIG_ITEMS.filter((c) =>
        c.ceoOnly ? isCeo : can(c.permissionModule, "view"),
      ),
    [can, isCeo],
  );

  // Default to Connections if the caller can see it (the historical
  // behaviour), otherwise the first visible Configuration item — never a
  // tab the rail doesn't actually show.
  const defaultTab: ActiveTab = canConnections
    ? "whatsapp"
    : (visibleConfigItems[0]?.key ?? "whatsapp");

  const [tab, setTab] = useState<ActiveTab>(initialTab ?? defaultTab);

  useEffect(() => {
    if (open) setTab(initialTab ?? defaultTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isConnectionTab = (t: ActiveTab): t is ConnectionTab =>
    (CONNECTIONS as string[]).includes(t);

  const accountsQ = useQuery({
    queryKey: ["messaging-accounts", business.key],
    queryFn: () => messagingAccountsApi.list(),
    enabled: open && canConnections,
  });

  const currentAccount = useMemo(() => {
    if (!isConnectionTab(tab)) return undefined;
    return (accountsQ.data ?? []).find(
      (a) => a.business === business.key && a.platform === tab,
    );
  }, [accountsQ.data, business.key, tab]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["messaging-accounts", business.key] });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="inline-flex items-center gap-2">
          <Plug className="w-[18px] h-[18px] text-accent-glow" />
          Messaging settings
          <span className="text-text-faint text-[13px] ml-2">
            · {business.name}
          </span>
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
        {/* Rail */}
        <aside className="md:border-r hairline md:pr-4">
          {canConnections && (
            <div className="mb-5">
              <div className="text-[10px] uppercase tracking-widest text-text-faint mb-1.5 px-1">
                Connections
              </div>
              <ul className="space-y-1">
                {CONNECTIONS.map((p) => {
                  const Icon = CONNECTION_ICON[p];
                  const meta = PLATFORM_META[p];
                  const acc = (accountsQ.data ?? []).find(
                    (a) => a.business === business.key && a.platform === p,
                  );
                  const active = p === tab;
                  return (
                    <li key={p}>
                      <button
                        onClick={() => setTab(p)}
                        className={
                          "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors " +
                          (active
                            ? "bg-accent/15 text-text-primary border hairline"
                            : "text-text-muted hover:bg-panel-2")
                        }
                      >
                        <span className="grid place-items-center w-8 h-8 rounded-lg bg-panel-2 border hairline text-accent-glow">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium truncate">
                            {meta.label}
                          </span>
                          <span className="block text-[11px] text-text-faint truncate">
                            {acc
                              ? acc.is_active
                                ? "Connected"
                                : "Disabled"
                              : "Not connected"}
                          </span>
                        </span>
                        {(p === "email_outbound"
                          ? acc?.has_smtp_password || acc?.smtp_host
                          : acc?.has_access_token) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-text-faint" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {visibleConfigItems.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-text-faint mb-1.5 px-1">
                Configuration
              </div>
              <ul className="space-y-1">
                {visibleConfigItems.map((c) => {
                  const Icon = c.icon;
                  const active = c.key === tab;
                  return (
                    <li key={c.key}>
                      <button
                        onClick={() => setTab(c.key)}
                        className={
                          "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors " +
                          (active
                            ? "bg-accent/15 text-text-primary border hairline"
                            : "text-text-muted hover:bg-panel-2")
                        }
                      >
                        <span className="grid place-items-center w-8 h-8 rounded-lg bg-panel-2 border hairline text-accent-glow">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="flex-1 min-w-0 text-[13px] font-medium truncate">
                          {c.label}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-faint" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {canConnections && isConnectionTab(tab) && (
            <div className="mt-6 rounded-xl border border-accent/20 bg-accent/5 p-3">
              <div className="flex items-start gap-2 text-[11.5px] text-text-muted">
                <ShieldCheck className="w-3.5 h-3.5 mt-[2px] text-accent-glow shrink-0" />
                <p>
                  Every secret is AES-256-GCM encrypted at rest. Only the
                  first 4 characters are ever shown here. To view or rotate a
                  secret, re-enter your login password.
                </p>
              </div>
            </div>
          )}
        </aside>

        {/* Pane */}
        <section className="min-w-0">
          {isConnectionTab(tab) ? (
            accountsQ.isLoading ? (
              <div className="grid place-items-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
              </div>
            ) : (
              <PlatformEditor
                platform={tab}
                account={currentAccount}
                onSaved={invalidate}
              />
            )
          ) : tab === "channel-access" ? (
            <ChannelAccessTab />
          ) : tab === "channel-policy" ? (
            <ChannelPolicyTab />
          ) : tab === "automations" ? (
            <CommsStudioTab />
          ) : tab === "quick-replies" ? (
            <QuickRepliesTab />
          ) : (
            <WhatsAppTemplatesTab />
          )}
        </section>
      </div>
    </Modal>
  );
}

// ── Platform editor ────────────────────────────────────────

interface EditorProps {
  platform: MessagingPlatform;
  account?: MessagingAccount;
  onSaved: () => void;
}

function PlatformEditor({ platform, account, onSaved }: EditorProps) {
  const meta = PLATFORM_META[platform];

  // Editable copy of the account fields. Secrets are ALWAYS edited
  // via the revealed value; the input holds either "" (unchanged) or
  // a freshly revealed / freshly typed value.
  const [form, setForm] = useState<UpsertInput>(() => ({
    platform,
    external_account_id: account?.external_account_id ?? "",
    display_name: account?.display_name ?? "",
    is_active: account?.is_active ?? true,
    notes: account?.notes ?? "",
    smtp_host: account?.smtp_host ?? "",
    smtp_port: account?.smtp_port ?? 587,
    smtp_secure: account?.smtp_secure ?? false,
    smtp_user: account?.smtp_user ?? "",
    reply_to_email: account?.reply_to_email ?? "",
    imap_host: account?.imap_host ?? "",
    imap_port: account?.imap_port ?? 993,
    imap_secure: account?.imap_secure ?? true,
    inbound_poll_enabled: account?.inbound_poll_enabled ?? false,
  }));
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    setForm({
      platform,
      external_account_id: account?.external_account_id ?? "",
      display_name: account?.display_name ?? "",
      is_active: account?.is_active ?? true,
      notes: account?.notes ?? "",
      smtp_host: account?.smtp_host ?? "",
      smtp_port: account?.smtp_port ?? 587,
      smtp_secure: account?.smtp_secure ?? false,
      smtp_user: account?.smtp_user ?? "",
      reply_to_email: account?.reply_to_email ?? "",
      imap_host: account?.imap_host ?? "",
      imap_port: account?.imap_port ?? 993,
      imap_secure: account?.imap_secure ?? true,
      inbound_poll_enabled: account?.inbound_poll_enabled ?? false,
    });
    setDirtyFields(new Set());
  }, [platform, account]);

  const markDirty = (k: keyof UpsertInput, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirtyFields((s) => {
      const next = new Set(s);
      next.add(k);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload: UpsertInput = {
        platform,
        external_account_id: form.external_account_id,
        display_name: form.display_name,
        is_active: form.is_active,
        notes: form.notes,
      };
      // Only include secret fields that were actually touched — the
      // backend COALESCE keeps unchanged secrets intact.
      if (dirtyFields.has("access_token") && form.access_token)
        payload.access_token = form.access_token;
      if (dirtyFields.has("app_secret") && form.app_secret)
        payload.app_secret = form.app_secret;
      if (dirtyFields.has("verify_token") && form.verify_token)
        payload.verify_token = form.verify_token;
      if (dirtyFields.has("business_account_id") && form.business_account_id)
        payload.business_account_id = form.business_account_id;
      if (platform === "email_outbound") {
        payload.smtp_host = form.smtp_host;
        payload.smtp_port = form.smtp_port;
        payload.smtp_secure = form.smtp_secure;
        payload.smtp_user = form.smtp_user;
        payload.reply_to_email = form.reply_to_email || undefined;
        // From address/name mirror the identity fields above so a
        // brand doesn't have to fill the same address in twice.
        payload.from_email = form.external_account_id;
        payload.from_name = form.display_name;
        if (dirtyFields.has("smtp_password") && form.smtp_password)
          payload.smtp_password = form.smtp_password;
        // Inbound polling (IMAP) — reuses smtp_user/password, so only the
        // IMAP host/port/security + the toggle are sent.
        payload.inbound_poll_enabled = form.inbound_poll_enabled;
        if (form.inbound_poll_enabled) {
          payload.imap_host = form.imap_host || undefined;
          payload.imap_port = form.imap_port;
          payload.imap_secure = form.imap_secure;
        }
      }
      return messagingAccountsApi.upsert(payload);
    },
    onSuccess: () => {
      onSaved();
      setDirtyFields(new Set());
      // Wipe secret fields from memory now that they're persisted.
      setForm((f) => ({
        ...f,
        access_token: "",
        app_secret: "",
        verify_token: "",
        business_account_id: "",
        smtp_password: "",
      }));
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      account ? messagingAccountsApi.remove(account.account_id) : Promise.resolve(),
    onSuccess: onSaved,
  });

  const test = useMutation({
    mutationFn: () => messagingAccountsApi.test(account!.account_id),
    onSuccess: (r) => {
      // Instagram Test can auto-correct a mistyped provider id (the row's
      // external_account_id) — refresh the account list so the corrected
      // id renders instead of the stale one.
      if (r?.healed) onSaved();
    },
  });

  const canSave =
    !!form.external_account_id &&
    !!form.display_name &&
    (platform !== "email_outbound" || !!form.smtp_host) &&
    (dirtyFields.size > 0 || !account);

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-[17px]">{meta.label}</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            {meta.description}
          </p>
        </div>
        {account && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => test.mutate()}
              disabled={test.isPending}
              className="rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[11.5px] hover:border-accent/40 inline-flex items-center gap-1.5"
              title="Ping the provider with the saved token"
            >
              {test.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3 text-accent-glow" />
              )}
              Test
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${account.display_name}? Inbound DMs to ${account.external_account_id} will stop arriving.`,
                  )
                )
                  remove.mutate();
              }}
              disabled={remove.isPending}
              className="rounded-lg bg-panel-2 border hairline p-1.5 hover:border-danger/40"
              title="Remove"
            >
              <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
            </button>
          </div>
        )}
      </header>

      {test.isSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-[12px] text-green-300 inline-flex items-start gap-1.5">
          <Check className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          <span>
            {platform === "email_outbound" && test.data?.provider_name
              ? `SMTP connected — ${test.data.provider_name}.`
              : test.data?.provider_name
                ? `Authenticated as "${test.data.provider_name}" (${test.data.provider_id ?? "ok"}).`
                : test.data?.mx_records?.length
                  ? `MX OK — primary: ${test.data.mx_records[0].exchange}`
                  : "Provider responded."}
            {test.data?.healed && (
              <span className="block text-green-200/80">
                The saved account ID didn't match Meta's — it has been
                corrected automatically so inbound DMs route properly.
              </span>
            )}
            {test.data?.imap &&
              (test.data.imap.ok ? (
                <span className="block text-green-200/80">
                  Inbound IMAP login OK — {test.data.imap.host}.
                </span>
              ) : (
                <span className="block text-amber-300/90">
                  Inbound IMAP check failed: {test.data.imap.error}
                </span>
              ))}
          </span>
        </div>
      )}
      {test.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger inline-flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          {test.error instanceof Error ? test.error.message : "Test failed."}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Field
          label={
            platform === "whatsapp"
              ? "Phone Number ID"
              : platform === "instagram"
                ? "IG Business Account ID"
                : platform === "facebook"
                  ? "Page ID"
                  : platform === "email_outbound"
                    ? "From address"
                    : "Inbound mailbox"
          }
          required
          value={form.external_account_id}
          onChange={(v) => setForm({ ...form, external_account_id: v })}
          placeholder={meta.placeholder_id}
          disabled={!!account}
          mono
          hint={
            account
              ? "Provider ID is the row identity — create a new account to change it."
              : undefined
          }
        />
        <Field
          label="Display name"
          required
          value={form.display_name}
          onChange={(v) => setForm({ ...form, display_name: v })}
          placeholder={meta.placeholder_name}
        />
      </div>

      {(platform === "whatsapp" ||
        platform === "instagram" ||
        platform === "facebook") && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SecretField
            label="Access Token"
            field="access_token"
            account={account}
            valueDraft={form.access_token ?? ""}
            firstFour={account?.access_token_first4 ?? null}
            hasStored={account?.has_access_token ?? false}
            placeholder="EAA…"
            onDraftChange={(v) => markDirty("access_token", v)}
          />
          <SecretField
            label="App Secret"
            field="app_secret"
            account={account}
            valueDraft={form.app_secret ?? ""}
            firstFour={account?.app_secret_first4 ?? null}
            hasStored={account?.has_app_secret ?? false}
            placeholder="Meta App Dashboard → Basic → App Secret"
            onDraftChange={(v) => markDirty("app_secret", v)}
          />
          <SecretField
            label="Webhook Verify Token"
            field="verify_token"
            account={account}
            valueDraft={form.verify_token ?? ""}
            firstFour={account?.verify_token_first4 ?? null}
            hasStored={account?.has_verify_token ?? false}
            placeholder="Any random string; must match Meta app config"
            onDraftChange={(v) => markDirty("verify_token", v)}
          />
          {platform === "whatsapp" && (
            <SecretField
              label="WhatsApp Business Account ID"
              field="business_account_id"
              account={account}
              valueDraft={form.business_account_id ?? ""}
              firstFour={account?.business_account_first4 ?? null}
              hasStored={account?.has_business_account_id ?? false}
              placeholder="WABA ID (e.g. 108293845678910)"
              onDraftChange={(v) => markDirty("business_account_id", v)}
            />
          )}
        </div>
      )}

      {platform === "email_outbound" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Field
            label="SMTP host"
            required
            value={form.smtp_host ?? ""}
            onChange={(v) => markDirty("smtp_host", v)}
            placeholder="smtp.hostinger.com"
            mono
          />
          <Field
            label="SMTP port"
            value={String(form.smtp_port ?? 587)}
            onChange={(v) => markDirty("smtp_port", Number(v) || 587)}
            placeholder="587"
            mono
          />
          <Field
            label="SMTP username"
            value={form.smtp_user ?? ""}
            onChange={(v) => markDirty("smtp_user", v)}
            placeholder="Usually the same as the From address"
            mono
          />
          <SecretField
            label="SMTP password"
            field="smtp_password"
            account={account}
            valueDraft={form.smtp_password ?? ""}
            firstFour={account?.smtp_password_first4 ?? null}
            hasStored={account?.has_smtp_password ?? false}
            placeholder="Mailbox password / SMTP app password"
            onDraftChange={(v) => markDirty("smtp_password", v)}
          />
          <label className="flex items-center gap-2 text-[12.5px] text-text-muted lg:col-span-2">
            <input
              type="checkbox"
              checked={form.smtp_secure ?? false}
              onChange={(e) => markDirty("smtp_secure", e.target.checked)}
              className="accent-accent"
            />
            Use implicit TLS (port 465). Leave unchecked for STARTTLS on 587.
          </label>
          <Field
            label="Reply-To address"
            value={form.reply_to_email ?? ""}
            onChange={(v) => markDirty("reply_to_email", v)}
            placeholder="sales@yourbrand.com — defaults to the From address"
            hint="Every outbound mail — even noreply@ transactional mail — carries this Reply-To, so a customer's reply always lands on a monitored, webhook-ingested mailbox."
          />

          {/* ── Inbound polling (IMAP) ──────────────────────── */}
          <div className="lg:col-span-2 mt-1 rounded-xl border hairline bg-panel-2/40 p-3 space-y-3">
            <label className="flex items-center gap-2 text-[12.5px] text-text-primary">
              <input
                type="checkbox"
                checked={form.inbound_poll_enabled ?? false}
                onChange={(e) =>
                  markDirty("inbound_poll_enabled", e.target.checked)
                }
                className="accent-accent"
              />
              Poll this mailbox for customer replies (IMAP)
            </label>
            <p className="text-[11px] text-text-faint">
              Reuses the SMTP username &amp; password above — same mailbox. The
              Hub checks for new replies every couple of minutes and threads
              them into the inbox. No DNS changes needed.
            </p>
            {form.inbound_poll_enabled && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field
                  label="IMAP host"
                  value={form.imap_host ?? ""}
                  onChange={(v) => markDirty("imap_host", v)}
                  placeholder="imap.hostinger.com — auto-derived from SMTP host if blank"
                  mono
                />
                <Field
                  label="IMAP port"
                  value={String(form.imap_port ?? 993)}
                  onChange={(v) => markDirty("imap_port", Number(v) || 993)}
                  placeholder="993"
                  mono
                />
                <label className="flex items-center gap-2 text-[12.5px] text-text-muted lg:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.imap_secure ?? true}
                    onChange={(e) => markDirty("imap_secure", e.target.checked)}
                    className="accent-accent"
                  />
                  Use TLS (port 993). Leave checked for Hostinger.
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
        <input
          type="checkbox"
          checked={form.is_active !== false}
          onChange={(e) => markDirty("is_active", e.target.checked)}
          className="accent-accent"
        />
        Active (route inbound + allow outbound)
      </label>

      <div>
        <label className="block text-[11.5px] text-text-muted mb-1">
          Internal notes
        </label>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => markDirty("notes", e.target.value)}
          placeholder="Ownership, template approval status, links to internal docs…"
          rows={2}
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
        />
      </div>

      {save.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger inline-flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          {save.error instanceof Error ? save.error.message : "Couldn't save."}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
          className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {save.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {account ? "Save changes" : "Connect"}
        </button>
        {account?.secrets_last_rotated_at && (
          <span className="text-[11px] text-text-faint inline-flex items-center gap-1">
            <History className="w-3 h-3" />
            Last rotated {formatDateTime(account.secrets_last_rotated_at)}
          </span>
        )}
      </div>

      {platform === "whatsapp" && account && (
        <>
          <WhatsAppBusinessProfile account={account} />
          <WhatsAppCallingSettings account={account} />
        </>
      )}

      {account && <RevealHistory accountId={account.account_id} />}

      <GettingStarted platform={platform} mailbox={form.external_account_id} />
    </div>
  );
}

// ── Fields ────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  disabled,
  mono,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={
          "w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 disabled:opacity-60 " +
          (mono ? "font-mono" : "")
        } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
      />
      {hint && <p className="text-[10.5px] text-text-faint mt-1">{hint}</p>}
    </label>
  );
}

/**
 * A secret input that renders as `EAAB••••` when a value is on file
 * and no draft is being typed. Clicking "Reveal / Edit" prompts for
 * the caller's login password and swaps the input to plaintext.
 */
function SecretField({
  label,
  field,
  account,
  valueDraft,
  firstFour,
  hasStored,
  placeholder,
  onDraftChange,
}: {
  label: string;
  field: RevealableField;
  account?: MessagingAccount;
  valueDraft: string;
  firstFour: string | null;
  hasStored: boolean;
  placeholder?: string;
  onDraftChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<"masked" | "revealed" | "new">(
    hasStored ? "masked" : "new",
  );
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    setMode(hasStored ? "masked" : "new");
  }, [hasStored, account?.account_id]);

  const revealed = mode === "revealed" || mode === "new";
  const canReveal = !!account && hasStored;

  return (
    <div>
      <label className="block text-[11.5px] text-text-muted mb-1">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="w-3 h-3" />
          {label}
        </span>
      </label>
      <div className="flex items-stretch gap-2">
        {revealed ? (
          <input
            type={mode === "new" ? "password" : "text"}
            value={valueDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            // "new-password" (not "off", which Chrome ignores for credential
            // fill) — stops Chrome treating this API-secret field as a login
            // password and pairing it with a "username" field elsewhere on
            // the page (it was autofilling the login email into the inbox
            // search box).
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore=""
            className="flex-1 rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40"
          />
        ) : (
          <div className="flex-1 rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono text-text-muted select-none">
            {firstFour ?? "----"}
            <span className="tracking-[0.35em] ml-0.5">••••</span>
          </div>
        )}
        {canReveal && !revealed && (
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> Reveal / edit
          </button>
        )}
        {revealed && canReveal && (
          <button
            type="button"
            onClick={() => {
              setMode("masked");
              onDraftChange("");
            }}
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
            title="Hide plaintext"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {mode === "new" && !hasStored && (
        <p className="text-[10.5px] text-text-faint mt-1">
          Value is stored encrypted; only the first 4 characters will be shown
          after saving.
        </p>
      )}
      {mode === "masked" && hasStored && (
        <p className="text-[10.5px] text-text-faint mt-1">
          Password required to reveal or rotate this secret.
        </p>
      )}

      {passwordOpen && account && (
        <PasswordConfirmModal
          field={field}
          accountId={account.account_id}
          onCancel={() => setPasswordOpen(false)}
          onRevealed={(value) => {
            setPasswordOpen(false);
            setMode("revealed");
            onDraftChange(value);
          }}
        />
      )}
    </div>
  );
}

// ── Password confirm modal ────────────────────────────────

function PasswordConfirmModal({
  field,
  accountId,
  onCancel,
  onRevealed,
}: {
  field: RevealableField;
  accountId: string;
  onCancel: () => void;
  onRevealed: (value: string) => void;
}) {
  const [password, setPassword] = useState("");
  const user = useAuthStore((s) => s.user);
  const reveal = useMutation({
    mutationFn: () => messagingAccountsApi.reveal(accountId, field, password),
    onSuccess: (r) => onRevealed(r.value),
  });

  const humanField = field.replace(/_/g, " ");

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-accent-glow" />
          Confirm your password
        </span>
      }
      footer={
        <>
          <button
            onClick={onCancel}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => reveal.mutate()}
            disabled={!password || reveal.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {reveal.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            Reveal
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-text-muted mb-3">
        To reveal or edit the <strong>{humanField}</strong>, re-enter the
        password for <strong>{user?.email ?? "your account"}</strong>. This
        reveal is logged.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Your login password"
        autoFocus
        autoComplete="current-password"
        onKeyDown={(e) => {
          if (e.key === "Enter" && password && !reveal.isPending)
            reveal.mutate();
        }}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40"
      />
      {reveal.isError && (
        <p className="text-[12px] text-danger mt-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {reveal.error instanceof Error
            ? reveal.error.message
            : "Incorrect password"}
        </p>
      )}
    </Modal>
  );
}

// ── Reveal history ────────────────────────────────────────

function RevealHistory({ accountId }: { accountId: string }) {
  const q = useQuery({
    queryKey: ["messaging-accounts", "reveals", accountId],
    queryFn: () => messagingAccountsApi.listReveals(accountId),
  });
  const rows = (q.data as SecretReveal[] | undefined) ?? [];
  if (rows.length === 0) return null;
  return (
    <details className="rounded-xl border hairline bg-panel-2">
      <summary className="cursor-pointer px-3 py-2 text-[12px] text-text-muted inline-flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" />
        Recent reveals ({rows.length})
      </summary>
      <ul className="border-t hairline divide-y hairline">
        {rows.slice(0, 10).map((r) => (
          <li
            key={r.reveal_id}
            className="px-3 py-2 text-[11.5px] text-text-muted flex items-center justify-between gap-2"
          >
            <span className="truncate">
              <span className="text-text-primary">
                {r.display_name || r.email || "Unknown"}
              </span>{" "}
              revealed{" "}
              <span className="font-mono text-accent-glow">
                {r.field.replace(/_/g, " ")}
              </span>
            </span>
            <span className="text-text-faint shrink-0">
              {formatDateTime(r.revealed_at)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Getting-started guide ─────────────────────────────────

function GettingStarted({
  platform,
  mailbox,
}: {
  platform: MessagingPlatform;
  mailbox: string;
}) {
  if (platform === "email") return <InboundEmailGuide mailbox={mailbox} />;
  if (platform === "email_outbound") return <OutboundEmailGuide />;
  if (platform === "whatsapp") return <WhatsAppGuide />;
  if (platform === "instagram") return <InstagramGuide />;
  return <FacebookGuide />;
}

/**
 * Inbound email guide, computed live for whatever mailbox the operator is
 * typing above. Inbound now works via IMAP polling on the brand's Outbound
 * Email connection (reusing the same mailbox login) — this panel shows the
 * IMAP settings + steps and points the operator to that toggle. Backed by
 * GET /messaging-accounts/dns-records (messaging-accounts.service.js
 * getInboundDnsRecords).
 */
function InboundEmailGuide({ mailbox }: { mailbox: string }) {
  const domain = mailbox.includes("@") ? mailbox.split("@")[1] : "";
  const dnsQ = useQuery({
    queryKey: ["messaging-accounts-dns", mailbox],
    queryFn: () => messagingAccountsApi.dnsRecords(mailbox),
    enabled: !!domain,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (value: string, key: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  return (
    <div className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <Info className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div>
          <h4 className="text-[13px] font-medium">
            Two-way email — inbound via IMAP
          </h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            Customer replies are pulled from your mailbox over IMAP and threaded
            into the inbox — no DNS changes, no Cloudflare. Set it up on this
            brand's Outbound Email connection (it reuses the same mailbox login).
          </p>
        </div>
      </div>

      {!domain ? (
        <p className="p-4 text-[12.5px] text-text-faint">
          Type the inbound mailbox above (e.g.{" "}
          <span className="font-mono">support@yourbrand.com</span>) to see its
          IMAP settings.
        </p>
      ) : dnsQ.isLoading ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
        </div>
      ) : dnsQ.data ? (
        <div className="p-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-text-faint mb-2">
              IMAP settings for {domain}
            </p>
            <DnsRow
              label="Host"
              value={dnsQ.data.imap.host}
              onCopy={() => copy(dnsQ.data!.imap.host, "host")}
              copied={copied === "host"}
            />
            <DnsRow
              label="Port"
              value={String(dnsQ.data.imap.port)}
              onCopy={() => copy(String(dnsQ.data!.imap.port), "port")}
              copied={copied === "port"}
            />
            <DnsRow
              label="Security"
              value={dnsQ.data.imap.security}
              onCopy={() => copy(dnsQ.data!.imap.security, "sec")}
              copied={copied === "sec"}
            />
            <DnsRow
              label="Username"
              value={dnsQ.data.imap.username}
              onCopy={() => copy(dnsQ.data!.imap.username, "user")}
              copied={copied === "user"}
            />
            <p className="text-[10.5px] text-text-faint mt-1.5">
              Password is the same one saved on the Outbound Email connection —
              nothing new to enter.
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-widest text-text-faint mb-2">
              Steps
            </p>
            <ol className="space-y-1.5 text-[12.5px] text-text-muted list-decimal ml-5">
              {dnsQ.data.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="p-4 text-[12.5px] text-danger">
          Couldn't load IMAP settings for this mailbox.
        </p>
      )}
    </div>
  );
}

function DnsRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border hairline bg-panel px-3 py-2 mb-1.5">
      <div className="min-w-0">
        <p className="text-[10.5px] text-text-faint">{label}</p>
        <p className="font-mono text-[11.5px] text-text-primary truncate">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded-md p-1 hover:bg-panel-2"
        title="Copy"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-text-faint" />
        )}
      </button>
    </div>
  );
}

function OutboundEmailGuide() {
  return (
    <div className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <Server className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div>
          <h4 className="text-[13px] font-medium">
            Outbound relay — what this brand sends through
          </h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            This is the SMTP relay used for every outbound email this brand
            sends — transactional notifications and in-app chat replies
            alike. Saving here takes effect on the very next send; no
            restart needed.
          </p>
        </div>
      </div>
      <ol className="p-4 space-y-3 text-[12.5px] text-text-muted list-decimal ml-5">
        <li>
          Ask your mailbox/relay provider for SMTP submission settings —
          typically <span className="font-mono text-accent-glow">host</span>,{" "}
          <span className="font-mono text-accent-glow">port 587</span>{" "}
          (STARTTLS) or <span className="font-mono text-accent-glow">465</span>{" "}
          (implicit TLS), plus a username + password.
        </li>
        <li>
          Set the <strong>From address</strong> above to the mailbox you're
          sending as (e.g. <span className="font-mono">sales@yourbrand.com</span>).
          It doubles as the display name's email identity.
        </li>
        <li>
          Set a <strong>Reply-To address</strong> — every outbound message
          carries it, even transactional mail whose From is{" "}
          <span className="font-mono">noreply@</span>, so a customer's reply
          always lands on a monitored mailbox your Inbound Email webhook
          ingests.
        </li>
        <li>
          Hit <strong>Test</strong> — it opens the SMTP connection (and
          authenticates, if credentials are set) without sending a real
          message.
        </li>
        <li>
          Confirm delivery end-to-end: send yourself a message from the app,
          then reply from your personal inbox and check it threads back into
          the same conversation in the Hub.
        </li>
      </ol>
    </div>
  );
}

function WhatsAppGuide() {
  return (
    <div className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <Info className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div>
          <h4 className="text-[13px] font-medium">
            How to get your WhatsApp API keys
          </h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            You'll need a Meta for Developers account and a WhatsApp Business
            Account (WABA). Everything below lives in the Meta App dashboard —
            not your personal Facebook.
          </p>
        </div>
      </div>
      <ol className="p-4 space-y-3 text-[12.5px] text-text-muted list-decimal ml-5">
        <li>
          Go to{" "}
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            developers.facebook.com/apps <ExternalLink className="w-3 h-3" />
          </a>{" "}
          and create a new app of type <em>Business</em>. Add the{" "}
          <strong>WhatsApp</strong> product.
        </li>
        <li>
          In the WhatsApp → API Setup panel, note the{" "}
          <span className="font-mono text-accent-glow">Phone Number ID</span>{" "}
          and the{" "}
          <span className="font-mono text-accent-glow">
            WhatsApp Business Account ID
          </span>
          . Paste them above.
        </li>
        <li>
          Generate a permanent{" "}
          <span className="font-mono text-accent-glow">Access Token</span> by
          creating a{" "}
          <a
            href="https://business.facebook.com/settings/system-users"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            System User <ExternalLink className="w-3 h-3" />
          </a>{" "}
          in Business Manager, giving it{" "}
          <strong>whatsapp_business_messaging</strong> and{" "}
          <strong>whatsapp_business_management</strong> scopes, then assigning
          it to your WhatsApp app. Paste the token above.
        </li>
        <li>
          In the app's <strong>Settings → Basic</strong>, copy the{" "}
          <span className="font-mono text-accent-glow">App Secret</span> and
          paste it above. We use it to verify inbound webhook signatures
          (HMAC-SHA256).
        </li>
        <li>
          Under <strong>WhatsApp → Configuration</strong>, set the{" "}
          <span className="font-mono text-accent-glow">Callback URL</span> to{" "}
          <span className="font-mono text-text-primary">
            https://your-domain/api/webhooks/meta/whatsapp
          </span>{" "}
          and set the{" "}
          <span className="font-mono text-accent-glow">Verify Token</span> to
          any random string — put the same string in the "Webhook Verify Token"
          field above.
        </li>
        <li>
          Subscribe the webhook to the <strong>messages</strong> field. Hit{" "}
          <em>Verify and save</em> — the GET handshake will match against the
          Verify Token you saved here.
        </li>
        <li>
          Come back and hit <strong>Test</strong>. A green pill confirms the
          token authenticates against Meta Graph.
        </li>
      </ol>
    </div>
  );
}

function InstagramGuide() {
  return (
    <div className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <Info className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div>
          <h4 className="text-[13px] font-medium">
            How to connect Instagram (Instagram API with Instagram Login)
          </h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            Uses the <strong>Instagram API with Instagram Login</strong> — no
            Facebook Page link required. Your brand's IG account must be a{" "}
            <em>Professional</em> (Business/Creator) account. Access tokens
            start with <span className="font-mono">IGAA</span> and are
            auto-renewed by the hub before their 60-day expiry.
          </p>
        </div>
      </div>
      <ol className="p-4 space-y-3 text-[12.5px] text-text-muted list-decimal ml-5">
        <li>
          In your Meta app at{" "}
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            developers.facebook.com/apps <ExternalLink className="w-3 h-3" />
          </a>{" "}
          add the use case{" "}
          <strong>"Manage messaging &amp; content on Instagram"</strong>. It
          grants <span className="font-mono">instagram_business_basic</span>{" "}
          and{" "}
          <span className="font-mono">instagram_business_manage_messages</span>
          .
        </li>
        <li>
          Under the use case's <strong>API setup with Instagram login</strong>{" "}
          → step 2 <strong>"Generate access tokens"</strong>, add your IG
          professional account and generate its token (starts with{" "}
          <span className="font-mono">IGAA</span>). Paste it into the Access
          Token field above. Skip step 4 ("Set up Instagram business login") —
          that OAuth flow is only for letting third parties connect, which
          this ERP doesn't need.
        </li>
        <li>
          In the app's <strong>App settings → Basic</strong>, copy the{" "}
          <span className="font-mono text-accent-glow">App Secret</span> and
          paste it above. We use it to verify inbound webhook signatures
          (HMAC-SHA256, same as WhatsApp).
        </li>
        <li>
          Under the use case's step 3 <strong>"Configure webhooks"</strong>,
          set the{" "}
          <span className="font-mono text-accent-glow">Callback URL</span> to{" "}
          <span className="font-mono text-text-primary">
            https://your-domain/api/webhooks/meta/instagram
          </span>{" "}
          and the{" "}
          <span className="font-mono text-accent-glow">Verify Token</span> to
          any random string — put the same string in the "Webhook Verify
          Token" field above. Subscribe at least the{" "}
          <span className="font-mono">messages</span> field.
        </li>
        <li>
          The ID field above wants the IG account's{" "}
          <strong>Graph user ID</strong> (a long number starting{" "}
          <span className="font-mono">1784…</span>). Don't worry about getting
          it exactly right — <strong>Test</strong> reads the true ID from Meta
          and corrects the field automatically.
        </li>
        <li>
          Hit <strong>Test</strong>. A green pill confirms the token
          authenticates as your IG account against{" "}
          <span className="font-mono">graph.instagram.com</span>.
        </li>
        <li>
          Until the app passes <strong>App Review</strong> (Advanced Access on{" "}
          <span className="font-mono">instagram_business_manage_messages</span>
          ), only accounts with a role on the app (admins/testers) can DM you.
          For replies <strong>outside the 24-hour window</strong> the{" "}
          <span className="font-mono text-accent-glow">HUMAN_AGENT</span> tag
          must also be approved.
        </li>
      </ol>
    </div>
  );
}

function FacebookGuide() {
  return (
    <div className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <Info className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div>
          <h4 className="text-[13px] font-medium">Facebook Messenger</h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            Same Meta app; add the Messenger product and paste the Page ID +
            Page access token above.
          </p>
        </div>
      </div>
    </div>
  );
}