/**
 * Shared UI atoms for the Vacancies feature — a voice-enabled text field
 * (Groq Whisper → browser fallback, reusing the Praxis voice hook), a tiny
 * safe markdown renderer for the JD preview, and small formatters/badges.
 */

import { useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type {
  VacancyStatus,
  ApplicationStage,
  WorkplaceModel,
} from "@/lib/vacancy-api";

export const inputCls =
  "w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary outline-none focus:border-accent/40";

// ── Voice-enabled field ────────────────────────────────────
/**
 * A textarea (or input) with a mic button. Speaking appends the transcript to
 * whatever is already typed, so voice and keyboard mix freely. Degrades to the
 * browser recognizer, then to keyboard-only, exactly like the Praxis composer.
 */
export function VoiceField({
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const voice = useVoiceInput({
    onFinal: (t) => onChange(value ? `${value.trim()} ${t}` : t),
  });
  return (
    <div className="relative">
      <textarea
        className={`${inputCls} pr-11`}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {voice.supported && (
        <button
          type="button"
          onClick={() => (voice.active ? voice.stop() : voice.start())}
          title={voice.active ? "Stop" : "Speak your answer"}
          className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border transition-colors ${
            voice.active
              ? "border-accent/40 bg-accent/20 text-accent-glow"
              : "border-line text-text-muted hover:text-text-primary"
          }`}
        >
          {voice.transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : voice.active ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
      )}
      {voice.active && (
        <div className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
          {voice.mode === "server" ? `● ${voice.seconds}s` : "listening…"}
        </div>
      )}
    </div>
  );
}

// ── Tiny safe markdown → HTML (headings, bold, italics, lists, paras) ──
function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal, dependency-free markdown for internal previews. Escapes first. */
export function miniMarkdown(md: string): string {
  const lines = esc(md || "").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length + 1; // # → h2, so it never fights the page h1
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

// ── Formatters ─────────────────────────────────────────────
const NGN = new Intl.NumberFormat("en-NG");

export function fmtSalary(
  min: number | string | null,
  max: number | string | null,
  currency = "NGN",
  period = "month",
): string {
  const lo = min !== null && min !== "" && !isNaN(Number(min)) ? Number(min) : null;
  const hi = max !== null && max !== "" && !isNaN(Number(max)) ? Number(max) : null;
  if (lo === null && hi === null) return "—";
  const sym = currency === "NGN" ? "₦" : `${currency} `;
  const body =
    lo !== null && hi !== null
      ? `${sym}${NGN.format(lo)} – ${sym}${NGN.format(hi)}`
      : `${sym}${NGN.format((lo ?? hi) as number)}`;
  return `${body} / ${period}`;
}

export const WORKPLACE_LABEL: Record<WorkplaceModel, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  on_site: "On-site",
};

export const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

// ── Badges ─────────────────────────────────────────────────
export const VACANCY_TONE: Record<VacancyStatus, "neutral" | "info" | "success" | "warn" | "accent"> = {
  draft: "neutral",
  published: "success",
  paused: "warn",
  closed: "neutral",
  filled: "accent",
};

export const STAGE_ORDER: ApplicationStage[] = [
  "new",
  "screening",
  "shortlisted",
  "interviewed",
  "offered",
  "rejected",
];

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  new: "New",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interviewed: "Interviewed",
  offered: "Offered",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STAGE_TONE: Record<ApplicationStage, "neutral" | "info" | "accent" | "success" | "warn"> = {
  new: "info",
  screening: "info",
  shortlisted: "accent",
  interviewed: "accent",
  offered: "success",
  rejected: "warn",
  withdrawn: "neutral",
};

/** Score → tone for the coloured ring/number. */
export function scoreTone(score: number | string | null): string {
  const n = score === null || score === "" ? null : Number(score);
  if (n === null || isNaN(n)) return "text-text-faint";
  if (n >= 75) return "text-success";
  if (n >= 50) return "text-accent-glow";
  return "text-text-muted";
}

// ── Star rating ────────────────────────────────────────────
export function StarRating({
  value,
  onChange,
  big,
  readOnly,
}: {
  value: number;
  onChange?: (n: number) => void;
  big?: boolean;
  readOnly?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const dim = big ? "h-5 w-5" : "h-4 w-4";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onMouseEnter={() => !readOnly && setHover(n)}
            onMouseLeave={() => !readOnly && setHover(0)}
            onClick={() => onChange?.(n)}
            className={`${readOnly ? "cursor-default" : "cursor-pointer"} leading-none`}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            <svg
              className={`${dim} ${on ? "fill-accent-glow text-accent-glow" : "fill-transparent text-text-faint"}`}
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.5l2.2 4.46 4.92.72-3.56 3.47.84 4.9L11.48 17l-4.4 2.32.84-4.9L4.36 8.68l4.92-.72 2.2-4.46z"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
