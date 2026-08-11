import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { MapPin, Clock, Plus, X, UploadCloud, CheckCircle2, ArrowLeft } from "lucide-react";
import {
  getVacancy,
  applyToVacancy,
  formatBand,
  locationOf,
  WORKPLACE_LABEL,
  EMPLOYMENT_LABEL,
  type VacancyDetail,
} from "@/lib/careers";

export const Route = createFileRoute("/careers/$slug")({
  component: VacancyPage,
});

const TURNSTILE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

const NOTICE_OPTIONS = ["Immediate", "2 weeks", "1 month", "2 months", "3 months+"];
const SOURCE_OPTIONS = [
  "LinkedIn", "Instagram", "Our website", "A friend / referral",
  "Job board", "WhatsApp", "Other",
];

const field =
  "w-full rounded-lg border border-taupe/25 bg-cream/[0.03] px-3.5 py-2.5 text-cream placeholder:text-cream/35 outline-none focus:border-taupe";

function VacancyPage() {
  const { slug } = Route.useParams();
  const { data: v, isLoading, isError } = useQuery({
    queryKey: ["careers", "vacancy", slug],
    queryFn: () => getVacancy(slug),
  });

  if (isLoading)
    return (
      <main className="bg-ink text-cream min-h-[60vh]">
        <div className="mx-auto max-w-[1100px] px-6 pt-32">
          <div className="h-10 w-2/3 animate-pulse rounded bg-cream/10" />
          <div className="mt-6 h-64 animate-pulse rounded-2xl bg-cream/[0.04]" />
        </div>
      </main>
    );

  if (isError || !v)
    return (
      <main className="bg-ink text-cream min-h-[60vh]">
        <div className="mx-auto max-w-[1100px] px-6 pt-32 text-center">
          <p className="font-display text-3xl">Role not found</p>
          <p className="mt-2 text-cream/60">This role may have closed.</p>
          <Link to="/careers" className="mt-6 inline-block text-taupe underline underline-offset-4">
            ← All open roles
          </Link>
        </div>
      </main>
    );

  return <VacancyDetailView v={v} slug={slug} />;
}

function VacancyDetailView({ v, slug }: { v: VacancyDetail; slug: string }) {
  const band = formatBand(v);
  const loc = locationOf(v);
  const applyRef = useRef<HTMLDivElement>(null);

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1100px] px-6 lg:px-10 pt-28 lg:pt-32 pb-24">
        <Link to="/careers" className="inline-flex items-center gap-1.5 text-sm text-taupe hover:text-cream">
          <ArrowLeft className="h-4 w-4" /> All roles
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6"
        >
          <h1 className="font-display text-4xl md:text-6xl leading-[0.98] tracking-tight text-balance">
            {v.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-cream/70">
            {v.department && <Chip>{v.department}</Chip>}
            <Chip>{EMPLOYMENT_LABEL[v.employment_type] || v.employment_type}</Chip>
            <Chip>{WORKPLACE_LABEL[v.workplace_model] || v.workplace_model}</Chip>
            {loc && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4 text-taupe" /> {loc}
              </span>
            )}
            {v.working_hours && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4 text-taupe" /> {v.working_hours}
              </span>
            )}
          </div>
          {band && <p className="mt-3 font-display text-2xl text-cream">{band}</p>}
          <button
            onClick={() => applyRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="mt-7 rounded-full bg-taupe px-7 py-3 text-sm font-semibold uppercase tracking-wider text-ink transition-transform hover:scale-[1.02]"
          >
            Apply for this role
          </button>
        </motion.header>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-10">
            {v.jd_html && (
              <div>
                <h2 className="font-display text-2xl">About the role</h2>
                <div className="careers-prose mt-4 text-cream/80" dangerouslySetInnerHTML={{ __html: v.jd_html }} />
              </div>
            )}
            {v.requirements_html && (
              <div>
                <h2 className="font-display text-2xl">What we're looking for</h2>
                <div className="careers-prose mt-4 text-cream/80" dangerouslySetInnerHTML={{ __html: v.requirements_html }} />
              </div>
            )}
          </div>

          {/* Quick facts */}
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-2xl border border-taupe/20 bg-cream/[0.02] p-6">
              <h3 className="font-display text-xl">At a glance</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <Fact label="Employment">{EMPLOYMENT_LABEL[v.employment_type] || v.employment_type}</Fact>
                <Fact label="Workplace">{WORKPLACE_LABEL[v.workplace_model] || v.workplace_model}</Fact>
                {(v.days_on_site != null || v.days_off_site != null || v.days_off != null) && (
                  <Fact label="Days">
                    {[
                      v.days_on_site != null ? `${v.days_on_site} on-site` : null,
                      v.days_off_site != null ? `${v.days_off_site} off-site` : null,
                      v.days_off != null ? `${v.days_off} off` : null,
                    ].filter(Boolean).join(" · ")}
                  </Fact>
                )}
                {loc && <Fact label="Location">{loc}</Fact>}
                {v.probation_months != null && <Fact label="Probation">{v.probation_months} months</Fact>}
                {band && <Fact label="Salary">{band}</Fact>}
                {v.target_start_date && <Fact label="Start">{v.target_start_date}</Fact>}
              </dl>
            </div>
          </aside>
        </div>

        <div ref={applyRef} className="mt-20 scroll-mt-24">
          <ApplicationForm v={v} slug={slug} />
        </div>
      </section>
    </main>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-taupe/30 px-3 py-1 text-xs uppercase tracking-wider text-cream/70">{children}</span>;
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-taupe/10 pb-2 last:border-0">
      <dt className="text-cream/50">{label}</dt>
      <dd className="text-right text-cream/90">{children}</dd>
    </div>
  );
}

// ── The application form ───────────────────────────────────
interface Link_ { label: string; url: string }
interface Skill_ { skill: string; years: string }

function ApplicationForm({ v, slug }: { v: VacancyDetail; slug: string }) {
  const cfg = v.apply_config;
  const [f, setF] = useState({
    full_name: "", email: "", phone: "", address: "",
    cover_letter_text: "", notice_period: "", desired_salary: "", source: "",
    company_website: "", // honeypot
  });
  const [cv, setCv] = useState<File | null>(null);
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [workImages, setWorkImages] = useState<File[]>([]);
  const [links, setLinks] = useState<Link_[]>([{ label: "", url: "" }]);
  const [skills, setSkills] = useState<Skill_[]>([{ skill: "", years: "" }]);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);

  const set = (k: keyof typeof f, val: string) => setF((s) => ({ ...s, [k]: val }));

  // Turnstile — only when a site key is configured (else the backend skips it).
  useEffect(() => {
    if (!TURNSTILE_KEY) return;
    if (document.querySelector('script[data-turnstile]')) return;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-turnstile", "1");
    document.head.appendChild(s);
  }, []);

  const cleanLinks = () => links.filter((l) => l.url.trim());
  const cleanSkills = () => skills.filter((s) => s.skill.trim()).map((s) => ({ skill: s.skill.trim(), years: s.years.trim() }));

  const canSubmit =
    f.full_name.trim() && f.email.trim() && f.phone.trim() && f.address.trim() && cv &&
    (!cfg.require_cover_letter || f.cover_letter_text.trim() || coverFile) &&
    (!cfg.require_portfolio_links || cleanLinks().length) &&
    status !== "submitting";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("submitting");
    setError("");
    try {
      const fd = new FormData();
      fd.append("full_name", f.full_name);
      fd.append("email", f.email);
      fd.append("phone", f.phone);
      fd.append("address", f.address);
      if (f.cover_letter_text) fd.append("cover_letter_text", f.cover_letter_text);
      if (f.notice_period) fd.append("notice_period", f.notice_period);
      if (f.desired_salary) {
        fd.append("desired_salary", f.desired_salary.replace(/[^\d.]/g, ""));
        fd.append("desired_salary_text", f.desired_salary);
      }
      if (f.source) fd.append("source", f.source);
      fd.append("portfolio_links", JSON.stringify(cleanLinks()));
      fd.append("skills", JSON.stringify(cleanSkills()));
      fd.append("company_website", f.company_website); // honeypot (should be empty)
      const token =
        (formRef.current?.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || "";
      if (token) fd.append("captcha_token", token);
      if (cv) fd.append("cv", cv);
      if (headshot) fd.append("headshot", headshot);
      if (coverFile) fd.append("cover_letter_file", coverFile);
      workImages.slice(0, cfg.max_work_images).forEach((img) => fd.append("work_images", img));

      await applyToVacancy(slug, fd);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError((err as { userMessage?: string })?.userMessage || "Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-taupe/25 bg-cream/[0.03] p-10 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-taupe" />
        <h3 className="mt-4 font-display text-3xl">Application received</h3>
        <p className="mx-auto mt-3 max-w-md text-cream/70">
          Thank you, {f.full_name.split(" ")[0] || "and welcome"}. We've received your application for{" "}
          <span className="text-cream">{v.title}</span> and sent a confirmation to {f.email}. We'll be in touch if it's a match.
        </p>
        <Link to="/careers" className="mt-6 inline-block text-taupe underline underline-offset-4">
          Browse other roles
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-taupe/20 bg-cream/[0.02] p-6 md:p-8">
      <h2 className="font-display text-3xl">Apply</h2>
      <p className="mt-2 text-sm text-cream/60">Fields marked * are required.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <L label="Full name *"><input className={field} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} /></L>
        <L label="Email *"><input className={field} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></L>
        <L label="Phone *"><input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></L>
        <L label="Notice period"><select className={field} value={f.notice_period} onChange={(e) => set("notice_period", e.target.value)}>
          <option value="">— select —</option>
          {NOTICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select></L>
      </div>
      <L label="Physical address *" className="mt-4"><input className={field} value={f.address} onChange={(e) => set("address", e.target.value)} /></L>

      {/* CV + optional media */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FileField label="CV / résumé *" hint="PDF, Word or a clear image" file={cv} onPick={setCv}
          accept=".pdf,.doc,.docx,image/*" />
        {cfg.request_headshot && (
          <FileField label="Corporate headshot" hint="A professional photo (optional)" file={headshot}
            onPick={setHeadshot} accept="image/*" />
        )}
      </div>

      {/* Cover letter */}
      <L label={`Cover letter${cfg.require_cover_letter ? " *" : ""}`} className="mt-4">
        <textarea className={field} rows={4} value={f.cover_letter_text}
          placeholder="Tell us why you're a great fit…" onChange={(e) => set("cover_letter_text", e.target.value)} />
      </L>
      <div className="mt-2">
        <FileField label="…or upload a cover letter" hint="Optional" file={coverFile} onPick={setCoverFile}
          accept=".pdf,.doc,.docx,image/*" compact />
      </div>

      {/* Skills */}
      <Repeater
        className="mt-6"
        label="Skills & experience"
        rows={skills}
        onAdd={() => setSkills((s) => [...s, { skill: "", years: "" }])}
        onRemove={(i) => setSkills((s) => s.filter((_, x) => x !== i))}
        render={(row, i) => (
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <input className={field} placeholder="e.g. Wig installation" value={row.skill}
              onChange={(e) => setSkills((s) => s.map((r, x) => (x === i ? { ...r, skill: e.target.value } : r)))} />
            <input className={field} placeholder="yrs" value={row.years}
              onChange={(e) => setSkills((s) => s.map((r, x) => (x === i ? { ...r, years: e.target.value } : r)))} />
          </div>
        )}
      />

      {/* Portfolio links */}
      <Repeater
        className="mt-6"
        label={`Portfolio & professional links${cfg.require_portfolio_links ? " *" : ""}`}
        rows={links}
        onAdd={() => setLinks((l) => [...l, { label: "", url: "" }])}
        onRemove={(i) => setLinks((l) => l.filter((_, x) => x !== i))}
        render={(row, i) => (
          <div className="grid grid-cols-[130px_1fr] gap-2">
            <input className={field} placeholder="LinkedIn / IG…" value={row.label}
              onChange={(e) => setLinks((l) => l.map((r, x) => (x === i ? { ...r, label: e.target.value } : r)))} />
            <input className={field} placeholder="https://…" value={row.url}
              onChange={(e) => setLinks((l) => l.map((r, x) => (x === i ? { ...r, url: e.target.value } : r)))} />
          </div>
        )}
      />

      {/* Work-sample images */}
      {cfg.request_work_images && (
        <div className="mt-6">
          <p className="text-sm text-cream/70">Work samples <span className="text-cream/40">(up to {cfg.max_work_images} images)</span></p>
          <div className="mt-2 flex flex-wrap gap-3">
            {workImages.map((img, i) => (
              <div key={i} className="relative">
                <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-lg border border-taupe/25 bg-cream/[0.04] text-[10px] text-cream/50">
                  {img.type.startsWith("image/") ? (
                    <img src={URL.createObjectURL(img)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "file"
                  )}
                </div>
                <button type="button" onClick={() => setWorkImages((w) => w.filter((_, x) => x !== i))}
                  className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-ink border border-taupe/40 text-cream">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {workImages.length < cfg.max_work_images && (
              <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-taupe/40 text-taupe hover:border-taupe">
                <Plus className="h-5 w-5" />
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setWorkImages((w) => [...w, file].slice(0, cfg.max_work_images));
                    e.target.value = "";
                  }} />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Desired salary + source */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <L label="Desired salary (₦/month)"><input className={field} value={f.desired_salary}
          placeholder="e.g. 250,000" onChange={(e) => set("desired_salary", e.target.value)} /></L>
        <L label="How did you hear about us?"><select className={field} value={f.source} onChange={(e) => set("source", e.target.value)}>
          <option value="">— select —</option>
          {SOURCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select></L>
      </div>

      {/* Honeypot — visually hidden, off-screen; bots fill it, humans don't. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
        <label>Company website<input tabIndex={-1} autoComplete="off" value={f.company_website}
          onChange={(e) => set("company_website", e.target.value)} /></label>
      </div>

      {TURNSTILE_KEY && <div className="cf-turnstile mt-6" data-sitekey={TURNSTILE_KEY} />}

      {status === "error" && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-8 w-full rounded-full bg-taupe px-8 py-3.5 text-sm font-semibold uppercase tracking-wider text-ink transition-transform enabled:hover:scale-[1.01] disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}

function L({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="mb-1.5 block text-sm text-cream/70">{label}</span>
      {children}
    </label>
  );
}

function FileField({
  label, hint, file, onPick, accept, compact,
}: {
  label: string; hint?: string; file: File | null; onPick: (f: File | null) => void; accept?: string; compact?: boolean;
}) {
  return (
    <label className="block cursor-pointer">
      <span className="mb-1.5 block text-sm text-cream/70">{label}</span>
      <div className={`flex items-center gap-3 rounded-lg border border-dashed border-taupe/35 bg-cream/[0.02] px-3.5 ${compact ? "py-2" : "py-3.5"} hover:border-taupe`}>
        <UploadCloud className="h-5 w-5 shrink-0 text-taupe" />
        <span className="min-w-0 flex-1 truncate text-sm text-cream/80">
          {file ? file.name : hint || "Choose a file"}
        </span>
        {file && (
          <button type="button" onClick={(e) => { e.preventDefault(); onPick(null); }} className="text-cream/50 hover:text-cream">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <input type="file" accept={accept} className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] || null)} />
    </label>
  );
}

function Repeater<T>({
  label, rows, render, onAdd, onRemove, className,
}: {
  label: string;
  rows: T[];
  render: (row: T, i: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (i: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-cream/70">{label}</span>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-taupe hover:text-cream">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">{render(row, i)}</div>
            {rows.length > 1 && (
              <button type="button" onClick={() => onRemove(i)} className="text-cream/40 hover:text-cream">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
