import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Save,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import { Card } from "@/components/ui/primitives";
import {
  aiGovernanceApi,
  type BrandVoiceUpsert,
} from "@/lib/ai-governance-api";

/**
 * Brand Voice editor — one row per brand. Praxis reads this whenever
 * the staff taps "Draft with Praxis" in the Smartcomm composer.
 *
 * Visible to CEO + anyone with ai_governance.edit. The two toggles at
 * the top are the CEO's cost controls: classify_inbound (auto-tagging,
 * default OFF — paid) and draft_on_tap (UI shows the button at all,
 * default ON — no cost unless tapped).
 */
export function BrandVoicePage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Brand Voice" },
  ]);
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const [form, setForm] = useState<BrandVoiceUpsert>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["brand-voice", business.key],
    queryFn: () => aiGovernanceApi.getBrandVoice(),
  });

  // Pre-fill from server on first load / brand switch.
  useEffect(() => {
    if (!data) {
      setForm({});
      return;
    }
    setForm({
      tone: data.tone ?? "",
      voice_summary: data.voice_summary ?? "",
      signature_html: data.signature_html ?? "",
      do_donts: data.do_donts ?? { do: [], dont: [] },
      faq_markdown: data.faq_markdown ?? "",
      sample_transcripts: data.sample_transcripts ?? [],
      primary_emojis: data.primary_emojis ?? [],
      classify_inbound: data.classify_inbound,
      draft_on_tap: data.draft_on_tap,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (input: BrandVoiceUpsert) =>
      aiGovernanceApi.upsertBrandVoice(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-voice", business.key] });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    },
  });

  function set<K extends keyof BrandVoiceUpsert>(
    key: K,
    value: BrandVoiceUpsert[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setList(key: "do" | "dont", value: string[]) {
    setForm((f) => ({
      ...f,
      do_donts: { ...(f.do_donts ?? {}), [key]: value },
    }));
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-panel-2 rounded animate-pulse w-1/3" />
        <div className="h-40 bg-panel-2 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-[920px] space-y-5">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Sparkles className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium leading-tight">
            Brand Voice
            <span className="text-text-faint text-[14px] ml-2">
              · {business.name}
            </span>
          </h2>
          <p className="text-text-muted text-[13px]">
            How Praxis sounds when she drafts replies for {business.name}. The
            same body lives in `ai_knowledge_chunks`, so Praxis grounds her
            answers in it.
          </p>
        </div>
        <button
          onClick={() => save.mutate(form)}
          disabled={save.isPending}
          className="grid place-items-center min-w-[120px] rounded-xl bg-accent text-bg font-semibold py-2.5 px-4 text-[13px] hover:bg-accent-glow disabled:opacity-50 transition-all"
        >
          {save.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" />
              Save
            </span>
          )}
        </button>
      </header>

      {savedAt && (
        <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2 text-[12.5px] text-green-300">
          <Check className="w-3.5 h-3.5" />
          Saved.
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
          <AlertCircle className="w-3.5 h-3.5" />
          Couldn&rsquo;t save. Try again.
        </div>
      )}

      {/* Toggles */}
      <Card className="p-5">
        <h3 className="font-display text-[16px] mb-3">Cost controls</h3>
        <div className="space-y-3">
          <Toggle
            label="Show ✨ Draft with Praxis in the composer"
            description="When OFF, staff can't tap the button. Every tap costs AI credits."
            checked={form.draft_on_tap !== false}
            onChange={(v) => set("draft_on_tap", v)}
          />
          <Toggle
            label="Auto-classify inbound messages"
            description="Tags every incoming DM with intent (order / question / complaint). Costs more — OFF by default."
            checked={!!form.classify_inbound}
            onChange={(v) => set("classify_inbound", v)}
          />
        </div>
      </Card>

      {/* Tone */}
      <Card className="p-5 space-y-4">
        <h3 className="font-display text-[16px]">Voice</h3>
        <Field
          label="Tone"
          placeholder="warm · luxe · playful · professional · …"
          value={form.tone ?? ""}
          onChange={(v) => set("tone", v)}
        />
        <Field
          label="Voice summary"
          placeholder="One paragraph describing how the brand speaks…"
          value={form.voice_summary ?? ""}
          onChange={(v) => set("voice_summary", v)}
          textarea
          rows={3}
        />
        <Field
          label="Signature (HTML allowed)"
          placeholder='Best,<br/>The Pixie Girl team 🌹'
          value={form.signature_html ?? ""}
          onChange={(v) => set("signature_html", v)}
          textarea
          rows={2}
        />
        <Field
          label="Primary emojis (comma-separated)"
          placeholder="🌹, ✨, 💞"
          value={(form.primary_emojis ?? []).join(", ")}
          onChange={(v) =>
            set(
              "primary_emojis",
              v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Card>

      {/* Do / Don't */}
      <Card className="p-5">
        <h3 className="font-display text-[16px] mb-3">Do / Don&rsquo;t</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ListEditor
            label="Always do"
            tone="ok"
            items={form.do_donts?.do ?? []}
            onChange={(v) => setList("do", v)}
          />
          <ListEditor
            label="Never do"
            tone="bad"
            items={form.do_donts?.dont ?? []}
            onChange={(v) => setList("dont", v)}
          />
        </div>
      </Card>

      {/* FAQ */}
      <Card className="p-5">
        <h3 className="font-display text-[16px] mb-3">Knowledge / FAQ</h3>
        <Field
          label="FAQ markdown"
          placeholder="## Returns\n\nWe accept returns within 7 days…"
          value={form.faq_markdown ?? ""}
          onChange={(v) => set("faq_markdown", v)}
          textarea
          rows={10}
          mono
        />
        <p className="text-text-faint text-[11.5px] mt-1.5">
          Praxis indexes this for RAG retrieval. Markdown is supported.
        </p>
      </Card>

      {/* Sample transcripts */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-[16px]">Sample transcripts</h3>
          <button
            onClick={() =>
              set("sample_transcripts", [
                ...(form.sample_transcripts ?? []),
                { label: "", customer: "", staff: "" },
              ])
            }
            className="text-[12px] text-accent-glow hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add example
          </button>
        </div>
        <p className="text-text-faint text-[11.5px] mb-3">
          Few-shot examples Praxis reads to tone-match. Keep these short and
          representative of the brand at its best.
        </p>
        <div className="space-y-3">
          {(form.sample_transcripts ?? []).length === 0 && (
            <p className="italic text-text-faint text-[12px]">
              No examples yet.
            </p>
          )}
          {(form.sample_transcripts ?? []).map((t, i) => (
            <div
              key={i}
              className="rounded-xl border hairline bg-panel-2/50 p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <input
                  value={t.label ?? ""}
                  onChange={(e) => {
                    const arr = [...(form.sample_transcripts ?? [])];
                    arr[i] = { ...t, label: e.target.value };
                    set("sample_transcripts", arr);
                  }}
                  placeholder="Label (e.g. 'Returns enquiry')"
                  className="flex-1 bg-transparent text-[12.5px] focus:outline-none placeholder:text-text-faint"
                />
                <button
                  onClick={() => {
                    const arr = [...(form.sample_transcripts ?? [])];
                    arr.splice(i, 1);
                    set("sample_transcripts", arr);
                  }}
                  className="text-text-muted hover:text-danger"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={t.customer ?? ""}
                onChange={(e) => {
                  const arr = [...(form.sample_transcripts ?? [])];
                  arr[i] = { ...t, customer: e.target.value };
                  set("sample_transcripts", arr);
                }}
                placeholder="Customer said…"
                rows={2}
                className="w-full rounded-lg bg-bg/50 border hairline px-2.5 py-1.5 text-[12px] focus:outline-none"
              />
              <textarea
                value={t.staff ?? ""}
                onChange={(e) => {
                  const arr = [...(form.sample_transcripts ?? [])];
                  arr[i] = { ...t, staff: e.target.value };
                  set("sample_transcripts", arr);
                }}
                placeholder="Brand replied…"
                rows={2}
                className="w-full rounded-lg bg-bg/50 border hairline px-2.5 py-1.5 text-[12px] focus:outline-none"
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Small primitives ────────────────────────────────────────

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 w-full text-left rounded-xl px-3 py-2.5 hover:bg-panel-2/70"
    >
      <span
        className={`mt-0.5 grid place-items-center w-10 h-6 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-panel-2 border hairline"
        }`}
      >
        <span
          className={`w-4 h-4 rounded-full bg-bg transition-transform ${
            checked ? "translate-x-2" : "-translate-x-2"
          }`}
        />
      </span>
      <span className="flex-1">
        <span className="block text-[13px] font-medium text-text-primary">
          {label}
        </span>
        {description && (
          <span className="block text-[11.5px] text-text-muted mt-0.5">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  rows,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows ?? 3}
          className={`w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 ${mono ? "font-mono text-[12px]" : ""}`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
        />
      )}
    </label>
  );
}

function ListEditor({
  label,
  tone,
  items,
  onChange,
}: {
  label: string;
  tone: "ok" | "bad";
  items: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  }
  function remove(i: number) {
    const arr = [...items];
    arr.splice(i, 1);
    onChange(arr);
  }
  const toneClasses =
    tone === "ok"
      ? "border-green-500/30 bg-green-500/5 text-green-300"
      : "border-danger/30 bg-danger/5 text-danger";
  return (
    <div>
      <div className={`rounded-xl px-3 py-2 mb-2 border ${toneClasses}`}>
        <span className="text-[11.5px] font-medium uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="space-y-1">
        {items.length === 0 && (
          <p className="text-text-faint text-[12px] italic">No entries yet.</p>
        )}
        {items.map((it, i) => (
          <div
            key={i}
            className="group flex items-center justify-between rounded-lg bg-panel-2/50 px-2.5 py-1.5 text-[12.5px]"
          >
            <span>{it}</span>
            <button
              onClick={() => remove(i)}
              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={tone === "ok" ? "e.g. Greet by first name" : "e.g. Never promise specific delivery dates"}
          className="flex-1 rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-accent/40"
        />
        <button
          onClick={add}
          className="rounded-lg bg-panel-2 border hairline px-2.5 text-text-muted hover:text-text-primary"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
