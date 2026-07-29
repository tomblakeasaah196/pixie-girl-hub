import { api } from "@/lib/api";
import type {
  CostComponent,
  CostType,
  FactoryAccount,
  LedgerEntry,
  LedgerPage,
  ProductLineInput,
  Shipment,
  ShipmentPage,
  ProductionRun,
  ProductionRunPage,
} from "./types";

const FA = "/factory-accounts";
const PR = "/production";

// ── Factory Accounts ──────────────────────────────────────

export function listFactoryAccounts() {
  return api.get<FactoryAccount[]>(FA);
}

export function getFactoryAccount(id: string) {
  return api.get<FactoryAccount>(`${FA}/${id}`);
}

export function createFactoryAccount(input: {
  supplier_id: string;
  account_name: string;
  base_currency?: string;
  credit_alert_threshold?: number;
  notes?: string;
}) {
  return api.post<FactoryAccount>(FA, input);
}

export function updateFactoryAccount(
  id: string,
  input: {
    account_name?: string;
    credit_alert_threshold?: number | null;
    is_active?: boolean;
    notes?: string | null;
  },
) {
  return api.patch<FactoryAccount>(`${FA}/${id}`, input);
}

// ── Ledger ────────────────────────────────────────────────

export function listLedger(
  accountId: string,
  params?: { limit?: number; offset?: number },
) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return api.get<LedgerPage>(`${FA}/${accountId}/ledger${q ? `?${q}` : ""}`);
}

export function addLedgerEntry(
  accountId: string,
  input: {
    entry_type: string;
    direction: string;
    amount_original: number;
    original_currency?: string;
    fx_rate_to_base?: number;
    description?: string;
    entry_date?: string;
    payment_method?: string;
    paid_by?: string;
    notes?: string;
  },
) {
  return api.post<LedgerEntry>(`${FA}/${accountId}/ledger`, input);
}

export function reconcileEntries(accountId: string, entryIds: string[]) {
  return api.post<{ reconciled: number }>(`${FA}/${accountId}/reconcile`, {
    entry_ids: entryIds,
  });
}

// ── Shipments ─────────────────────────────────────────────

export function listShipments(params?: {
  account_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.account_id) qs.set("account_id", params.account_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return api.get<ShipmentPage>(`${FA}/shipments${q ? `?${q}` : ""}`);
}

export function createShipment(input: {
  account_id: string;
  supplier_id: string;
  courier: string;
  tracking_number?: string;
  courier_fee_original?: number;
  courier_fee_currency?: string;
  shipped_at?: string;
  estimated_arrival?: string;
  notes?: string;
  items: Array<{
    po_line_id?: string;
    sku_description?: string;
    quantity_shipped: number;
    unit_price_base?: number;
  }>;
}) {
  return api.post<Shipment>(`${FA}/shipments`, input);
}

export function getShipment(id: string) {
  return api.get<Shipment>(`${FA}/shipments/${id}`);
}

export function advanceShipment(
  id: string,
  input: { status: string; arrived_at?: string; notes?: string },
) {
  return api.post<Shipment>(`${FA}/shipments/${id}/advance`, input);
}

// ── Production Runs ───────────────────────────────────────

export function listProductionRuns(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return api.get<ProductionRunPage>(`${PR}${q ? `?${q}` : ""}`);
}

export function getProductionRun(id: string) {
  return api.get<ProductionRun>(`${PR}/${id}`);
}

/**
 * Open a run. `lines` is what is being made — each becomes production_run_units
 * rows, and the priced lines roll into one `factory_unit_cost` component. Pass
 * `po_id` alone to build the run from an existing purchase order's lines.
 */
export function createProductionRun(input: {
  title: string;
  units_planned?: number;
  supplier_id?: string;
  po_id?: string;
  currency?: string;
  fx_rate_used?: number;
  lines?: ProductLineInput[];
  expected_arrival_date?: string;
  notes?: string;
}) {
  return api.post<ProductionRun>(PR, input);
}

export function addProducts(
  runId: string,
  input: {
    lines: ProductLineInput[];
    currency?: string;
    fx_rate_used?: number;
    incurred_at?: string;
  },
) {
  return api.post<ProductionRun>(`${PR}/${runId}/products`, input);
}

export function advanceProductionRun(id: string, status: string) {
  return api.post<ProductionRun>(`${PR}/${id}/advance`, { status });
}

export function addCostComponent(
  runId: string,
  input: {
    cost_type: CostType;
    amount: number;
    currency: string;
    fx_rate_used?: number;
    applies_to_units?: number;
    description?: string;
    invoice_reference?: string;
    incurred_at?: string;
  },
) {
  return api.post<CostComponent>(`${PR}/${runId}/costs`, input);
}

/** Book finished units into a Lagos stock location at the run's landed cost. */
export function receiveProduction(
  runId: string,
  input: {
    variant_id: string;
    location_id: string;
    quantity: number;
    unit_cost_ngn?: number;
  },
) {
  return api.post<ProductionRun>(`${PR}/${runId}/receive`, input);
}

/**
 * NGN per 1 unit of `currency`, for the cost form's live NGN preview. Served by
 * the production module rather than business-setup so a factory manager can
 * read it without holding the settings permission.
 */
export function getFxRate(currency: string) {
  return api.get<{ currency: string; rate: number | null }>(
    `${PR}/fx-rate?currency=${encodeURIComponent(currency)}`,
  );
}
