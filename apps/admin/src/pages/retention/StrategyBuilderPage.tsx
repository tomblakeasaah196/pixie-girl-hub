/**
 * Strategy Builder — the full-page, plain-English wizard (canon: as easy as
 * WhatsApp). Three plain sections: WHEN (trigger + who), THEN (the steps),
 * and a live PREVIEW that shows the exact framed mail a sample customer would
 * receive + "email this to me". Conditions are built from guided rows sourced
 * from the backend catalogue, with an Advanced (JSON) escape hatch.
 *
 * Email steps are hybrid: write the mail right here in the Gmail-style
 * RichMailEditor (loyalty-aware Personalise tokens), or point the step at a
 * saved Marketing template — same storage, same send pipeline, one engine.
 *
 * Mobile-first: every row wraps, the preview stacks under the form, and the
 * primary actions live in a thumb-reach sticky bar on phones.
 *
 * /retention/strategies/new starts a blank draft; /:id/edit loads an existing
 * one. Preview + test-send require a saved strategy, so a brand-new draft is
 * saved first (then we land in edit mode).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Eye,
  Send,
  Save,
  CheckCircle2,
  XCircle,
  PenLine,
  FileCode2,
  ExternalLink,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, NumberField, ErrorState, DeniedState } from "@/components/ui/controls";
import { RichMailEditor } from "@/components/marketing/RichMailEditor";
import { useEmailTemplates } from "@/lib/marketing-api";
import { toastReport } from "@/lib/error-report";
import { cn } from "@/lib/cn";
import {
  useStrategy,
  useStrategyCatalogue,
  useCreateStrategy,
  useUpdateStrategy,
  usePreviewStrategy,
  useTestSendStrategy,
  type StrategyStep,
  type StrategyPreview,
} from "@/lib/retention-api";

interface Row {
  field: string;
  op: string;
  value: string;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) ||
  "strategy";

export function StrategyBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit") || can("retention", "create");
  useBreadcrumbs([{ label: "Retention" }, { label: isEdit ? "Edit strategy" : "New strategy" }]);

  const catalogueQ = useStrategyCatalogue();
  const existingQ = useStrategy(id);
  const createM = useCreateStrategy();
  const updateM = useUpdateStrategy(id);
  const previewM = usePreviewStrategy(id);
  const testM = useTestSendStrategy(id);

  // ── form state ──
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("{}");
  const [steps, setSteps] = useState<StrategyStep[]>([]);
  const [cooldown, setCooldown] = useState("");
  const [maxEnroll, setMaxEnroll] = useState("");
  const [preview, setPreview] = useState<StrategyPreview | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Hydrate from an existing strategy.
  useEffect(() => {
    const s = existingQ.data;
    if (!s) return;
    setName(s.display_name);
    setTrigger(s.trigger_type);
    setCooldown(s.reenroll_cooldown_days != null ? String(s.reenroll_cooldown_days) : "");
    setMaxEnroll(s.max_enrollments_per_customer != null ? String(s.max_enrollments_per_customer) : "");
    const cond = s.trigger_conditions || {};
    const all = (cond as { all?: Row[] }).all;
    if (Array.isArray(all) && all.every((r) => r && "field" in r)) {
      setRows(all.map((r) => ({ field: r.field, op: r.op, value: r.value != null ? String(r.value) : "" })));
      setAdvanced(false);
    } else if (Object.keys(cond).length > 0) {
      setAdvanced(true);
      setAdvancedJson(JSON.stringify(cond, null, 2));
    }
    setSteps((s.steps ?? []).map((st) => ({ ...st })));
  }, [existingQ.data]);

  const cat = catalogueQ.data;
  const valuelessOps = useMemo(() => new Set(["exists", "not_exists"]), []);

  if (!canEdit) return <DeniedState message="You can't edit retention strategies." />;
  if (isEdit && existingQ.isLoading) return <Skeleton style={{ height: 320 }} />;
  if (isEdit && existingQ.isError) return <ErrorState onRetry={() => existingQ.refetch()} />;

  // ── conditions assembly ──
  const buildConditions = (): Record<string, unknown> => {
    if (advanced) {
      try {
        return JSON.parse(advancedJson || "{}");
      } catch {
        return {};
      }
    }
    const clean = rows.filter((r) => r.field && r.op);
    if (clean.length === 0) return {};
    return {
      all: clean.map((r) => {
        const num = Number(r.value);
        const value = valuelessOps.has(r.op)
          ? undefined
          : r.value !== "" && !Number.isNaN(num)
            ? num
            : r.value;
        return valuelessOps.has(r.op) ? { field: r.field, op: r.op } : { field: r.field, op: r.op, value };
      }),
    };
  };

  const payload = () => ({
    display_name: name.trim() || "Untitled strategy",
    trigger_type: trigger,
    trigger_conditions: buildConditions(),
    reenroll_cooldown_days: cooldown ? Number(cooldown) : undefined,
    max_enrollments_per_customer: maxEnroll ? Number(maxEnroll) : undefined,
    steps: steps.map((s, i) => ({ ...s, step_order: i + 1 })),
  });

  const save = async (): Promise<string | undefined> => {
    setSaveError(null);
    try {
      if (isEdit) {
        await updateM.mutateAsync(payload());
        return id;
      }
      const created = await createM.mutateAsync({
        strategy_key: `${slug(name)}_${Math.random().toString(36).slice(2, 6)}`,
        ...payload(),
      });
      navigate(`/retention/strategies/${created.strategy_id}/edit`, { replace: true });
      return created.strategy_id;
    } catch (e) {
      toastReport("Retention → Strategy builder", "Save strategy", e);
      setSaveError(e instanceof Error ? e.message : "Could not save");
      return undefined;
    }
  };

  const runPreview = async () => {
    if (!isEdit) {
      await save();
      return; // after redirect, the user previews in edit mode
    }
    await updateM.mutateAsync(payload());
    setPreview(await previewM.mutateAsync(undefined));
  };

  const runTest = async () => {
    setTestMsg(null);
    try {
      const r = await testM.mutateAsync(undefined);
      setTestMsg(`Sent to ${r.sent_to}`);
    } catch (e) {
      toastReport("Retention → Strategy builder", "Test send", e);
    }
  };

  const triggerOptions = (cat?.triggers ?? []).map((t) => ({ value: t.key, label: t.label }));
  const fieldOptions = (cat?.condition_fields ?? []).map((f) => ({ value: f.key, label: f.label }));
  const opOptions = (cat?.operators ?? []).map((o) => ({ value: o.key, label: o.label }));
  const actionOptions = (cat?.actions ?? []).map((a) => ({ value: a.key, label: a.label }));
  const busy = createM.isPending || updateM.isPending;

  return (
    <div className="max-w-[1180px] space-y-5 pb-24 md:pb-0">
      {/* Header — wraps on phones; actions also live in the sticky bar below */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate("/retention")}>
          Back
        </Button>
        <h1 className="font-display text-lg sm:text-xl flex-1 min-w-[180px] truncate">
          {isEdit ? "Edit strategy" : "New strategy"}
        </h1>
        <div className="hidden md:flex items-center gap-2">
          <Button variant="secondary" icon={<Eye className="w-4 h-4" />} onClick={runPreview} disabled={busy || !trigger}>
            Preview
          </Button>
          <Button variant="primary" icon={<Save className="w-4 h-4" />} onClick={save} disabled={busy || !trigger}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </div>

      {saveError && <div className="text-[13px] text-danger">{saveError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* WHEN */}
          <Card className="p-4 sm:p-5 space-y-4">
            <SectionTitle n={1} title="When" hint="What kicks this off, and who it applies to." />
            <Field label="Name this strategy">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Win back quiet customers"
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
            </Field>
            <Field label="Trigger">
              <Select value={trigger} onChange={setTrigger} options={[{ value: "", label: "Choose a trigger…" }, ...triggerOptions]} />
              {trigger && (
                <p className="text-[11.5px] text-text-faint mt-1">
                  {cat?.triggers.find((t) => t.key === trigger)?.description}
                </p>
              )}
            </Field>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="micro">Only for customers where…</span>
                <button
                  className="text-[11px] text-text-muted hover:text-text-primary py-1.5 -my-1.5 shrink-0"
                  onClick={() => setAdvanced((a) => !a)}
                >
                  {advanced ? "Use guided rows" : "Advanced (JSON)"}
                </button>
              </div>
              {advanced ? (
                <textarea
                  value={advancedJson}
                  onChange={(e) => setAdvancedJson(e.target.value)}
                  rows={6}
                  className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[12px]"
                />
              ) : (
                <div className="space-y-2">
                  {rows.length === 0 && (
                    <p className="text-[12px] text-text-faint">Everyone on this trigger (no conditions).</p>
                  )}
                  {rows.map((r, i) => (
                    <ConditionRow
                      key={i}
                      row={r}
                      fieldOptions={fieldOptions}
                      opOptions={opOptions}
                      valueless={valuelessOps.has(r.op)}
                      onChange={(next) => setRows((rs) => rs.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    />
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => setRows((rs) => [...rs, { field: "", op: "", value: "" }])}
                  >
                    Add condition
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Re-enrol cooldown (days)">
                <NumberField value={cooldown} onChange={setCooldown} allowDecimal={false} placeholder="optional" />
              </Field>
              <Field label="Max times per customer">
                <NumberField value={maxEnroll} onChange={setMaxEnroll} allowDecimal={false} placeholder="optional" />
              </Field>
            </div>
          </Card>

          {/* THEN */}
          <Card className="p-4 sm:p-5 space-y-4">
            <SectionTitle n={2} title="Then" hint="The steps that run, in order. Email is the channel." />
            {steps.map((s, i) => (
              <StepEditor
                key={i}
                index={i}
                step={s}
                actionOptions={actionOptions}
                onChange={(next) => setSteps((ss) => ss.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setSteps((ss) => ss.filter((_, j) => j !== i))}
              />
            ))}
            <Button
              variant="secondary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() =>
                setSteps((ss) => [
                  ...ss,
                  { step_order: ss.length + 1, wait_minutes: ss.length === 0 ? 0 : 1440, action_type: "send_email", action_config: {} },
                ])
              }
            >
              Add step
            </Button>
          </Card>
        </div>

        {/* PREVIEW */}
        <Card className="p-4 sm:p-5 space-y-3 lg:sticky lg:top-4 min-w-0">
          <SectionTitle n={3} title="Preview" hint="The exact mail a sample customer would get." />
          {!isEdit ? (
            <p className="text-[12.5px] text-text-muted">Save the draft to preview and send yourself a test.</p>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="secondary" icon={<Eye className="w-4 h-4" />} onClick={runPreview} disabled={previewM.isPending}>
                  {previewM.isPending ? "Rendering…" : "Refresh"}
                </Button>
                <Button size="sm" variant="ghost" icon={<Send className="w-4 h-4" />} onClick={runTest} disabled={testM.isPending}>
                  {testM.isPending ? "Sending…" : "Email me a test"}
                </Button>
              </div>
              {testMsg && <p className="text-[12px] text-success">{testMsg}</p>}
              {preview && (
                <div className="space-y-3">
                  <p className="text-[13px] text-text-muted italic">{preview.summary}</p>
                  <div className="flex items-center gap-2 text-[12px]">
                    {preview.would_enroll ? (
                      <span className="text-success inline-flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Sample customer would enrol
                      </span>
                    ) : (
                      <span className="text-text-faint inline-flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Sample customer wouldn't match
                      </span>
                    )}
                  </div>
                  {preview.steps.map((st) => (
                    <div key={st.step_order} className="rounded-[11px] border border-line overflow-hidden">
                      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-line bg-text-primary/[0.02]">
                        <Pill tone={st.condition_met ? "accent" : "neutral"} dot={false}>
                          {st.wait}
                        </Pill>
                        <span className="text-[11.5px] text-text-faint">{st.action_type.replace(/_/g, " ")}</span>
                      </div>
                      {st.rendered ? (
                        <div>
                          <div className="text-[13px] font-medium px-3 py-2">{st.rendered.subject || "(no subject)"}</div>
                          {/* The full framed document — same pipeline as the live send */}
                          <iframe
                            title={`Step ${st.step_order} mail`}
                            sandbox=""
                            srcDoc={st.rendered.html}
                            className="w-full h-[320px] sm:h-[380px] bg-white border-t border-line"
                          />
                        </div>
                      ) : (
                        <div className="text-[12px] text-text-muted px-3 py-2.5">{st.description || st.action_type.replace(/_/g, " ")}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Sticky action bar — primary actions in thumb reach on phones */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 dropglass border-t border-line px-4 py-3 flex gap-2"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button
          variant="secondary"
          className="flex-1"
          icon={<Eye className="w-4 h-4" />}
          onClick={runPreview}
          disabled={busy || !trigger}
        >
          Preview
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          icon={<Save className="w-4 h-4" />}
          onClick={save}
          disabled={busy || !trigger}
        >
          {busy ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

/** One guided condition row. Inline on desktop; stacks into a tidy card on
 *  phones so no control ever collapses below thumb width. */
function ConditionRow({
  row,
  fieldOptions,
  opOptions,
  valueless,
  onChange,
  onRemove,
}: {
  row: Row;
  fieldOptions: { value: string; label: string }[];
  opOptions: { value: string; label: string }[];
  valueless: boolean;
  onChange: (r: Row) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[11px] border border-line p-2.5 sm:p-0 sm:border-0 sm:rounded-none">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <Select
            value={row.field}
            onChange={(v) => onChange({ ...row, field: v })}
            options={[{ value: "", label: "Field…" }, ...fieldOptions]}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 sm:w-40 sm:flex-none">
            <Select
              value={row.op}
              onChange={(v) => onChange({ ...row, op: v })}
              options={[{ value: "", label: "is…" }, ...opOptions]}
            />
          </div>
          {!valueless && (
            <input
              value={row.value}
              onChange={(e) => onChange({ ...row, value: e.target.value })}
              placeholder="value"
              className="flex-1 sm:flex-none sm:w-28 min-w-0 h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          )}
          <button
            onClick={onRemove}
            aria-label="Remove condition"
            className="grid place-items-center w-10 h-10 sm:w-9 sm:h-9 rounded-[10px] text-text-faint hover:text-danger shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StepEditor({
  index,
  step,
  actionOptions,
  onChange,
  onRemove,
}: {
  index: number;
  step: StrategyStep;
  actionOptions: { value: string; label: string }[];
  onChange: (s: StrategyStep) => void;
  onRemove: () => void;
}) {
  const cfg = (step.action_config || {}) as Record<string, string>;
  const setCfg = (k: string, v: string) => onChange({ ...step, action_config: { ...cfg, [k]: v } });
  const waitDays = step.wait_minutes ? String(Math.round(step.wait_minutes / 1440)) : "0";

  return (
    <div className="rounded-[12px] border border-line p-3 sm:p-3.5 space-y-3">
      {/* Timing + action — wraps cleanly at any width */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="grid place-items-center w-6 h-6 rounded-full bg-accent/15 text-accent-glow text-[12px] font-bold shrink-0">
          {index + 1}
        </span>
        <span className="text-[12px] text-text-muted">Wait</span>
        <div className="w-20">
          <NumberField
            value={waitDays}
            onChange={(v) => onChange({ ...step, wait_minutes: (Number(v) || 0) * 1440 })}
            allowDecimal={false}
            suffix="d"
          />
        </div>
        <span className="text-[12px] text-text-muted">then</span>
        <div className="flex-1 min-w-[160px]">
          <Select
            value={step.action_type}
            onChange={(v) => onChange({ ...step, action_type: v })}
            options={actionOptions}
          />
        </div>
        <button
          onClick={onRemove}
          aria-label="Remove step"
          className="grid place-items-center w-10 h-10 sm:w-9 sm:h-9 rounded-[10px] text-text-faint hover:text-danger ml-auto sm:ml-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {step.action_type === "send_email" ? (
        <EmailStepEditor step={step} cfg={cfg} setCfg={setCfg} onChange={onChange} />
      ) : step.action_type === "award_points" ? (
        <div className="w-40">
          <NumberField value={cfg.points ?? ""} onChange={(v) => setCfg("points", v)} allowDecimal={false} suffix="pts" />
        </div>
      ) : step.action_type === "add_to_segment" ? (
        <input
          value={cfg.tag ?? ""}
          onChange={(e) => setCfg("tag", e.target.value)}
          placeholder="Tag to apply (e.g. vip)"
          className="w-full h-[40px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      ) : (
        <input
          value={cfg.title ?? ""}
          onChange={(e) => setCfg("title", e.target.value)}
          placeholder="Title / note"
          className="w-full h-[40px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      )}
    </div>
  );
}

/**
 * The email step — hybrid authoring. "Write it here" opens the same
 * Gmail-style editor Marketing uses (with loyalty Personalise tokens);
 * "Saved template" points the step at a Marketing template, so one mail can
 * be crafted once and reused by campaigns and strategies alike.
 */
function EmailStepEditor({
  step,
  cfg,
  setCfg,
  onChange,
}: {
  step: StrategyStep;
  cfg: Record<string, string>;
  setCfg: (k: string, v: string) => void;
  onChange: (s: StrategyStep) => void;
}) {
  const { can } = useAuthStore();
  // The template picker reads Marketing's template list; hide it entirely
  // (and never fire the query) when the user lacks that module — the API
  // would refuse it anyway.
  const canPickTemplates = can("email_campaigns", "view");
  const usingTemplate = Boolean(step.email_template_id);

  return (
    <div className="space-y-2.5">
      {canPickTemplates && (
        <TemplateModeControls step={step} onChange={onChange} usingTemplate={usingTemplate} />
      )}

      {!usingTemplate && (
        <div className="space-y-2">
          <input
            value={cfg.subject ?? ""}
            onChange={(e) => setCfg("subject", e.target.value)}
            placeholder="Email subject — use Personalise for names & points"
            className="w-full h-[40px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <RichMailEditor
            value={cfg.html ?? ""}
            onChange={(html) => setCfg("html", html)}
            tokenScope="retention"
            compact
            placeholder="Write the mail — the brand header, footer and unsubscribe link are added automatically."
          />
        </div>
      )}
    </div>
  );
}

/** The "Write it here / Saved template" toggle + picker. Mounted only when
 *  the user can read Marketing templates, so the query never 403s. */
function TemplateModeControls({
  step,
  onChange,
  usingTemplate,
}: {
  step: StrategyStep;
  onChange: (s: StrategyStep) => void;
  usingTemplate: boolean;
}) {
  const templatesQ = useEmailTemplates();
  const templates = (templatesQ.data ?? []).filter((t) => t.status !== "archived");
  const chosen = templates.find((t) => t.template_id === step.email_template_id);

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-[10px] border border-line p-0.5 bg-text-primary/[0.03]">
        <ModeButton
          active={!usingTemplate}
          icon={<PenLine className="w-3.5 h-3.5" />}
          onClick={() => onChange({ ...step, email_template_id: null })}
        >
          Write it here
        </ModeButton>
        <ModeButton
          active={usingTemplate}
          icon={<FileCode2 className="w-3.5 h-3.5" />}
          onClick={() => {
            if (!usingTemplate)
              onChange({ ...step, email_template_id: templates[0]?.template_id ?? null });
          }}
          disabled={templates.length === 0}
        >
          Saved template
        </ModeButton>
      </div>

      {usingTemplate && (
        <div className="space-y-2">
          <Select
            value={step.email_template_id ?? ""}
            onChange={(v) => onChange({ ...step, email_template_id: v || null })}
            options={[
              { value: "", label: templates.length ? "Choose a template…" : "No templates yet" },
              ...templates.map((t) => ({ value: t.template_id, label: t.display_name })),
            ]}
          />
          {chosen && (
            <p className="text-[11.5px] text-text-faint">
              Subject &amp; body come from the template: <span className="text-text-muted">“{chosen.subject_line}”</span>
            </p>
          )}
          <Link
            to="/marketing?tab=templates"
            className="inline-flex items-center gap-1 text-[12px] text-accent-glow hover:underline"
          >
            Craft templates in Marketing <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  icon,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-[8px] text-[12px] font-semibold transition-colors disabled:opacity-40",
        active
          ? "bg-accent/[0.16] text-accent-glow"
          : "text-text-muted hover:text-text-primary",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SectionTitle({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="grid place-items-center w-7 h-7 rounded-[9px] bg-accent-deep text-[#F4E9D9] font-display text-[13px] shrink-0">
        {n}
      </span>
      <div>
        <h3 className="font-display text-[16px] leading-tight">{title}</h3>
        <p className="text-[12px] text-text-muted">{hint}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="micro block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
