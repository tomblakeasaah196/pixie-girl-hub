import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Search,
  Users,
  MessageSquare,
  Instagram,
  Facebook,
  Mail,
  Loader2,
  Check,
  ChevronDown,
  RotateCcw,
  Lock,
} from "lucide-react";
import { useActiveBusiness } from "@/stores/business";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";
import {
  smartcommApi,
  type AccessPlatform,
  type ChannelGrant,
  type ChannelGrantMap,
  type ChannelAccessUser,
} from "@/lib/smartcomm-api";
import { cn } from "@/lib/cn";

/**
 * Channel Access — Messaging settings → Channel Access (CEO-only, gated at
 * the modal rail AND the backend routes).
 *
 * The single source of truth for which channels each employee can reach.
 * Everyone can message in-house by default; the CEO decides who additionally
 * sees WhatsApp, Instagram, Facebook, and email — or restricts a staffer to
 * in-house only. Backed by shared.smartcomm_platform_permissions; the
 * smartcomm service enforces every grant here on read, reply, and inbox
 * listing.
 */

const CHANNELS: {
  key: AccessPlatform;
  label: string;
  icon: React.FC<{ className?: string }>;
  hint: string;
  external: boolean;
}[] = [
  {
    key: "internal",
    label: "In-house & Groups",
    icon: Users,
    hint: "Team DMs and staff group chats",
    external: false,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    hint: "Customer WhatsApp threads",
    external: true,
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: Instagram,
    hint: "Instagram DMs",
    external: true,
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: Facebook,
    hint: "Messenger threads",
    external: true,
  },
  {
    key: "email",
    label: "Email",
    icon: Mail,
    hint: "Customer email conversations",
    external: true,
  },
];

export function ChannelAccessTab() {
  const business = useActiveBusiness();
  const [q, setQ] = useState("");
  const [openUser, setOpenUser] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["smartcomm", "channel-access", business.key],
    queryFn: () => smartcommApi.getChannelAccessMatrix(),
  });

  const filtered = useMemo(() => {
    const users = data?.users ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.display_name?.toLowerCase().includes(needle) ||
        (u.job_title ?? "").toLowerCase().includes(needle) ||
        (u.department ?? "").toLowerCase().includes(needle),
    );
  }, [data?.users, q]);

  return (
    <div className="space-y-5">
      <header>
        <h3 className="font-display text-[17px] inline-flex items-center gap-2">
          <ShieldCheck className="w-[18px] h-[18px] text-accent-glow" />
          Channel Access
        </h3>
        <p className="text-[12.5px] text-text-muted mt-1">
          The single source of truth for who can reach which channels. Every
          staff member can message in-house by default — grant WhatsApp,
          Instagram, Facebook, or email per person, or restrict someone to
          in-house only.
        </p>
      </header>

      <div className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent/[0.06] px-3.5 py-2.5 text-[12.5px] text-text-muted">
        <Lock className="w-4 h-4 mt-[2px] shrink-0 text-accent-glow" />
        <div>
          <span className="font-medium text-text-primary">CEO-only.</span>{" "}
          Changes take effect immediately — on the very next message load a
          staffer's inbox only shows the channels granted here. Grants apply to{" "}
          <span className="text-text-primary">{business.name}</span>.
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search staff by name, role, or department…"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus-visible:border-accent/50"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore=""
          data-form-type="other"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-panel-2 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border hairline bg-panel-2/40 py-10 text-center text-[12.5px] text-text-faint">
          No staff match “{q}”.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((u) => (
            <UserRow
              key={u.user_id}
              user={u}
              open={openUser === u.user_id}
              onToggle={() =>
                setOpenUser((cur) => (cur === u.user_id ? null : u.user_id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  open,
  onToggle,
}: {
  user: ChannelAccessUser;
  open: boolean;
  onToggle: () => void;
}) {
  const grantedExternal = CHANNELS.filter(
    (c) => c.external && user.channels[c.key]?.can_view,
  );

  return (
    <div
      className={cn(
        "rounded-xl border hairline bg-panel-2/40 transition-colors",
        open && "border-accent/40 bg-panel-2/70",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs text-white"
          style={{ backgroundColor: getAvatarColour(user.display_name) }}
        >
          {getInitials(user.display_name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-text-primary">
            {user.display_name}
          </span>
          <span className="block truncate text-[11px] text-text-muted">
            {user.job_title || "—"}
            {user.department ? ` · ${user.department}` : ""}
          </span>
        </span>
        {/* Summary chips */}
        <span className="hidden sm:flex items-center gap-1 shrink-0">
          {user.managed ? (
            grantedExternal.length === 0 ? (
              <span className="rounded-full bg-panel border hairline px-2 py-0.5 text-[10px] text-text-faint">
                In-house only
              </span>
            ) : (
              grantedExternal.map((c) => {
                const Icon = c.icon;
                return (
                  <span
                    key={c.key}
                    title={c.label}
                    className="grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-accent-glow"
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                );
              })
            )
          ) : (
            <span className="rounded-full bg-panel border hairline px-2 py-0.5 text-[10px] text-text-faint">
              Default · all channels
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-text-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && <AccessEditor user={user} />}
    </div>
  );
}

function AccessEditor({ user }: { user: ChannelAccessUser }) {
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ChannelGrantMap>(() =>
    cloneGrants(user.channels),
  );
  const [savedAt, setSavedAt] = useState(0);

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: ["smartcomm", "channel-access", business.key],
    });
    // The target user's own inbox visibility changes — nudge those queries.
    qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
  };

  const save = useMutation({
    mutationFn: () =>
      smartcommApi.setUserChannelAccess(user.user_id, { channels: draft }),
    onSuccess: () => {
      invalidate();
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(0), 2000);
    },
  });

  const reset = useMutation({
    mutationFn: () =>
      smartcommApi.setUserChannelAccess(user.user_id, { reset: true }),
    onSuccess: () => invalidate(),
  });

  const setChannel = (key: AccessPlatform, patch: Partial<ChannelGrant>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(user.channels),
    [draft, user.channels],
  );

  return (
    <div className="border-t hairline px-3 py-3 space-y-2">
      {CHANNELS.map((c) => {
        const grant = draft[c.key];
        const Icon = c.icon;
        const on = !!grant?.can_view;
        return (
          <div
            key={c.key}
            className="rounded-lg border hairline bg-panel/40 px-3 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg border hairline",
                  on ? "bg-accent/15 text-accent-glow" : "bg-panel-2 text-text-faint",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-text-primary">
                  {c.label}
                </span>
                <span className="block text-[10.5px] text-text-faint">
                  {c.hint}
                </span>
              </span>
              <Switch
                checked={on}
                onChange={(v) =>
                  setChannel(c.key, {
                    can_view: v,
                    // Turning a channel on defaults to a useful posture;
                    // turning it off clears the sub-permissions.
                    can_reply: v,
                    can_close: v,
                    can_send_template: v ? grant?.can_send_template : false,
                  })
                }
              />
            </div>

            {/* Sub-permissions — external channels only, when access is on. */}
            {c.external && on && (
              <div className="mt-2.5 ml-[42px] flex flex-wrap gap-1.5">
                <SubToggle
                  label="Reply"
                  checked={!!grant?.can_reply}
                  onChange={(v) => setChannel(c.key, { can_reply: v })}
                />
                <SubToggle
                  label="Send templates"
                  checked={!!grant?.can_send_template}
                  onChange={(v) => setChannel(c.key, { can_send_template: v })}
                />
                <SubToggle
                  label="Resolve / close"
                  checked={!!grant?.can_close}
                  onChange={(v) => setChannel(c.key, { can_close: v })}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          onClick={() => reset.mutate()}
          disabled={reset.isPending || (!user.managed && !dirty)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-text-muted hover:text-text-primary disabled:opacity-40"
          title="Clear all custom grants — return this staffer to the default (all channels)"
        >
          {reset.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Reset to default
        </button>

        <div className="flex items-center gap-2">
          {savedAt > 0 && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-green-300">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-bg hover:bg-accent-glow disabled:opacity-40"
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save access
          </button>
        </div>
      </div>

      {save.isError && (
        <p className="text-[11.5px] text-danger">
          {save.error instanceof Error ? save.error.message : "Couldn't save."}
        </p>
      )}
    </div>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-panel-2 border hairline",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function SubToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        checked
          ? "border-accent/40 bg-accent/10 text-accent-glow"
          : "hairline text-text-muted hover:text-text-primary",
      )}
    >
      <span
        className={cn(
          "grid h-3 w-3 place-items-center rounded-sm border",
          checked ? "border-accent bg-accent text-bg" : "border-line",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      {label}
    </button>
  );
}

function cloneGrants(g: ChannelGrantMap): ChannelGrantMap {
  return JSON.parse(JSON.stringify(g));
}
