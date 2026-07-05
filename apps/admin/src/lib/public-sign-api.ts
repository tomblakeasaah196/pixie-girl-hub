/**
 * Public signer-page API (no auth). Backs `/sign/:token` and `/verify/:code`.
 *
 * The unguessable token identifies the signer; the server enforces order,
 * expiry, and PIN. A signature can be drawn one-off, or stored on file
 * behind a PIN so future documents only need the PIN.
 */

import { api } from "@/lib/api";

export interface SignRequestView {
  request: {
    request_id: string;
    business: string | null;
    subject: string;
    message: string | null;
    status: string;
    request_type: string;
    expires_at: string | null;
    document_id: string;
    document_title: string | null;
    document_number: string | null;
    mime_type: string | null;
  };
  signer: {
    display_name: string;
    email: string;
    signer_role: string;
    status: string;
    signed_at: string | null;
    verification_code: string | null;
    can_sign: boolean;
  };
  has_saved_signature: boolean;
  saved_signature_locked: boolean;
}

export interface SignResult {
  status: string;
  signed: {
    verification_code: string;
    signed_at: string;
    display_name: string;
    signer_role: string;
    saved_signature: boolean;
  };
}

export interface VerifyResult {
  verification_code: string;
  intact: boolean;
  signed_at: string;
  status: string;
  document: { title: string | null; request_type: string };
  signer: { display_name: string; signer_role: string };
}

export interface SignPayload {
  signature_data_url?: string;
  pin?: string;
  save_signature?: boolean;
}

export const signApi = {
  view: (token: string) => api.get<SignRequestView>(`/sign/${token}`, "public"),
  sign: (token: string, body: SignPayload) =>
    api.post<SignResult>(`/sign/${token}/sign`, body, "public"),
  decline: (token: string, reason?: string) =>
    api.post(`/sign/${token}/decline`, { reason }, "public"),
  verify: (code: string) =>
    api.get<VerifyResult>(`/sign/verify/${encodeURIComponent(code)}`, "public"),
  /** Same-origin URL the backend streams the document from (token-scoped). */
  documentUrl: (token: string) => `/api/public/sign/${token}/document`,
};
