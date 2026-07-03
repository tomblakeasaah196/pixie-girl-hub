/** Stylist Partner Programme (§6.26) — API shapes (PR1 backend contract). */

export type PartnerStatus =
  | "applicant"
  | "vetting"
  | "vetted"
  | "certified"
  | "suspended"
  | "terminated";

export interface Partner {
  stylist_id: string;
  partner_code: string;
  contact_id: string;
  display_name: string;
  status: PartnerStatus;
  application_received_at: string;
  vetted_at: string | null;
  suspended_reason: string | null;
  terminated_reason: string | null;
  country_code: string;
  city: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  service_radius_km: number;
  max_active_assignments: number;
  current_active_count: number;
  badge_token: string | null;
  badge_revoked_at: string | null;
  current_tier_key: string | null;
  current_tier_expires_at: string | null;
  payout_currency: string;
  payout_bank_name: string | null;
  payout_account_name: string | null;
  bio: string | null;
  portfolio_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  probation_ends_at: string | null;
  id_document_id: string | null;
  business_document_id: string | null;
  contract_document_id: string | null;
  contract_signed_at: string | null;
  vetting_decision_note: string | null;
  referral_code: string | null;
  referral_commission_pct: string | null;
  avg_rating: string | null;
  rating_count: number;
  created_at: string;
}

export interface Speciality {
  speciality_id: string;
  stylist_id: string;
  business: string;
  service_key: string;
  display_name: string;
  rate: string;
  duration_minutes: number | null;
  is_active: boolean;
  pending_admin_review: boolean;
}

export interface Certification {
  certification_id: string;
  stylist_id: string;
  tier_key: string;
  awarded_at: string;
  expires_at: string;
  assessment_score: string | null;
  assessment_notes: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  is_current: boolean;
}

export interface PartnerDetail extends Partner {
  specialities: Speciality[];
  certifications: Certification[];
}

export interface QuestionnaireResponse {
  response_id: string;
  question_id: string;
  question: string;
  field_type: string;
  answer: unknown;
  display_order: number;
}

export interface VettingReview {
  review_id: string;
  stylist_id: string;
  reviewer_user_id: string;
  reviewer_name: string | null;
  rubric: { criterion: string; score: number; max: number }[];
  total_score: string;
  recommendation: "advance" | "reject" | "hold";
  notes: string | null;
  created_at: string;
}

export interface ApplicationDetail extends Partner {
  responses: QuestionnaireResponse[];
  reviews: VettingReview[];
  specialities: Speciality[];
}

export interface ApplicationRow extends Partner {
  review_count: number;
  latest_review: VettingReview | null;
}

export type AssignmentStatus =
  | "offered_pool"
  | "accepted"
  | "declined_by_stylist"
  | "declined_other_accepted"
  | "escalated_to_admin"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disputed";

export interface Assignment {
  assignment_id: string;
  assignment_number: string;
  business: string;
  customer_contact_id: string;
  reference_type: string;
  reference_id: string;
  service_key: string;
  stylist_id: string | null;
  status: AssignmentStatus;
  offered_at: string;
  offer_expires_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  base_rate: string | null;
  tier_multiplier: string;
  platform_fee_pct: string;
  gross_payout: string | null;
  net_payout: string | null;
  payout_currency: string | null;
  payout_id: string | null;
  scheduled_at: string | null;
  customer_rating: number | null;
  customer_review: string | null;
  reviewed_at: string | null;
  satisfaction_confirmed_at: string | null;
  payable_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  dispute_resolved_at: string | null;
  review_hidden: boolean;
  created_at: string;
}

export interface Offer {
  offer_id: string;
  assignment_id: string;
  stylist_id: string;
  offered_at: string;
  response: "pending" | "accepted" | "declined" | "expired" | "superseded";
  responded_at: string | null;
  decline_reason: string | null;
  match_score: string | null;
  match_rank: number | null;
}

export interface AssignmentDetail extends Assignment {
  offers: Offer[];
}

export type PayoutStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";

export interface PayoutLine {
  line_id: string;
  payout_id: string;
  assignment_id: string | null;
  attribution_id: string | null;
  line_kind: "assignment" | "referral";
  gross_amount: string;
  platform_fee_amount: string;
  net_amount: string;
  description: string | null;
}

export interface Payout {
  payout_id: string;
  payout_number: string;
  stylist_id: string;
  period_start: string;
  period_end: string;
  currency: string;
  gross_amount: string;
  platform_fee_amount: string;
  net_amount: string;
  amount_ngn: string;
  status: PayoutStatus;
  paystack_transfer_code: string | null;
  approved_at: string | null;
  paid_at: string | null;
  workflow_instance_id: string | null;
  created_at: string;
  lines?: PayoutLine[];
  lines_count?: number;
}

export interface Tier {
  tier_key: string;
  label: string;
  rank: number;
  payout_multiplier: string;
  validity_months: number;
  badge_color: string | null;
  display_order: number;
  is_active: boolean;
}

export interface ProgrammeConfig {
  business: string;
  quality_hold_days: number;
  offer_window_hours: number;
  offer_top_n: number;
  routing_weights: {
    distance: number;
    tier: number;
    rating: number;
    capacity: number;
    specialty: number;
  };
  referral_commission_pct: string;
  applications_open: boolean;
  contract_template_doc_id: string | null;
  portal_subdomain: string | null;
}

export interface Question {
  question_id: string;
  question: string;
  help_text: string | null;
  field_type: "text" | "textarea" | "select" | "boolean";
  options: string[] | null;
  weight: string;
  is_required: boolean;
  display_order: number;
  is_active: boolean;
}

export interface RoutingCandidate {
  stylist_id: string;
  display_name: string;
  partner_code: string;
  city: string;
  state: string | null;
  country_code: string;
  current_tier_key: string | null;
  avg_rating: string | null;
  rating_count: number;
  current_active_count: number;
  max_active_assignments: number;
  rate: string | null;
  has_specialty: boolean;
  match_score: number;
  match_rank: number;
  components: Record<string, number>;
}

export interface RoutingSuggestion {
  weights: Record<string, number>;
  offer_top_n: number;
  candidates: RoutingCandidate[];
}

export interface VerifiedReview {
  assignment_id: string;
  assignment_number: string;
  stylist_id: string;
  business: string;
  service_key: string;
  customer_rating: number;
  customer_review: string | null;
  reviewed_at: string;
  review_hidden: boolean;
  stylist_name: string | null;
}

export interface Attribution {
  attribution_id: string;
  stylist_id: string;
  business: string;
  referral_code: string;
  order_id: string;
  order_number: string | null;
  order_total_ngn: string;
  commission_pct: string;
  commission_amount_ngn: string;
  currency: string;
  status: "pending" | "payable" | "paid" | "void";
  payable_at: string | null;
  payout_id: string | null;
  created_at: string;
}
