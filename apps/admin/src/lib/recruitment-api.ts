/**
 * Recruitment API (HR & Staff → Recruitment).
 *
 * Admin surface (brand-scoped, authed): company context pack, AI drafting,
 * the Offer Studio edits, approve & send, provision & email credentials.
 * Public surface (no auth, token): the candidate offer packet + signing.
 */

import { api } from "@/lib/api";

export type OfferStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "contracted"
  | "provisioned"
  | "declined"
  | "withdrawn";

export interface OfferMeta {
  reporting_to?: string;
  employment_type?: string;
  location?: string;
  probation_months?: number;
  review_days?: number;
  salary_probation?: string;
  salary_post_probation?: string;
  variable_pay?: string;
  start_date?: string;
  additional_terms?: string;
  [k: string]: unknown;
}

/** The candidate's captured e-signature, present once the offer is signed. */
export interface OfferSignature {
  data_url: string;
  signed_at: string | null;
  verification_code: string | null;
  signer_name: string | null;
}

export interface Offer {
  offer_id: string;
  business: string;
  title: string;
  candidate_name: string | null;
  candidate_email: string | null;
  target_businesses: string[];
  jd_markdown: string;
  offer_markdown: string;
  offer_meta: OfferMeta;
  status: OfferStatus;
  public_token: string | null;
  role_ids: string[];
  is_ceo: boolean;
  ai_provider: string | null;
  provisioned_user_id: string | null;
  offer_document_id: string | null;
  contract_document_id: string | null;
  expires_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  provisioned_at: string | null;
  created_at: string;
  /** Attached by the API on GET /offers/:id once the offer is signed. */
  signature?: OfferSignature | null;
}

/** Which document to export as a branded, page-numbered PDF. */
export type OfferPdfDoc = "packet" | "jd" | "offer";

export interface ContextRow {
  business: string;
  display_name: string | null;
  summary: string | null;
  tone: string | null;
  target_markets: string | null;
  non_negotiables: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  /**
   * The countersignatory's captured e-signature as a base64 PNG data URL.
   * Drawn once in the Company-context modal, then stamped by the renderer on
   * every offer packet's "For {brand}" line — same treatment as the
   * candidate's signature. Null until captured.
   */
  signatory_signature_data_url: string | null;
  notes: string | null;
}

export interface DraftIntake {
  title: string;
  target_businesses?: string[];
  candidate_name?: string;
  candidate_email?: string;
  role_ids?: string[];
  is_ceo?: boolean;
  use_ai?: boolean;
  intake?: Record<string, unknown>;
}

export const recruitmentApi = {
  // Context pack
  getContext: () => api.get<ContextRow[]>("/recruitment/context"),
  updateContext: (business: string, patch: Partial<ContextRow>) =>
    api.put<ContextRow>(`/recruitment/context/${business}`, patch),

  // Offers
  listOffers: (status?: string) =>
    api.get<Offer[]>(`/recruitment/offers${status ? `?status=${status}` : ""}`),
  getOffer: (id: string) => api.get<Offer>(`/recruitment/offers/${id}`),
  draftOffer: (body: DraftIntake) => api.post<Offer>("/recruitment/offers", body),
  editOffer: (id: string, patch: Partial<Offer>) =>
    api.patch<Offer>(`/recruitment/offers/${id}`, patch),
  regenerate: (id: string, intake?: Record<string, unknown>) =>
    api.post<Offer>(`/recruitment/offers/${id}/regenerate`, { intake }),
  /**
   * Server-side WYSIWYG preview. Ships the studio's in-flight markdown to the
   * backend and gets back the full packet HTML the PDF exporter would produce,
   * so the preview pane, the candidate offer page, and the downloaded PDF are
   * literally the same document.
   */
  previewPacket: (
    id: string,
    drafts: { jd_markdown?: string; offer_markdown?: string; title?: string; candidate_name?: string },
  ) => api.post<{ packet_html: string }>(`/recruitment/offers/${id}/preview`, drafts),
  send: (id: string, body: Record<string, unknown>) =>
    api.post<Offer>(`/recruitment/offers/${id}/send`, body),
  /**
   * Provision the candidate's Hub login (credentials are emailed to them).
   * `staff_profile_id` links the login to the HR employee profile created by
   * the onboarding wizard — that's what puts the hire in the directory and
   * their organigramme seat. `role_ids` overrides the offer's stored grants.
   */
  provision: (
    id: string,
    body?: { staff_profile_id?: string; role_ids?: string[] },
  ) =>
    api.post<{ email: string; emailed: boolean; user_id: string; status: string }>(
      `/recruitment/offers/${id}/provision`,
      body ?? {},
    ),

  // Branded, page-numbered PDF (rendered by headless Chromium on the server).
  // Streams the bytes with auth + brand headers, then triggers a browser save.
  downloadPdf: (id: string, doc: OfferPdfDoc = "packet", fallbackName = "offer.pdf") =>
    api.download(`/recruitment/offers/${id}/pdf?doc=${doc}&download=1`, fallbackName),
};

// ── Public (no auth) ───────────────────────────────────────
export interface PublicOffer {
  title: string;
  candidate_name: string | null;
  status: OfferStatus;
  signed: boolean;
  can_sign: boolean;
  jd_html: string;
  offer_letter_html: string;
  /**
   * Full offer-packet HTML — the same document the PDF exporter produces
   * (brand shell, cover, Part A + Part B, single Execution block). The
   * candidate reads this in a scrollable iframe so what they sign is
   * literally what gets downloaded as a PDF.
   */
  packet_html: string;
  company: {
    /** business_key ("faitlynhair" | "pixiegirl" | …) for brand chrome. */
    business?: string;
    name: string;
    signatory_name: string;
    signatory_title: string;
  };
  signed_at: string | null;
  verification_code: string | null;
  /** The candidate's own captured signature image, once they've signed. */
  signature_data_url: string | null;
}

export const publicOfferApi = {
  view: (token: string) =>
    api.get<PublicOffer>(`/offer/${token}`, "public"),
  sign: (token: string, signature_data_url: string) =>
    api.post<{ signed: boolean; verification_code: string | null; signed_at: string | null }>(
      `/offer/${token}/sign`,
      { signature_data_url },
      "public",
    ),
  /**
   * Download the offer as a branded PDF straight from the tokenised link — the
   * SAME document the admin exporter produces. Works before AND after signing
   * (once signed, the candidate's stamped e-signature is in the packet). No
   * login: the token in the URL is the credential.
   */
  downloadPdf: (token: string, doc: OfferPdfDoc = "packet", fallbackName = "offer.pdf") =>
    api.downloadPublic(`/offer/${token}/pdf?doc=${doc}&download=1`, fallbackName),
};
