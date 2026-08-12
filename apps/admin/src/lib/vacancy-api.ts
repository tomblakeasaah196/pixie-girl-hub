/**
 * Vacancy API (HR & Staff → Vacancies) — backend module: `recruitment`.
 *
 * The vacancy-first half of hiring: create a vacancy (conversational AI intake),
 * publish it to the public Careers page, track applicants through a pipeline
 * with AI match scoring + the 5-question rubric, then hand a winner to the
 * existing Offer Studio ("Move to Offered").
 */

import { api } from "@/lib/api";

export type VacancyStatus = "draft" | "published" | "paused" | "closed" | "filled";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type WorkplaceModel = "remote" | "hybrid" | "on_site";
export type ApplicationStage =
  | "new" | "screening" | "shortlisted" | "interviewed" | "offered" | "rejected" | "withdrawn";

export interface Vacancy {
  vacancy_id: string;
  business: string;
  title: string;
  slug: string | null;
  org_unit_id: string | null;
  department: string | null;
  role_id: string | null;
  employment_type: EmploymentType;
  workplace_model: WorkplaceModel;
  days_on_site: number | null;
  days_off_site: number | null;
  days_off: number | null;
  working_hours: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  probation_months: number | null;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_currency: string;
  salary_period: string;
  salary_hidden: boolean;
  jd_markdown: string | null;
  requirements_markdown: string | null;
  target_start_date: string | null;
  headcount: number;
  target_businesses: string[];
  hiring_manager_position_id: string | null;
  reviewer_position_ids: string[];
  status: VacancyStatus;
  apply_config: ApplyConfig;
  intake: Record<string, unknown>;
  ai_provider: string | null;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  /** Absolute public Careers-page URL on the brand's storefront (GET one only,
   *  null when unpublished or no storefront domain is configured). */
  public_careers_url?: string | null;
  /** On the list endpoint only. */
  application_count?: number;
  new_count?: number;
}

export interface ApplyConfig {
  request_headshot?: boolean;
  request_work_images?: boolean;
  max_work_images?: number;
  require_cover_letter?: boolean;
  require_portfolio_links?: boolean;
}

export interface ScreeningQuestion {
  question_id: string;
  vacancy_id: string;
  position: number;
  question: string;
  rationale: string | null;
  answer: string | null;
  weight: number;
  answered_by: string | null;
  answered_at: string | null;
}

export interface PortfolioLink { label?: string; url: string }
export interface SkillEntry { skill: string; years?: string | number }

export interface Application {
  application_id: string;
  vacancy_id: string;
  business: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  cover_letter_text: string | null;
  cover_letter_key: string | null;
  cv_key: string | null;
  cv_filename: string | null;
  cv_mime: string | null;
  cv_text: string | null;
  headshot_key: string | null;
  portfolio_links: PortfolioLink[];
  notice_period: string | null;
  desired_salary: number | string | null;
  desired_salary_text: string | null;
  skills: SkillEntry[];
  source: string | null;
  stage: ApplicationStage;
  match_score: number | string | null;
  match_summary: string | null;
  match_stage: string | null;
  offer_id: string | null;
  applied_at: string;
  // list enrichment
  avg_rating?: number;
  rating_count?: number;
  media_count?: number;
  note_count?: number;
}

export interface ApplicationMedia {
  media_id: string;
  storage_key: string;
  filename: string | null;
  mime: string | null;
  caption: string | null;
  display_order: number;
}
export interface ApplicationNote {
  note_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}
export interface ApplicationScore {
  score_id: string;
  score: number | string;
  summary: string | null;
  breakdown: Record<string, unknown>;
  scoring_stage: "provisional" | "rubric";
  ai_provider: string | null;
  created_at: string;
}
export interface RatingSummary { avg_stars: number; rating_count: number; my_stars: number | null }

/** One row of the interview scorecard: a screening question + how this
 *  candidate was rated against it. */
export interface ScorecardItem {
  question_id: string;
  position: number;
  question: string;
  rationale: string | null;
  avg_stars: number;
  rating_count: number;
  my_stars: number | null;
  my_note: string | null;
}

export interface ApplicationDetail extends Application {
  media: ApplicationMedia[];
  notes: ApplicationNote[];
  scores: ApplicationScore[];
  ratings: RatingSummary;
  scorecard: ScorecardItem[];
}

export interface VacancyOptions {
  departments: { unit_id: string; display_name: string }[];
  positions: { position_id: string; display_name: string; role_id: string | null; unit_name: string | null; role_name: string | null }[];
  roles: { role_id: string; role_name: string }[];
}

export interface Followup { key: string; question: string }

export interface CreateVacancyBody {
  title: string;
  target_businesses?: string[];
  headcount?: number;
  use_ai?: boolean;
  intake?: Record<string, unknown>;
  // explicit overrides (all optional)
  department?: string;
  org_unit_id?: string | null;
  role_id?: string | null;
  employment_type?: EmploymentType;
  workplace_model?: WorkplaceModel;
  salary_min?: number;
  salary_max?: number;
  salary_hidden?: boolean;
  jd_markdown?: string;
  requirements_markdown?: string;
}

export const vacancyApi = {
  options: () => api.get<VacancyOptions>("/recruitment/vacancy-options"),
  followups: (intake: Record<string, unknown>) =>
    api.post<Followup[]>("/recruitment/vacancies/intake/followups", { intake }),

  list: (status?: string) =>
    api.get<Vacancy[]>(`/recruitment/vacancies${status ? `?status=${status}` : ""}`),
  get: (id: string) => api.get<Vacancy>(`/recruitment/vacancies/${id}`),
  create: (body: CreateVacancyBody) => api.post<Vacancy>("/recruitment/vacancies", body),
  update: (id: string, patch: Partial<Vacancy>) =>
    api.patch<Vacancy>(`/recruitment/vacancies/${id}`, patch),
  setStatus: (id: string, status: VacancyStatus) =>
    api.post<Vacancy>(`/recruitment/vacancies/${id}/status`, { status }),
  remove: (id: string) => api.delete<void>(`/recruitment/vacancies/${id}`),

  // Screening questions (the rubric)
  generateQuestions: (id: string) =>
    api.post<ScreeningQuestion[]>(`/recruitment/vacancies/${id}/questions/generate`),
  listQuestions: (id: string) =>
    api.get<ScreeningQuestion[]>(`/recruitment/vacancies/${id}/questions`),
  answerQuestions: (
    id: string,
    answers: { question_id: string; answer?: string; weight?: number }[],
  ) => api.put<ScreeningQuestion[]>(`/recruitment/vacancies/${id}/questions`, { answers }),

  // Applications
  listApplications: (id: string, stage?: string) =>
    api.get<Application[]>(
      `/recruitment/vacancies/${id}/applications${stage ? `?stage=${stage}` : ""}`,
    ),
  addApplication: (id: string, body: Record<string, unknown>) =>
    api.post<Application>(`/recruitment/vacancies/${id}/applications`, body),
  scoreAll: (id: string) =>
    api.post<{ scored: number; failed: number; total: number }>(
      `/recruitment/vacancies/${id}/score-all`,
    ),

  getApplication: (appId: string) =>
    api.get<ApplicationDetail>(`/recruitment/applications/${appId}`),
  setStage: (appId: string, stage: ApplicationStage) =>
    api.post<Application>(`/recruitment/applications/${appId}/stage`, { stage }),
  addNote: (appId: string, body: string) =>
    api.post<ApplicationNote>(`/recruitment/applications/${appId}/notes`, { body }),
  setRating: (appId: string, stars: number) =>
    api.put<RatingSummary>(`/recruitment/applications/${appId}/rating`, { stars }),
  setQuestionRating: (appId: string, questionId: string, stars: number, note?: string) =>
    api.put<{ scorecard: ScorecardItem[]; ratings: RatingSummary }>(
      `/recruitment/applications/${appId}/questions/${questionId}/rating`,
      { stars, note },
    ),
  score: (appId: string) =>
    api.post<Application & { score: ApplicationScore }>(
      `/recruitment/applications/${appId}/score`,
    ),
  moveToOffered: (appId: string) =>
    api.post<{ application: Application; offer_id: string; already?: boolean }>(
      `/recruitment/applications/${appId}/offer`,
    ),
  fileUrl: (appId: string, kind: "cv" | "headshot" | "cover_letter" | "media", mediaId?: string) =>
    `/recruitment/applications/${appId}/file/${kind}${mediaId ? `?media_id=${mediaId}` : ""}`,
  downloadFile: (appId: string, kind: "cv" | "headshot" | "cover_letter" | "media", name: string, mediaId?: string) =>
    api.download(
      `/recruitment/applications/${appId}/file/${kind}?download=1${mediaId ? `&media_id=${mediaId}` : ""}`,
      name,
    ),
};
