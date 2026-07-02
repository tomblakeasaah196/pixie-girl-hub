import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { rpApi } from "./api";
import type {
  PartnerStatus,
  PartnerCreateInput,
  PartnerUpdateInput,
  LocationCreateInput,
  MovementInput,
  SettlementGenerateInput,
} from "./types";

/** No Socket.io rooms exist for this module (backend emits events but
 *  realtime never subscribes), so lists poll on a modest interval and
 *  mutations invalidate — per the module question-gate decision. */
const POLL_MS = 30_000;

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

export function usePartners(status?: PartnerStatus) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "partners", { status }],
    queryFn: () => rpApi.listPartners(status),
    refetchInterval: POLL_MS,
  });
}

export function usePartnerDetail(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "partner", id],
    queryFn: () => rpApi.getPartner(id!),
    enabled: !!id,
  });
}

export function useConsignmentStock(params: {
  partner_id?: string;
  consignment_location_id?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "stock", params],
    queryFn: () => rpApi.listStock(params),
    refetchInterval: POLL_MS,
  });
}

export function useConsignmentMovements(params: {
  partner_id?: string;
  consignment_location_id?: string;
  settled?: boolean;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "movements", params],
    queryFn: () => rpApi.listMovements(params),
    refetchInterval: POLL_MS,
  });
}

export function useSettlements(params: {
  partner_id?: string;
  status?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "settlements", params],
    queryFn: () => rpApi.listSettlements(params),
    refetchInterval: POLL_MS,
  });
}

export function useSettlementDetail(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "settlement", id],
    queryFn: () => rpApi.getSettlement(id!),
    enabled: !!id,
  });
}

/** Stock locations (stock module) — warehouse picks + unassigned
 *  partner_consignment locations for the chained location create. */
export function useStockLocationsLite() {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "retail-partners", "stock-locations"],
    queryFn: () => rpApi.listStockLocations(),
  });
}

export function useRpMutations() {
  const brand = useBrand();
  const qc = useQueryClient();
  const invalidate = (...keys: unknown[]) =>
    qc.invalidateQueries({ queryKey: [brand, "retail-partners", ...keys] });
  /** Dispatch/recall also post warehouse stock movements — keep the Stock
   *  module's caches honest too. */
  const invalidateWarehouse = () =>
    qc.invalidateQueries({ queryKey: [brand, "stock"] });

  return {
    createPartner: useMutation({
      mutationFn: (input: PartnerCreateInput) => rpApi.createPartner(input),
      onSuccess: () => invalidate("partners"),
    }),
    updatePartner: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: PartnerUpdateInput }) =>
        rpApi.updatePartner(id, patch),
      onSuccess: (_d, v) => {
        invalidate("partners");
        invalidate("partner", v.id);
      },
    }),
    setPartnerStatus: useMutation({
      mutationFn: ({
        id,
        status,
        reason,
      }: {
        id: string;
        status: PartnerStatus;
        reason?: string;
      }) => rpApi.setPartnerStatus(id, status, reason),
      onSuccess: (_d, v) => {
        invalidate("partners");
        invalidate("partner", v.id);
      },
    }),
    createLocation: useMutation({
      mutationFn: ({
        partnerId,
        input,
      }: {
        partnerId: string;
        input: LocationCreateInput;
      }) => rpApi.createLocation(partnerId, input),
      onSuccess: (_d, v) => {
        invalidate("partner", v.partnerId);
        invalidate("stock-locations");
      },
    }),
    createStockLocation: useMutation({
      mutationFn: (input: Parameters<typeof rpApi.createStockLocation>[0]) =>
        rpApi.createStockLocation(input),
      onSuccess: () => {
        invalidate("stock-locations");
        invalidateWarehouse();
      },
    }),
    recordMovement: useMutation({
      mutationFn: (input: MovementInput) => rpApi.recordMovement(input),
      onSuccess: (_d, v) => {
        invalidate("stock");
        invalidate("movements");
        invalidate("partners");
        invalidate("partner");
        if (
          v.movement_type === "dispatch_to_partner" ||
          v.movement_type === "recall_to_warehouse"
        ) {
          invalidateWarehouse();
        }
      },
    }),
    generateSettlement: useMutation({
      mutationFn: (input: SettlementGenerateInput) =>
        rpApi.generateSettlement(input),
      onSuccess: () => {
        invalidate("settlements");
        invalidate("movements");
        invalidate("stock");
        invalidate("partner");
      },
    }),
    approveSettlement: useMutation({
      mutationFn: (id: string) => rpApi.approveSettlement(id),
      onSuccess: (_d, id) => {
        invalidate("settlements");
        invalidate("settlement", id);
      },
    }),
    markSettlementPaid: useMutation({
      mutationFn: ({
        id,
        payment_reference,
      }: {
        id: string;
        payment_reference?: string;
      }) => rpApi.markSettlementPaid(id, payment_reference),
      onSuccess: (_d, v) => {
        invalidate("settlements");
        invalidate("settlement", v.id);
      },
    }),
  };
}
