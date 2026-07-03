import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, Upload } from "lucide-react";
import { publicApi, type Question, type ApiError } from "@/lib/api";

/**
 * Application wizard (§6.26 Q5–Q8): profile → portfolio & socials →
 * brand-alignment questionnaire (config-driven, rendered from the API) →
 * ID/business documents → review & submit. One multipart POST at the end.
 */
export const Route = createFileRoute("/apply")({
  head: () => ({
    meta: [
      { title: "Apply — Pixie Girl Stylist Partner Programme" },
      {
        name: "description",
        content:
          "Apply to join the Pixie Girl Global Stylist Partner Programme — vetting, certification, a verifiable badge and routed clients.",
      },
    ],
  }),
  component: ApplyWizard,
});

const STEPS = ["Profile", "Portfolio", "Questionnaire", "Verification", "Review"] as const;

interface FormState {
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  country_code: string;
  city: string;
  state: string;
  bio: string;
  portfolio_url: string;
  instagram_url: string;
  youtube_url: string;
  website_url: string;
  answers: Record<string, string | boolean>;
  id_doc: File | null;
  business_doc: File | null;
}

const EMPTY: FormState = {
  display_name: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  whatsapp_number: "",
  country_code: "NG",
  city: "",
  state: "",
  bio: "",
  portfolio_url: "",
  instagram_url: "",
  youtube_url: "",
  website_url: "",
  answers: {},
  id_doc: null,
  business_doc: null,
};

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="micro block mb-1.5">
        {label}
        {required && <span className="text-accent-glow"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-cream-faint mt-1">{hint}</p>}
    </div>
  );
}

function urlOk(v: string) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function ApplyWizard() {
  const questions = useQuery({
    queryKey: ["apply-questions"],
    queryFn: publicApi.questions,
  });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      const scalar: (keyof FormState)[] = [
        "display_name",
        "first_name",
        "last_name",
        "email",
        "phone",
        "whatsapp_number",
        "country_code",
        "city",
        "state",
        "bio",
        "portfolio_url",
        "instagram_url",
        "youtube_url",
        "website_url",
      ];
      for (const k of scalar) {
        const v = form[k];
        if (typeof v === "string" && v.trim()) fd.set(k, v.trim());
      }
      fd.set(
        "answers",
        JSON.stringify(
          Object.entries(form.answers).map(([question_id, answer]) => ({
            question_id,
            answer,
          })),
        ),
      );
      if (form.id_doc) fd.append("id_doc", form.id_doc);
      if (form.business_doc) fd.append("business_doc", form.business_doc);
      return publicApi.apply(fd);
    },
  });

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return (
          form.display_name.trim().length > 0 &&
          /.+@.+\..+/.test(form.email) &&
          form.city.trim().length > 0 &&
          form.country_code.trim().length >= 2
        );
      case 1:
        return (
          [form.portfolio_url, form.instagram_url, form.youtube_url, form.website_url].every(
            urlOk,
          ) &&
          Boolean(
            form.portfolio_url || form.instagram_url || form.youtube_url || form.website_url,
          )
        );
      case 2:
        return (questions.data ?? [])
          .filter((q) => q.is_required)
          .every((q) => {
            const a = form.answers[q.question_id];
            return a !== undefined && a !== "";
          });
      case 3:
        return true; // docs encouraged, not blocking (backend accepts without)
      default:
        return true;
    }
  }, [step, form, questions.data]);

  if (submit.isSuccess) {
    return (
      <div className="mx-auto max-w-xl px-5 py-28 text-center">
        <CheckCircle2 className="w-12 h-12 mx-auto text-success mb-5" />
        <h1 className="font-display text-[34px] mb-3">Application received.</h1>
        <p className="text-[14px] text-cream-muted leading-relaxed mb-2">
          Thank you, {form.first_name || form.display_name}. Our team reviews
          every application personally — you'll hear from us by email once your
          review is complete.
        </p>
        <p className="font-mono text-[13px] text-cream-faint mb-10">
          Reference: {submit.data.partner_code}
        </p>
        <Link to="/" className="btn-ghost no-underline">
          Back to the programme
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <p className="micro mb-2">Stylist Partner Programme</p>
      <h1 className="font-display text-[32px] mb-8">Apply to partner with Pixie.</h1>

      {/* Stepper */}
      <div className="flex gap-1.5 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div
              className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-cream/10"}`}
            />
            <p
              className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${
                i === step ? "text-cream" : "text-cream-faint"
              } hidden sm:block`}
            >
              {s}
            </p>
          </div>
        ))}
      </div>

      <div className="glass rounded-xl2 p-6 sm:p-8 space-y-5">
        {step === 0 && (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="First name">
                <input className="input" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
              </Field>
              <Field label="Last name">
                <input className="input" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
              </Field>
            </div>
            <Field label="Studio / display name" required hint="How you'd appear in the partner directory.">
              <input className="input" placeholder="e.g. Ada Lagos Styles" value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Email" required>
                <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone / WhatsApp">
                <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="City" required>
                <input className="input" placeholder="Lagos" value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State / region">
                <input className="input" value={form.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
              <Field label="Country code" required hint="ISO, e.g. NG, GH, US">
                <input className="input font-mono uppercase" maxLength={3} value={form.country_code} onChange={(e) => set("country_code", e.target.value.toUpperCase())} />
              </Field>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-[13px] text-cream-muted -mt-1">
              Show us the work. At least one link is required — your strongest
              surface first.
            </p>
            <Field label="Portfolio URL">
              <input className="input" placeholder="https://…" value={form.portfolio_url} onChange={(e) => set("portfolio_url", e.target.value)} />
            </Field>
            <Field label="Instagram">
              <input className="input" placeholder="https://instagram.com/…" value={form.instagram_url} onChange={(e) => set("instagram_url", e.target.value)} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="YouTube">
                <input className="input" placeholder="https://youtube.com/…" value={form.youtube_url} onChange={(e) => set("youtube_url", e.target.value)} />
              </Field>
              <Field label="Website">
                <input className="input" placeholder="https://…" value={form.website_url} onChange={(e) => set("website_url", e.target.value)} />
              </Field>
            </div>
            <Field label="About you & your craft" hint="Years of practice, specialities, what you're known for.">
              <textarea className="input min-h-[110px]" value={form.bio} onChange={(e) => set("bio", e.target.value)} />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            {questions.isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-cream/5 animate-pulse" />
                ))}
              </div>
            )}
            {questions.isError && (
              <p className="text-danger text-[13px]">
                Couldn't load the questionnaire —{" "}
                <button className="underline" onClick={() => questions.refetch()}>
                  retry
                </button>
                .
              </p>
            )}
            {(questions.data ?? []).map((q: Question) => (
              <Field key={q.question_id} label={q.question} required={q.is_required} hint={q.help_text ?? undefined}>
                {q.field_type === "textarea" && (
                  <textarea
                    className="input min-h-[100px]"
                    value={(form.answers[q.question_id] as string) ?? ""}
                    onChange={(e) =>
                      set("answers", { ...form.answers, [q.question_id]: e.target.value })
                    }
                  />
                )}
                {q.field_type === "text" && (
                  <input
                    className="input"
                    value={(form.answers[q.question_id] as string) ?? ""}
                    onChange={(e) =>
                      set("answers", { ...form.answers, [q.question_id]: e.target.value })
                    }
                  />
                )}
                {q.field_type === "select" && (
                  <select
                    className="input"
                    value={(form.answers[q.question_id] as string) ?? ""}
                    onChange={(e) =>
                      set("answers", { ...form.answers, [q.question_id]: e.target.value })
                    }
                  >
                    <option value="">Choose…</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
                {q.field_type === "boolean" && (
                  <div className="flex gap-2">
                    {[
                      ["Yes", true],
                      ["No", false],
                    ].map(([label, v]) => (
                      <button
                        key={String(v)}
                        type="button"
                        onClick={() =>
                          set("answers", { ...form.answers, [q.question_id]: v as boolean })
                        }
                        className={
                          form.answers[q.question_id] === v ? "btn-primary !py-2 !px-5" : "btn-ghost !py-2 !px-5"
                        }
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            ))}
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-[13px] text-cream-muted -mt-1">
              Verification documents speed up your review. Images or PDF, up to
              10&nbsp;MB each.
            </p>
            {(
              [
                ["id_doc", "Government ID", "Passport, national ID or driver's licence."],
                ["business_doc", "Business / salon registration", "Optional — strengthens Pro/Elite candidacy."],
              ] as const
            ).map(([key, label, hint]) => (
              <Field key={key} label={label} hint={hint}>
                <label className="input flex items-center gap-3 cursor-pointer">
                  <Upload className="w-4 h-4 text-cream-faint shrink-0" />
                  <span className="text-[13px] text-cream-muted truncate">
                    {form[key]?.name ?? "Choose file…"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => set(key, e.target.files?.[0] ?? null)}
                  />
                </label>
              </Field>
            ))}
          </>
        )}

        {step === 4 && (
          <>
            <p className="text-[13px] text-cream-muted -mt-1">
              A human reviews everything below. Auto-approval is never used.
            </p>
            <div className="space-y-2 text-[13px]">
              {[
                ["Name", `${form.display_name} (${form.first_name} ${form.last_name})`.trim()],
                ["Contact", [form.email, form.phone].filter(Boolean).join(" · ")],
                ["Location", `${form.city}${form.state ? `, ${form.state}` : ""} · ${form.country_code}`],
                [
                  "Links",
                  [form.portfolio_url, form.instagram_url, form.youtube_url, form.website_url]
                    .filter(Boolean)
                    .join("  ·  ") || "—",
                ],
                [
                  "Questionnaire",
                  `${Object.keys(form.answers).length} of ${(questions.data ?? []).length} answered`,
                ],
                [
                  "Documents",
                  [form.id_doc?.name, form.business_doc?.name].filter(Boolean).join(" · ") ||
                    "None attached",
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 py-2 border-b border-line last:border-0">
                  <span className="micro w-32 shrink-0 pt-0.5">{k}</span>
                  <span className="text-cream-muted break-words min-w-0">{v}</span>
                </div>
              ))}
            </div>
            {submit.isError && (
              <p className="text-danger text-[13px]">
                {(submit.error as ApiError).userMessage}
              </p>
            )}
          </>
        )}

        {/* Nav */}
        <div className="flex items-center justify-between pt-2">
          <button
            className="btn-ghost !py-2.5"
            style={{ visibility: step === 0 ? "hidden" : "visible" }}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              className="btn-primary"
              disabled={!stepValid}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              className="btn-primary"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Submitting…" : "Submit application"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
