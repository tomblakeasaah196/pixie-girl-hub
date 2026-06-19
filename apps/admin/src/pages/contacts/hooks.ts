import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as contactsApi from "./api";
import type {
  ContactCreateInput,
  AddressCreateInput,
  DealCreateInput,
  CustomerPreferences,
  CustomerMeasurement,
} from "./types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Contacts ────────────────────────────────────────────────────────────

export function useContacts(params: contactsApi.ContactListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, params],
    queryFn: () => contactsApi.listContacts(params),
    placeholderData: keepPreviousData,
  });
}

export function useContact(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "detail", id],
    queryFn: () => contactsApi.getContact(id!),
    enabled: !!id,
  });
}

export function useContactSummary(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "summary", id],
    queryFn: () => contactsApi.getContactSummary(id!),
    enabled: !!id,
  });
}

export function useContactTimeline(
  id: string | null,
  params: contactsApi.TimelineParams = {},
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "timeline", id, params],
    queryFn: () => contactsApi.getContactTimeline(id!, params),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useAddresses(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "addresses", contactId],
    queryFn: () => contactsApi.listAddresses(contactId!),
    enabled: !!contactId,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: ContactCreateInput) => contactsApi.createContact(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", biz] }),
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Partial<ContactCreateInput>) =>
      contactsApi.updateContact(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", biz] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => contactsApi.deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", biz] }),
  });
}

export function useCreateAddress(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: AddressCreateInput) =>
      contactsApi.createAddress(contactId, input),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["contacts", biz, "addresses", contactId],
      }),
  });
}

export function useDeleteAddress(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (addressId: string) =>
      contactsApi.deleteAddress(contactId, addressId),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["contacts", biz, "addresses", contactId],
      }),
  });
}

// ── Segments ────────────────────────────────────────────────────────────

export function useSegments() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "segments"],
    queryFn: contactsApi.listSegments,
  });
}

// ── CRM: Pipelines ───────────────────────────────────────────────────────

export function usePipelines() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "pipelines"],
    queryFn: contactsApi.listPipelines,
  });
}

export function usePipelineStages(pipelineId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "stages", pipelineId],
    queryFn: () => contactsApi.listPipelineStages(pipelineId!),
    enabled: !!pipelineId,
  });
}

// ── CRM: Deals ──────────────────────────────────────────────────────────

export function useDeals(params: contactsApi.DealListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "deals", params],
    queryFn: () => contactsApi.listDeals(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: DealCreateInput) => contactsApi.createDeal(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", biz, "deals"] }),
  });
}

export function useMoveDeal() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({
      id,
      stageId,
      notes,
    }: {
      id: string;
      stageId: string;
      notes?: string;
    }) => contactsApi.moveDeal(id, stageId, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", biz, "deals"] }),
  });
}

// ── CRM: Customer data ───────────────────────────────────────────────────

export function usePreferences(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "preferences", contactId],
    queryFn: () => contactsApi.getPreferences(contactId!),
    enabled: !!contactId,
  });
}

export function useMeasurements(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "measurements", contactId],
    queryFn: () => contactsApi.listMeasurements(contactId!),
    enabled: !!contactId,
  });
}

export function useChurnScores(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "churn", contactId],
    queryFn: () => contactsApi.listChurnScores(contactId!),
    enabled: !!contactId,
  });
}

export function useUpsertPreferences(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Partial<CustomerPreferences>) =>
      contactsApi.upsertPreferences(contactId, input),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["crm", biz, "preferences", contactId],
      }),
  });
}

export function useAddMeasurement(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Partial<CustomerMeasurement>) =>
      contactsApi.addMeasurement(contactId, input),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["crm", biz, "measurements", contactId],
      }),
  });
}
