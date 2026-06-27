/**
 * Invoicing → Settings tab: editable document copy (invoice/receipt/quotation/
 * delivery-note PDFs + their mail), per brand. Talks to GET/PUT
 * /api/v1/invoicing/settings; the brand rides on X-Brand-Context (set globally
 * by the api client from the business store).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { api } from "@/lib/api";

export interface PdfCopy {
  note_label?: string;
  note?: string;
  message?: string;
}
export interface FullEmailCopy {
  subject?: string;
  heading?: string;
  body?: string;
  signoff?: string;
}
export interface ReceiptEmailCopy {
  intro?: string;
  signoff?: string;
}

export interface DocumentCopy {
  invoice?: { pdf?: PdfCopy; email?: FullEmailCopy };
  receipt?: { pdf?: PdfCopy; email?: ReceiptEmailCopy };
  quotation?: { pdf?: PdfCopy; email?: FullEmailCopy };
  delivery_note?: { pdf?: PdfCopy };
}

export interface DocumentSettingsResponse {
  effective: DocumentCopy;
  overrides: DocumentCopy;
  defaults: DocumentCopy;
}

const KEY = (brand: string) =>
  ["invoicing", "document-settings", brand] as const;

export function useDocumentSettings() {
  const brand = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: KEY(brand),
    queryFn: () => api.get<DocumentSettingsResponse>("/invoicing/settings"),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateDocumentSettings() {
  const qc = useQueryClient();
  const brand = useBusinessStore((s) => s.activeKey);
  return useMutation({
    mutationFn: (patch: DocumentCopy) =>
      api.put<{ effective: DocumentCopy; overrides: DocumentCopy }>(
        "/invoicing/settings",
        patch,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(brand) }),
  });
}
