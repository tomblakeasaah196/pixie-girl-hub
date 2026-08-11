/**
 * Applicant pipeline — the internal tracking view for a vacancy.
 *
 * A ranked, stage-filterable list (sorted by AI match score) with inline stage
 * moves and star ratings, plus a full detail drawer (CV, headshot, work images,
 * portfolio links, skills, AI score breakdown, notes) and the "Move to Offered"
 * hand-off into the existing Recruitment/Offer flow.
 *
 * NOTE: this is the functional, mobile-first list. The richer 360° board
 * (kanban + score rings) lands once the reference sample is in — the data layer
 * and every action below already support it.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus,
  Users2,
  FileText,
  Sparkles,
  Loader2,
  ArrowRight,
  ExternalLink,
  MessageSquarePlus,
  Download,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";
import {
  vacancyApi,
  type Vacancy,
  type Application,
  type ApplicationStage,
} from "@/lib/vacancy-api";
import {
  inputCls,
  StarRating,
  STAGE_LABEL,
  STAGE_TONE,
  STAGE_ORDER,
  scoreTone,
  fmtSalary,
} from "./vacancy-ui";
import { useNotify, errMsg } from "../hr-shared";

const STAGES: ApplicationStage[] = [
  "new", "screening", "shortlisted", "interviewed", "offered", "rejected",
];

export function ApplicantPipeline({
  vacancy,
  canEdit,
  canApprove,
}: {
  vacancy: Vacancy;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const qc = useQueryClient();
  const notify = useNotify("Vacancies: applicants");
  const [stage, setStage] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: apps, isLoading } = useQuery({
    queryKey: ["vacancies", "applications", vacancy.vacancy_id],
    queryFn: () => vacancyApi.listApplications(vacancy.vacancy_id),
  });

  const inval = () =>
    qc.invalidateQueries({ queryKey: ["vacancies", "applications", vacancy.vacancy_id] });

  const rows = (apps ?? []).filter((a) => !stage || a.stage === stage);
  const countBy = (s: string) => (apps ?? []).filter((a) => a.stage === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <StageChip label={`All (${apps?.length ?? 0})`} on={stage === ""} onClick={() => setStage("")} />
          {STAGES.map((s) => (
            <StageChip key={s} label={`${STAGE_LABEL[s]} (${countBy(s)})`} on={stage === s} onClick={() => setStage(s)} />
          ))}
        </div>
        {canEdit && (
          <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
            Add applicant
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 rounded-[var(--radius)]" />
      ) : !rows.length ? (
        <EmptyState
          icon={<Users2 className="h-6 w-6" />}
          title={stage ? "None at this stage" : "No applicants yet"}
          message={
            vacancy.status === "published"
              ? "Applications from your public Careers page will appear here."
              : "Publish this vacancy so candidates can apply — or add an applicant manually."
          }
        />
      ) : (
        <div className="grid gap-2">
          {rows.map((a) => (
            <ApplicantRow key={a.application_id} a={a} canEdit={canEdit}
              onOpen={() => setOpenId(a.application_id)} onChanged={inval} notify={notify} />
          ))}
        </div>
      )}

      {openId && (
        <ApplicantDetail
          appId={openId}
          canEdit={canEdit}
          canApprove={canApprove}
          onClose={() => setOpenId(null)}
          onChanged={inval}
        />
      )}
      {addOpen && (
        <AddApplicantModal
          vacancyId={vacancy.vacancy_id}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); inval(); }}
        />
      )}
    </div>
  );
}

function StageChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
        on ? "border-accent/30 bg-accent/15 text-accent-glow" : "border-line text-text-muted hover:text-text-primary"
      }`}>
      {label}
    </button>
  );
}

function ScoreRing({ score }: { score: number | string | null }) {
  const n = score === null || score === "" ? null : Number(score);
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line">
      <span className={`font-mono text-sm font-semibold ${scoreTone(score)}`}>
        {n === null || isNaN(n) ? "—" : Math.round(n)}
      </span>
    </div>
  );
}

function ApplicantRow({
  a, canEdit, onOpen, onChanged, notify,
}: {
  a: Application;
  canEdit: boolean;
  onOpen: () => void;
  onChanged: () => void;
  notify: ReturnType<typeof useNotify>;
}) {
  const setStageM = useMutation({
    mutationFn: (s: ApplicationStage) => vacancyApi.setStage(a.application_id, s),
    onSuccess: onChanged,
    onError: (e) => notify("Couldn't move", errMsg(e), "high"),
  });
  const rate = useMutation({
    mutationFn: (stars: number) => vacancyApi.setRating(a.application_id, stars),
    onSuccess: onChanged,
    onError: (e) => notify("Couldn't rate", errMsg(e), "high"),
  });

  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <ScoreRing score={a.match_score} />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{a.full_name}</span>
            <Pill tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Pill>
            {a.match_stage === "provisional" && (
              <span className="text-[10px] text-text-faint">provisional</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-text-muted">
            {a.match_summary || a.email}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-faint">
            <span>Applied {formatDate(a.applied_at)}</span>
            {(a.media_count ?? 0) > 0 && <span>{a.media_count} images</span>}
            {(a.note_count ?? 0) > 0 && <span>{a.note_count} notes</span>}
            {a.cv_key && <span className="inline-flex items-center gap-0.5"><FileText className="h-3 w-3" /> CV</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1">
            <StarRating value={Math.round(a.avg_rating || 0)} readOnly={!canEdit}
              onChange={(n) => rate.mutate(n)} />
          </div>
          {canEdit && (
            <select
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-[11px] text-text-primary"
              value={a.stage}
              onChange={(e) => setStageM.mutate(e.target.value as ApplicationStage)}
              onClick={(e) => e.stopPropagation()}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Detail drawer ──────────────────────────────────────────
function ApplicantDetail({
  appId, canEdit, canApprove, onClose, onChanged,
}: {
  appId: string;
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify("Vacancies: applicant");
  const [note, setNote] = useState("");

  const { data: app, isLoading } = useQuery({
    queryKey: ["vacancies", "application", appId],
    queryFn: () => vacancyApi.getApplication(appId),
  });

  const inval = () => {
    qc.invalidateQueries({ queryKey: ["vacancies", "application", appId] });
    onChanged();
  };

  const score = useMutation({
    mutationFn: () => vacancyApi.score(appId),
    onSuccess: () => { inval(); notify("Scored"); },
    onError: (e) => notify("Couldn't score", errMsg(e), "high"),
  });
  const addNote = useMutation({
    mutationFn: () => vacancyApi.addNote(appId, note),
    onSuccess: () => { setNote(""); inval(); },
    onError: (e) => notify("Couldn't add note", errMsg(e), "high"),
  });
  const rate = useMutation({
    mutationFn: (stars: number) => vacancyApi.setRating(appId, stars),
    onSuccess: inval,
  });
  const rateQuestion = useMutation({
    mutationFn: (v: { questionId: string; stars: number; note?: string }) =>
      vacancyApi.setQuestionRating(appId, v.questionId, v.stars, v.note),
    onSuccess: inval,
    onError: (e) => notify("Couldn't save rating", errMsg(e), "high"),
  });
  const offer = useMutation({
    mutationFn: () => vacancyApi.moveToOffered(appId),
    onSuccess: (r) => {
      inval();
      notify(
        r.already ? "Already offered" : "Offer created",
        "Opening the Recruitment tab where you can edit and send it.",
      );
      navigate("/hr?tab=recruitment");
    },
    onError: (e) => notify("Couldn't create offer", errMsg(e), "high"),
  });

  const dl = (kind: "cv" | "headshot" | "cover_letter" | "media", name: string, mediaId?: string) =>
    vacancyApi.downloadFile(appId, kind, name, mediaId).catch((e) => notify("Download failed", errMsg(e), "high"));

  const latest = app?.scores?.[0];

  return (
    <Modal open onClose={onClose} title={app?.full_name || "Applicant"}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">Your rating</span>
            <StarRating value={app?.ratings.my_stars || 0} readOnly={!canEdit} onChange={(n) => rate.mutate(n)} />
          </div>
          {canApprove && app && app.stage !== "offered" && (
            <Button variant="primary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}
              disabled={offer.isPending} onClick={() => offer.mutate()}>
              {offer.isPending ? "Creating…" : "Move to Offered"}
            </Button>
          )}
          {app?.offer_id && (
            <a href="/hr?tab=recruitment"><Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>Open offer</Button></a>
          )}
        </div>
      }
    >
      {isLoading || !app ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {/* contact + score */}
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-text-muted">
              <div>{app.email}{app.phone ? ` · ${app.phone}` : ""}</div>
              {app.address && <div className="mt-0.5">{app.address}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Pill tone={STAGE_TONE[app.stage]}>{STAGE_LABEL[app.stage]}</Pill>
                {app.source && <span>via {app.source}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-mono text-2xl font-bold ${scoreTone(app.match_score)}`}>
                {app.match_score === null ? "—" : Math.round(Number(app.match_score))}
              </div>
              <div className="text-[10px] text-text-faint">AI match</div>
            </div>
          </div>

          {/* AI score breakdown */}
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent-glow" /> AI assessment
                {latest && <span className="text-[10px] text-text-faint">({latest.scoring_stage}{latest.ai_provider ? ` · ${latest.ai_provider}` : ""})</span>}
              </span>
              {canEdit && (
                <Button size="sm" icon={score.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  disabled={score.isPending} onClick={() => score.mutate()}>
                  {score.isPending ? "Scoring…" : "Score"}
                </Button>
              )}
            </div>
            {latest ? (
              <>
                {app.match_summary && <p className="mb-2 text-xs text-text-muted">{app.match_summary}</p>}
                <ScoreBars breakdown={latest.breakdown} />
              </>
            ) : (
              <p className="text-xs text-text-faint">Not scored yet.</p>
            )}
          </div>

          {/* Interview scorecard — rate the candidate against the AI questions */}
          {app.scorecard.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-1 text-xs font-medium text-text-primary">Interview scorecard</div>
              <p className="mb-2.5 text-[11px] text-text-faint">
                Rate this candidate against each question during the interview. Your overall rating is
                the average of these.
              </p>
              <div className="space-y-2.5">
                {app.scorecard.map((q, idx) => (
                  <div key={q.question_id} className="rounded-lg border border-line/70 p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent-glow">
                        {idx + 1}
                      </span>
                      <p className="flex-1 text-xs text-text-primary">{q.question}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-6">
                      <StarRating
                        value={q.my_stars || 0}
                        readOnly={!canEdit}
                        onChange={(n) => rateQuestion.mutate({ questionId: q.question_id, stars: n, note: q.my_note || undefined })}
                      />
                      {q.rating_count > 0 && (
                        <span className="text-[10px] text-text-faint">
                          team avg {q.avg_stars.toFixed(1)} · {q.rating_count}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* files */}
          <div className="flex flex-wrap gap-2">
            {app.cv_key && (
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => dl("cv", app.cv_filename || "cv.pdf")}>CV</Button>
            )}
            {app.cover_letter_key && (
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => dl("cover_letter", "cover-letter")}>Cover letter</Button>
            )}
            {app.headshot_key && (
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => dl("headshot", "headshot")}>Headshot</Button>
            )}
          </div>

          {/* work images */}
          {app.media.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-text-muted">Work samples</div>
              <div className="flex flex-wrap gap-2">
                {app.media.map((m) => (
                  <button key={m.media_id} type="button"
                    onClick={() => dl("media", m.filename || "image", m.media_id)}
                    className="rounded-lg border border-line px-2 py-1 text-[11px] text-text-muted hover:text-text-primary">
                    {m.caption || m.filename || "image"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* cover letter text */}
          {app.cover_letter_text && (
            <Field label="Cover letter"><p className="whitespace-pre-wrap text-xs text-text-muted">{app.cover_letter_text}</p></Field>
          )}

          {/* skills */}
          {app.skills.length > 0 && (
            <Field label="Skills">
              <div className="flex flex-wrap gap-1.5">
                {app.skills.map((s, i) => (
                  <span key={i} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-text-primary">
                    {s.skill}{s.years ? ` · ${s.years}y` : ""}
                  </span>
                ))}
              </div>
            </Field>
          )}

          {/* comp + availability */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Desired salary">
              <span className="text-text-primary">
                {app.desired_salary_text || (app.desired_salary ? fmtSalary(app.desired_salary, null) : "—")}
              </span>
            </Field>
            <Field label="Notice period"><span className="text-text-primary">{app.notice_period || "—"}</span></Field>
          </div>

          {/* links */}
          {app.portfolio_links.length > 0 && (
            <Field label="Links">
              <div className="flex flex-col gap-1">
                {app.portfolio_links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent-glow hover:underline">
                    <ExternalLink className="h-3 w-3" /> {l.label || l.url}
                  </a>
                ))}
              </div>
            </Field>
          )}

          {/* notes */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">Internal notes</div>
            <div className="space-y-2">
              {app.notes.map((n) => (
                <div key={n.note_id} className="rounded-lg border border-line p-2 text-xs">
                  <div className="text-text-primary">{n.body}</div>
                  <div className="mt-1 text-[10px] text-text-faint">
                    {n.author_name || "Someone"} · {formatDate(n.created_at)}
                  </div>
                </div>
              ))}
              {!app.notes.length && <p className="text-[11px] text-text-faint">No notes yet.</p>}
            </div>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <input className={inputCls} value={note} placeholder="Add a note after screening / interview…"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && note.trim() && addNote.mutate()} />
                <Button size="sm" icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
                  disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Add</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ScoreBars({ breakdown }: { breakdown: Record<string, unknown> }) {
  const dims: [string, string][] = [
    ["skills_fit", "Skills"],
    ["experience_fit", "Experience"],
    ["salary_fit", "Salary fit"],
    ["portfolio_fit", "Portfolio"],
  ];
  const notes = typeof breakdown.notes === "string" ? breakdown.notes : null;
  return (
    <div className="space-y-1.5">
      {dims.map(([k, label]) => {
        const raw = breakdown[k];
        const v = typeof raw === "number" ? raw : null;
        // A null dimension means "not assessed" — render it dimmed with an
        // "n/a" label so an empty bar is never misread as a score of 0.
        return (
          <div key={k} className={`flex items-center gap-2 ${v === null ? "opacity-45" : ""}`}>
            <span className="w-20 shrink-0 text-[10.5px] text-text-muted">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-text-primary/10">
              {v !== null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />}
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-text-muted">
              {v === null ? "n/a" : Math.round(v)}
            </span>
          </div>
        );
      })}
      {notes && <p className="pt-1 text-[11px] text-text-faint">{notes}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-text-muted">{label}</div>
      {children}
    </div>
  );
}

// ── Add applicant (manual) ─────────────────────────────────
function AddApplicantModal({
  vacancyId, onClose, onAdded,
}: {
  vacancyId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const notify = useNotify("Vacancies: add applicant");
  const [f, setF] = useState({
    full_name: "", email: "", phone: "", desired_salary: "",
    notice_period: "", source: "referral", skills: "", cover_letter_text: "",
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const add = useMutation({
    mutationFn: () =>
      vacancyApi.addApplication(vacancyId, {
        full_name: f.full_name,
        email: f.email,
        phone: f.phone || undefined,
        desired_salary: f.desired_salary ? Number(f.desired_salary) : undefined,
        desired_salary_text: f.desired_salary || undefined,
        notice_period: f.notice_period || undefined,
        source: f.source || undefined,
        cover_letter_text: f.cover_letter_text || undefined,
        skills: f.skills
          ? f.skills.split(",").map((s) => ({ skill: s.trim() })).filter((s) => s.skill)
          : [],
      }),
    onSuccess: onAdded,
    onError: (e) => notify("Couldn't add", errMsg(e), "high"),
  });

  return (
    <Modal open onClose={onClose} title="Add applicant"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.full_name.trim() || !f.email.trim() || add.isPending}
            onClick={() => add.mutate()}>{add.isPending ? "Adding…" : "Add"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <L label="Full name"><input className={inputCls} value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} /></L>
          <L label="Email"><input className={inputCls} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></L>
          <L label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></L>
          <L label="Desired salary (₦/mo)"><input className={inputCls} value={f.desired_salary} onChange={(e) => set({ desired_salary: e.target.value })} /></L>
          <L label="Notice period"><input className={inputCls} value={f.notice_period} placeholder="e.g. 1 month" onChange={(e) => set({ notice_period: e.target.value })} /></L>
          <L label="Source"><input className={inputCls} value={f.source} onChange={(e) => set({ source: e.target.value })} /></L>
        </div>
        <L label="Skills (comma-separated)"><input className={inputCls} value={f.skills} placeholder="Colouring, Wig install, Client care" onChange={(e) => set({ skills: e.target.value })} /></L>
        <L label="Notes / cover letter"><textarea className={inputCls} rows={3} value={f.cover_letter_text} onChange={(e) => set({ cover_letter_text: e.target.value })} /></L>
      </div>
    </Modal>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export default ApplicantPipeline;
