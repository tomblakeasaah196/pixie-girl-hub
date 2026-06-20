import { useMemo, useState } from "react";
import {
  Share2,
  Plus,
  CalendarDays,
  List,
  Plug,
  Trash2,
  Send,
  FileText,
  RefreshCw,
  Heart,
  MessageCircle,
  Eye,
  Bookmark,
  Repeat2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, DeniedState, MultiSelect, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  usePosts,
  useSocialAccounts,
  useConnectAccount,
  useRevokeAccount,
  useCreatePost,
  usePublishPost,
  useReschedulePost,
  usePostMetrics,
  useRefreshMetrics,
  PLATFORM_META,
  ALL_PLATFORMS,
  POST_TYPES,
  STATUS_TONE,
  STATUS_LABEL,
  MONTH_NAMES,
  DAY_NAMES,
  monthGrid,
  sameDay,
  type SocialPost,
  type SocialPlatform,
  type PostType,
  type SocialAccount,
} from "@/lib/social-api";

/**
 * Social Media Management (`/social`, canon §6.14).
 *
 * Posts (calendar + list), the multi-platform composer, connected accounts
 * and per-post engagement. Ports the hub-system SocialHome UX into the admin
 * design system (Maroon Noir tokens, glass, TanStack Query, entity scope).
 */

type Tab = "calendar" | "posts" | "accounts";

/** What the composer's dispatch button does. */
type PostMode = "now" | "draft" | "schedule";
const ACTIONS: { key: PostMode; label: string; icon: React.ReactNode }[] = [
  { key: "now", label: "Publish now", icon: <Send className="w-3.5 h-3.5" /> },
  { key: "draft", label: "Save draft", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-3.5 h-3.5" /> },
];

export function SocialPage() {
  useBreadcrumbs([{ label: "Social" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState<Tab>("calendar");
  const [composer, setComposer] = useState<{ date?: Date } | null>(null);
  const [detail, setDetail] = useState<SocialPost | null>(null);

  const postsQ = usePosts();
  const posts = postsQ.data?.data ?? [];
  const canCreate = can("social", "create");

  if (!can("social", "view")) {
    return <DeniedState message="You don't have access to Social Media." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <div className="flex items-end justify-between gap-3 border-b border-line">
        <nav className="flex items-center gap-1">
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} icon={<CalendarDays className="w-4 h-4" />}>
            Calendar
          </TabButton>
          <TabButton active={tab === "posts"} onClick={() => setTab("posts")} icon={<List className="w-4 h-4" />}>
            Posts
          </TabButton>
          <TabButton active={tab === "accounts"} onClick={() => setTab("accounts")} icon={<Plug className="w-4 h-4" />}>
            Accounts
          </TabButton>
        </nav>
        {canCreate && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setComposer({})}
            className="mb-1.5"
          >
            New post
          </Button>
        )}
      </div>

      {tab === "accounts" ? (
        <AccountsTab />
      ) : postsQ.isLoading ? (
        <PostsSkeleton />
      ) : postsQ.isError ? (
        <ErrorState onRetry={() => postsQ.refetch()} />
      ) : tab === "calendar" ? (
        <CalendarTab
          posts={posts}
          onOpen={setDetail}
          onCreateOn={canCreate ? (date) => setComposer({ date }) : undefined}
        />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Share2 className="w-7 h-7" />}
          title="No posts yet"
          message="Compose your first post and schedule it across channels."
          action={
            canCreate ? (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setComposer({})}>
                New post
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PostsTab posts={posts} onOpen={setDetail} />
      )}

      {composer && (
        <Composer initialDate={composer.date} onClose={() => setComposer(null)} />
      )}
      {detail && (
        <PostDetail post={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-accent text-accent-glow"
          : "border-transparent text-text-muted hover:text-text-primary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Posts list ──────────────────────────────────────────────

function PostsTab({
  posts,
  onOpen,
}: {
  posts: SocialPost[];
  onOpen: (p: SocialPost) => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      {posts.map((p, i) => (
        <button
          key={p.post_id}
          onClick={() => onOpen(p)}
          className={`w-full text-left p-4 flex items-start gap-3 hover:bg-text-primary/[0.03] transition-colors ${
            i < posts.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={STATUS_TONE[p.status]} dot>
                {STATUS_LABEL[p.status] ?? p.status}
              </Pill>
              <span className="text-[11.5px] uppercase tracking-widest text-text-faint">
                {PLATFORM_META[p.platform]?.label ?? p.platform} · {p.post_type}
              </span>
            </div>
            <p className="mt-1.5 text-[13.5px] text-text-primary line-clamp-2">
              {p.caption || (
                <span className="text-text-faint italic">No caption</span>
              )}
            </p>
            <p className="mt-1 text-[11.5px] text-text-faint">
              {p.scheduled_for
                ? `Scheduled ${new Date(p.scheduled_for).toLocaleString()}`
                : p.published_at
                  ? `Published ${new Date(p.published_at).toLocaleString()}`
                  : `Created ${new Date(p.created_at).toLocaleDateString()}`}
            </p>
          </div>
          {p.media_urls?.[0] && (
            <img
              src={p.media_urls[0]}
              alt=""
              className="w-12 h-12 rounded-lg object-cover border border-line shrink-0"
            />
          )}
        </button>
      ))}
    </Card>
  );
}

// ── Calendar ────────────────────────────────────────────────

function CalendarTab({
  posts,
  onOpen,
  onCreateOn,
}: {
  posts: SocialPost[];
  onOpen: (p: SocialPost) => void;
  onCreateOn?: (date: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const weeks = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, SocialPost[]>();
    for (const p of posts) {
      const when = p.scheduled_for || p.published_at;
      if (!when) continue;
      const d = new Date(when);
      const k = d.toDateString();
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [posts]);

  const shift = (n: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px]">
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} icon={<ChevronLeft className="w-4 h-4" />}>
            {""}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} icon={<ChevronRight className="w-4 h-4" />}>
            {""}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-[10.5px] uppercase tracking-widest text-text-faint py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {weeks.flat().map((d, idx) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayPosts = byDay.get(d.toDateString()) ?? [];
          // Only today / future days can start a new post; past days are
          // view-only (their posts stay clickable).
          const clickable = inMonth && !!onCreateOn && d >= startToday;
          return (
            <div
              key={idx}
              onClick={clickable ? () => onCreateOn!(d) : undefined}
              role={clickable ? "button" : undefined}
              title={clickable ? "Schedule a post on this day" : undefined}
              className={`group min-h-[84px] rounded-lg border p-1.5 transition-colors ${
                inMonth ? "border-line bg-text-primary/[0.02]" : "border-transparent opacity-40"
              } ${clickable ? "cursor-pointer hover:border-accent/40 hover:bg-accent/[0.04]" : ""} ${
                sameDay(d, new Date()) ? "ring-1 ring-accent/40" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-text-faint">{d.getDate()}</span>
                {clickable && (
                  <Plus className="w-3 h-3 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </div>
              <div className="space-y-1">
                {dayPosts.slice(0, 3).map((p) => (
                  <button
                    key={p.post_id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p);
                    }}
                    className={`w-full text-left text-[10.5px] px-1.5 py-1 rounded-md truncate ${
                      p.status === "draft"
                        ? "bg-text-primary/[0.07] text-text-muted hover:bg-text-primary/[0.12]"
                        : p.status === "published"
                          ? "bg-success/[0.12] text-success hover:bg-success/20"
                          : "bg-accent/[0.1] text-accent-glow hover:bg-accent/20"
                    }`}
                    title={p.caption ?? ""}
                  >
                    {p.status === "draft" ? "◦ " : ""}
                    {PLATFORM_META[p.platform]?.label?.slice(0, 2)} ·{" "}
                    {p.caption?.slice(0, 16) || p.post_type}
                  </button>
                ))}
                {dayPosts.length > 3 && (
                  <div className="text-[10px] text-text-faint pl-1">
                    +{dayPosts.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Accounts ────────────────────────────────────────────────

function AccountsTab() {
  const { can } = useAuthStore();
  const accountsQ = useSocialAccounts();
  const revoke = useRevokeAccount();
  const [connecting, setConnecting] = useState(false);
  const accounts = accountsQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">
          Connected social accounts that posts publish to.
        </p>
        {can("social", "create") && (
          <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setConnecting(true)}>
            Connect account
          </Button>
        )}
      </div>
      <Card className="p-0 overflow-hidden">
        {accountsQ.isLoading ? (
          <div className="p-5">
            <Skeleton style={{ height: 18, width: "40%" }} />
          </div>
        ) : accounts.length === 0 ? (
          <p className="p-6 text-center text-[12.5px] text-text-faint italic">
            No accounts connected yet.
          </p>
        ) : (
          accounts.map((a: SocialAccount, i) => (
            <div
              key={a.account_id}
              className={`p-4 flex items-center gap-3 ${
                i < accounts.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line text-[11px] font-bold uppercase">
                {(PLATFORM_META[a.platform]?.label ?? a.platform).slice(0, 2)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] truncate">@{a.handle}</div>
                <div className="text-[11.5px] text-text-faint">
                  {PLATFORM_META[a.platform]?.label ?? a.platform}
                </div>
              </div>
              {can("social", "delete") && (
                <button
                  onClick={() => {
                    if (window.confirm(`Disconnect @${a.handle}?`))
                      revoke.mutate(a.account_id);
                  }}
                  className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
                  title="Disconnect"
                >
                  <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
                </button>
              )}
            </div>
          ))
        )}
      </Card>
      {connecting && <ConnectAccountDrawer onClose={() => setConnecting(false)} />}
    </div>
  );
}

function ConnectAccountDrawer({ onClose }: { onClose: () => void }) {
  const connect = useConnectAccount();
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [handle, setHandle] = useState("");
  const [externalId, setExternalId] = useState("");

  return (
    <Drawer open onClose={onClose} title="Connect account" subtitle="Link a social profile">
      <div className="space-y-4 p-1">
        <Labelled label="Platform">
          <Select
            value={platform}
            onChange={(v) => setPlatform(v)}
            options={ALL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
          />
        </Labelled>
        <Labelled label="Handle">
          <TextInput value={handle} onChange={setHandle} placeholder="pixiegirlglobal" prefix="@" />
        </Labelled>
        <Labelled label="External account ID">
          <TextInput value={externalId} onChange={setExternalId} placeholder="Provider account id" mono />
        </Labelled>
        {connect.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t connect. Check the account isn&rsquo;t already linked.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!handle || !externalId || connect.isPending}
            onClick={() =>
              connect.mutate(
                { platform, handle, external_account_id: externalId },
                { onSuccess: onClose },
              )
            }
            icon={connect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          >
            Connect
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Composer ────────────────────────────────────────────────

function Composer({
  initialDate,
  onClose,
}: {
  initialDate?: Date;
  onClose: () => void;
}) {
  const accountsQ = useSocialAccounts();
  const create = useCreatePost();
  const publish = usePublishPost();
  const accounts = accountsQ.data ?? [];

  const [platforms, setPlatforms] = useState<SocialPlatform[]>(["instagram"]);
  const [accountId, setAccountId] = useState<string>("");
  const [postType, setPostType] = useState<PostType>("image");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  // When opened from a calendar day, default the schedule to 09:00 on that day.
  const [scheduledFor, setScheduledFor] = useState(() =>
    initialDate ? toLocalInput(initialDate, 9) : "",
  );
  // Action: publish immediately, keep a draft, or schedule. A future calendar
  // pick defaults to "schedule"; today / no date defaults to "now".
  const [mode, setMode] = useState<PostMode>(() =>
    !initialDate ? "now" : sameDay(initialDate, new Date()) ? "now" : "schedule",
  );

  const primary = platforms[0] ?? "instagram";
  const charLimit = PLATFORM_META[primary]?.charLimit ?? 2200;
  const overLimit = caption.length > charLimit;

  const accountsForPlatform = accounts.filter((a) => platforms.includes(a.platform));
  const resolvedAccountId =
    accountId || accountsForPlatform[0]?.account_id || accounts[0]?.account_id || "";

  const busy = create.isPending || publish.isPending;
  const currentAction = ACTIONS.find((a) => a.key === mode)!;
  // You can't publish "now" onto a future day — only draft or schedule.
  const isFuturePick = !!initialDate && !sameDay(initialDate, new Date());
  const availableActions = isFuturePick
    ? ACTIONS.filter((a) => a.key !== "now")
    : ACTIONS;
  const canSubmit =
    platforms.length > 0 &&
    !!resolvedAccountId &&
    !overLimit &&
    (mode !== "schedule" || !!scheduledFor);

  async function submit() {
    const base = {
      account_id: resolvedAccountId,
      platform: primary,
      post_type: postType,
      caption: caption || undefined,
      hashtags: hashtags
        .split(/[\s,]+/)
        .map((h) => h.replace(/^#/, ""))
        .filter(Boolean),
      media_urls: mediaUrls.split(/\s+/).filter(Boolean),
    };
    try {
      if (mode === "schedule") {
        await create.mutateAsync({
          ...base,
          scheduled_for: new Date(scheduledFor).toISOString(),
        });
      } else if (mode === "draft") {
        // A draft opened from a calendar day keeps that day (as its planned
        // date) so it shows on the calendar but stays a draft; the backend
        // detaches it once the day passes.
        await create.mutateAsync({
          ...base,
          status: "draft",
          scheduled_for:
            initialDate && scheduledFor
              ? new Date(scheduledFor).toISOString()
              : undefined,
        });
      } else {
        // Publish now: create the post, then push it live.
        const post = await create.mutateAsync(base);
        await publish.mutateAsync({ id: post.post_id });
      }
      onClose();
    } catch {
      /* surfaced via create.isError / publish.isError below */
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="New post"
      subtitle={
        initialDate
          ? initialDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
          : "Compose & schedule across channels"
      }
    >
      <div className="space-y-4 p-1">
        <Labelled label="Channels">
          <MultiSelect
            values={platforms}
            onChange={(v) => setPlatforms(v as SocialPlatform[])}
            options={ALL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
          />
        </Labelled>

        {accounts.length > 0 && (
          <Labelled label="Publish from">
            <Select
              value={resolvedAccountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({
                value: a.account_id,
                label: `@${a.handle} · ${PLATFORM_META[a.platform]?.label}`,
              }))}
            />
          </Labelled>
        )}

        <Labelled label="Post type">
          <Select
            value={postType}
            onChange={(v) => setPostType(v as PostType)}
            options={POST_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
          />
        </Labelled>

        <Labelled label="Caption">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            placeholder="Write your caption…"
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
          />
          <div className={`text-[11px] mt-1 text-right ${overLimit ? "text-danger" : "text-text-faint"}`}>
            {caption.length} / {charLimit}
          </div>
        </Labelled>

        <Labelled label="Hashtags">
          <TextInput value={hashtags} onChange={setHashtags} placeholder="#luxe #hair #lagos" />
        </Labelled>

        <Labelled label="Media URLs (space-separated)">
          <TextInput value={mediaUrls} onChange={setMediaUrls} placeholder="https://… https://…" mono />
        </Labelled>

        <Labelled label="When">
          <div className={`grid gap-1.5 ${availableActions.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {availableActions.map((a) => {
              const on = mode === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setMode(a.key)}
                  className={`inline-flex items-center justify-center gap-1.5 h-[38px] rounded-[10px] text-[12px] font-semibold border transition-colors ${
                    on
                      ? "border-accent/50 text-accent-glow bg-accent/[0.12]"
                      : "border-line text-text-muted hover:text-text-primary"
                  }`}
                >
                  {a.icon}
                  {a.label}
                </button>
              );
            })}
          </div>
        </Labelled>

        {mode === "schedule" && (
          <Labelled label="Scheduled date & time">
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
            />
          </Labelled>
        )}

        {accounts.length === 0 && (
          <p className="text-[12px] text-warn">
            No connected account — connect one in the Accounts tab first.
          </p>
        )}
        {(create.isError || publish.isError) && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t save the post.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSubmit || busy}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : currentAction.icon}
          >
            {currentAction.label}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Post detail + metrics ───────────────────────────────────

function PostDetail({ post, onClose }: { post: SocialPost; onClose: () => void }) {
  const { can } = useAuthStore();
  const metricsQ = usePostMetrics(post.post_id);
  const publish = usePublishPost();
  const reschedule = useReschedulePost();
  const refresh = useRefreshMetrics();
  const metrics = metricsQ.data ?? [];

  const canEdit = can("social", "edit");
  const editable =
    post.status === "draft" ||
    post.status === "scheduled" ||
    post.status === "failed";
  const isFuture =
    !!post.scheduled_for && new Date(post.scheduled_for) > new Date();
  // Publish now: drafts/failed any time; a scheduled post only once it's due
  // (never publish "now" onto a still-future scheduled date).
  const canPublishNow =
    canEdit && editable && !(post.status === "scheduled" && isFuture);
  const [rescheduleAt, setRescheduleAt] = useState(() =>
    post.scheduled_for ? toLocalInput(new Date(post.scheduled_for)) : "",
  );

  const totals = metrics.reduce(
    (acc, m) => ({
      likes: acc.likes + (m.likes ?? 0),
      comments: acc.comments + (m.comments ?? 0),
      shares: acc.shares + (m.shares ?? 0),
      saves: acc.saves + (m.saves ?? 0),
      reach: Math.max(acc.reach, m.reach ?? 0),
      impressions: Math.max(acc.impressions, m.impressions ?? 0),
    }),
    { likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0 },
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={PLATFORM_META[post.platform]?.label ?? post.platform}
      subtitle={`${post.post_type} · ${STATUS_LABEL[post.status] ?? post.status}`}
    >
      <div className="space-y-4 p-1">
        <div className="flex items-center gap-2">
          <Pill tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status] ?? post.status}</Pill>
          {post.scheduled_for && (
            <span className="text-[11.5px] text-text-faint">
              {new Date(post.scheduled_for).toLocaleString()}
            </span>
          )}
        </div>

        {post.media_urls?.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {post.media_urls.map((u, i) => (
              <img key={i} src={u} alt="" className="w-20 h-20 rounded-lg object-cover border border-line" />
            ))}
          </div>
        )}

        <div>
          <div className="micro mb-1">Caption</div>
          <p className="text-[13.5px] text-text-primary whitespace-pre-wrap">
            {post.caption || <span className="text-text-faint italic">No caption</span>}
          </p>
        </div>

        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.hashtags.map((h) => (
              <span key={h} className="text-[11.5px] text-accent-glow bg-accent/[0.1] rounded-full px-2 py-0.5">
                #{h}
              </span>
            ))}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="micro">Engagement</div>
            {can("social", "edit") && post.status === "published" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => refresh.mutate(post.post_id)}
                icon={<RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />}
              >
                Refresh
              </Button>
            )}
          </div>
          {metricsQ.isLoading ? (
            <Skeleton style={{ height: 60 }} />
          ) : metrics.length === 0 ? (
            <p className="text-[12.5px] text-text-faint italic">No metrics recorded yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Metric icon={<Heart className="w-3.5 h-3.5" />} label="Likes" value={totals.likes} />
              <Metric icon={<MessageCircle className="w-3.5 h-3.5" />} label="Comments" value={totals.comments} />
              <Metric icon={<Repeat2 className="w-3.5 h-3.5" />} label="Shares" value={totals.shares} />
              <Metric icon={<Bookmark className="w-3.5 h-3.5" />} label="Saves" value={totals.saves} />
              <Metric icon={<Eye className="w-3.5 h-3.5" />} label="Reach" value={totals.reach} />
              <Metric icon={<Eye className="w-3.5 h-3.5" />} label="Impr." value={totals.impressions} />
            </div>
          )}
        </div>

        {canEdit && editable && (
          <div className="space-y-3 pt-3 border-t border-line">
            {isFuture && post.status === "scheduled" && (
              <p className="text-[11.5px] text-text-faint">
                Scheduled for a future date — reschedule it, or publish once
                it&rsquo;s due.
              </p>
            )}
            <div>
              <div className="micro mb-1.5">{isFuture ? "Reschedule" : "Schedule"}</div>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={rescheduleAt}
                  onChange={(e) => setRescheduleAt(e.target.value)}
                  className="flex-1 h-[40px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!rescheduleAt || reschedule.isPending}
                  onClick={() =>
                    reschedule.mutate(
                      {
                        id: post.post_id,
                        scheduled_for: new Date(rescheduleAt).toISOString(),
                      },
                      { onSuccess: onClose },
                    )
                  }
                  icon={
                    reschedule.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CalendarDays className="w-4 h-4" />
                    )
                  }
                >
                  {isFuture ? "Reschedule" : "Schedule"}
                </Button>
              </div>
            </div>
            {canPublishNow && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => publish.mutate({ id: post.post_id }, { onSuccess: onClose })}
                  disabled={publish.isPending}
                  icon={publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                >
                  Publish now
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-text-primary/[0.02] p-2.5">
      <div className="flex items-center gap-1.5 text-text-faint text-[10.5px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="font-display text-[18px] tabular-nums mt-0.5">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// ── Small shared form bits ──────────────────────────────────

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  prefix,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50">
      {prefix && <span className="pl-3 text-text-faint text-[13px]">{prefix}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-transparent px-3 h-[42px] text-[13px] outline-none ${mono ? "font-mono text-[12px]" : ""}`}
      />
    </div>
  );
}

/** Format a date as a `datetime-local` value (YYYY-MM-DDTHH:mm). When `hour`
 *  is given the time is pinned to that hour; otherwise the date's own time is
 *  kept. */
function toLocalInput(date: Date, hour?: number): string {
  const d = new Date(date);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostsSkeleton() {
  return (
    <Card className="p-4 space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} style={{ height: 48 }} />
      ))}
    </Card>
  );
}
