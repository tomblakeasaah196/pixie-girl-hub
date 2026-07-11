/**
 * AI Chief of Staff — settings panel (PR6).
 *
 * The CEO personalises her Chief of Staff: name, pronoun, tone, avatar, work &
 * quiet hours, brief/review times, and the celebrate-wins / adaptive-timing
 * toggles. Naming is CoS-only — Praxis is untouched. Backed by GET/PUT
 * /cos/settings. Rendered as a glass right-drawer (bottom-sheet on mobile),
 * matching GoalDetailPanel. Four states: loading / error / form (the CoS tab is
 * already CEO-gated, so no separate permission-denied state).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, RotateCw, Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Toggle, Select } from "@/components/ui/controls";
import {
  useCosSettings,
  useUpdateCosSettings,
  type CosSettings as Settings,
  type CosSettingsPatch,
  type CosTone,
  type CosPronoun,
} from "@/lib/cos-api";

/** TIME columns arrive as "HH:MM:SS"; <input type=time> wants "HH:MM". */
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

type FormState = {
  assistant_name: string;
  pronoun: CosPronoun;
  tone: CosTone;
  avatar_url: string;
  timezone: string;
  work_start: string;
  work_end: string;
  morning_brief_at: string;
  evening_review_at: string;
  quiet_start: string;
  quiet_end: string;
  celebrate_wins: boolean;
  adaptive_timing: boolean;
};

function toForm(s: Settings): FormState {
  return {
    assistant_name: s.assistant_name,
    pronoun: s.pronoun,
    tone: s.tone,
    avatar_url: s.avatar_url ?? "",
    timezone: s.timezone,
    work_start: hhmm(s.work_start),
    work_end: hhmm(s.work_end),
    morning_brief_at: hhmm(s.morning_brief_at),
    evening_review_at: hhmm(s.evening_review_at),
    quiet_start: hhmm(s.quiet_start),
    quiet_end: hhmm(s.quiet_end),
    celebrate_wins: s.celebrate_wins,
    adaptive_timing: s.adaptive_timing,
  };
}

/** Only the fields that actually changed, so a save is a minimal PATCH. */
function diff(form: FormState, base: Settings): CosSettingsPatch {
  const patch: CosSettingsPatch = {};
  const bAvatar = base.avatar_url ?? "";
  if (form.assistant_name.trim() && form.assistant_name !== base.assistant_name)
    patch.assistant_name = form.assistant_name.trim();
  if (form.pronoun !== base.pronoun) patch.pronoun = form.pronoun;
  if (form.tone !== base.tone) patch.tone = form.tone;
  if (form.avatar_url !== bAvatar) patch.avatar_url = form.avatar_url.trim() || null;
  if (form.timezone.trim() && form.timezone !== base.timezone) patch.timezone = form.timezone.trim();
  for (const k of [
    "work_start",
    "work_end",
    "morning_brief_at",
    "evening_review_at",
    "quiet_start",
    "quiet_end",
  ] as const) {
    if (form[k] && form[k] !== hhmm(base[k])) patch[k] = form[k];
  }
  if (form.celebrate_wins !== base.celebrate_wins) patch.celebrate_wins = form.celebrate_wins;
  if (form.adaptive_timing !== base.adaptive_timing) patch.adaptive_timing = form.adaptive_timing;
  return patch;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-text-primary mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-faint mt-1">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full h-[42px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary outline-none focus-visible:border-accent/50 transition-colors";

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        aria-label={label}
      />
    </Field>
  );
}

export function CosSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useCosSettings(open);
  const update = useUpdateCosSettings();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (q.data) setForm(toForm(q.data));
  }, [q.data]);

  // Close on Escape (a11y).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const dirty = !!(form && q.data && Object.keys(diff(form, q.data)).length > 0);

  async function save() {
    if (!form || !q.data) return;
    const patch = diff(form, q.data);
    if (!Object.keys(patch).length) return;
    try {
      await update.mutateAsync(patch);
      onClose();
    } catch {
      /* toasted by the mutation */
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px] flex md:justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Chief of Staff settings"
    >
      <div
        className="mt-auto md:mt-0 w-full md:w-[440px] max-h-[88vh] md:max-h-none md:h-full overflow-y-auto dropglass rounded-t-[22px] md:rounded-none md:rounded-l-[22px] animate-slide-up md:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 p-4 border-b hairline dropglass">
          <Sparkles className="w-4 h-4 text-accent-glow" />
          <h2 className="font-display text-[15px] font-medium flex-1">Chief of Staff settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {q.isLoading || !form ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[52px] rounded-[12px] bg-text-primary/[0.05] animate-pulse" />
              ))}
            </div>
          ) : q.isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[13px] text-text-muted">Couldn't load your settings.</p>
              <Button variant="secondary" size="sm" icon={<RotateCw className="w-3.5 h-3.5" />} onClick={() => q.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Identity */}
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-faint">Personality</h3>
                <Field label="Name" hint="What your assistant is called — in the tab, chat and every reminder. Praxis keeps its own name.">
                  <input
                    type="text"
                    value={form.assistant_name}
                    maxLength={60}
                    onChange={(e) => set("assistant_name", e.target.value)}
                    placeholder="Chief of Staff"
                    className={inputCls}
                    aria-label="Assistant name"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pronoun">
                    <Select<CosPronoun>
                      value={form.pronoun}
                      onChange={(v) => set("pronoun", v)}
                      ariaLabel="Pronoun"
                      options={[
                        { value: "she", label: "She" },
                        { value: "he", label: "He" },
                        { value: "they", label: "They" },
                        { value: "it", label: "It" },
                      ]}
                    />
                  </Field>
                  <Field label="Tone">
                    <Select<CosTone>
                      value={form.tone}
                      onChange={(v) => set("tone", v)}
                      ariaLabel="Tone"
                      options={[
                        { value: "warm", label: "Warm" },
                        { value: "concise", label: "Concise" },
                        { value: "formal", label: "Formal" },
                      ]}
                    />
                  </Field>
                </div>
                <Field label="Avatar image URL" hint="Optional — link to an image for your assistant.">
                  <input
                    type="url"
                    value={form.avatar_url}
                    onChange={(e) => set("avatar_url", e.target.value)}
                    placeholder="https://…"
                    className={inputCls}
                    aria-label="Avatar image URL"
                  />
                </Field>
              </section>

              {/* Hours */}
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-faint">Working &amp; quiet hours</h3>
                <Field label="Timezone" hint="Used for reminders, briefings and quiet hours.">
                  <input
                    type="text"
                    value={form.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                    placeholder="Africa/Lagos"
                    className={inputCls}
                    aria-label="Timezone"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <TimeField label="Work starts" value={form.work_start} onChange={(v) => set("work_start", v)} />
                  <TimeField label="Work ends" value={form.work_end} onChange={(v) => set("work_end", v)} />
                  <TimeField label="Morning brief" value={form.morning_brief_at} onChange={(v) => set("morning_brief_at", v)} />
                  <TimeField label="Evening review" value={form.evening_review_at} onChange={(v) => set("evening_review_at", v)} />
                  <TimeField label="Quiet from" value={form.quiet_start} onChange={(v) => set("quiet_start", v)} />
                  <TimeField label="Quiet until" value={form.quiet_end} onChange={(v) => set("quiet_end", v)} />
                </div>
                <p className="text-[11px] text-text-faint">No reminders are sent during quiet hours.</p>
              </section>

              {/* Behaviour */}
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-faint">Behaviour</h3>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text-primary">Celebrate wins</div>
                    <div className="text-[11px] text-text-faint">A note of congratulations when you finish a milestone or hit a goal.</div>
                  </div>
                  <Toggle
                    checked={form.celebrate_wins}
                    onChange={(v) => set("celebrate_wins", v)}
                    ariaLabel="Celebrate wins"
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text-primary">Adaptive timing</div>
                    <div className="text-[11px] text-text-faint">Learn when you usually engage and nudge you around then (within work hours).</div>
                  </div>
                  <Toggle
                    checked={form.adaptive_timing}
                    onChange={(v) => set("adaptive_timing", v)}
                    ariaLabel="Adaptive timing"
                  />
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        {form && !q.isError && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 p-4 border-t hairline dropglass">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="w-3.5 h-3.5" />}
              onClick={save}
              disabled={!dirty || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default CosSettings;
