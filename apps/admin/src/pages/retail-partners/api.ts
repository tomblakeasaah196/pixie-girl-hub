import { api } from "@/lib/api";
import type {
  RetailPartner,
  PartnerDetail,
  PartnerCreateInput,
  PartnerUpdateInput,
  PartnerStatus,
  ConsignmentLocation,
  LocationCreateInput,
  ConsignmentStockRow,
  ConsignmentMovement,
  MovementInput,
  PartnerSettlement,
  SettlementDetail,
  SettlementGenerateInput,
  StockLocationLite,
  ContactHit,
} from "./types";

const B = "/retail-partners";

function qs(params: Record<string, string | number | boolean | undefined>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const rpApi = {
  // ── Partners ─────────────────────────────────────────────
  listPartners: (status?: PartnerStatus) =>
    api.get<RetailPartner[]>(`${B}${qs({ status })}`),

  getPartner: (id: string) => api.get<PartnerDetail>(`${B}/${id}`),

  createPartner: (input: PartnerCreateInput) =>
    api.post<RetailPartner>(B, input),

  updatePartner: (id: string, patch: PartnerUpdateInput) =>
    api.patch<RetailPartner>(`${B}/${id}`, patch),

  setPartnerStatus: (id: string, status: PartnerStatus, reason?: string) =>
    api.post<RetailPartner>(`${B}/${id}/status`, {
      status,
      ...(reason ? { reason } : {}),
    }),

  // ── Locations ────────────────────────────────────────────
  listLocations: (partnerId: string) =>
    api.get<ConsignmentLocation[]>(`${B}/${partnerId}/locations`),

  createLocation: (partnerId: string, input: LocationCreateInput) =>
    api.post<ConsignmentLocation>(`${B}/${partnerId}/locations`, input),

  // ── Consignment stock + movements ────────────────────────
  listStock: (params: {
    partner_id?: string;
    consignment_location_id?: string;
  }) => api.get<ConsignmentStockRow[]>(`${B}/stock${qs(params)}`),

  listMovements: (params: {
    partner_id?: string;
    consignment_location_id?: string;
    settled?: boolean;
  }) => api.get<ConsignmentMovement[]>(`${B}/movements${qs(params)}`),

  recordMovement: (input: MovementInput) =>
    api.post<ConsignmentMovement>(`${B}/movements`, input),

  // ── Settlements ──────────────────────────────────────────
  listSettlements: (params: { partner_id?: string; status?: string }) =>
    api.get<PartnerSettlement[]>(`${B}/settlements${qs(params)}`),

  getSettlement: (id: string) =>
    api.get<SettlementDetail>(`${B}/settlements/${id}`),

  generateSettlement: (input: SettlementGenerateInput) =>
    api.post<PartnerSettlement & { lines_count: number }>(
      `${B}/settlements`,
      input,
    ),

  approveSettlement: (id: string) =>
    api.post<PartnerSettlement>(`${B}/settlements/${id}/approve`),

  markSettlementPaid: (id: string, payment_reference?: string) =>
    api.post<PartnerSettlement>(
      `${B}/settlements/${id}/paid`,
      payment_reference ? { payment_reference } : {},
    ),

  // ── Supporting (other modules' endpoints, declared locally like sales does) ──

  /** Contact search for the partner↔contact link (shared.contacts). */
  searchContacts: (q: string, limit = 8) =>
    api.get<{ data: ContactHit[] }>(
      `/contacts?q=${encodeURIComponent(q)}&page_size=${limit}`,
    ),

  /** Quick-create a retail_partner contact from the partner form. */
  createContact: (input: {
    display_name: string;
    company_name?: string;
    primary_phone?: string;
    email?: string;
  }) =>
    api.post<ContactHit>(`/contacts`, {
      contact_type: ["retail_partner"],
      ...input,
    }),

  /** Stock locations — the warehouse pick + the chained consignment-location
   *  create (a consignment location mirrors a stock_location of type
   *  partner_consignment). */
  listStockLocations: () => api.get<StockLocationLite[]>(`/stock/locations`),

  createStockLocation: (input: {
    location_code: string;
    display_name: string;
    address?: string;
    city?: string;
    state?: string;
  }) =>
    api.post<StockLocationLite>(`/stock/locations`, {
      ...input,
      location_type: "partner_consignment",
    }),
};
