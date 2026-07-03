/**
 * Applications & vetting (§6.26 Q5–Q8). Auto-approval is never used — every
 * decision here is an explicit human action (canon: the UI must require it).
 * Marketing scores the rubric; approve sets probation, generates the contract
 * and invites the partner into the portal (backend side-effects).
 */

import { useState } from "react";
import { Inbox, ExternalLink, FileText } from "lucide-react";
import { Button, Pill } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { downloadDocument } from "@/lib/documents-api";
import {
  useApplications,
  useApplication,
  useApplicationMutations,
} from "./hooks";
import { PARTNER_STATUS_META, DEFAULT_RUBRIC } from "./constants";
import type { ApplicationRow } from "./types";

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-text-primary/[0.08] overflow-hidden">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RubricDrawer({
  stylistId,
  onClose,
}: {
  stylistId: string;
  onClose: () => void;
}) {
  const { review } = useApplicationMutations(stylistId);
  const [scores, setScores] = useState<number[]>(DEFAULT_RUBRIC.map(() => 0));
  const [recommendation, setRecommendation] = useState<
    "advance" | "reject" | "hold"
  >("advance");
  const [notes, setNotes] = useState("");
  const total = scores.reduce((s, x) => s + x, 0);
  const max = DEFAULT_RUBRIC.reduce((s, r) => s + r.max, 0);

  return (
    <Drawer open onClose={onClose} title="Score this application" subtitle="Rubric review — your score is recorded alongside every other reviewer's">
      <div className="space-y-5">
        {DEFAULT_RUBRIC.map((r, i) => (
          <div key={r.criterion}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label">{r.criterion}</label>
              <span className="font-mono text-[12px] tabular-nums">
                {scores[i]}/{r.max}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={r.max}
              value={scores[i]}
              onChange={(e) =>
                setScores((s) =>
                  s.map((x, j) => (j === i ? Number(e.target.value) : x)),
                )
              }
              className="w-full accent-[rgb(var(--accent))]"
            />
            <ScoreBar score={scores[i]} max={r.max} />
          </div>
        ))}

        <div className="glass rounded-xl p-3 flex items-center justify-between">
          <span className="micro">Total</span>
          <span className="font-display text-[22px] tabular-nums">
            {total}
            <span className="text-text-faint text-[14px]">/{max}</span>
          </span>
        </div>

        <div>
          <label className="label">Recommendation</label>
          <div className="flex gap-2 mt-1">
            {(["advance", "hold", "reject"] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={recommendation === r ? "primary" : "secondary"}
                onClick={() => setRecommendation(r)}
              >
                {r === "advance" ? "Advance" : r === "hold" ? "Hold" : "Reject"}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            className="input w-full min-h-[90px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What stood out — good or bad?"
          />
        </div>

        <Button
          variant="primary"
          disabled={review.isPending}
          onClick={() =>
            review.mutate(
              {
                rubric: DEFAULT_RUBRIC.map((r, i) => ({
                  criterion: r.criterion,
                  score: scores[i],
                  max: r.max,
                })),
                recommendation,
                notes: notes || undefined,
              },
              { onSuccess: onClose },
            )
          }
        >
          {review.isPending ? "Saving…" : "Record review"}
        </Button>
        {review.isError && (
          <p className="text-danger text-[12px]">
            {(review.error as Error).message}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function ApplicationDrawer({
  stylistId,
  onClose,
  onOpenPartner,
}: {
  stylistId: string;
  onClose: () => void;
  onOpenPartner: (id: string) => void;
}) {
  const can = useAuthStore((s) => s.can);
  const app = useApplication(stylistId);
  const { decide } = useApplicationMutations(stylistId);
  const [scoring, setScoring] = useState(false);
  const [confirm, setConfirm] = useState<null | "approve" | "reject">(null);
  const [probationMonths, setProbationMonths] = useState(3);
  const [note, setNote] = useState("");

  const a = app.data;
  const canDecide = can("stylist_programme", "approve");
  const canReview = can("stylist_programme", "edit");

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={a ? a.display_name : "Application"}
      subtitle={a ? `${a.partner_code} · applied ${new Date(a.application_received_at).toLocaleDateString()}` : undefined}
    >
      {app.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-text-primary/[0.05] animate-pulse" />
          ))}
        </div>
      )}
      {app.isError && (
        <ErrorState
          message={(app.error as Error).message}
          onRetry={() => app.refetch()}
        />
      )}
      {a && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={PARTNER_STATUS_META[a.status].tone}>
              {PARTNER_STATUS_META[a.status].label}
            </Pill>
            <span className="text-[12.5px] text-text-muted">
              {a.city}
              {a.state ? `, ${a.state}` : ""} · {a.country_code}
            </span>
          </div>

          {/* Socials + portfolio */}
          <div className="flex gap-2 flex-wrap">
            {[
              ["Portfolio", a.portfolio_url],
              ["Instagram", a.instagram_url],
              ["YouTube", a.youtube_url],
              ["Website", a.website_url],
            ]
              .filter(([, url]) => url)
              .map(([label, url]) => (
                <a
                  key={label as string}
                  href={url as string}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] border border-line text-[12px] font-semibold hover:border-accent/40"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {label}
                </a>
              ))}
            {[
              ["ID document", a.id_document_id],
              ["Business document", a.business_document_id],
            ]
              .filter(([, id]) => id)
              .map(([label, id]) => (
                <button
                  key={label as string}
                  onClick={() =>
                    downloadDocument({
                      document_id: id as string,
                      title: `${a.display_name} — ${label}`,
                    } as Parameters<typeof downloadDocument>[0]).catch(() =>
                      alert("Download failed"),
                    )
                  }
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] border border-line text-[12px] font-semibold hover:border-accent/40"
                >
                  <FileText className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
          </div>

          {a.bio && <p className="text-[13px] text-text-muted">{a.bio}</p>}

          {/* Questionnaire answers */}
          <section>
            <h3 className="micro mb-2">Brand-alignment questionnaire</h3>
            <div className="space-y-3">
              {a.responses.map((r) => (
                <div key={r.response_id} className="glass rounded-xl p-3">
                  <div className="text-[12px] text-text-muted mb-1">
                    {r.question}
                  </div>
                  <div className="text-[13px]">
                    {typeof r.answer === "boolean"
                      ? r.answer
                        ? "Yes"
                        : "No"
                      : String(r.answer)}
                  </div>
                </div>
              ))}
              {a.responses.length === 0 && (
                <p className="text-[12.5px] text-text-faint">
                  No questionnaire answers recorded.
                </p>
              )}
            </div>
          </section>

          {/* Rubric reviews */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="micro">Vetting reviews ({a.reviews.length})</h3>
              {canReview &&
                ["applicant", "vetting"].includes(a.status) && (
                  <Button size="sm" onClick={() => setScoring(true)}>
                    Score application
                  </Button>
                )}
            </div>
            <div className="space-y-2">
              {a.reviews.map((r) => (
                <div key={r.review_id} className="glass rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold">
                      {r.reviewer_name ?? "Reviewer"}
                    </span>
                    <span className="tabular-nums font-mono text-[12px]">
                      {Number(r.total_score)} pts ·{" "}
                      <Pill
                        tone={
                          r.recommendation === "advance"
                            ? "success"
                            : r.recommendation === "reject"
                              ? "danger"
                              : "warn"
                        }
                        dot={false}
                      >
                        {r.recommendation}
                      </Pill>
                    </span>
                  </div>
                  {r.notes && (
                    <p className="text-[12.5px] text-text-muted mt-1">
                      {r.notes}
                    </p>
                  )}
                </div>
              ))}
              {a.reviews.length === 0 && (
                <p className="text-[12.5px] text-text-faint">
                  Not yet scored — decisions need at least one recorded review.
                </p>
              )}
            </div>
          </section>

          {/* Explicit decisions — never automated */}
          {canDecide && ["applicant", "vetting"].includes(a.status) && (
            <section className="border-t hairline pt-4 space-y-3">
              <h3 className="micro">Decision</h3>
              <div className="flex gap-2 flex-wrap">
                {a.status === "applicant" && (
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ decision: "start_vetting" })}
                  >
                    Move to vetting
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decide.isPending}
                  onClick={() => setConfirm("approve")}
                >
                  Approve as partner
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={decide.isPending}
                  onClick={() => setConfirm("reject")}
                >
                  Reject
                </Button>
              </div>
              {decide.isError && (
                <p className="text-danger text-[12px]">
                  {(decide.error as Error).message}
                </p>
              )}
            </section>
          )}

          {["vetted", "certified"].includes(a.status) && (
            <Button size="sm" onClick={() => onOpenPartner(a.stylist_id)}>
              Open partner profile
            </Button>
          )}
        </div>
      )}

      {scoring && (
        <RubricDrawer stylistId={stylistId} onClose={() => setScoring(false)} />
      )}

      <ConfirmDialog
        open={confirm === "approve"}
        title="Approve this stylist?"
        tone="accent"
        busy={decide.isPending}
        message={
          <div className="space-y-3 text-left">
            <p>
              Approval marks them vetted, starts probation, generates the
              partner agreement for e-signature and emails their portal
              invite. The badge issues automatically when they sign.
            </p>
            <div>
              <label className="label">Probation (months)</label>
              <input
                type="number"
                min={0}
                max={24}
                className="input w-24"
                value={probationMonths}
                onChange={(e) => setProbationMonths(Number(e.target.value))}
              />
            </div>
          </div>
        }
        confirmLabel="Approve"
        onConfirm={() =>
          decide.mutate(
            { decision: "approve", probation_months: probationMonths },
            { onSuccess: () => setConfirm(null) },
          )
        }
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "reject"}
        title="Reject this application?"
        busy={decide.isPending}
        message={
          <div className="space-y-3 text-left">
            <p>The applicant is notified by email. This cannot be undone.</p>
            <textarea
              className="input w-full min-h-[70px]"
              placeholder="Reason (internal note + shapes the email tone)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        }
        confirmLabel="Reject"
        onConfirm={() =>
          decide.mutate(
            { decision: "reject", note: note || undefined },
            { onSuccess: () => setConfirm(null) },
          )
        }
        onClose={() => setConfirm(null)}
      />
    </Drawer>
  );
}

export function ApplicationsPanel({
  onOpenPartner,
}: {
  onOpenPartner: (id: string) => void;
}) {
  const apps = useApplications();
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<ApplicationRow>[] = [
    {
      key: "name",
      header: "Applicant",
      render: (p) => (
        <div>
          <div className="font-semibold text-[13px]">{p.display_name}</div>
          <div className="font-mono text-[10.5px] text-text-faint">
            {p.partner_code}
          </div>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (p) => (
        <span className="text-[12.5px]">
          {p.city} · {p.country_code}
        </span>
      ),
    },
    {
      key: "applied",
      header: "Applied",
      render: (p) => (
        <span className="text-[12.5px] tabular-nums">
          {new Date(p.application_received_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "reviews",
      header: "Reviews",
      render: (p) =>
        p.review_count > 0 ? (
          <span className="tabular-nums text-[12.5px]">
            {p.review_count} · latest{" "}
            <strong>{Number(p.latest_review?.total_score ?? 0)}</strong> pts
          </span>
        ) : (
          <Pill tone="warn" dot={false}>
            Unscored
          </Pill>
        ),
    },
    {
      key: "status",
      header: "Stage",
      render: (p) => (
        <Pill tone={PARTNER_STATUS_META[p.status].tone}>
          {PARTNER_STATUS_META[p.status].label}
        </Pill>
      ),
    },
  ];

  if (apps.isError)
    return (
      <ErrorState
        message={(apps.error as Error).message}
        onRetry={() => apps.refetch()}
      />
    );

  return (
    <>
      <DataTable
        columns={columns}
        rows={apps.data ?? []}
        rowKey={(p) => p.stylist_id}
        loading={apps.isLoading}
        onRowClick={(p) => setOpenId(p.stylist_id)}
        empty={{
          icon: <Inbox className="w-6 h-6" />,
          title: "No applications waiting",
          message:
            "New applications from the public portal land here for vetting.",
        }}
      />
      {openId && (
        <ApplicationDrawer
          stylistId={openId}
          onClose={() => setOpenId(null)}
          onOpenPartner={(id) => {
            setOpenId(null);
            onOpenPartner(id);
          }}
        />
      )}
    </>
  );
}
