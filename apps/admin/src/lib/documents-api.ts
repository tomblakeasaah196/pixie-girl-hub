/**
 * Documents & Signatures — typed client + TanStack hooks.
 *
 * Mirrors `src/shared/documents/*` (mounted /api/v1/documents, permission key
 * `documents`). The documents table is the registry for EVERY file in the
 * system — uploaded or generated — of any mime type. E-signature requests live
 * under /documents/signatures.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, getAccessToken } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

interface Paginated<T> {
  data: T[];
  meta?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════
// Documents
// ════════════════════════════════════════════════════════════

export interface DocumentTag {
  tag_name: string;
  colour: string;
}

export interface DocumentRow {
  document_id: string;
  document_number: string;
  business: string;
  document_type: string;
  title: string | null;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  content_hash: string | null;
  reference_type: string | null;
  reference_id: string | null;
  uploaded_by: string | null;
  created_at: string;
  tags?: DocumentTag[];
}

export interface DocFilters {
  document_type?: string;
  reference_type?: string;
  reference_id?: string;
  q?: string;
  tag?: string;
  page?: number;
  page_size?: number;
}

export function useDocuments(filters: DocFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.document_type) qs.set("document_type", filters.document_type);
  if (filters.reference_type) qs.set("reference_type", filters.reference_type);
  if (filters.reference_id) qs.set("reference_id", filters.reference_id);
  if (filters.q) qs.set("q", filters.q);
  if (filters.tag) qs.set("tag", filters.tag);
  if (filters.page) qs.set("page", String(filters.page));
  qs.set("page_size", String(filters.page_size ?? 50));
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["documents", "list", brand, qs.toString()],
    queryFn: () => api.get<Paginated<DocumentRow>>(`/documents?${qs}`),
    staleTime: 20_000,
    // Keep the current rows on screen while a new filter/search refetches so
    // the list doesn't flash the skeleton on every dropdown change.
    placeholderData: keepPreviousData,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      file: File;
      document_type?: string;
      title?: string;
      reference_type?: string;
      reference_id?: string;
      /** Comma-separated tag list; the backend also adds a category tag. */
      tags?: string;
      onProgress?: (percent: number) => void;
    }) => {
      const form = new FormData();
      form.append("file", args.file);
      if (args.document_type) form.append("document_type", args.document_type);
      if (args.title) form.append("title", args.title);
      if (args.reference_type) form.append("reference_type", args.reference_type);
      if (args.reference_id) form.append("reference_id", args.reference_id);
      if (args.tags && args.tags.trim()) form.append("tags", args.tags.trim());
      return api.postForm<DocumentRow>("/documents", form, {
        onProgress: args.onProgress,
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["documents", "list", brand] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/documents/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["documents", "list", brand] }),
  });
}

/** Authenticated blob download — streams the file with the access token +
 *  brand header, then triggers a browser save. (The api JSON helpers can't do
 *  binary, so this is a focused fetch.) */
export async function downloadDocument(doc: DocumentRow): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const raw = localStorage.getItem("pgh-business");
    const key = raw ? JSON.parse(raw)?.state?.activeKey : null;
    if (key) headers["X-Brand-Context"] = key;
  } catch {
    /* ignore */
  }
  const res = await fetch(`${API_BASE}/documents/${doc.document_id}/download`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.title || doc.document_number || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════
// E-signatures
// ════════════════════════════════════════════════════════════

export type SignatureRequestType =
  | "stylist_partner_agreement"
  | "employment_contract"
  | "nda"
  | "supplier_agreement"
  | "service_agreement"
  | "investor_document"
  | "other";

export type SignatureStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "completed"
  | "declined"
  | "voided"
  | "cancelled"
  | "expired";

export interface SignatureSigner {
  signer_id: string;
  request_id: string;
  signer_role: string;
  display_name_snapshot: string | null;
  display_email_snapshot: string | null;
  external_name: string | null;
  external_email: string | null;
  status: string;
  signing_step: number;
  signed_at?: string | null;
}

export interface SignatureEvent {
  event_id?: string;
  request_id: string;
  event_type: string;
  occurred_at: string;
  [k: string]: unknown;
}

export interface SignatureRequest {
  request_id: string;
  business: string;
  document_id: string;
  request_type: SignatureRequestType;
  signing_order: "sequential" | "parallel";
  status: SignatureStatus;
  subject: string;
  message: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  signers?: SignatureSigner[];
  events?: SignatureEvent[];
}

export interface SignerInput {
  signer_role: string;
  external_name?: string;
  external_email?: string;
  external_phone?: string;
  user_id?: string;
  contact_id?: string;
}

export function useSignatureRequests(status?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("page_size", "100");
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["documents", "signatures", brand, qs.toString()],
    queryFn: () =>
      api.get<Paginated<SignatureRequest>>(`/documents/signatures?${qs}`),
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  });
}

export function useSignatureRequest(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["documents", "signature", brand, id],
    queryFn: () => api.get<SignatureRequest>(`/documents/signatures/${id}`),
  });
}

export function useCreateSignatureRequest() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      document_id: string;
      request_type: SignatureRequestType;
      subject: string;
      message?: string;
      signing_order?: "sequential" | "parallel";
      expires_at?: string;
      signers: SignerInput[];
    }) => api.post<SignatureRequest>("/documents/signatures", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["documents", "signatures", brand] }),
  });
}

export function useSignatureAction() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      action: "send" | "cancel" | "void";
      reason?: string;
    }) =>
      api.post<SignatureRequest>(
        `/documents/signatures/${args.id}/${args.action}`,
        args.reason ? { reason: args.reason } : {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", "signatures", brand] });
      qc.invalidateQueries({ queryKey: ["documents", "signature", brand] });
    },
  });
}

// ════════════════════════════════════════════════════════════
// Presentation
// ════════════════════════════════════════════════════════════

export const SIGNATURE_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  sent: "info",
  in_progress: "warn",
  completed: "success",
  declined: "danger",
  voided: "danger",
  cancelled: "neutral",
  expired: "warn",
};

export const REQUEST_TYPE_LABEL: Record<SignatureRequestType, string> = {
  stylist_partner_agreement: "Stylist partner agreement",
  employment_contract: "Employment contract",
  nda: "NDA",
  supplier_agreement: "Supplier agreement",
  service_agreement: "Service agreement",
  investor_document: "Investor document",
  other: "Other",
};

export function fileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Broad mime → icon bucket so the vault holds files of any format. */
export function mimeKind(
  mime: string,
): "image" | "pdf" | "doc" | "sheet" | "video" | "audio" | "archive" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/spreadsheet|excel|csv/.test(mime)) return "sheet";
  if (/word|document|rtf|text/.test(mime)) return "doc";
  if (/zip|rar|tar|gzip|compressed/.test(mime)) return "archive";
  return "file";
}
