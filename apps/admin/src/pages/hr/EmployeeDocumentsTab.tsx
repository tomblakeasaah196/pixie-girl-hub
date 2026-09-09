/**
 * Employee → Documents tab (V2.2 §6.11).
 *
 * An employee's paper trail: contract, guarantor form, NIN slip, passport
 * photograph and whatever else HR files. Uploads are PDFs or images, each one
 * filed under a type from the brand's own catalogue — extensible in place, so
 * the first time HR needs "Work Permit" they name it while filing it and it
 * is there for everyone afterwards.
 *
 * Two things make the tab worth more than a folder:
 *
 *   · Required types drive a "still missing" strip at the top, so an
 *     incomplete file is visible now rather than discovered during a dispute.
 *   · Documents preview in place. Chasing a NIN slip through the downloads
 *     folder is the reason nobody checks.
 *
 * These files never appear in the Documents module or in global search — they
 * are HR-only, served from /hr/employees/:id/documents. Preview bytes are
 * fetched with the bearer token and handed to the viewer as an object URL,
 * because the in-memory token can't ride an <img>/<iframe> src.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Upload,
  Download,
  Trash2,
  Plus,
  AlertTriangle,
  Eye,
  CheckCircle2,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState, IconButton } from "@/components/ui/primitives";
import { ConfirmDialog, Toggle, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import { UploadProgress } from "@/components/ui/UploadProgress";
import { useBusinessStore } from "@/stores/business";
import {
  listStaffDocuments,
  uploadStaffDocument,
  deleteStaffDocument,
  createDocumentType,
  staffDocumentBlob,
  downloadStaffDocument,
  type StaffDocument,
  type StaffDocumentType,
  type DocumentAccepts,
} from "@/lib/hr-api";
import { DocumentPreviewDrawer } from "./DocumentPreviewDrawer";
import { SectionTitle, useNotify, errMsg, fileSize, acceptAttr } from "./hr-shared";

function docDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Upload ─────────────────────────────────────────────────

function UploadDrawer({
  open,
  onClose,
  profileId,
  types,
  presetType,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  types: StaffDocumentType[];
  presetType?: string | null;
}) {
  const qc = useQueryClient();
  const brand = useBusinessStore((s) => s.activeKey);
  const notify = useNotify("HR → Employee documents");
  const fileRef = useRef<HTMLInputElement>(null);

  const [typeKey, setTypeKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  // "+ New type" — named while filing, then reusable for every employee.
  const [newType, setNewType] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newRequired, setNewRequired] = useState(false);
  const [newAccepts, setNewAccepts] = useState<DocumentAccepts>("any");

  const selected = types.find((t) => t.type_key === typeKey) ?? null;

  useEffect(() => {
    if (!open) return;
    setTypeKey(presetType || types[0]?.type_key || "");
    setFile(null);
    setTitle("");
    setProgress(null);
    setNewType(false);
    setNewLabel("");
    setNewRequired(false);
    setNewAccepts("any");
  }, [open, presetType, types]);

  const createType = useMutation({
    mutationFn: () =>
      createDocumentType({
        label: newLabel.trim(),
        is_required: newRequired,
        accepts: newAccepts,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["hr", "staff-documents", brand] });
      qc.invalidateQueries({ queryKey: ["hr", "document-types", brand] });
      setTypeKey(t.type_key);
      setNewType(false);
      setNewLabel("");
      notify(`"${t.label}" added`);
    },
    onError: (e) => notify("Couldn't add that type", errMsg(e), "high"),
  });

  const upload = useMutation({
    mutationFn: () =>
      uploadStaffDocument(
        profileId,
        { file: file!, document_type: typeKey, title: title.trim() || undefined },
        setProgress,
      ),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["hr", "staff-documents", brand, profileId] });
      notify(`${d.type_label} uploaded`);
      onClose();
    },
    onError: (e) => {
      setProgress(null);
      notify("Upload failed", errMsg(e), "high");
    },
  });

  const wrongKind =
    file && selected
      ? (selected.accepts === "image" && !file.type.startsWith("image/")) ||
        (selected.accepts === "pdf" && file.type !== "application/pdf")
      : false;

  const canSubmit = Boolean(file && typeKey) && !wrongKind && !upload.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Upload document"
      subtitle="PDF or image, filed under a document type"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => upload.mutate()}
            disabled={!canSubmit}
            icon={<Upload className="h-3.5 w-3.5" />}
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Document type">
          {newType ? (
            <div className="space-y-3 rounded-[11px] border border-line bg-text-primary/[0.03] p-3">
              <TextInput
                autoFocus
                value={newLabel}
                placeholder="e.g. Work Permit"
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-4">
                <Toggle
                  checked={newRequired}
                  onChange={setNewRequired}
                  label="Required for every employee"
                />
                <div className="min-w-[150px]">
                  <Select<DocumentAccepts>
                    ariaLabel="Accepted file kind"
                    value={newAccepts}
                    onChange={setNewAccepts}
                    options={[
                      { value: "any", label: "PDF or image" },
                      { value: "pdf", label: "PDF only" },
                      { value: "image", label: "Image only" },
                    ]}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => createType.mutate()}
                  disabled={!newLabel.trim() || createType.isPending}
                >
                  {createType.isPending ? "Adding…" : "Add type"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setNewType(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  ariaLabel="Document type"
                  value={typeKey}
                  onChange={setTypeKey}
                  options={types.map((t) => ({
                    value: t.type_key,
                    label: t.is_required ? `${t.label} · required` : t.label,
                  }))}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setNewType(true)}
              >
                New type
              </Button>
            </div>
          )}
        </Field>

        <Field
          label="File"
          hint={
            selected?.accepts === "image"
              ? "image only"
              : selected?.accepts === "pdf"
                ? "PDF only"
                : "PDF or image"
          }
        >
          <input
            ref={fileRef}
            type="file"
            accept={acceptAttr(selected?.accepts ?? "any")}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
            }}
            className="block w-full text-[13px] text-text-muted file:mr-3 file:rounded-[9px] file:border-0 file:bg-accent/15 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-accent-glow hover:file:bg-accent/25"
          />
        </Field>

        {file && (
          <div className="flex items-center justify-between gap-3 rounded-[11px] border border-line bg-text-primary/[0.03] px-3 py-2">
            <span className="truncate text-[13px] text-text-primary">{file.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-text-faint">
              {fileSize(file.size)}
            </span>
          </div>
        )}

        {wrongKind && selected && (
          <div className="flex items-start gap-2 rounded-[11px] border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {selected.label} must be {selected.accepts === "image" ? "an image" : "a PDF"}.
              Pick a different file or file it under another type.
            </span>
          </div>
        )}

        <Field label="Label" hint="optional — shown in the list">
          <TextInput
            value={title}
            placeholder={selected?.label ?? "Document"}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <UploadProgress value={progress} />
      </div>
    </Drawer>
  );
}

// ── Tab ────────────────────────────────────────────────────

export default function EmployeeDocumentsTab({
  profileId,
  employeeName,
  canEdit,
  canDelete,
}: {
  profileId: string;
  employeeName?: string | null;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const brand = useBusinessStore((s) => s.activeKey);
  const qc = useQueryClient();
  const notify = useNotify("HR → Employee documents");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [presetType, setPresetType] = useState<string | null>(null);
  const [preview, setPreview] = useState<StaffDocument | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StaffDocument | null>(null);

  const { data, isLoading, error } = useQuery({
    enabled: Boolean(brand && profileId),
    queryKey: ["hr", "staff-documents", brand, profileId],
    queryFn: () => listStaffDocuments(profileId),
  });

  const remove = useMutation({
    mutationFn: (d: StaffDocument) => deleteStaffDocument(profileId, d.document_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "staff-documents", brand, profileId] });
      notify("Document removed");
      setPendingDelete(null);
    },
    onError: (e) => notify("Couldn't remove that document", errMsg(e), "high"),
  });

  const download = (d: StaffDocument) => {
    const base = [employeeName, d.type_label].filter(Boolean).join(" — ");
    downloadStaffDocument(profileId, d.document_id, base || "document").catch((e) =>
      notify("Download failed", errMsg(e), "high"),
    );
  };

  const openUpload = (typeKey?: string) => {
    setPresetType(typeKey ?? null);
    setUploadOpen(true);
  };

  /** Documents grouped by type, in catalogue order, newest first within a type. */
  const groups = useMemo(() => {
    const docs = data?.documents ?? [];
    const out: { key: string; label: string; docs: StaffDocument[] }[] = [];
    for (const d of docs) {
      const existing = out.find((g) => g.key === d.document_type);
      if (existing) existing.docs.push(d);
      else out.push({ key: d.document_type, label: d.type_label, docs: [d] });
    }
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-5">
        <div className="text-sm text-danger">{errMsg(error)}</div>
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ["hr", "staff-documents", brand, profileId] })
          }
        >
          Retry
        </Button>
      </Card>
    );
  }

  const missing = data?.missing_required ?? [];
  const types = (data?.types ?? []).filter((t) => t.is_active);
  const total = data?.documents.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={<FileText className="h-4 w-4 text-accent-glow" />}>
          Documents{total ? ` · ${total}` : ""}
        </SectionTitle>
        {canEdit && (
          <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => openUpload()}>
            Upload
          </Button>
        )}
      </div>

      {/* Required-but-missing: the reason this tab is a checklist, not a folder. */}
      {missing.length > 0 ? (
        <Card className="border-warn/30 bg-warn/[0.06] p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-warn">
            <AlertTriangle className="h-3.5 w-3.5" />
            {missing.length} required document{missing.length > 1 ? "s" : ""} missing
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {missing.map((m) =>
              canEdit ? (
                <button
                  key={m.type_key}
                  onClick={() => openUpload(m.type_key)}
                  className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-[12px] text-text-primary transition-colors hover:bg-warn/20"
                >
                  {m.label} <span className="text-text-faint">· upload</span>
                </button>
              ) : (
                <Pill key={m.type_key} tone="warn">
                  {m.label}
                </Pill>
              ),
            )}
          </div>
        </Card>
      ) : total > 0 ? (
        <div className="flex items-center gap-2 rounded-[11px] border border-success/25 bg-success/[0.06] px-3 py-2 text-[12px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All required documents are on file.
        </div>
      ) : null}

      {!total ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No documents yet"
          message="Upload a contract, guarantor form, NIN slip or passport photograph."
          action={
            canEdit ? (
              <Button icon={<Upload className="h-3.5 w-3.5" />} onClick={() => openUpload()}>
                Upload document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-text-faint">
                {g.label}
                <span className="text-text-faint/60">· {g.docs.length}</span>
              </div>
              <div className="space-y-2">
                {g.docs.map((d) => (
                  <Card
                    key={d.document_id}
                    className="flex items-center gap-3 p-3 transition-colors hover:border-accent/30"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line bg-text-primary/[0.04]">
                      {d.is_image ? (
                        <ImageIcon className="h-4 w-4 text-accent-glow" />
                      ) : (
                        <FileText className="h-4 w-4 text-accent-glow" />
                      )}
                    </div>
                    <button
                      onClick={() => setPreview(d)}
                      className="min-w-0 flex-1 text-left"
                      title="Preview"
                    >
                      <div className="truncate text-sm text-text-primary">
                        {d.title || d.type_label}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-text-faint">
                        {fileSize(d.file_size_bytes)} · {docDate(d.created_at)}
                        {d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton
                        aria-label="Preview"
                        title="Preview"
                        onClick={() => setPreview(d)}
                      >
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        aria-label="Download"
                        title="Download"
                        onClick={() => download(d)}
                      >
                        <Download className="h-4 w-4" />
                      </IconButton>
                      {canDelete && (
                        <IconButton
                          aria-label="Remove"
                          title="Remove"
                          onClick={() => setPendingDelete(d)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </IconButton>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadDrawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        profileId={profileId}
        types={types}
        presetType={presetType}
      />

      <DocumentPreviewDrawer
        doc={preview}
        fetchBlob={(id) => staffDocumentBlob(profileId, id)}
        onClose={() => setPreview(null)}
        onDownload={download}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
        busy={remove.isPending}
        title="Remove document?"
        confirmLabel="Remove"
        message={
          <>
            <strong className="text-text-primary">
              {pendingDelete?.title || pendingDelete?.type_label}
            </strong>{" "}
            will be removed from this employee's file. The upload stays in the audit trail.
          </>
        }
      />
    </div>
  );
}
