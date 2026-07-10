import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  Send,
  Check,
  AlertCircle,
  Coins,
  Pencil,
} from "lucide-react";
import { useActiveBusiness } from "@/stores/business";
import { Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { toastReport } from "@/lib/error-report";
import { toast } from "@/stores/toast";
import {
  whatsappTemplatesApi,
  CATEGORY_META,
  STATUS_META,
  fmtRateNgn,
  type WhatsAppTemplate,
  type TemplateRate,
  type TemplateCategory,
  type RateCategory,
} from "@/lib/whatsapp-templates-api";
import {
  buildComponents,
  parseTemplate,
  TemplateEditorFields,
  type TemplateForm,
  emptyForm,
} from "@/components/messaging/TemplateEditor";

/**
 * WhatsApp Templates tab — Messaging settings → WhatsApp Templates.
 *
 * Meta blocks free-form replies after the 24-hour window; the only way
 * through is a pre-approved template. This tab is where the CEO authors
 * them, submits them to Meta for review, watches their status, and —
 * critically — sees what each send will COST, since Marketing, Utility
 * and Authentication are billed at different rates.
 */

const TONE_CLASS: Record<string, string> = {
  green: "text-green-300 border-green-400/30 bg-green-400/10",
  amber: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  red: "text-danger border-danger/30 bg-danger/10",
  blue: "text-info border-info/30 bg-info/10",
  muted: "text-text-muted border-border/60 bg-panel-2",
};

export function WhatsAppTemplatesTab() {
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{
    form: TemplateForm;
    id?: string;
    status?: string;
  } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["whatsapp-templates", business.key],
    queryFn: () => whatsappTemplatesApi.list(),
  });

  const templates = data?.templates ?? [];
  const rates = data?.rates ?? [];

  const sync = useMutation({
    mutationFn: () => whatsappTemplatesApi.sync(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates", business.key] });
      toast.success(`Synced ${res.synced} template(s) from Meta.`);
    },
    onError: (e) => toastReport("Messaging → WhatsApp Templates", "Sync from Meta", e),
  });

  const remove = useMutation({
    mutationFn: (id: string) => whatsappTemplatesApi.remove(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["whatsapp-templates", business.key] }),
    onError: (e) => toastReport("Messaging → WhatsApp Templates", "Delete template", e),
  });

  const submit = useMutation({
    mutationFn: (id: string) => whatsappTemplatesApi.submit(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates", business.key] });
      toast.success("Submitted to Meta for review.");
    },
    onError: (e) => toastReport("Messaging → WhatsApp Templates", "Submit template", e),
  });

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-[17px]">WhatsApp Templates</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            Approved templates are the only way to reach a customer once the
            24-hour window closes. Author them here, submit to Meta, track
            approval — and see what each send costs.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12.5px] hover:border-accent/40 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {sync.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Sync from Meta
          </button>
          <button
            onClick={() => setEditing({ form: emptyForm() })}
            className="rounded-xl bg-accent text-bg px-3 py-2 text-[12.5px] font-semibold hover:bg-accent-glow inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New template
          </button>
        </div>
      </header>

      <RatesCard rates={rates} businessKey={business.key} />

      <div className="flex items-center justify-between">
        <h3 className="font-display text-[16px]">Templates</h3>
        <span className="text-text-faint text-[11.5px]">
          {templates.length} total
        </span>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-panel-2 rounded animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6 text-center text-[13px] text-danger inline-flex items-center gap-2 justify-center w-full">
            <AlertCircle className="w-4 h-4" />
            Couldn&rsquo;t load templates.
          </div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[13px] text-text-muted">
              No templates yet. Create one above, or{" "}
              <button
                onClick={() => sync.mutate()}
                className="text-accent-glow underline underline-offset-2"
              >
                sync from Meta
              </button>{" "}
              to pull any you already approved in the Meta Business Manager.
            </p>
          </div>
        ) : (
          templates.map((t, i) => (
            <TemplateRow
              key={t.template_id}
              tpl={t}
              last={i === templates.length - 1}
              onEdit={() =>
                setEditing({
                  form: parseTemplate(t),
                  id: t.template_id,
                  status: t.status,
                })
              }
              onSubmit={() => submit.mutate(t.template_id)}
              onRemove={() => {
                if (
                  window.confirm(
                    `Delete "${t.name}"? This removes it from Meta too and can't be undone.`,
                  )
                )
                  remove.mutate(t.template_id);
              }}
              submitting={submit.isPending && submit.variables === t.template_id}
              deleting={remove.isPending && remove.variables === t.template_id}
            />
          ))
        )}
      </Card>

      {editing && (
        <TemplateEditorModal
          initial={editing.form}
          id={editing.id}
          status={editing.status}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({
              queryKey: ["whatsapp-templates", business.key],
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-widest font-semibold px-2 py-[2px] rounded-full border ${
        TONE_CLASS[tone] || TONE_CLASS.muted
      }`}
    >
      {children}
    </span>
  );
}

function TemplateRow({
  tpl,
  last,
  onEdit,
  onSubmit,
  onRemove,
  submitting,
  deleting,
}: {
  tpl: WhatsAppTemplate;
  last: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onRemove: () => void;
  submitting: boolean;
  deleting: boolean;
}) {
  const status = STATUS_META[tpl.status] ?? { label: tpl.status, tone: "muted" };
  const cat = CATEGORY_META[tpl.category];
  const canSubmit = tpl.status === "LOCAL_DRAFT" || tpl.status === "REJECTED";
  return (
    <div className={`p-3.5 ${last ? "" : "border-b hairline"} hover:bg-panel-2/40`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={onEdit} className="text-left min-w-0 flex-1 group">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] text-accent-glow truncate group-hover:underline underline-offset-2">
              {tpl.name}
            </span>
            <span className="text-[11px] text-text-faint uppercase">
              {tpl.language}
            </span>
            <Badge tone={cat?.tone ?? "muted"}>{cat?.label ?? tpl.category}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="text-[12.5px] text-text-muted mt-1 line-clamp-2">
            {tpl.body_text || "(no body)"}
          </p>
          {tpl.rejected_reason && (
            <p className="text-[11.5px] text-danger mt-1">
              Rejected: {tpl.rejected_reason}
            </p>
          )}
        </button>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[12px] font-mono">
            <Coins className="w-3.5 h-3.5 text-text-faint" />
            <span
              className={
                tpl.cost && Number(tpl.cost.amount_ngn) === 0
                  ? "text-green-300"
                  : "text-text-primary"
              }
            >
              {tpl.cost ? fmtRateNgn(tpl.cost.amount_ngn) : "—"}
            </span>
            <span className="text-text-faint">/ send</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-panel-2 text-text-muted hover:text-text-primary"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {canSubmit && (
              <button
                onClick={onSubmit}
                disabled={submitting}
                className="p-1.5 rounded-lg hover:bg-panel-2 text-text-muted hover:text-accent-glow disabled:opacity-50"
                title="Submit to Meta for review"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              onClick={onRemove}
              disabled={deleting}
              className="p-1.5 rounded-lg hover:bg-panel-2 text-text-muted hover:text-danger disabled:opacity-50"
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rates card ─────────────────────────────────────────────

function RatesCard({
  rates,
  businessKey,
}: {
  rates: TemplateRate[];
  businessKey: string;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const order: RateCategory[] = [
    "MARKETING",
    "UTILITY",
    "AUTHENTICATION",
    "SERVICE",
  ];
  const byCat = useMemo(() => {
    const m: Partial<Record<RateCategory, TemplateRate>> = {};
    for (const r of rates) m[r.category] = r;
    return m;
  }, [rates]);

  const save = useMutation({
    mutationFn: (input: { category: RateCategory; amount_ngn: number }) =>
      whatsappTemplatesApi.setRate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates", businessKey] });
      toast.success("Rate updated.");
    },
    onError: (e) => toastReport("Messaging → WhatsApp Templates", "Update rate", e),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Coins className="w-4 h-4 text-accent-glow" />
        <h3 className="font-display text-[15px]">Send-cost rates (NGN)</h3>
      </div>
      <p className="text-text-faint text-[12px] mb-3">
        What one template send costs, per Meta billing category. Meta charges
        differently for Marketing vs Utility vs Authentication — set your
        brand&rsquo;s real rates so the team sees the true cost before sending.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {order.map((cat) => {
          const meta = CATEGORY_META[cat];
          const row = byCat[cat];
          const readOnly = cat === "SERVICE";
          const value =
            drafts[cat] ?? (row ? String(Number(row.amount_ngn)) : "0");
          return (
            <div
              key={cat}
              className="rounded-xl bg-panel-2 border hairline p-3 flex flex-col gap-2"
            >
              <div>
                <div className="text-[13px] font-medium">{meta.label}</div>
                <div className="text-[11px] text-text-faint leading-snug mt-0.5">
                  {meta.blurb}
                </div>
              </div>
              {readOnly ? (
                <div className="text-green-300 font-mono text-[15px] mt-auto">
                  Free
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-auto">
                  <span className="text-text-faint font-mono text-[13px]">₦</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={value}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [cat]: e.target.value }))
                    }
                    className="w-full rounded-lg bg-bg border hairline px-2 py-1.5 text-[13px] font-mono focus:outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={() =>
                      save.mutate({
                        category: cat,
                        amount_ngn: Number(value) || 0,
                      })
                    }
                    disabled={save.isPending}
                    className="p-1.5 rounded-lg bg-accent/10 text-accent-glow border border-accent/20 hover:bg-accent/20 disabled:opacity-50"
                    title="Save rate"
                  >
                    {save.isPending && save.variables?.category === cat ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Editor modal ───────────────────────────────────────────

function TemplateEditorModal({
  initial,
  id,
  status,
  onClose,
  onSaved,
}: {
  initial: TemplateForm;
  id?: string;
  status?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TemplateForm>(initial);
  const isNew = !id;
  const onMeta = !!status && status !== "LOCAL_DRAFT";

  const save = useMutation({
    mutationFn: async (submitToMeta: boolean) => {
      const components = buildComponents(form);
      if (isNew) {
        return whatsappTemplatesApi.create({
          name: form.name,
          language: form.language,
          category: form.category as TemplateCategory,
          components,
          submit: submitToMeta,
        });
      }
      return whatsappTemplatesApi.update(id!, {
        category: form.category as TemplateCategory,
        components,
        submit: submitToMeta,
      });
    },
    onSuccess: onSaved,
    onError: (e) => toastReport("Messaging → WhatsApp Templates", "Save template", e),
  });

  const canSave = !!form.name.trim() && !!form.body.trim();

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New WhatsApp template" : `Edit “${form.name}”`}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate(false)}
            disabled={!canSave || save.isPending}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] hover:border-accent/40 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending && save.variables === false ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Save draft
          </button>
          <button
            onClick={() => save.mutate(true)}
            disabled={!canSave || save.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending && save.variables === true ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {onMeta ? "Save & resubmit" : "Submit to Meta"}
          </button>
        </>
      }
    >
      <TemplateEditorFields
        form={form}
        onChange={setForm}
        lockName={!isNew}
      />
    </Modal>
  );
}
