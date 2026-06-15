import { api } from "@/lib/api";
import type {
  Contact,
  ContactAddress,
  ContactSummary,
  TimelineEvent,
  ContactSegment,
  ContactTag,
  Pipeline,
  PipelineStage,
  Deal,
  CrmActivity,
  CrmNote,
  CustomerPreferences,
  CustomerMeasurement,
  ChurnScore,
  PaginatedResponse,
  ContactCreateInput,
  AddressCreateInput,
  DealCreateInput,
} from "./types";

const C = "/contacts";
const CRM = "/crm";

// ── Contacts ────────────────────────────────────────────────────────────

export interface ContactListParams {
  search?: string;
  type?: string;
  priority?: string;
  source?: string;
  assigned_to?: string;
  page?: number;
  page_size?: number;
}

function qs(params: object) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const listContacts = (params: ContactListParams = {}) =>
  api.get<PaginatedResponse<Contact>>(`${C}${qs(params)}`);

export const getContact = (id: string) => api.get<Contact>(`${C}/${id}`);

export const createContact = (input: ContactCreateInput) =>
  api.post<Contact>(C, input);

export const updateContact = (id: string, input: Partial<ContactCreateInput>) =>
  api.patch<Contact>(`${C}/${id}`, input);

export const deleteContact = (id: string) => api.delete<void>(`${C}/${id}`);

export const getContactSummary = (id: string) =>
  api.get<ContactSummary>(`${C}/${id}/summary`);

export interface TimelineParams {
  category?: "commercial" | "engagement" | "internal";
  page?: number;
  page_size?: number;
}

export const getContactTimeline = (id: string, params: TimelineParams = {}) =>
  api.get<{ data: TimelineEvent[]; meta: { total: number; has_more: boolean } }>(
    `${C}/${id}/timeline${qs(params)}`,
  );

// ── Addresses ────────────────────────────────────────────────────────────

export const listAddresses = (contactId: string) =>
  api.get<ContactAddress[]>(`${C}/${contactId}/addresses`);

export const createAddress = (contactId: string, input: AddressCreateInput) =>
  api.post<ContactAddress>(`${C}/${contactId}/addresses`, input);

export const updateAddress = (
  contactId: string,
  addressId: string,
  input: Partial<AddressCreateInput>,
) => api.patch<ContactAddress>(`${C}/${contactId}/addresses/${addressId}`, input);

export const deleteAddress = (contactId: string, addressId: string) =>
  api.delete<void>(`${C}/${contactId}/addresses/${addressId}`);

// ── Segments ────────────────────────────────────────────────────────────

export const listSegments = () => api.get<ContactSegment[]>(`${C}/segments`);

export const createSegment = (input: {
  name: string;
  description?: string;
  filter?: Record<string, unknown>;
}) => api.post<ContactSegment>(`${C}/segments`, input);

export const updateSegment = (
  id: string,
  input: Partial<{ name: string; description: string; filter: Record<string, unknown> }>,
) => api.patch<ContactSegment>(`${C}/segments/${id}`, input);

export const deleteSegment = (id: string) => api.delete<void>(`${C}/segments/${id}`);

// ── CRM: Pipelines ───────────────────────────────────────────────────────

export const listPipelines = () => api.get<Pipeline[]>(`${CRM}/pipelines`);

export const listPipelineStages = (pipelineId: string) =>
  api.get<PipelineStage[]>(`${CRM}/pipelines/${pipelineId}/stages`);

// ── CRM: Deals ──────────────────────────────────────────────────────────

export interface DealListParams {
  contact_id?: string;
  pipeline_id?: string;
  stage_id?: string;
  status?: string;
  assigned_to?: string;
  page?: number;
  page_size?: number;
}

export const listDeals = (params: DealListParams = {}) =>
  api.get<PaginatedResponse<Deal>>(`${CRM}/deals${qs(params)}`);

export const getDeal = (id: string) => api.get<Deal>(`${CRM}/deals/${id}`);

export const createDeal = (input: DealCreateInput) =>
  api.post<Deal>(`${CRM}/deals`, input);

export const updateDeal = (id: string, input: Partial<DealCreateInput>) =>
  api.patch<Deal>(`${CRM}/deals/${id}`, input);

export const moveDeal = (id: string, stageId: string, notes?: string) =>
  api.post<Deal>(`${CRM}/deals/${id}/move`, { stage_id: stageId, notes });

export const setDealStatus = (
  id: string,
  status: "won" | "lost" | "cancelled",
  lostReason?: string,
) => api.post<Deal>(`${CRM}/deals/${id}/status`, { status, lost_reason: lostReason });

// ── CRM: Activities ──────────────────────────────────────────────────────

export const listActivities = (dealId: string) =>
  api.get<CrmActivity[]>(`${CRM}/deals/${dealId}/activities`);

export const addActivity = (
  dealId: string,
  input: {
    activity_type: string;
    direction?: string;
    subject?: string;
    body?: string;
    outcome?: string;
    performed_at?: string;
    duration_minutes?: number;
  },
) => api.post<CrmActivity>(`${CRM}/deals/${dealId}/activities`, input);

// ── CRM: Notes ──────────────────────────────────────────────────────────

export const listNotes = (dealId: string) =>
  api.get<CrmNote[]>(`${CRM}/deals/${dealId}/notes`);

export const addNote = (dealId: string, body: string, visibility?: string) =>
  api.post<CrmNote>(`${CRM}/deals/${dealId}/notes`, { body, visibility });

// ── CRM: Preferences ────────────────────────────────────────────────────

export const getPreferences = (contactId: string) =>
  api.get<CustomerPreferences | null>(`${CRM}/customers/${contactId}/preferences`);

export const upsertPreferences = (contactId: string, input: Partial<CustomerPreferences>) =>
  api.put<CustomerPreferences>(`${CRM}/customers/${contactId}/preferences`, input);

// ── CRM: Measurements ───────────────────────────────────────────────────

export const listMeasurements = (contactId: string) =>
  api.get<CustomerMeasurement[]>(`${CRM}/customers/${contactId}/measurements`);

export const addMeasurement = (contactId: string, input: Partial<CustomerMeasurement>) =>
  api.post<CustomerMeasurement>(`${CRM}/customers/${contactId}/measurements`, input);

// ── CRM: Churn ──────────────────────────────────────────────────────────

export const listChurnScores = (contactId: string) =>
  api.get<ChurnScore[]>(`${CRM}/customers/${contactId}/churn`);

// ── Tags ──────────────────────────────────────────────────────────────────

export const listContactTags = (contactId: string) =>
  api.get<ContactTag[]>(`${C}/${contactId}/tags`);

export const listAllTags = () =>
  api.get<ContactTag[]>(`${C}/tags`);

export const addContactTag = (
  contactId: string,
  tag: { tag_name: string; colour?: string },
) => api.post<ContactTag>(`${C}/${contactId}/tags`, tag);

export const removeContactTag = (contactId: string, tagId: string) =>
  api.delete<void>(`${C}/${contactId}/tags/${tagId}`);

export const updateTag = (
  tagId: string,
  input: { tag_name?: string; colour?: string },
) => api.patch<ContactTag>(`${C}/tags/${tagId}`, input);

export const deleteTag = (tagId: string) =>
  api.delete<void>(`${C}/tags/${tagId}`);

export const mergeTags = (sourceTagId: string, targetTagId: string) =>
  api.post<void>(`${C}/tags/merge`, { source_tag_id: sourceTagId, target_tag_id: targetTagId });

// ── Contact-level activities (no deal required) ───────────────────────────

export const logContactActivity = (
  contactId: string,
  input: {
    activity_type: string;
    direction?: string;
    subject?: string;
    body?: string;
    outcome?: string;
    performed_at?: string;
    duration_minutes?: number;
    scheduled_at?: string;
  },
) => api.post<CrmActivity>(`${CRM}/contacts/${contactId}/activities`, input);

// ── Milestones (cross-contact birthdays & anniversaries) ─────────────────

export const listUpcomingMilestones = (params: { days?: number } = {}) =>
  api.get<import("./types").Milestone[]>(`${C}/milestones${qs(params)}`);
