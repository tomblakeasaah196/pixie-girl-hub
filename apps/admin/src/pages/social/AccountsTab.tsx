import { useState } from "react";
import {
  Plug,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Settings2,
  AlertTriangle,
  Lock,
  Sparkles,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Skeleton, Pill, type Tone } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useSocialAccounts,
  useConnectAccount,
  useRevokeAccount,
  useSyncAccount,
  type SocialAccount,
} from "@/lib/social-api";
import {
  useSocialPlatforms,
  useCreateSocialPlatform,
  type SocialPlatformDef,
} from "@/lib/social-platforms-api";
import { compactCount, formatDateTime, initials } from "@/lib/format";
import { ApifySettingsModal } from "@/components/social/ApifySettingsModal";
import { Labelled, TextInput } from "./parts";

/**
 * Accounts — the brand's real handles per platform, now carrying the
 * public metrics Apify scrapes twice daily (follower count + bio) in
 * addition to the original proof-of-publish role (flagging a pasted link
 * that doesn't look like it came from your account). Platforms are a
 * data-driven registry (social-platforms-api.ts), not a hardcoded list —
 * "Add handle" can register a brand-new network on the fly.
 */
export function AccountsTab() {
  const { can } = useAuthStore();
  const accountsQ = useSocialAccounts();
  const platformsQ = useSocialPlatforms(false); // active only — this is the "Add handle" picker's source
  const revoke = useRevokeAccount();
  const sync = useSyncAccount();
  const [connecting, setConnecting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const accounts = accountsQ.data ?? [];

  if (!can("social", "view")) {
    return (
      <Card className="p-10 flex flex-col items-center gap-3 text-center">
        <Lock className="w-7 h-7 text-text-faint" />
        <p className="text-[13px] text-text-muted">
          You don&rsquo;t have access to Social Studio accounts.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-text-muted max-w-[54ch]">
          Public follower counts and bios, pulled by Apify and refreshed twice
          daily — also used to flag a proof link that doesn&rsquo;t look like
          it came from your account.
        </p>
        <div className="flex items-center gap-2">
          {can("apify_settings", "view") && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Settings2 className="w-4 h-4" />}
              onClick={() => setConfiguring(true)}
            >
              Configure Apify
            </Button>
          )}
          {can("social", "create") && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setConnecting(true)}
            >
              Add handle
            </Button>
          )}
        </div>
      </div>

      {accountsQ.isLoading ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(258px,1fr))]">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="rounded-xl" style={{ height: 36, width: 36 }} />
                <div className="flex-1 space-y-2">
                  <Skeleton style={{ height: 11, width: "60%" }} />
                  <Skeleton style={{ height: 9, width: "40%" }} />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="flex-1" style={{ height: 46 }} />
                <Skeleton className="flex-1" style={{ height: 46 }} />
              </div>
              <Skeleton style={{ height: 28 }} />
            </Card>
          ))}
        </div>
      ) : accountsQ.isError ? (
        <Card className="p-10 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-7 h-7 text-danger" />
          <p className="text-[13px] text-text-muted">Couldn&rsquo;t load connected accounts.</p>
          <Button size="sm" variant="secondary" onClick={() => accountsQ.refetch()}>
            Retry
          </Button>
        </Card>
      ) : accounts.length === 0 ? (
        <Card className="p-10 flex flex-col items-center gap-3 text-center">
          <p className="text-[12.5px] text-text-faint italic">No handles registered yet.</p>
          {can("social", "create") && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setConnecting(true)}
            >
              Add your first platform
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(258px,1fr))]">
          {accounts.map((a) => (
            <AccountCard
              key={a.account_id}
              account={a}
              onSync={() => sync.mutate(a.account_id)}
              syncing={sync.isPending && sync.variables === a.account_id}
              onRemove={() => {
                if (window.confirm(`Remove @${a.handle}?`)) revoke.mutate(a.account_id);
              }}
              canDelete={can("social", "delete")}
              canEdit={can("social", "edit")}
            />
          ))}
        </div>
      )}

      {connecting && (
        <ConnectAccountDrawer
          platforms={platformsQ.data ?? []}
          onClose={() => setConnecting(false)}
        />
      )}
      {configuring && <ApifySettingsModal onClose={() => setConfiguring(false)} />}
    </div>
  );
}

const SCRAPE_STATUS: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "Scraper active" },
  error: { tone: "danger", label: "Scrape failed" },
  pending: { tone: "warn", label: "Awaiting first sync" },
  paused: { tone: "neutral", label: "Scraper paused" },
};

function AccountCard({
  account,
  onSync,
  syncing,
  onRemove,
  canEdit,
  canDelete,
}: {
  account: SocialAccount;
  onSync: () => void;
  syncing: boolean;
  onRemove: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const statusKey = !account.scrape_enabled
    ? "paused"
    : account.last_scrape_status === "error"
      ? "error"
      : account.last_scraped_at
        ? "ok"
        : "pending";
  const status = SCRAPE_STATUS[statusKey];
  const schema = account.platform_metrics_schema ?? [];
  // count/decimal -> numeric tiles; text -> chips; bool -> badges (shown when true).
  // After a successful scrape, a metric the actor didn't return means this
  // profile simply doesn't have it (e.g. a Facebook page with ratings off) —
  // drop the tile rather than showing a dead "—". Before the first sync (or
  // after an error) keep every tile so the card shows what's coming.
  const scrapedOk = account.last_scrape_status === "ok";
  const numericSpecs = schema.filter(
    (s) =>
      (!s.type || s.type === "count" || s.type === "decimal") &&
      (!scrapedOk || account.metrics?.[s.key] !== undefined),
  );
  const textSpecs = schema.filter((s) => s.type === "text");
  const boolSpecs = schema.filter((s) => s.type === "bool");

  const brand = account.platform_brand_color;

  return (
    <Card className="p-4 flex flex-col gap-3 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[3px] opacity-90" style={{ background: brand }} />
      <div className="flex items-center gap-3">
        {account.avatar_url ? (
          <img
            src={account.avatar_url}
            alt=""
            className="w-9 h-9 rounded-xl object-cover flex-none"
          />
        ) : (
          <span
            className="grid place-items-center w-9 h-9 rounded-xl text-[13px] font-display font-semibold text-white flex-none"
            style={{ background: brand }}
          >
            {account.platform_icon_glyph || initials(account.platform_display_name)}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13.5px] truncate">
            {account.platform_display_name}
          </div>
          <div className="text-[11.5px] text-text-faint truncate">
            @{account.handle}
            {account.profile_url && (
              <>
                {" · "}
                <a
                  href={account.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-glow hover:underline"
                >
                  view profile
                </a>
              </>
            )}
          </div>
        </div>
        {canDelete && (
          <button
            onClick={onRemove}
            className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40 flex-none"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
          </button>
        )}
      </div>

      {numericSpecs.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {numericSpecs.map((s) => (
            <MetricTile
              key={s.key}
              label={s.label}
              value={account.metrics?.[s.key]}
              decimal={s.type === "decimal"}
            />
          ))}
        </div>
      )}

      {(boolSpecs.length > 0 || textSpecs.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {boolSpecs.map((s) =>
            account.metrics?.[s.key] === true ? (
              <Pill key={s.key} tone={boolTone(s.key)}>
                {s.label}
              </Pill>
            ) : null,
          )}
          {textSpecs.map((s) => {
            const v = account.metrics?.[s.key];
            return v === undefined || v === null || v === "" ? null : (
              <AttrChip key={s.key} label={s.label} value={String(v)} />
            );
          })}
        </div>
      )}

      {account.platform_supports_bio && (
        <p className="text-[12px] text-text-muted line-clamp-2 min-h-[32px]">
          {account.bio ||
            (account.last_scraped_at
              ? "No bio set on this profile."
              : "No bio yet — syncs at the next scheduled run.")}
        </p>
      )}

      {account.last_scrape_status === "error" && account.last_scrape_error && (
        <p className="text-[11px] text-danger line-clamp-2" title={account.last_scrape_error}>
          {account.last_scrape_error}
        </p>
      )}

      <div className="mt-auto pt-3 border-t border-line flex items-center gap-2">
        <Pill tone={status.tone}>{status.label}</Pill>
        <span className="text-[10.5px] text-text-faint ml-auto whitespace-nowrap">
          {account.last_scraped_at ? `Synced ${formatDateTime(account.last_scraped_at)}` : "Not synced yet"}
        </span>
        {canEdit && (
          <button
            onClick={onSync}
            disabled={syncing}
            className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-accent/40 disabled:opacity-50 flex-none"
            title="Sync now"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-text-muted hover:text-accent-glow" />
            )}
          </button>
        )}
      </div>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  decimal,
}: {
  label: string;
  value: number | string | boolean | undefined;
  decimal?: boolean;
}) {
  const display =
    typeof value === "number"
      ? decimal
        ? value.toFixed(1)
        : compactCount(value)
      : "—";
  return (
    <div className="min-w-0 rounded-[10px] bg-text-primary/[0.035] px-2.5 py-2">
      <div className="font-mono text-[15px] font-medium tabular-nums">{display}</div>
      <div className="text-[9px] uppercase tracking-wide text-text-faint mt-0.5 truncate">
        {label}
      </div>
    </div>
  );
}

// Bool badges only show when true; a couple of keys get a meaningful tone.
const BOOL_TONE: Record<string, Tone> = {
  verified: "success",
  ads_running: "warn",
  closed: "danger",
};
function boolTone(key: string): Tone {
  return BOOL_TONE[key] ?? "neutral";
}

/** A labelled text attribute (category, industry, address, …) rendered as a
 *  compact chip, with the full value on hover. */
function AttrChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 max-w-full rounded-full border border-line bg-text-primary/[0.03] px-2 py-0.5"
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] uppercase tracking-wide text-text-faint">{label}</span>
      <span className="text-[10.5px] text-text-muted truncate max-w-[140px]">{value}</span>
    </span>
  );
}

function ConnectAccountDrawer({
  platforms,
  onClose,
}: {
  platforms: SocialPlatformDef[];
  onClose: () => void;
}) {
  const connect = useConnectAccount();
  const createPlatform = useCreateSocialPlatform();
  const [platform, setPlatform] = useState<string>(platforms[0]?.platform_key ?? "");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [addingPlatform, setAddingPlatform] = useState(false);

  return (
    <Drawer open onClose={onClose} title="Add handle" subtitle="Register a brand-owned account">
      <div className="space-y-4 p-1">
        <Labelled label="Platform">
          {platforms.length > 0 ? (
            <Select
              value={platform}
              onChange={setPlatform}
              options={platforms.map((p) => ({ value: p.platform_key, label: p.display_name }))}
            />
          ) : (
            <p className="text-[12px] text-text-faint italic">No platforms registered yet.</p>
          )}
        </Labelled>
        <button
          type="button"
          onClick={() => setAddingPlatform((v) => !v)}
          className="text-[11.5px] text-accent-glow hover:underline"
        >
          {addingPlatform ? "Cancel — use an existing platform" : "Don't see it? Add a new platform"}
        </button>
        {addingPlatform && (
          <NewPlatformFields
            onCreated={(key) => {
              setPlatform(key);
              setAddingPlatform(false);
            }}
            saving={createPlatform.isPending}
            create={(input) =>
              createPlatform.mutateAsync(input).then((p) => p.platform_key)
            }
          />
        )}
        <Labelled label="Handle">
          <TextInput value={handle} onChange={setHandle} placeholder="pixiegirlglobal" prefix="@" />
        </Labelled>
        <Labelled label="Profile URL (optional)">
          <TextInput
            value={profileUrl}
            onChange={setProfileUrl}
            placeholder="https://instagram.com/pixiegirlglobal"
            mono
          />
        </Labelled>
        {connect.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t add that handle. Check it isn&rsquo;t already registered.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!handle || !platform || connect.isPending}
            onClick={() =>
              connect.mutate(
                { platform, handle, profile_url: profileUrl || undefined },
                { onSuccess: onClose },
              )
            }
            icon={connect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          >
            Add
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/** Inline "register a new platform" mini-form — the concrete answer to
 *  "we need to be able to add Twitter/Pinterest/whatever else Apify
 *  covers": no engineering change, just this form. Apify actor id is
 *  optional at this step; an admin can paste one later in Configure Apify
 *  once they've picked one from the Apify Store. */
function NewPlatformFields({
  onCreated,
  create,
  saving,
}: {
  onCreated: (key: string) => void;
  create: (input: {
    platform_key: string;
    display_name: string;
    brand_color: string;
    apify_actor_id?: string;
  }) => Promise<string>;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState("#a81d1d");
  const [actorId, setActorId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const key = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return (
    <div className="rounded-[12px] border border-line bg-text-primary/[0.02] p-3 space-y-3">
      <Labelled label="Platform name">
        <TextInput value={displayName} onChange={setDisplayName} placeholder="Pinterest" />
      </Labelled>
      <Labelled label="Brand color">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-full rounded-[10px] border border-line bg-transparent"
        />
      </Labelled>
      <Labelled label="Apify actor ID (optional — can add later)">
        <TextInput value={actorId} onChange={setActorId} placeholder="author/actor-name" mono />
      </Labelled>
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
      <Button
        size="sm"
        variant="secondary"
        icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        disabled={!key || !displayName || saving}
        onClick={async () => {
          setError(null);
          try {
            const created = await create({
              platform_key: key,
              display_name: displayName,
              brand_color: color,
              apify_actor_id: actorId || undefined,
            });
            onCreated(created);
          } catch {
            setError("Couldn't register that platform — the key may already exist.");
          }
        }}
      >
        Register platform
      </Button>
    </div>
  );
}
