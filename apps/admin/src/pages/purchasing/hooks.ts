import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as api from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Suppliers ─────────────────────────────────────────────

export function useSuppliers() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["suppliers", brand],
    queryFn: () => api.listSuppliers(),
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: api.createSupplier,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers", brand] });
    },
  });
}

// ── Purchase Orders ───────────────────────────────────────

export function usePos(params?: {
  status?: string;
  supplier_id?: string;
  page?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["purchase-orders", params, brand],
    queryFn: () => api.listPos(params),
  });
}

export function usePo(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["purchase-order", id, brand],
    queryFn: () => api.getPo(id!),
    enabled: !!id,
  });
}

export function useCreatePo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createPo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function usePoActions(poId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-order", poId, brand] });
  };

  return {
    submit: useMutation({
      mutationFn: () => api.submitPo(poId),
      onSuccess: invalidate,
    }),
    approve: useMutation({
      mutationFn: () => api.approvePo(poId),
      onSuccess: invalidate,
    }),
    advance: useMutation({
      mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
        api.advancePo(poId, status, notes),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (reason?: string) => api.cancelPo(poId, reason),
      onSuccess: invalidate,
    }),
  };
}

// ── GRNs ─────────────────────────────────────────────────

export function useGrns(params?: { page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["grns", params, brand],
    queryFn: () => api.listGrns(params),
  });
}

export function useCreateGrn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createGrn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grns"] });
    },
  });
}

export function usePostGrn(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: () => api.postGrn(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grns"] });
      qc.invalidateQueries({ queryKey: ["grn", id, brand] });
    },
  });
}

// ── Supplier Invoices ─────────────────────────────────────

export function useSupplierInvoices(params?: {
  page?: number;
  status?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["supplier-invoices", params, brand],
    queryFn: () => api.listSupplierInvoices(params),
  });
}

export function useCreateSupplierInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createSupplierInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
    },
  });
}

export function useSupplierInvoiceActions(invoiceId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
  return {
    match: useMutation({
      mutationFn: () => api.matchSupplierInvoice(invoiceId),
      onSuccess: invalidate,
    }),
    approve: useMutation({
      mutationFn: () => api.approveSupplierInvoice(invoiceId),
      onSuccess: invalidate,
    }),
    pay: useMutation({
      mutationFn: ({ method, ref }: { method: string; ref?: string }) =>
        api.paySupplierInvoice(invoiceId, method, ref),
      onSuccess: invalidate,
    }),
  };
}
