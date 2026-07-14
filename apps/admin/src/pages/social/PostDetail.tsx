import { useState } from "react";
import {
  CalendarDays,
  Send,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Upload,
  Timer,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Pill } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  usePost,
  useReschedulePost,
  useSubmitProof,
  useRateCreative,
  useRecordMetrics,
  useUpdatePost,
  useAssignableStaff,
  PLATFORM_META,
  STATUS_TONE,
  STATUS_LABEL,
  type SocialPost,
} from "@/lib/social-api";
import { formatDateTime } from "@/lib/format";
import { Labelled, TextInput, StarRating, PostGrade, ProductTagPicker, toLocalInput } from "./parts";

const EDITABLE = new Set(["draft", "assigned", "scheduled"]);
const PROOFABLE = new Set(["scheduled", "assigned", "flagged"]);

export function PostDetail({ post: seed, onClose }: { post: SocialPost; onClose: () => void }) {
  const { can } = useAuthStore();
  // The list/plan endpoints hand over a snapshot; refetch the single post so
  // mutations (rate, proof, reschedule…) reflect back into this same drawer.
  const detailQ = usePost(seed.post_id);
  const post = detailQ.data ?? seed;
  const reschedule = useReschedulePost();
  const submitProof = useSubmitProof();
  const rate = useRateCreative();
  const recordMetrics = useRecordMetrics();
  const updatePost = useUpdatePost();
  const staffQ = useAssignableStaff();
  const metrics = post.metrics ?? [];
  const latest = metrics[0];

  const canEdit = can("social", "edit");
  const canApprove = can("social", "approve");
  const editable = EDITABLE.has(post.status);
  const proofable = PROOFABLE.has(post.status);

  const [rescheduleAt, setRescheduleAt] = useState(() =>
    seed.scheduled_for ? toLocalInput(new Date(seed.scheduled_for)) : "",
  );
  const [proofUrl, setProofUrl] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>(seed.tagged_product_ids ?? []);
  const [metricInputs, setMetricInputs] = useState({
    reach: "",
    likes: "",
    comments: "",
    shares: "",
    saves: "",
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={PLATFORM_META[post.platform]?.label ?? post.platform}
      subtitle={`${post.post_type} · ${STATUS_LABEL[post.status]}`}
    >
      <div className="space-y-4 p-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Pill>
          {post.scheduled_for && (
            <span className="text-[11.5px] text-text-faint">
              Due {formatDateTime(post.scheduled_for)}
            </span>
          )}
        </div>

        {post.status === "flagged" && post.flag_reason && (
          <div className="flex items-start gap-2 rounded-[11px] border border-danger/30 bg-danger/[0.08] p-3">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-danger">{post.flag_reason}</p>
          </div>
        )}

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

        {editable && (
          <Labelled label="Tagged products (powers the storefront &ldquo;as seen on&rdquo; badge)">
            <ProductTagPicker
              value={tags}
              onChange={(v) => {
                setTags(v);
                updatePost.mutate({ id: post.post_id, input: { tagged_product_ids: v } });
              }}
            />
          </Labelled>
        )}

        {editable && staffQ.data && staffQ.data.length > 0 && (
          <Labelled label="Assigned to">
            <Select
              value={post.assigned_to ?? ""}
              onChange={(v) =>
                updatePost.mutate({ id: post.post_id, input: { assigned_to: v || undefined } })
              }
              options={[
                { value: "", label: "Unassigned (whoever's on it)" },
                ...staffQ.data.map((s) => ({ value: s.user_id, label: s.display_name })),
              ]}
            />
          </Labelled>
        )}

        {/* Proof of publish */}
        {proofable && canEdit && (
          <div className="space-y-3 pt-3 border-t border-line">
            <div className="micro">Prove it&rsquo;s live</div>
            <Labelled label="Link to the live post">
              <TextInput
                value={proofUrl}
                onChange={setProofUrl}
                placeholder="https://instagram.com/p/…"
                mono
              />
            </Labelled>
            <Labelled label="Screenshot">
              <label className="flex items-center gap-2 h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[12.5px] text-text-muted cursor-pointer hover:border-accent/50">
                <Upload className="w-4 h-4" />
                {screenshot ? screenshot.name : "Choose an image…"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                />
              </label>
            </Labelled>
            {submitProof.isError && (
              <p className="text-[12px] text-danger">
                Couldn&rsquo;t submit proof — a link and a screenshot are both required.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!proofUrl || !screenshot || submitProof.isPending}
                onClick={() =>
                  submitProof.mutate(
                    { id: post.post_id, external_url: proofUrl, screenshot: screenshot! },
                    { onSuccess: () => setScreenshot(null) },
                  )
                }
                icon={
                  submitProof.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )
                }
              >
                Submit proof
              </Button>
            </div>
          </div>
        )}

        {/* Posted: proof card + Post Grade + metrics */}
        {post.status === "posted" && (
          <div className="space-y-3 pt-3 border-t border-line">
            <div className="flex items-center justify-between">
              <div className="micro">Proof</div>
              <a
                href={post.external_url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-accent-glow hover:underline"
              >
                View live <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {post.handle_mismatch && (
              <div className="flex items-start gap-2 rounded-[11px] border border-warn/30 bg-warn/[0.08] p-3">
                <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-warn">
                  This link&rsquo;s author (@{post.oembed_author_handle ?? "unknown"}) doesn&rsquo;t
                  match a registered handle — double-check it&rsquo;s the right account.
                </p>
              </div>
            )}
            <div className="flex items-center gap-3">
              {post.oembed_thumbnail_url && (
                <img
                  src={post.oembed_thumbnail_url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border border-line"
                />
              )}
              <PostGrade
                performanceScore={post.performance_score}
                creativeRating={post.creative_rating}
              />
            </div>

            {canApprove && (
              <Labelled label="Rate the creative">
                <StarRating
                  value={post.creative_rating}
                  onChange={(n) => rate.mutate({ id: post.post_id, rating: n })}
                />
              </Labelled>
            )}

            <Labelled label="Engagement (manual entry from the platform's own insights)">
              <div className="grid grid-cols-3 gap-2">
                {(["reach", "likes", "comments", "shares", "saves"] as const).map((k) => (
                  <input
                    key={k}
                    type="number"
                    min={0}
                    value={metricInputs[k]}
                    onChange={(e) => setMetricInputs((m) => ({ ...m, [k]: e.target.value }))}
                    placeholder={latest ? String(latest[k]) : k}
                    className="h-[38px] px-2.5 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12.5px] outline-none focus:border-accent/50"
                  />
                ))}
              </div>
            </Labelled>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                disabled={recordMetrics.isPending}
                onClick={() =>
                  recordMetrics.mutate({
                    id: post.post_id,
                    metrics: Object.fromEntries(
                      Object.entries(metricInputs)
                        .filter(([, v]) => v !== "")
                        .map(([k, v]) => [k, Number(v)]),
                    ),
                  })
                }
              >
                Save metrics
              </Button>
            </div>
          </div>
        )}

        {/* Reschedule */}
        {canEdit && post.status !== "posted" && (
          <div className="space-y-2 pt-3 border-t border-line">
            <div className="micro">{post.scheduled_for ? "Reschedule" : "Schedule"}</div>
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
                  reschedule.mutate({
                    id: post.post_id,
                    scheduled_for: new Date(rescheduleAt).toISOString(),
                  })
                }
                icon={
                  reschedule.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CalendarDays className="w-4 h-4" />
                  )
                }
              >
                Set
              </Button>
            </div>
            {post.nudge_count > 0 && (
              <p className="text-[11px] text-text-faint inline-flex items-center gap-1">
                <Timer className="w-3 h-3" /> Nudged {post.nudge_count} time
                {post.nudge_count === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
