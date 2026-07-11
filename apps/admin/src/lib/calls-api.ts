/**
 * WhatsApp Calls API client — mirrors src/modules/calls/calls.routes.js.
 *
 * Live-call flow: claim (atomic, returns the SDP offer + ICE config) →
 * the browser builds a WebRTC answer (lib/webrtc-call.ts) → accept.
 */

import { api } from "@/lib/api";

export type CallStatus =
  | "ringing"
  | "in_progress"
  | "completed"
  | "missed"
  | "rejected"
  | "failed";

export type CallOutcome =
  | "deal_closed"
  | "order_placed"
  | "follow_up"
  | "enquiry"
  | "complaint"
  | "wrong_number"
  | "other";

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  deal_closed: "Deal closed",
  order_placed: "Order placed",
  follow_up: "Follow up",
  enquiry: "Enquiry",
  complaint: "Complaint",
  wrong_number: "Wrong number",
  other: "Other",
};

export interface WhatsAppCall {
  call_id: string;
  business: string;
  wa_call_id?: string;
  contact_id?: string | null;
  channel_id?: string | null;
  direction: "inbound" | "outbound";
  status: CallStatus;
  from_number?: string | null;
  caller_name?: string | null;
  contact_name?: string | null;
  answered_by?: string | null;
  answered_by_name?: string | null;
  answered_at?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  end_reason?: string | null;
  outcome?: CallOutcome | null;
  outcome_notes?: string | null;
  outcome_recorded_at?: string | null;
  auto_reply_sent?: boolean;
  missed_task_id?: string | null;
}

/** Socket payload for call:ringing (see calls.realtime.js). */
export interface CallRing {
  call_id: string;
  brand: string;
  caller_name?: string | null;
  from_number?: string | null;
  contact_id?: string | null;
  channel_id?: string | null;
  started_at?: string;
  scope: "owner" | "brand";
}

export interface ClaimResult {
  call: WhatsAppCall;
  sdp_offer: string | null;
  ice_servers: { urls: string }[];
}

/** Duck-typed view of lib/api's ApiError for catch blocks. */
export interface ApiErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const callsApi = {
  list: (
    p: {
      status?: CallStatus;
      contact_id?: string;
      answered_by?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => api.get<WhatsAppCall[]>(`/calls${qs(p)}`),
  get: (id: string) => api.get<WhatsAppCall>(`/calls/${id}`),
  claim: (id: string) => api.post<ClaimResult>(`/calls/${id}/claim`),
  accept: (id: string, sdp: string) =>
    api.post<{ ok: boolean }>(`/calls/${id}/accept`, { sdp }),
  reject: (id: string) => api.post<WhatsAppCall>(`/calls/${id}/reject`),
  hangup: (id: string) => api.post<WhatsAppCall>(`/calls/${id}/hangup`),
  recordOutcome: (id: string, outcome: CallOutcome, notes?: string) =>
    api.post<WhatsAppCall>(`/calls/${id}/outcome`, {
      outcome,
      ...(notes ? { notes } : {}),
    }),
};

export function fmtCallDuration(seconds?: number | null): string {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
