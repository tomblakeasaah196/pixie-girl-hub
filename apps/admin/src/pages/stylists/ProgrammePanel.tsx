/**
 * Programme configuration (§6.26). Everything the spec says must be config,
 * rendered from the DB (canon §4.4): tiers (D-2 — labels/multipliers, never
 * hardcoded), routing weights (Q13 RoutingConfigPanel), quality-hold days
 * (Q14), referral commission (Q17), offer window, applications toggle,
 * questionnaire (Q6). CEO/approve permission edits; everyone else reads.
 */

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import {
  useProgrammeConfig,
  useTiers,
  useQuestions,
  useConfigMutations,
} from "./hooks";
import type { Question } from "./types";

const WEIGHT_KEYS = ["distance", "tier", "rating", "capacity", "specialty"] as const;

function ConfigCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-[var(--radius)] shadow-glass p-5">
      <h3 className="micro mb-4">{title}</h3>
      {children}
    </section>
  );
}

export function ProgrammePanel() {
  const can = useAuthStore((s) => s.can);
  const config = useProgrammeConfig();
  const tiers = useTiers();
  const questions = useQuestions();
  const m = useConfigMutations();
  const canEdit = can("stylist_programme", "approve");
  const canEditQuestions = can("stylist_programme", "edit");

  const [form, setForm] = useState<{
    quality_hold_days: number;
    offer_window_hours: number;
    offer_top_n: number;
    referral_commission_pct: number;
    applications_open: boolean;
    weights: Record<string, number>;
  } | null>(null);
  const [newQuestion, setNewQuestion] = useState("");

  useEffect(() => {
    if (config.data && !form)
      setForm({
        quality_hold_days: config.data.quality_hold_days,
        offer_window_hours: config.data.offer_window_hours,
        offer_top_n: config.data.offer_top_n,
        referral_commission_pct: Number(config.data.referral_commission_pct),
        applications_open: config.data.applications_open,
        weights: { ...config.data.routing_weights },
      });
  }, [config.data, form]);

  if (config.isError)
    return (
      <ErrorState
        message={(config.error as Error).message}
        onRetry={() => config.refetch()}
      />
    );
  if (config.isLoading || !form)
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-52 rounded-[var(--radius)] bg-text-primary/[0.05] animate-pulse" />
        ))}
      </div>
    );

  const dirty =
    config.data &&
    (form.quality_hold_days !== config.data.quality_hold_days ||
      form.offer_window_hours !== config.data.offer_window_hours ||
      form.offer_top_n !== config.data.offer_top_n ||
      form.referral_commission_pct !== Number(config.data.referral_commission_pct) ||
      form.applications_open !== config.data.applications_open ||
      WEIGHT_KEYS.some((k) => form.weights[k] !== config.data!.routing_weights[k]));

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <ConfigCard title="Money & holds">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Quality-hold window</div>
                <div className="text-[11.5px] text-text-muted">
                  Days after completion before pay releases without customer confirmation (Q14)
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={90}
                disabled={!canEdit}
                className="input w-20 tabular-nums text-right"
                value={form.quality_hold_days}
                onChange={(e) =>
                  setForm((f) => f && { ...f, quality_hold_days: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Referral commission</div>
                <div className="text-[11.5px] text-text-muted">
                  Default % of an attributed order paid to the partner (per-partner overrides win)
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                disabled={!canEdit}
                className="input w-20 tabular-nums text-right"
                value={form.referral_commission_pct}
                onChange={(e) =>
                  setForm((f) => f && { ...f, referral_commission_pct: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </ConfigCard>

        <ConfigCard title="Offers & applications">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Offer window (hours)</div>
                <div className="text-[11.5px] text-text-muted">
                  How long candidates have before the pool expires + escalates
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={720}
                disabled={!canEdit}
                className="input w-20 tabular-nums text-right"
                value={form.offer_window_hours}
                onChange={(e) =>
                  setForm((f) => f && { ...f, offer_window_hours: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Auto-offer top N</div>
                <div className="text-[11.5px] text-text-muted">
                  How many ranked candidates get the one-click offer
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={20}
                disabled={!canEdit}
                className="input w-20 tabular-nums text-right"
                value={form.offer_top_n}
                onChange={(e) =>
                  setForm((f) => f && { ...f, offer_top_n: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Applications open</div>
                <div className="text-[11.5px] text-text-muted">
                  The public landing accepts new applications
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form.applications_open}
                onChange={(e) =>
                  setForm((f) => f && { ...f, applications_open: e.target.checked })
                }
              />
            </div>
          </div>
        </ConfigCard>
      </div>

      <ConfigCard title="Routing weights (Q13 — relative, normalised at read)">
        <div className="grid md:grid-cols-5 gap-4">
          {WEIGHT_KEYS.map((k) => (
            <div key={k}>
              <div className="flex items-center justify-between mb-1">
                <label className="label capitalize">{k}</label>
                <span className="font-mono text-[11.5px] tabular-nums">
                  {form.weights[k]}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                disabled={!canEdit}
                value={form.weights[k]}
                onChange={(e) =>
                  setForm(
                    (f) =>
                      f && {
                        ...f,
                        weights: { ...f.weights, [k]: Number(e.target.value) },
                      },
                  )
                }
                className="w-full accent-[rgb(var(--accent))]"
              />
            </div>
          ))}
        </div>
      </ConfigCard>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!dirty || m.updateConfig.isPending}
            onClick={() =>
              m.updateConfig.mutate({
                quality_hold_days: form.quality_hold_days,
                offer_window_hours: form.offer_window_hours,
                offer_top_n: form.offer_top_n,
                referral_commission_pct: form.referral_commission_pct,
                applications_open: form.applications_open,
                routing_weights: form.weights,
              })
            }
          >
            {m.updateConfig.isPending ? "Saving…" : "Save programme config"}
          </Button>
          {m.updateConfig.isError && (
            <span className="text-danger text-[12px]">
              {(m.updateConfig.error as Error).message}
            </span>
          )}
          {m.updateConfig.isSuccess && !dirty && (
            <span className="text-success text-[12px]">Saved</span>
          )}
        </div>
      )}

      {/* Tiers (D-2) */}
      <ConfigCard title="Certification tiers (D-2 — rendered from config everywhere)">
        <div className="space-y-2">
          {(tiers.data ?? []).map((t) => (
            <div key={t.tier_key} className="flex items-center gap-3 flex-wrap glass rounded-xl p-3">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: t.badge_color ?? "rgb(var(--accent))" }}
              />
              <span className="text-[13px] font-semibold w-24">{t.label}</span>
              <span className="micro">rank {t.rank}</span>
              <span className="micro">×{Number(t.payout_multiplier)} payout</span>
              <span className="micro">{t.validity_months}mo validity</span>
              {!t.is_active && <Pill tone="neutral" dot={false}>Inactive</Pill>}
              {canEdit && (
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="number"
                    step="0.05"
                    min={0.1}
                    max={10}
                    className="input h-8 w-20 tabular-nums text-right"
                    defaultValue={Number(t.payout_multiplier)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v && v !== Number(t.payout_multiplier))
                        m.updateTier.mutate([t.tier_key, { payout_multiplier: v }]);
                    }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={120}
                    className="input h-8 w-16 tabular-nums text-right"
                    defaultValue={t.validity_months}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v && v !== t.validity_months)
                        m.updateTier.mutate([t.tier_key, { validity_months: v }]);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </ConfigCard>

      {/* Questionnaire (Q6) */}
      <ConfigCard title="Brand-alignment questionnaire (Q6 — the public form renders this)">
        <div className="space-y-2">
          {(questions.data ?? []).map((q: Question) => (
            <div key={q.question_id} className="flex items-center gap-3 glass rounded-xl p-3">
              <span className="micro w-6 text-center">{q.display_order}</span>
              <div className="flex-1">
                <div className="text-[13px]">{q.question}</div>
                <div className="text-[11px] text-text-faint">
                  {q.field_type}
                  {q.is_required ? " · required" : ""}
                  {!q.is_active ? " · inactive" : ""}
                </div>
              </div>
              {canEditQuestions && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={m.updateQuestion.isPending}
                  onClick={() =>
                    m.updateQuestion.mutate([q.question_id, { is_active: !q.is_active }])
                  }
                >
                  {q.is_active ? "Retire" : "Restore"}
                </Button>
              )}
            </div>
          ))}
          {canEditQuestions && (
            <div className="flex gap-2 pt-1">
              <input
                className="input h-9 flex-1"
                placeholder="New question…"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
              />
              <Button
                size="sm"
                icon={<Settings2 className="w-3.5 h-3.5" />}
                disabled={!newQuestion.trim() || m.createQuestion.isPending}
                onClick={() =>
                  m.createQuestion.mutate(
                    {
                      question: newQuestion.trim(),
                      field_type: "textarea",
                      display_order: (questions.data?.length ?? 0) + 1,
                    },
                    { onSuccess: () => setNewQuestion("") },
                  )
                }
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </ConfigCard>
    </div>
  );
}
