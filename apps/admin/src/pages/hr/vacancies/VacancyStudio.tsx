/**
 * Vacancy Studio — review/edit a vacancy, set the AI screening rubric, and work
 * the applicant pipeline. Sub-tabs: Details · AI Screening · Applicants.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Send,
  Pause,
  Play,
  XCircle,
  Trash2,
  ExternalLink,
  Sparkles,
  Loader2,
  Building2,
} from "lucide-react";
import { Card, Button, Pill, Skeleton } from "@/components/ui/primitives";
import {
  vacancyApi,
  type Vacancy,
  type VacancyStatus,
  type ScreeningQuestion,
} from "@/lib/vacancy-api";
import { TabBar, useNotify, errMsg } from "../hr-shared";
import { ApplicantPipeline } from "./ApplicantPipeline";
import {
  inputCls,
  VoiceField,
  miniMarkdown,
  VACANCY_TONE,
} from "./vacancy-ui";

const EMPLOYMENT = ["full_time", "part_time", "contract", "internship"];
const WORKPLACE = ["on_site", "hybrid", "remote"];

export function VacancyStudio({
  vacancyId,
  canEdit,
  canApprove,
  onBack,
}: {
  vacancyId: string;
  canEdit: boolean;
  canApprove: boolean;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("Vacancies: studio");
  const [sub, setSub] = useState<"details" | "screening" | "applicants">("details");

  const { data: vacancy, isLoading } = useQuery({
    queryKey: ["vacancies", "one", vacancyId],
    queryFn: () => vacancyApi.get(vacancyId),
  });
  const { data: options } = useQuery({
    queryKey: ["vacancies", "options"],
    queryFn: () => vacancyApi.options(),
  });

  const inval = () => {
    qc.invalidateQueries({ queryKey: ["vacancies", "one", vacancyId] });
    qc.invalidateQueries({ queryKey: ["vacancies", "list"] });
  };

  if (isLoading || !vacancy) {
    return (
      <div className="space-y-3">
        <Button size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
        <Skeleton className="h-[60vh] rounded-[var(--radius)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
          <span className="font-display text-lg text-text-primary">{vacancy.title}</span>
          <Pill tone={VACANCY_TONE[vacancy.status as VacancyStatus]}>{vacancy.status}</Pill>
        </div>
        <StatusControls
          vacancy={vacancy}
          canApprove={canApprove}
          onChanged={inval}
          onDeleted={onBack}
          notify={notify}
        />
      </div>

      <TabBar
        active={sub}
        onChange={(k) => setSub(k as typeof sub)}
        tabs={[
          { key: "details", label: "Details" },
          { key: "screening", label: "AI Screening" },
          {
            key: "applicants",
            label: "Applicants",
            badge: vacancy.application_count || undefined,
          },
        ]}
      />

      {sub === "details" && (
        <DetailsPanel vacancy={vacancy} options={options} readOnly={!canEdit} onSaved={inval} notify={notify} />
      )}
      {sub === "screening" && (
        <ScreeningPanel vacancyId={vacancyId} readOnly={!canEdit} notify={notify} />
      )}
      {sub === "applicants" && (
        <ApplicantPipeline vacancy={vacancy} canEdit={canEdit} canApprove={canApprove} />
      )}
    </div>
  );
}

// ── Publish / pause / close / delete ───────────────────────
function StatusControls({
  vacancy,
  canApprove,
  onChanged,
  onDeleted,
  notify,
}: {
  vacancy: Vacancy;
  canApprove: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  notify: ReturnType<typeof useNotify>;
}) {
  const set = useMutation({
    mutationFn: (status: VacancyStatus) => vacancyApi.setStatus(vacancy.vacancy_id, status),
    onSuccess: (v) => { onChanged(); notify(`Vacancy ${v.status}`); },
    onError: (e) => notify("Couldn't update", errMsg(e), "high"),
  });
  const del = useMutation({
    mutationFn: () => vacancyApi.remove(vacancy.vacancy_id),
    onSuccess: () => { notify("Vacancy deleted"); onDeleted(); },
    onError: (e) => notify("Couldn't delete", errMsg(e), "high"),
  });

  // Absolute storefront URL resolved by the API (the Careers page lives on the
  // brand's storefront, NOT the admin host — a relative link would 404 here).
  const careersUrl = vacancy.public_careers_url || null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {vacancy.status === "published" && careersUrl && (
        <a href={careersUrl} target="_blank" rel="noreferrer">
          <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>Careers page</Button>
        </a>
      )}
      {canApprove && (
        <>
          {(vacancy.status === "draft" || vacancy.status === "paused" || vacancy.status === "closed") && (
            <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />}
              disabled={set.isPending} onClick={() => set.mutate("published")}>
              {vacancy.status === "draft" ? "Publish" : "Re-publish"}
            </Button>
          )}
          {vacancy.status === "published" && (
            <Button size="sm" icon={<Pause className="h-3.5 w-3.5" />}
              disabled={set.isPending} onClick={() => set.mutate("paused")}>Pause</Button>
          )}
          {vacancy.status === "paused" && (
            <Button size="sm" icon={<Play className="h-3.5 w-3.5" />}
              disabled={set.isPending} onClick={() => set.mutate("published")}>Resume</Button>
          )}
          {["published", "paused"].includes(vacancy.status) && (
            <Button size="sm" icon={<XCircle className="h-3.5 w-3.5" />}
              disabled={set.isPending} onClick={() => set.mutate("closed")}>Close</Button>
          )}
          {vacancy.status === "draft" && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={del.isPending}
              onClick={() => { if (confirm("Delete this draft vacancy?")) del.mutate(); }}>
              Delete
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Details (review & edit) ────────────────────────────────
function DetailsPanel({
  vacancy,
  options,
  readOnly,
  onSaved,
  notify,
}: {
  vacancy: Vacancy;
  options: ReturnType<typeof vacancyApi.options> extends Promise<infer T> ? T | undefined : undefined;
  readOnly: boolean;
  onSaved: () => void;
  notify: ReturnType<typeof useNotify>;
}) {
  const [d, setD] = useState<Vacancy>(vacancy);
  useEffect(() => setD(vacancy), [vacancy]);

  const set = (patch: Partial<Vacancy>) => setD((s) => ({ ...s, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      vacancyApi.update(vacancy.vacancy_id, {
        title: d.title,
        org_unit_id: d.org_unit_id,
        department: d.department,
        role_id: d.role_id,
        employment_type: d.employment_type,
        workplace_model: d.workplace_model,
        days_on_site: d.days_on_site,
        days_off_site: d.days_off_site,
        days_off: d.days_off,
        working_hours: d.working_hours,
        location_city: d.location_city,
        location_state: d.location_state,
        location_country: d.location_country,
        probation_months: d.probation_months,
        salary_min: d.salary_min === "" ? null : d.salary_min,
        salary_max: d.salary_max === "" ? null : d.salary_max,
        salary_hidden: d.salary_hidden,
        headcount: d.headcount,
        target_start_date: d.target_start_date || null,
        hiring_manager_position_id: d.hiring_manager_position_id,
        reviewer_position_ids: d.reviewer_position_ids,
        apply_config: d.apply_config,
        jd_markdown: d.jd_markdown,
        requirements_markdown: d.requirements_markdown,
      }),
    onSuccess: () => { onSaved(); notify("Saved"); },
    onError: (e) => notify("Couldn't save", errMsg(e), "high"),
  });

  const cfg = d.apply_config || {};
  const setCfg = (patch: Record<string, unknown>) => set({ apply_config: { ...cfg, ...patch } });
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left — form */}
      <div className="space-y-3">
        <Card className="space-y-3 p-4">
          <F label="Role title">
            <input className={inputCls} value={d.title} disabled={readOnly}
              onChange={(e) => set({ title: e.target.value })} />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Department">
              <select className={inputCls} value={d.org_unit_id || ""} disabled={readOnly}
                onChange={(e) => {
                  const unit = options?.departments.find((u) => u.unit_id === e.target.value);
                  set({ org_unit_id: e.target.value || null, department: unit?.display_name || d.department });
                }}>
                <option value="">{d.department || "— select —"}</option>
                {options?.departments.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>{u.display_name}</option>
                ))}
              </select>
            </F>
            <F label="Permission role on hire">
              <select className={inputCls} value={d.role_id || ""} disabled={readOnly}
                onChange={(e) => set({ role_id: e.target.value || null })}>
                <option value="">— none —</option>
                {options?.roles.map((r) => (
                  <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                ))}
              </select>
            </F>
            <F label="Employment type">
              <select className={inputCls} value={d.employment_type} disabled={readOnly}
                onChange={(e) => set({ employment_type: e.target.value as Vacancy["employment_type"] })}>
                {EMPLOYMENT.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </F>
            <F label="Headcount">
              <input className={inputCls} type="number" min={1} value={d.headcount} disabled={readOnly}
                onChange={(e) => set({ headcount: Number(e.target.value) || 1 })} />
            </F>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="text-xs font-medium text-text-muted">Work model</div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Model">
              <select className={inputCls} value={d.workplace_model} disabled={readOnly}
                onChange={(e) => set({ workplace_model: e.target.value as Vacancy["workplace_model"] })}>
                {WORKPLACE.map((t) => <option key={t} value={t}>{t.replace("_", "-")}</option>)}
              </select>
            </F>
            <F label="Working hours">
              <input className={inputCls} value={d.working_hours || ""} disabled={readOnly}
                placeholder="9am–5pm, Mon–Fri" onChange={(e) => set({ working_hours: e.target.value })} />
            </F>
            <F label="Days on-site">
              <input className={inputCls} type="number" min={0} max={7} value={d.days_on_site ?? ""} disabled={readOnly}
                onChange={(e) => set({ days_on_site: num(e.target.value) })} />
            </F>
            <F label="Days off-site">
              <input className={inputCls} type="number" min={0} max={7} value={d.days_off_site ?? ""} disabled={readOnly}
                onChange={(e) => set({ days_off_site: num(e.target.value) })} />
            </F>
            <F label="Days off">
              <input className={inputCls} type="number" min={0} max={7} value={d.days_off ?? ""} disabled={readOnly}
                onChange={(e) => set({ days_off: num(e.target.value) })} />
            </F>
            <F label="Probation (months)">
              <input className={inputCls} type="number" min={0} max={24} value={d.probation_months ?? ""} disabled={readOnly}
                onChange={(e) => set({ probation_months: num(e.target.value) })} />
            </F>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <F label="City"><input className={inputCls} value={d.location_city || ""} disabled={readOnly}
              onChange={(e) => set({ location_city: e.target.value })} /></F>
            <F label="State"><input className={inputCls} value={d.location_state || ""} disabled={readOnly}
              onChange={(e) => set({ location_state: e.target.value })} /></F>
            <F label="Country"><input className={inputCls} value={d.location_country || ""} disabled={readOnly}
              onChange={(e) => set({ location_country: e.target.value })} /></F>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="text-xs font-medium text-text-muted">Compensation & timing</div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Salary min (₦/mo)">
              <input className={inputCls} type="number" min={0} value={d.salary_min ?? ""} disabled={readOnly}
                onChange={(e) => set({ salary_min: num(e.target.value) })} />
            </F>
            <F label="Salary max (₦/mo)">
              <input className={inputCls} type="number" min={0} value={d.salary_max ?? ""} disabled={readOnly}
                onChange={(e) => set({ salary_max: num(e.target.value) })} />
            </F>
            <F label="Target start date">
              <input className={inputCls} type="date" value={d.target_start_date || ""} disabled={readOnly}
                onChange={(e) => set({ target_start_date: e.target.value })} />
            </F>
            <label className="flex items-end gap-2 pb-2 text-xs text-text-primary">
              <input type="checkbox" checked={d.salary_hidden} disabled={readOnly}
                onChange={(e) => set({ salary_hidden: e.target.checked })} />
              Hide salary from the public page
            </label>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="text-xs font-medium text-text-muted">Hiring team (roles only — no names)</div>
          <F label="Hiring manager">
            <select className={inputCls} value={d.hiring_manager_position_id || ""} disabled={readOnly}
              onChange={(e) => set({ hiring_manager_position_id: e.target.value || null })}>
              <option value="">— none —</option>
              {options?.positions.map((p) => (
                <option key={p.position_id} value={p.position_id}>
                  {p.display_name}{p.unit_name ? ` · ${p.unit_name}` : ""}
                </option>
              ))}
            </select>
          </F>
          <F label="Reviewers">
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
              {(options?.positions || []).map((p) => {
                const on = d.reviewer_position_ids.includes(p.position_id);
                return (
                  <label key={p.position_id} className="flex items-center gap-2 text-xs text-text-primary">
                    <input type="checkbox" checked={on} disabled={readOnly}
                      onChange={() => set({
                        reviewer_position_ids: on
                          ? d.reviewer_position_ids.filter((x) => x !== p.position_id)
                          : [...d.reviewer_position_ids, p.position_id],
                      })} />
                    {p.display_name}{p.unit_name ? ` · ${p.unit_name}` : ""}
                  </label>
                );
              })}
              {!options?.positions?.length && <span className="text-xs text-text-faint">No positions found in the org chart.</span>}
            </div>
          </F>
        </Card>

        <Card className="space-y-2 p-4">
          <div className="text-xs font-medium text-text-muted">Public application form</div>
          {[
            ["request_headshot", "Ask for a corporate headshot"],
            ["request_work_images", "Ask for up to 3 work-sample images"],
            ["require_cover_letter", "Require a cover letter"],
            ["require_portfolio_links", "Require at least one portfolio link"],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-xs text-text-primary">
              <input type="checkbox" checked={Boolean((cfg as Record<string, unknown>)[k])} disabled={readOnly}
                onChange={(e) => setCfg({ [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </Card>

        <VacancyEditor label="Job description (markdown)" value={d.jd_markdown || ""} disabled={readOnly}
          onChange={(v) => set({ jd_markdown: v })} />
        <VacancyEditor label="Requirements (markdown)" value={d.requirements_markdown || ""} disabled={readOnly}
          onChange={(v) => set({ requirements_markdown: v })} />

        {!readOnly && (
          <div className="flex justify-end">
            <Button variant="primary" icon={save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {/* Right — live preview (what the Careers page will read) */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
          <Building2 className="h-3.5 w-3.5" /> Preview — how the job description reads
        </div>
        <Card className="max-h-[80vh] overflow-y-auto p-5">
          <div className="vacancy-prose text-sm text-text-primary"
            dangerouslySetInnerHTML={{ __html: miniMarkdown(d.jd_markdown || "_No job description yet._") }} />
          {d.requirements_markdown && (
            <div className="vacancy-prose mt-4 border-t border-line pt-4 text-sm text-text-primary"
              dangerouslySetInnerHTML={{ __html: miniMarkdown(d.requirements_markdown) }} />
          )}
        </Card>
      </div>
    </div>
  );
}

function VacancyEditor({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="mb-1.5 text-xs font-medium text-text-muted">{label}</div>
      {disabled ? (
        <textarea value={value} disabled rows={12}
          className="w-full resize-y rounded-lg border border-line bg-text-primary/[0.03] p-3 font-mono text-[12.5px] leading-relaxed text-text-primary opacity-70" />
      ) : (
        <VoiceField value={value} onChange={onChange} rows={12} />
      )}
    </Card>
  );
}

// ── AI interview questions (rated per-candidate on the applicant scorecard) ──
function ScreeningPanel({
  vacancyId,
  readOnly,
  notify,
}: {
  vacancyId: string;
  readOnly: boolean;
  notify: ReturnType<typeof useNotify>;
}) {
  const qc = useQueryClient();
  const { data: questions, isLoading } = useQuery({
    queryKey: ["vacancies", "questions", vacancyId],
    queryFn: () => vacancyApi.listQuestions(vacancyId),
  });

  const gen = useMutation({
    mutationFn: () => vacancyApi.generateQuestions(vacancyId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vacancies", "questions", vacancyId] }); notify("Generated interview questions"); },
    onError: (e) => notify("Couldn't generate", errMsg(e), "high"),
  });
  const scoreAll = useMutation({
    mutationFn: () => vacancyApi.scoreAll(vacancyId),
    onSuccess: (r) => notify("Re-scored applicants", `${r.scored} scored${r.failed ? `, ${r.failed} failed` : ""}.`),
    onError: (e) => notify("Couldn't score", errMsg(e), "high"),
  });

  if (isLoading) return <Skeleton className="h-64 rounded-[var(--radius)]" />;

  const hasQuestions = (questions?.length ?? 0) > 0;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
            <Sparkles className="h-4 w-4 text-accent-glow" /> AI interview questions
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Five strategic questions AI writes for this role. Use them to interview candidates and rate
            each 1–5 stars on the applicant's <span className="text-text-primary">Interview scorecard</span>{" "}
            (Applicants → open a candidate). Candidates never see these. The AI match score is separate —
            it reads each CV against the job description automatically.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={gen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={gen.isPending}
              onClick={() => { if (!hasQuestions || confirm("Regenerate the 5 interview questions?")) gen.mutate(); }}>
              {hasQuestions ? "Regenerate" : "Generate questions"}
            </Button>
            {hasQuestions && (
              <Button size="sm" icon={scoreAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                disabled={scoreAll.isPending} onClick={() => scoreAll.mutate()}>
                {scoreAll.isPending ? "Scoring…" : "Re-score all with AI"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!hasQuestions ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-text-muted">
          No questions yet. {readOnly ? "" : "Generate them once the job description is written."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {(questions || []).map((q: ScreeningQuestion, idx) => (
            <div key={q.question_id} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent-glow">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-text-primary">{q.question}</p>
                  {q.rationale && <p className="mt-0.5 text-[11px] text-text-faint">{q.rationale}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export default VacancyStudio;
