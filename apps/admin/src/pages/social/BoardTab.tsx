import { useState } from "react";
import {
  Plus,
  Send,
  Check,
  Undo2,
  Loader2,
  CalendarRange,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  usePlans,
  usePlan,
  useCreatePlan,
  useAddPostsToPlan,
  useSubmitPlan,
  useApprovePlan,
  useRequestPlanChanges,
  useSocialAccounts,
  PLATFORM_META,
  ALL_PLATFORMS,
  POST_TYPES,
  PLAN_STATUS_TONE,
  PLAN_STATUS_LABEL,
  STATUS_TONE,
  STATUS_LABEL,
  type ContentPlan,
  type SocialPlatform,
  type PostType,
  type PostRowInput,
  type SocialPost,
} from "@/lib/social-api";
import { formatDate } from "@/lib/format";
import { Labelled } from "./parts";
import { PostDetail } from "./PostDetail";

function monthRange(offset: number): { period_start: string; period_end: string; label: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    period_start: iso(start),
    period_end: iso(end),
    label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

export function BoardTab() {
  const { can } = useAuthStore();
  const canCreate = can("social", "create");
  const plansQ = usePlans();
  const plans = plansQ.data ?? [];
  const create = useCreatePlan();
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [newPlanOffset, setNewPlanOffset] = useState(1); // default: plan next month

  const options = [0, 1, 2].map((n) => ({ value: String(n), label: monthRange(n).label }));

  return (
    <div className="space-y-3">
      {canCreate && (
        <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[13px] text-text-muted">
            <CalendarRange className="w-4 h-4 text-text-faint" />
            Plan a whole month of posts at once, submit it for one CEO approval.
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(newPlanOffset)}
              onChange={(v) => setNewPlanOffset(Number(v))}
              options={options}
            />
            <Button
              size="sm"
              variant="primary"
              icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              disabled={create.isPending}
              onClick={() => {
                const { period_start, period_end } = monthRange(newPlanOffset);
                create.mutate(
                  { period_start, period_end },
                  { onSuccess: (p) => setOpenPlanId(p.plan_id) },
                );
              }}
            >
              New plan
            </Button>
          </div>
        </Card>
      )}

      {plansQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 48 }} />
          ))}
        </Card>
      ) : plansQ.isError ? (
        <ErrorState onRetry={() => plansQ.refetch()} />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="w-7 h-7" />}
          title="No content plans yet"
          message="Plan a month of posts and submit it for one CEO approval."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {plans.map((p, i) => (
            <button
              key={p.plan_id}
              onClick={() => setOpenPlanId(p.plan_id)}
              className={`w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-text-primary/[0.03] transition-colors ${
                i < plans.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div>
                <div className="font-medium text-[13.5px]">
                  {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </div>
                <div className="text-[11.5px] text-text-faint mt-0.5">
                  {p.post_count} post{p.post_count === 1 ? "" : "s"}
                  {p.decision_notes ? ` · "${p.decision_notes}"` : ""}
                </div>
              </div>
              <Pill tone={PLAN_STATUS_TONE[p.status]}>{PLAN_STATUS_LABEL[p.status]}</Pill>
            </button>
          ))}
        </Card>
      )}

      {openPlanId && <PlanDetail planId={openPlanId} onClose={() => setOpenPlanId(null)} />}
    </div>
  );
}

// ── Plan detail: bulk grid planner + submit/approve ──────────

interface GridRow extends PostRowInput {
  _key: number;
}
let rowKey = 0;
function blankRow(): GridRow {
  return { _key: rowKey++, platform: "instagram", post_type: "image", caption: "" };
}

function PlanDetail({ planId, onClose }: { planId: string; onClose: () => void }) {
  const { can } = useAuthStore();
  const planQ = usePlan(planId);
  const accountsQ = useSocialAccounts();
  const addPosts = useAddPostsToPlan();
  const submit = useSubmitPlan();
  const approve = useApprovePlan();
  const requestChanges = useRequestPlanChanges();
  const [rows, setRows] = useState<GridRow[]>([blankRow(), blankRow(), blankRow()]);
  const [notes, setNotes] = useState("");
  const [detail, setDetail] = useState<SocialPost | null>(null);

  const plan = planQ.data;
  const canEdit = can("social", "create");
  const canApprove = can("social", "approve");
  const editable = plan && ["draft", "changes_requested"].includes(plan.status);

  if (!plan) {
    return (
      <Drawer open onClose={onClose} title="Content plan" wide>
        <Skeleton style={{ height: 200 }} />
      </Drawer>
    );
  }

  const filledRows = rows.filter((r) => r.caption?.trim() || r.scheduled_for);

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${formatDate(plan.period_start)} – ${formatDate(plan.period_end)}`}
      subtitle={PLAN_STATUS_LABEL[plan.status]}
      wide
    >
      <div className="space-y-5 p-1">
        <div className="flex items-center gap-2">
          <Pill tone={PLAN_STATUS_TONE[plan.status]}>{PLAN_STATUS_LABEL[plan.status]}</Pill>
          {plan.decision_notes && (
            <span className="text-[12px] text-text-muted italic">&ldquo;{plan.decision_notes}&rdquo;</span>
          )}
        </div>

        {editable && canEdit && (
          <div className="space-y-2">
            <div className="micro">Plan the month — fast grid entry</div>
            <div className="rounded-[11px] border border-line overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr_2fr_28px] gap-px bg-line text-[10.5px] uppercase tracking-wide text-text-faint">
                <div className="bg-panel-2 px-2 py-1.5">Date</div>
                <div className="bg-panel-2 px-2 py-1.5">Platform</div>
                <div className="bg-panel-2 px-2 py-1.5">Type</div>
                <div className="bg-panel-2 px-2 py-1.5">Caption</div>
                <div className="bg-panel-2" />
              </div>
              {rows.map((row, i) => (
                <div
                  key={row._key}
                  className="grid grid-cols-[1fr_1fr_1fr_2fr_28px] gap-px bg-line"
                >
                  <input
                    type="date"
                    value={row.scheduled_for?.slice(0, 10) ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((rs) =>
                        rs.map((r, j) =>
                          j === i
                            ? { ...r, scheduled_for: v ? `${v}T09:00:00.000Z` : undefined }
                            : r,
                        ),
                      );
                    }}
                    className="bg-panel px-2 py-1.5 text-[12px] outline-none"
                  />
                  <select
                    value={row.platform}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((r, j) =>
                          j === i ? { ...r, platform: e.target.value as SocialPlatform } : r,
                        ),
                      )
                    }
                    className="bg-panel px-2 py-1.5 text-[12px] outline-none"
                  >
                    {ALL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_META[p].label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.post_type}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((r, j) => (j === i ? { ...r, post_type: e.target.value as PostType } : r)),
                      )
                    }
                    className="bg-panel px-2 py-1.5 text-[12px] outline-none"
                  >
                    {POST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.caption ?? ""}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, caption: e.target.value } : r)))
                    }
                    placeholder="Caption…"
                    className="bg-panel px-2 py-1.5 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    className="bg-panel text-text-faint hover:text-danger text-[13px]"
                    title="Remove row"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                + Add row
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={filledRows.length === 0 || addPosts.isPending || accountsQ.data?.length === 0}
                icon={addPosts.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
                onClick={() =>
                  addPosts.mutate(
                    { planId, rows: filledRows },
                    { onSuccess: () => setRows([blankRow(), blankRow(), blankRow()]) },
                  )
                }
              >
                Add {filledRows.length || ""} post{filledRows.length === 1 ? "" : "s"} to plan
              </Button>
            </div>
            {accountsQ.data?.length === 0 && (
              <p className="text-[12px] text-warn">Connect at least one account first (Accounts tab).</p>
            )}
          </div>
        )}

        <div>
          <div className="micro mb-2">
            Posts in this plan ({plan.posts?.length ?? 0})
          </div>
          {!plan.posts || plan.posts.length === 0 ? (
            <p className="text-[12.5px] text-text-faint italic">No posts added yet.</p>
          ) : (
            <div className="rounded-[11px] border border-line divide-y divide-line overflow-hidden">
              {plan.posts.map((post) => (
                <button
                  key={post.post_id}
                  onClick={() => setDetail(post)}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-text-primary/[0.03]"
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] truncate">
                      {PLATFORM_META[post.platform]?.label} · {post.caption?.slice(0, 40) || post.post_type}
                    </div>
                    {post.scheduled_for && (
                      <div className="text-[11px] text-text-faint">{formatDate(post.scheduled_for)}</div>
                    )}
                  </div>
                  <Pill tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Pill>
                </button>
              ))}
            </div>
          )}
        </div>

        {editable && canEdit && (plan.posts?.length ?? 0) > 0 && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={submit.isPending}
              icon={submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              onClick={() => submit.mutate(planId)}
            >
              Submit for approval
            </Button>
          </div>
        )}

        {plan.status === "pending_approval" && canApprove && (
          <div className="space-y-2 pt-3 border-t border-line">
            <div className="micro">Decide</div>
            <Labelled label="Notes (optional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Feedback for the creator…"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2 text-[13px] outline-none focus:border-accent/50 resize-y"
              />
            </Labelled>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={requestChanges.isPending}
                icon={<Undo2 className="w-4 h-4" />}
                onClick={() => requestChanges.mutate({ id: planId, notes: notes || undefined })}
              >
                Request changes
              </Button>
              <Button
                variant="primary"
                disabled={approve.isPending}
                icon={approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                onClick={() => approve.mutate({ id: planId, notes: notes || undefined })}
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </div>

      {detail && <PostDetail post={detail} onClose={() => setDetail(null)} />}
    </Drawer>
  );
}

// Re-export the type so BoardTab consumers can annotate a plan if needed.
export type { ContentPlan };
