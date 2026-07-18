import { useMemo, useState } from "react";
import {
  Loader2,
  Link2,
  Trash2,
  RefreshCw,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Play,
  Moon,
  AlertTriangle,
  AtSign,
  Check,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/auth";
import { compactCount } from "@/lib/format";
import {
  useSocialAccounts,
  useQuickLog,
  useDeletePost,
  useRefreshReactions,
  usePost,
  detectPlatformFromUrl,
  accountForUrl,
  buildPlatformLooks,
  registeredPlatforms,
  lookFor,
  isSunday,
  type PlatformLook,
  type SocialPost,
  type SocialAccount,
} from "@/lib/social-api";
import { PostEmbed } from "./PostEmbed";

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** A day drawer: native bottom sheet on phones, side drawer on desktop. */
export function DaySheet({
  date,
  posts,
  onClose,
}: {
  date: Date;
  posts: SocialPost[];
  onClose: () => void;
}) {
  const isDesktop = useIsDesktop();
  const dateLabel = `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`;
  const subtitle =
    posts.length === 0
      ? "Nothing logged yet"
      : `${posts.length} link${posts.length === 1 ? "" : "s"} logged`;

  const body = <DayBody date={date} posts={posts} showHeader={!isDesktop} dateLabel={dateLabel} />;

  if (isDesktop) {
    return (
      <Drawer open onClose={onClose} title={dateLabel} subtitle={subtitle}>
        {body}
      </Drawer>
    );
  }
  return (
    <BottomSheet open onClose={onClose}>
      {body}
    </BottomSheet>
  );
}

function DayBody({
  date,
  posts,
  showHeader,
  dateLabel,
}: {
  date: Date;
  posts: SocialPost[];
  showHeader: boolean;
  dateLabel: string;
}) {
  const { can } = useAuthStore();
  const canLog = can("social", "create");
  const accountsQ = useSocialAccounts();
  const accounts = useMemo(
    () => (accountsQ.data ?? []).filter((a) => a.is_active !== false),
    [accountsQ.data],
  );
  const looks = useMemo(() => buildPlatformLooks(accounts), [accounts]);
  // The registered handles ARE the chip row — plus any platform that already
  // has a post this day even if its handle was since removed.
  const platforms = useMemo(() => {
    const regs = registeredPlatforms(accounts);
    const extra = [...new Set(posts.map((p) => p.platform))].filter(
      (p) => !regs.includes(p),
    );
    return [...regs, ...extra];
  }, [accounts, posts]);

  const sunday = isSunday(date);
  const isFuture = startOfDay(date).getTime() > startOfDay(new Date()).getTime();
  const covered = new Set(posts.map((p) => p.platform));

  return (
    <div className="space-y-4">
      {showHeader && (
        <div>
          <h2 className="font-display text-[19px] font-medium leading-tight">{dateLabel}</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            {posts.length === 0
              ? "Nothing logged yet"
              : `${posts.length} link${posts.length === 1 ? "" : "s"} logged`}
          </p>
        </div>
      )}

      {sunday && (
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-text-primary/[0.03] px-3 py-2.5">
          <Moon className="h-4 w-4 text-text-muted" />
          <span className="text-[12.5px] text-text-muted">
            Sunday is a rest day — no post expected. You can still log one if you posted.
          </span>
        </div>
      )}

      {/* Coverage chips — one per registered handle's platform */}
      {!isFuture && platforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {platforms.map((p) => {
            const on = covered.has(p);
            const look = lookFor(looks, p);
            return (
              <span
                key={p}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  on ? "border-transparent text-white" : "border-line text-text-faint"
                }`}
                style={on ? { background: look.color } : undefined}
              >
                {on && <Check className="h-3 w-3" />}
                {look.label}
              </span>
            );
          })}
        </div>
      )}

      {/* No handles registered yet — point at the Account tab (canon: empty
          state with CTA, not a dead surface). */}
      {!accountsQ.isLoading && accounts.length === 0 && posts.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-[12px] border border-dashed border-line px-3 py-4">
          <AtSign className="h-4 w-4 flex-none text-text-faint" />
          <span className="text-[12.5px] text-text-muted">
            No handles registered yet — add your accounts in the{" "}
            <span className="font-semibold text-text-primary">Account</span> tab
            and they&rsquo;ll appear here.
          </span>
        </div>
      )}

      {/* Logged posts */}
      {posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((p) => (
            <LoggedPost
              key={p.post_id}
              post={p}
              look={lookFor(looks, p.platform)}
              canDelete={can("social", "delete")}
              canEdit={can("social", "edit")}
            />
          ))}
        </div>
      )}

      {/* Composer */}
      {isFuture ? (
        <p className="rounded-[12px] border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-text-faint">
          This day hasn&rsquo;t come yet — paste a link once it&rsquo;s posted.
        </p>
      ) : canLog && accounts.length > 0 ? (
        <LinkComposer date={date} accounts={accounts} looks={looks} />
      ) : null}
    </div>
  );
}

/** Paste a single link → resolve it to a registered handle → log it. */
function LinkComposer({
  date,
  accounts,
  looks,
}: {
  date: Date;
  accounts: SocialAccount[];
  looks: Map<string, PlatformLook>;
}) {
  const quickLog = useQuickLog();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = url.trim();
  const account = trimmed ? accountForUrl(trimmed, accounts) : null;
  // Canonical detection still names the platform when there's no handle for
  // it, so the error can say WHICH handle to add.
  const detected = account?.platform ?? (trimmed ? detectPlatformFromUrl(trimmed) : null);
  const look = detected ? lookFor(looks, detected) : null;
  const noAccount = Boolean(detected) && !account;

  const publishedAt = (() => {
    const w = new Date(date);
    w.setHours(12, 0, 0, 0);
    return w.toISOString();
  })();

  const canSubmit = Boolean(account) && !quickLog.isPending;

  const submit = () => {
    setError(null);
    if (!account) {
      setError(
        detected && look
          ? `Add a ${look.label} handle in the Account tab first.`
          : "That link doesn't match any of your registered platforms.",
      );
      return;
    }
    quickLog.mutate(
      {
        external_url: trimmed,
        platform: account.platform,
        account_id: account.account_id,
        published_at: publishedAt,
      },
      {
        onSuccess: () => setUrl(""),
        onError: () => setError("Couldn't log that link. Check it and try again."),
      },
    );
  };

  return (
    <div className="space-y-2 rounded-[14px] border border-line bg-text-primary/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text-muted">
        <Link2 className="h-3.5 w-3.5" />
        Paste a posted link
      </div>
      <div className="flex items-center rounded-[11px] border border-line bg-text-primary/[0.04] focus-within:border-accent/50">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          placeholder="https://instagram.com/p/…"
          className="h-11 w-full bg-transparent px-3 font-mono text-[12px] outline-none"
          autoComplete="off"
          inputMode="url"
          data-1p-ignore=""
        />
        {look && (
          <span
            className="mr-1.5 grid h-7 w-7 flex-none place-items-center rounded-lg font-display text-[11px] font-semibold text-white"
            style={{ background: look.color }}
            title={look.label}
          >
            {look.glyph}
          </span>
        )}
      </div>

      {account && look && (
        <p className="text-[11.5px] text-text-faint">
          Logs to <span className="text-text-muted">@{account.handle}</span> on {look.label}.
        </p>
      )}
      {noAccount && look && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5" />
          No {look.label} handle yet — add one in the Account tab.
        </p>
      )}
      {error && <p className="text-[11.5px] text-danger">{error}</p>}

      <Button
        variant="primary"
        className="w-full"
        disabled={!canSubmit}
        onClick={submit}
        icon={quickLog.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      >
        Log it
      </Button>
    </div>
  );
}

/** One logged link: its live embed + reactions + refresh/delete actions. */
function LoggedPost({
  post,
  look,
  canDelete,
  canEdit,
}: {
  post: SocialPost;
  look: PlatformLook;
  canDelete: boolean;
  canEdit: boolean;
}) {
  // The list row lacks metrics; the single GET carries them.
  const detailQ = usePost(post.post_id);
  const detail = detailQ.data ?? post;
  const metrics = detail.metrics?.[0];
  const refresh = useRefreshReactions();
  const del = useDeletePost();
  const [confirming, setConfirming] = useState(false);

  const reactions: { icon: typeof Heart; value: number }[] = metrics
    ? [
        { icon: Heart, value: metrics.likes },
        { icon: MessageCircle, value: metrics.comments },
        { icon: Share2, value: metrics.shares },
        { icon: Bookmark, value: metrics.saves },
        { icon: Play, value: metrics.video_views },
      ].filter((r) => r.value > 0)
    : [];

  return (
    <div className="space-y-2">
      <PostEmbed
        platform={post.platform}
        url={detail.external_url ?? post.external_url ?? ""}
        thumbnailUrl={detail.oembed_thumbnail_url}
        authorHandle={detail.oembed_author_handle}
        look={look}
      />

      {detail.handle_mismatch && (
        <div className="flex items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5" />
          This link&rsquo;s author doesn&rsquo;t match a registered handle.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {reactions.length > 0 ? (
          <div className="flex items-center gap-3 text-[12px] text-text-muted">
            {reactions.map(({ icon: Icon, value }, i) => (
              <span key={i} className="inline-flex items-center gap-1 tabular-nums">
                <Icon className="h-3.5 w-3.5" />
                {compactCount(value)}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11.5px] text-text-faint italic">No reactions pulled yet</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {canEdit && (
            <button
              onClick={() => refresh.mutate(post.post_id)}
              disabled={refresh.isPending}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-text-muted hover:border-accent/40 hover:text-accent-glow disabled:opacity-50"
              title="Refresh reactions"
            >
              {refresh.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setConfirming(true)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-text-muted hover:border-danger/40 hover:text-danger"
              title="Remove link"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {confirming &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-6 backdrop-blur-[2px]"
            onClick={() => setConfirming(false)}
          >
            <div
              className="dropglass w-full max-w-[320px] rounded-[16px] p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-display text-[16px]">Remove this link?</h3>
              <p className="mt-1 text-[12.5px] text-text-muted">
                It disappears from this day and the performance count. This can&rsquo;t be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={del.isPending}
                  onClick={() => del.mutate(post.post_id, { onSuccess: () => setConfirming(false) })}
                  icon={del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
