/**
 * Vacancy creation — a guided, conversational intake (UX3 wizard + UX4 hybrid).
 *
 * The team answers a short scripted spine one question at a time (typing OR
 * speaking, via the Groq-backed voice hook). After the spine, Gemini is asked
 * for up to two smart follow-ups (hybrid) — skipped silently if AI is down.
 * Then "Draft with AI" sends the intake and Gemini writes the WHOLE vacancy
 * (JD, requirements, work model, salary band); the user lands in the Studio to
 * review & publish. A "start from a blank form" escape hatch is always there.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Loader2,
  PencilLine,
} from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { useActiveBusiness } from "@/stores/business";
import { vacancyApi, type Followup } from "@/lib/vacancy-api";
import { VoiceField, inputCls } from "./vacancy-ui";
import { useNotify, errMsg } from "../hr-shared";

const BRANDS = [
  { key: "pixiegirl", label: "Pixie Girl Global" },
  { key: "faitlynhair", label: "Faitlyn Hair" },
];

type Kind = "text" | "brands" | "number" | "salary" | "voice";
interface Step {
  key: string;
  kind: Kind;
  q: string;
  hint?: string;
  ph?: string;
}

const SPINE: Step[] = [
  { key: "title", kind: "text", q: "What role are you hiring for?", ph: "e.g. Senior Stylist" },
  { key: "brands", kind: "brands", q: "Which brand(s) is this role for?" },
  { key: "headcount", kind: "number", q: "How many people are you hiring?", ph: "e.g. 10" },
  {
    key: "work_model",
    kind: "voice",
    q: "How will they work — on-site, hybrid or remote?",
    hint: "Mention days on-site vs off-site and the working hours.",
    ph: "e.g. On-site 5 days, 9am–6pm Mon–Fri",
  },
  {
    key: "location",
    kind: "voice",
    q: "Where is the role based?",
    hint: "City, state, country — important for on-site & hybrid roles.",
    ph: "e.g. Lekki, Lagos, Nigeria",
  },
  {
    key: "salary",
    kind: "salary",
    q: "What monthly salary range are you offering?",
    hint: "Leave blank and AI will estimate a market band you can adjust.",
  },
  {
    key: "must_haves",
    kind: "voice",
    q: "What are the must-haves and key responsibilities?",
    hint: "The 3–5 things that really matter for this role.",
    ph: "Speak the essentials…",
  },
  {
    key: "extras",
    kind: "voice",
    q: "Anything else I should know? (optional)",
    hint: "Perks, reporting line, team, probation…",
    ph: "Optional context…",
  },
];

export function VacancyWizard({
  onCreated,
  onCancel,
}: {
  onCreated: (vacancyId: string) => void;
  onCancel: () => void;
}) {
  const notify = useNotify("Vacancies: new");
  const activeBrand = useActiveBusiness()?.key;

  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<string[]>(activeBrand ? [activeBrand] : []);
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [followups, setFollowups] = useState<Followup[] | null>(null);
  const [fetchingFollowups, setFetchingFollowups] = useState(false);

  const questions: Step[] = [
    ...SPINE,
    ...(followups ?? []).map((f) => ({ key: `fu_${f.key}`, kind: "voice" as const, q: f.question })),
  ];
  const step = questions[i];
  const isLast = i === questions.length - 1;
  const spineDone = i >= SPINE.length - 1;

  const set = (key: string, v: string) => setAnswers((s) => ({ ...s, [key]: v }));
  const toggleBrand = (k: string) =>
    setBrands((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]));

  const buildIntake = () => {
    const intake: Record<string, unknown> = {
      title: answers.title,
      work_model: answers.work_model,
      location: answers.location,
      must_haves: answers.must_haves,
      notes: answers.extras,
    };
    for (const f of followups ?? []) intake[f.key] = answers[`fu_${f.key}`];
    return intake;
  };

  const create = useMutation({
    mutationFn: (useAi: boolean) =>
      vacancyApi.create({
        title: answers.title?.trim(),
        target_businesses: brands,
        headcount: Number(answers.headcount) || 1,
        salary_min: salaryMin ? Number(salaryMin) : undefined,
        salary_max: salaryMax ? Number(salaryMax) : undefined,
        use_ai: useAi,
        intake: buildIntake(),
      }),
    onSuccess: (v) => onCreated(v.vacancy_id),
    onError: (e) => notify("Couldn't create the vacancy", errMsg(e), "high"),
  });

  const canAdvance =
    step.kind === "text" ? Boolean(answers[step.key]?.trim()) : true;

  const next = async () => {
    // After the last scripted question, fetch AI follow-ups once (best-effort).
    if (spineDone && followups === null && !fetchingFollowups) {
      setFetchingFollowups(true);
      try {
        const fu = await vacancyApi.followups(buildIntake());
        setFollowups(fu || []);
        if (fu && fu.length) {
          setI(SPINE.length); // step into the first follow-up
          return;
        }
      } catch {
        setFollowups([]); // degrade to the pure scripted flow
      } finally {
        setFetchingFollowups(false);
      }
    }
    if (!isLast) setI((n) => n + 1);
  };

  const progress = Math.round(((i + 1) / questions.length) * 100);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-text-muted">
          Question {Math.min(i + 1, questions.length)} of {questions.length}
        </span>
      </div>

      {/* progress */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-text-primary/10">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent-glow" />
          <div>
            <h3 className="font-display text-lg text-text-primary">{step.q}</h3>
            {step.hint && <p className="mt-1 text-xs text-text-muted">{step.hint}</p>}
          </div>
        </div>

        <div>
          {step.kind === "text" && (
            <input
              className={inputCls}
              autoFocus
              value={answers[step.key] || ""}
              placeholder={step.ph}
              onChange={(e) => set(step.key, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canAdvance && next()}
            />
          )}

          {step.kind === "number" && (
            <input
              className={inputCls}
              type="number"
              min={1}
              autoFocus
              value={answers[step.key] || ""}
              placeholder={step.ph}
              onChange={(e) => set(step.key, e.target.value)}
            />
          )}

          {step.kind === "brands" && (
            <div className="flex flex-wrap gap-2">
              {BRANDS.map((b) => {
                const on = brands.includes(b.key);
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => toggleBrand(b.key)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      on ? "border-accent/30 bg-accent/15 text-accent-glow" : "border-line text-text-muted"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          )}

          {step.kind === "salary" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-text-muted">Minimum (₦/month)</span>
                <input className={inputCls} type="number" min={0} value={salaryMin}
                  placeholder="150000" onChange={(e) => setSalaryMin(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-text-muted">Maximum (₦/month)</span>
                <input className={inputCls} type="number" min={0} value={salaryMax}
                  placeholder="250000" onChange={(e) => setSalaryMax(e.target.value)} />
              </label>
            </div>
          )}

          {step.kind === "voice" && (
            <VoiceField
              value={answers[step.key] || ""}
              onChange={(v) => set(step.key, v)}
              placeholder={step.ph}
              rows={4}
              autoFocus
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowLeft className="h-4 w-4" />}
            disabled={i === 0}
            onClick={() => setI((n) => Math.max(0, n - 1))}
          >
            Back
          </Button>

          {isLast && followups !== null ? (
            <Button
              variant="primary"
              icon={create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              disabled={!answers.title?.trim() || create.isPending}
              onClick={() => create.mutate(true)}
            >
              {create.isPending ? "Drafting…" : "Draft the whole vacancy with AI"}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={fetchingFollowups ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              disabled={!canAdvance || fetchingFollowups}
              onClick={next}
            >
              {fetchingFollowups ? "Thinking…" : "Next"}
            </Button>
          )}
        </div>
      </Card>

      <div className="flex justify-center">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
          disabled={create.isPending}
          onClick={() => {
            if (!answers.title?.trim()) {
              notify("Add a role title first", "Even a blank vacancy needs a title.", "high");
              setI(0);
              return;
            }
            create.mutate(false);
          }}
        >
          <PencilLine className="h-3.5 w-3.5" />
          Skip the questions — start from a blank form
        </button>
      </div>
    </div>
  );
}

export default VacancyWizard;
