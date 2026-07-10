import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Instagram,
  Facebook,
  Mail,
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
import { CommsStudioTab } from "./CommsStudioTab";
import { QuickRepliesTab } from "./QuickRepliesTab";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab";

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
};

const CONNECTIONS: ConnectionTab[] = ["whatsapp", "instagram", "facebook", "email"];

const CONFIG_ITEMS: {
  key: ConfigTab;
  label: string;
  icon: React.FC<{ className?: string }>;
  /** access.catalog.js module key this section's backend routes enforce. */
  permissionModule: string;
}[] = [
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
  const qc = useQueryClient();

  const canConnections = can("messaging_accounts", "edit");
  const visibleConfigItems = useMemo(
    () => CONFIG_ITEMS.filter((c) => can(c.permissionModule, "view")),
    [can],
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
                        {acc?.has_access_token && (
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
  }));
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    setForm({
      platform,
      external_account_id: account?.external_account_id ?? "",
      display_name: account?.display_name ?? "",
      is_active: account?.is_active ?? true,
      notes: account?.notes ?? "",
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
  });

  const canSave =
    !!form.external_account_id &&
    !!form.display_name &&
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
          {test.data?.provider_name
            ? `Authenticated as "${test.data.provider_name}" (${test.data.provider_id ?? "ok"}).`
            : test.data?.mx_records?.length
              ? `MX OK — primary: ${test.data.mx_records[0].exchange}`
              : "Provider responded."}
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

      {platform !== "email" && (
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

      {account && <RevealHistory accountId={account.account_id} />}

      <GettingStarted platform={platform} />
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

function GettingStarted({ platform }: { platform: MessagingPlatform }) {
  if (platform === "email") return null;
  if (platform === "whatsapp") return <WhatsAppGuide />;
  if (platform === "instagram") return <InstagramGuide />;
  return <FacebookGuide />;
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
            How to get your Instagram API keys
          </h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            Instagram Messenger rides the same Meta app as WhatsApp — you just
            add the <strong>Instagram</strong> and <strong>Messenger</strong>{" "}
            products. Your brand's IG account must be a{" "}
            <em>Business</em> account linked to the Facebook Page that owns it.
          </p>
        </div>
      </div>
      <ol className="p-4 space-y-3 text-[12.5px] text-text-muted list-decimal ml-5">
        <li>
          On the IG mobile app, switch the account to{" "}
          <strong>Business</strong> and connect it to your brand's Facebook
          Page — this is the only combination the Graph API accepts. If you
          already did this, skip.
        </li>
        <li>
          Go to your Meta app at{" "}
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            developers.facebook.com/apps <ExternalLink className="w-3 h-3" />
          </a>{" "}
          → add the <strong>Instagram</strong> and <strong>Messenger</strong>{" "}
          products. Under Instagram → API Setup, pick the connected IG Business
          Account and copy the{" "}
          <span className="font-mono text-accent-glow">
            Instagram Business Account ID
          </span>
          . Paste it into the ID field above.
        </li>
        <li>
          Generate a permanent{" "}
          <span className="font-mono text-accent-glow">Page Access Token</span>
          . In{" "}
          <a
            href="https://business.facebook.com/settings/system-users"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            Business Manager → System Users <ExternalLink className="w-3 h-3" />
          </a>{" "}
          create a system user, assign the Page owning your IG to it, and
          generate a token with{" "}
          <strong>instagram_manage_messages</strong>,{" "}
          <strong>instagram_manage_comments</strong>, and{" "}
          <strong>pages_messaging</strong> scopes. Paste it above.
        </li>
        <li>
          In the Meta app's <strong>Settings → Basic</strong>, copy the{" "}
          <span className="font-mono text-accent-glow">App Secret</span> and
          paste it above. We use it to verify inbound webhook signatures
          (HMAC-SHA256, same as WhatsApp).
        </li>
        <li>
          Under <strong>Instagram → Configuration → Webhooks</strong>, set the{" "}
          <span className="font-mono text-accent-glow">Callback URL</span> to{" "}
          <span className="font-mono text-text-primary">
            https://your-domain/api/webhooks/meta/instagram
          </span>{" "}
          and set the{" "}
          <span className="font-mono text-accent-glow">Verify Token</span> to
          any random string — put the same string in the "Webhook Verify Token"
          field above.
        </li>
        <li>
          Subscribe the webhook to these fields:{" "}
          <span className="font-mono">messages</span>,{" "}
          <span className="font-mono">messaging_seen</span>,{" "}
          <span className="font-mono">message_reactions</span>. To ingest{" "}
          <strong>story mentions</strong> and{" "}
          <strong>replies to your stories</strong>, also subscribe{" "}
          <span className="font-mono">messaging_postbacks</span> and{" "}
          <span className="font-mono">messaging_referral</span>. Hit{" "}
          <em>Verify and save</em>.
        </li>
        <li>
          For replies <strong>outside the 24-hour service window</strong>, your
          Meta app must be approved for the{" "}
          <span className="font-mono text-accent-glow">HUMAN_AGENT</span> tag
          (App Review → Standard Access). Until it's approved, expect a
          "24-hour window expired" error on late replies.
        </li>
        <li>
          Come back and hit <strong>Test</strong>. A green pill confirms the
          token authenticates as your IG Business Account against Meta Graph.
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
