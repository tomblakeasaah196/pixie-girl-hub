export type ContactType =
  | "customer"
  | "supplier"
  | "staff"
  | "retail_partner"
  | "stylist_partner";

export type PriorityLevel = "vip" | "regular" | "new";

export type ContactSource =
  | "walk_in"
  | "social_media"
  | "referral"
  | "website"
  | "event"
  | "storefront"
  | "instagram_dm";

export type AddressType = "delivery" | "billing" | "office" | "home" | "other";

export interface Contact {
  contact_id: string;
  contact_type: ContactType[];
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  tin: string | null;
  cac_number: string | null;
  primary_phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  country_code: string | null;
  priority_level: PriorityLevel;
  assigned_to: string | null;
  visible_to: string[];
  source: ContactSource | null;
  notes: string | null;
  is_deleted: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ContactAddress {
  address_id: string;
  contact_id: string;
  address_type: AddressType;
  line1: string;
  line2: string | null;
  area: string | null;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code: string | null;
  landmark: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  is_verified: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContactTag {
  tag_id: string;
  contact_id: string;
  tag_name: string;
  business: string;
  colour: string;
  created_by: string;
  created_at: string;
}

export interface ContactSegment {
  segment_id: string;
  business: string;
  name: string;
  description: string | null;
  filter: Record<string, unknown>;
  cached_count: number | null;
  cached_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContactSummary {
  total_orders: number;
  lifetime_value_ngn: string;
  last_activity_at: string | null;
  open_deals: number;
  churn_risk_score: number | null;
  churn_risk_band: "low" | "medium" | "high" | "critical" | null;
  loyalty_points: number;
}

export interface TimelineEvent {
  event_id: string;
  event_type: string;
  event_at: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_by_name: string | null;
  category: "commercial" | "engagement" | "internal";
}

export type DealStatus = "open" | "won" | "lost" | "on_hold" | "cancelled";

export type DealChannel =
  | "instagram"
  | "whatsapp"
  | "website"
  | "walk_in"
  | "referral"
  | "campaign"
  | "google_ads"
  | "meta_ads"
  | "storefront"
  | "pos"
  | "event"
  | "other";

export type ActivityType =
  | "call"
  | "sms"
  | "whatsapp_msg"
  | "instagram_dm"
  | "email"
  | "meeting"
  | "website_chat"
  | "walk_in_visit"
  | "quote_sent"
  | "payment_received"
  | "system_note"
  | "status_change"
  | "follow_up_scheduled"
  | "task_created";

export type ActivityOutcome =
  | "connected"
  | "no_answer"
  | "left_voicemail"
  | "reschedule_requested"
  | "interested"
  | "not_interested"
  | "follow_up_required"
  | "converted";

export interface Pipeline {
  pipeline_id: string;
  pipeline_key: string;
  display_name: string;
  description: string | null;
  is_default: boolean;
  applies_to: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  stage_id: string;
  pipeline_id: string;
  stage_key: string;
  display_name: string;
  description: string | null;
  display_order: number;
  colour: string | null;
  is_terminal: boolean;
  is_won: boolean;
  is_lost: boolean;
  win_probability_pct: number | null;
  sla_days: number | null;
  workflow_trigger_key: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  deal_id: string;
  deal_number: string;
  contact_id: string;
  contact_name?: string;
  pipeline_id: string;
  pipeline_name?: string;
  current_stage_id: string;
  current_stage_name?: string;
  title: string;
  description: string | null;
  expected_value_ngn: string | null;
  expected_close_date: string | null;
  source_channel: DealChannel | null;
  source_reference: string | null;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  status: DealStatus;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  sales_order_id: string | null;
  last_activity_at: string | null;
  stage_entered_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

export interface CrmActivity {
  activity_id: string;
  contact_id: string | null;
  deal_id: string | null;
  activity_type: ActivityType;
  direction: "inbound" | "outbound" | "internal";
  subject: string | null;
  body: string | null;
  outcome: ActivityOutcome | null;
  external_ref: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  performed_by: string | null;
  performed_by_name?: string | null;
  performed_at: string;
  created_at: string;
}

export interface CrmNote {
  note_id: string;
  contact_id: string | null;
  deal_id: string | null;
  body: string;
  is_pinned: boolean;
  visibility: "team" | "managers_only" | "author_only";
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerPreferences {
  preference_id: string;
  contact_id: string;
  preferred_textures: string[];
  preferred_lace_types: string[];
  preferred_lengths_in: number[];
  preferred_colours: string[];
  preferred_densities: string[];
  preferred_cap_sizes: string[];
  avoid_textures: string[];
  avoid_colours: string[];
  use_cases: string[];
  budget_min_ngn: string | null;
  budget_max_ngn: string | null;
  styling_sensitivities: string | null;
  source: "manual" | "observed" | "survey" | "curator_pick";
  last_observed_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerMeasurement {
  measurement_id: string;
  contact_id: string;
  circumference_cm: string | null;
  ear_to_ear_cm: string | null;
  forehead_to_nape_cm: string | null;
  temple_to_temple_cm: string | null;
  nape_width_cm: string | null;
  natural_hair_type: string | null;
  scalp_notes: string | null;
  head_shape_notes: string | null;
  measured_at: string | null;
  is_current: boolean;
  notes: string | null;
  created_at: string;
}

export interface ChurnScore {
  score_id: string;
  contact_id: string;
  risk_score: number;
  risk_band: "low" | "medium" | "high" | "critical";
  reasons: string[];
  days_since_last_order: number | null;
  lifetime_value_ngn: string;
  total_orders: number;
  average_days_between_orders: string | null;
  computed_at: string;
  recovered_at: string | null;
  superseded_at: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}

export interface ContactCreateInput {
  contact_type: ContactType[];
  display_name: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  gender?: string;
  date_of_birth?: string;
  tin?: string;
  cac_number?: string;
  primary_phone?: string;
  whatsapp_number?: string;
  email?: string;
  country_code?: string;
  priority_level?: PriorityLevel;
  assigned_to?: string;
  visible_to?: string[];
  source?: ContactSource;
  notes?: string;
}

export interface AddressCreateInput {
  address_type: AddressType;
  line1: string;
  line2?: string;
  area?: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code?: string;
  landmark?: string;
  recipient_name?: string;
  recipient_phone?: string;
  google_maps_url?: string;
  latitude?: number;
  longitude?: number;
  is_default?: boolean;
}

export interface DealCreateInput {
  contact_id: string;
  pipeline_id: string;
  title: string;
  description?: string;
  expected_value_ngn?: number;
  expected_close_date?: string;
  source_channel?: DealChannel;
  source_reference?: string;
  assigned_to?: string;
}

export interface Milestone {
  contact_id: string;
  display_name: string;
  priority_level: "vip" | "regular" | "new";
  event_type: "birthday" | "wedding_anniversary" | "business_anniversary" | "graduation" | "other";
  event_date: string;
  days_until: number;
  primary_phone: string | null;
  whatsapp_number: string | null;
}
