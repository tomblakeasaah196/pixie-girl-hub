import { api, type ApiContext } from "./api";

/*
 * Careers data layer — the public job board + application form. Talks to the
 * Hub's /api/public/careers endpoints (brand resolved from the host). Uploads
 * ride multipart via api.postForm.
 */

export interface VacancyCard {
  title: string;
  slug: string;
  department: string | null;
  employment_type: string;
  workplace_model: string;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_currency: string;
  salary_period: string;
  salary_hidden: boolean;
  target_start_date: string | null;
  published_at: string | null;
}

export interface ApplyConfig {
  request_headshot: boolean;
  request_work_images: boolean;
  max_work_images: number;
  require_cover_letter: boolean;
  require_portfolio_links: boolean;
}

export interface VacancyDetail extends VacancyCard {
  jd_html: string;
  requirements_html: string;
  days_on_site: number | null;
  days_off_site: number | null;
  days_off: number | null;
  working_hours: string | null;
  probation_months: number | null;
  headcount: number;
  apply_config: ApplyConfig;
}

export const listVacancies = (ctx?: ApiContext) =>
  api.get<VacancyCard[]>(`/api/public/careers`, ctx);

export const getVacancy = (slug: string, ctx?: ApiContext) =>
  api.get<VacancyDetail>(`/api/public/careers/${slug}`, ctx);

export const applyToVacancy = (slug: string, form: FormData, ctx?: ApiContext) =>
  api.postForm<{ ok: boolean; application_id?: string }>(
    `/api/public/careers/${slug}/apply`,
    form,
    ctx,
  );

// ── display helpers ────────────────────────────────────────
const NGN = new Intl.NumberFormat("en-NG");

export function formatBand(v: {
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_currency: string;
  salary_period: string;
  salary_hidden: boolean;
}): string | null {
  if (v.salary_hidden) return null;
  const lo = v.salary_min != null && v.salary_min !== "" ? Number(v.salary_min) : null;
  const hi = v.salary_max != null && v.salary_max !== "" ? Number(v.salary_max) : null;
  if (lo == null && hi == null) return null;
  const sym = v.salary_currency === "NGN" ? "₦" : `${v.salary_currency} `;
  const body =
    lo != null && hi != null
      ? `${sym}${NGN.format(lo)} – ${sym}${NGN.format(hi)}`
      : `${sym}${NGN.format((lo ?? hi) as number)}`;
  return `${body} / ${v.salary_period}`;
}

export const WORKPLACE_LABEL: Record<string, string> = {
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

export function locationOf(v: {
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
}): string {
  return [v.location_city, v.location_state, v.location_country].filter(Boolean).join(", ");
}
