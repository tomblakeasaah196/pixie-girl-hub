import { useRef, useState } from "react";
import {
  FolderArchive,
  Upload,
  Search,
  Download,
  Trash2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Film,
  Music,
  Archive,
  File as FileIcon,
  PenLine,
  Plus,
  Send,
  Ban,
  Loader2,
  X,
  Clock,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import {
  ErrorState,
  DeniedState,
  Select,
} from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import {
  useDocuments,
  useUploadDocument,
  useDeleteDocument,
  downloadDocument,
  useSignatureRequests,
  useSignatureRequest,
  useCreateSignatureRequest,
  useSignatureAction,
  fileSize,
  mimeKind,
  SIGNATURE_STATUS_TONE,
  REQUEST_TYPE_LABEL,
  type DocumentRow,
  type DocumentTag,
  type SignatureRequest,
  type SignatureRequestType,
  type SignerInput,
} from "@/lib/documents-api";

/**
 * Documents & Signatures (`/documents`, canon §6.13).
 *
 * The filing cabinet for EVERY file in the system — any format, uploaded or
 * generated — plus the e-signature request workflow. Ports the hub-system
 * DocumentsVault UX into the admin design system.
 */

type Tab = "vault" | "signatures";

const KIND_ICON = {
  image: ImageIcon,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  video: Film,
  audio: Music,
  archive: Archive,
  file: FileIcon,
} as const;

export function DocumentsPage() {
  useBreadcrumbs([{ label: "Documents" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState<Tab>("vault");

  if (!can("documents", "view")) {
    return <DeniedState message="You don't have access to Documents." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <nav className="flex items-center gap-1 border-b border-line">
        <TabButton active={tab === "vault"} onClick={() => setTab("vault")} icon={<FolderArchive className="w-4 h-4" />}>
          Vault
        </TabButton>
        <TabButton active={tab === "signatures"} onClick={() => setTab("signatures")} icon={<PenLine className="w-4 h-4" />}>
          E-signatures
        </TabButton>
      </nav>

      {tab === "vault" ? <VaultTab /> : <SignaturesTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
        active ? "border-accent text-accent-glow" : "border-transparent text-text-muted hover:text-text-primary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// VAULT
// ════════════════════════════════════════════════════════════

function VaultTab() {
  const { can } = useAuthStore();
  const [q, setQ] = useState("");
  const [docType, setDocType] = useState("");
  const docsQ = useDocuments({ q: q || undefined, document_type: docType || undefined });
  const del = useDeleteDocument();
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const docs = docsQ.data?.data ?? [];
  const canCreate = can("documents", "create");
  const canDelete = can("documents", "delete");

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center flex-1 min-w-[200px] rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 px-3">
          <Search className="w-4 h-4 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or document number…"
            className="w-full bg-transparent px-2 h-[42px] text-[13px] outline-none"
          />
        </div>
        <div className="w-48">
          <Select
            value={docType}
            onChange={setDocType}
            options={[{ value: "", label: "All types" }, ...DOC_TYPES]}
          />
        </div>
        {canCreate && (
          <Button variant="primary" icon={<Upload className="w-4 h-4" />} onClick={() => setUploadOpen(true)}>
            Upload
          </Button>
        )}
      </div>

      {/* List */}
      {docsQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 44 }} />)}
        </Card>
      ) : docsQ.isError ? (
        <ErrorState onRetry={() => docsQ.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FolderArchive className="w-7 h-7" />}
          title="No documents"
          message="Upload files or generate them from invoices, contracts and exports — they all land here."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {docs.map((d, i) => {
            const Icon = KIND_ICON[mimeKind(d.mime_type)];
            return (
              <div
                key={d.document_id}
                className={`p-3.5 flex items-center gap-3 hover:bg-text-primary/[0.03] ${
                  i < docs.length - 1 ? "border-b border-line" : ""
                }`}
              >
                <button onClick={() => setPreview(d)} className="grid place-items-center w-10 h-10 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                  <Icon className="w-5 h-5" />
                </button>
                <button onClick={() => setPreview(d)} className="flex-1 min-w-0 text-left">
                  <div className="font-medium text-[13.5px] truncate">
                    {d.title || d.document_number}
                  </div>
                  <div className="text-[11.5px] text-text-faint truncate">
                    {d.document_number} · {d.document_type} · {fileSize(d.file_size_bytes)}
                    {d.reference_type && ` · ${d.reference_type}`}
                  </div>
                  <TagChips tags={d.tags} />
                </button>
                <span className="text-[11px] text-text-faint hidden sm:block">
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => downloadDocument(d).catch(() => alert("Download failed"))}
                  className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-accent/40"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5 text-text-muted" />
                </button>
                {canDelete && (
                  <button
                    onClick={() => window.confirm(`Delete ${d.title || d.document_number}?`) && del.mutate(d.document_id)}
                    className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {preview && <DocumentPreview doc={preview} onClose={() => setPreview(null)} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

// Document categories and linkable record types. `reference_type` is what the
// backend stores; the label is what staff see.
const DOC_TYPES = [
  { value: "document", label: "Document" },
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
  { value: "contract", label: "Contract" },
  { value: "agreement", label: "Agreement" },
  { value: "image", label: "Image / media" },
  { value: "export", label: "Export" },
  { value: "id_document", label: "ID document" },
  { value: "other", label: "Other" },
];

const RECORD_TYPES = [
  { value: "", label: "Record type…" },
  { value: "contact", label: "Contact" },
  { value: "deal", label: "Deal" },
  { value: "sales_order", label: "Sales order" },
  { value: "invoice", label: "Invoice" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "service_job", label: "Service job" },
  { value: "stylist", label: "Stylist" },
  { value: "supplier", label: "Supplier" },
  { value: "campaign", label: "Campaign" },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function UploadModal({ onClose }: { onClose: () => void }) {
  const upload = useUploadDocument();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [docType, setDocType] = useState("");
  const [title, setTitle] = useState("");
  const [recordType, setRecordType] = useState("");
  const [recordId, setRecordId] = useState("");
  const [tags, setTags] = useState("");

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name);
  };

  const idInvalid = recordId.trim() !== "" && !UUID_RE.test(recordId.trim());
  const canUpload = !!file && !idInvalid && !upload.isPending;

  function submit() {
    if (!file) return;
    // Only link a record when both a type and a valid UUID are supplied.
    const linked = recordType && UUID_RE.test(recordId.trim());
    upload.mutate(
      {
        file,
        document_type: docType || undefined,
        title: title || undefined,
        reference_type: linked ? recordType : undefined,
        reference_id: linked ? recordId.trim() : undefined,
        tags: tags || undefined,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload Document"
      footer={
        <>
          <button
            onClick={onClose}
            className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            disabled={!canUpload}
            onClick={submit}
            icon={upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Dropzone */}
        <div
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-2xl border border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
            dragging ? "border-accent/60 bg-accent/[0.06]" : "border-line hover:border-accent/40"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-[13px]">
              <FileIcon className="w-5 h-5 text-accent-glow" />
              <span className="font-medium truncate max-w-[260px]">{file.name}</span>
              <span className="text-text-faint">{fileSize(file.size)}</span>
            </div>
          ) : (
            <>
              <Upload className="w-7 h-7 mx-auto text-text-faint mb-2" />
              <p className="text-[13px] text-text-muted">
                Drag &amp; drop a file here, or{" "}
                <span className="text-accent-glow font-semibold">click to browse</span>
              </p>
              <p className="text-[11.5px] text-text-faint mt-1">
                Max 25&nbsp;MB · PDF, images, or any file type
              </p>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Labelled label="Document type">
            <Select
              value={docType}
              onChange={setDocType}
              options={[{ value: "", label: "Select type…" }, ...DOC_TYPES]}
            />
          </Labelled>
          <Labelled label="Title (optional)">
            <TextInput value={title} onChange={setTitle} placeholder="Auto-filled from filename" />
          </Labelled>
        </div>

        <div>
          <div className="text-[11.5px] text-text-muted mb-1.5">
            Link to record <span className="text-text-faint">(optional)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={recordType} onChange={setRecordType} options={RECORD_TYPES} />
            <div>
              <TextInput value={recordId} onChange={setRecordId} placeholder="Record UUID" mono />
              <p className={`text-[11px] mt-1 ${idInvalid ? "text-danger" : "text-text-faint"}`}>
                {idInvalid ? "Enter a valid UUID." : "Find the ID by opening the record."}
              </p>
            </div>
          </div>
        </div>

        <Labelled label="Tags (optional)">
          <TextInput value={tags} onChange={setTags} placeholder="urgent, external, signed" />
          <p className="text-[11px] text-text-faint mt-1">
            Comma-separated. A category tag (commercial, hr, etc.) is added automatically.
          </p>
        </Labelled>

        {upload.isError && (
          <p className="text-[12px] text-danger">Upload failed. Check the file size and try again.</p>
        )}
      </div>
    </Modal>
  );
}

function DocumentPreview({ doc, onClose }: { doc: DocumentRow; onClose: () => void }) {
  const kind = mimeKind(doc.mime_type);
  const Icon = KIND_ICON[kind];
  return (
    <Modal open onClose={onClose} title={doc.title || doc.document_number}>
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-text-primary/[0.02] p-8 grid place-items-center text-accent-glow">
          <Icon className="w-14 h-14" />
        </div>
        <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-[12.5px]">
          <Meta label="Document #" value={doc.document_number} mono />
          <Meta label="Type" value={doc.document_type} />
          <Meta label="MIME" value={doc.mime_type} mono />
          <Meta label="Size" value={fileSize(doc.file_size_bytes)} />
          {doc.reference_type && <Meta label="Linked to" value={`${doc.reference_type}`} />}
          <Meta label="Uploaded" value={new Date(doc.created_at).toLocaleString()} />
        </dl>
        {doc.tags && doc.tags.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-widest text-text-faint mb-1.5">Tags</div>
            <TagChips tags={doc.tags} />
          </div>
        )}
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={<Download className="w-4 h-4" />}
            onClick={() => downloadDocument(doc).catch(() => alert("Download failed"))}
          >
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-widest text-text-faint">{label}</dt>
      <dd className={`text-text-primary ${mono ? "font-mono text-[11.5px] break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function TagChips({ tags }: { tags?: DocumentTag[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map((t) => (
        <span
          key={t.tag_name}
          className="inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-[1px] border"
          style={{
            color: t.colour,
            borderColor: `${t.colour}55`,
            backgroundColor: `${t.colour}1a`,
          }}
        >
          {t.tag_name}
        </span>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// E-SIGNATURES
// ════════════════════════════════════════════════════════════

function SignaturesTab() {
  const { can } = useAuthStore();
  const [status, setStatus] = useState("");
  const reqsQ = useSignatureRequests(status || undefined);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const reqs = reqsQ.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="w-44">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "completed", label: "Completed" },
              { value: "declined", label: "Declined" },
              { value: "voided", label: "Voided" },
            ]}
          />
        </div>
        {can("documents", "create") && (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New request
          </Button>
        )}
      </div>

      {reqsQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 44 }} />)}
        </Card>
      ) : reqsQ.isError ? (
        <ErrorState onRetry={() => reqsQ.refetch()} />
      ) : reqs.length === 0 ? (
        <EmptyState
          icon={<PenLine className="w-7 h-7" />}
          title="No signature requests"
          message="Send a document for e-signature — contracts, NDAs, partner agreements."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {reqs.map((r, i) => (
            <button
              key={r.request_id}
              onClick={() => setDetailId(r.request_id)}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] ${
                i < reqs.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[13.5px] truncate">{r.subject}</span>
                  <Pill tone={SIGNATURE_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Pill>
                </div>
                <div className="text-[11.5px] text-text-faint">
                  {REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}
                  {r.expires_at && ` · expires ${new Date(r.expires_at).toLocaleDateString()}`}
                </div>
              </div>
              <PenLine className="w-4 h-4 text-text-faint shrink-0" />
            </button>
          ))}
        </Card>
      )}

      {creating && <SignatureBuilder onClose={() => setCreating(false)} />}
      {detailId && <SignatureDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function SignatureBuilder({ onClose }: { onClose: () => void }) {
  const create = useCreateSignatureRequest();
  const docsQ = useDocuments({ page_size: 100 });
  const docs = docsQ.data?.data ?? [];

  const [documentId, setDocumentId] = useState("");
  const [requestType, setRequestType] = useState<SignatureRequestType>("service_agreement");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState<"sequential" | "parallel">("sequential");
  const [expiresAt, setExpiresAt] = useState("");
  const [signers, setSigners] = useState<SignerInput[]>([
    { signer_role: "signer", external_name: "", external_email: "" },
  ]);

  const validSigners = signers.filter((s) => s.external_email && s.signer_role);
  const canSubmit = documentId && subject && validSigners.length > 0;

  function submit() {
    create.mutate(
      {
        document_id: documentId,
        request_type: requestType,
        subject,
        message: message || undefined,
        signing_order: order,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        signers: validSigners,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer open onClose={onClose} title="New signature request" subtitle="Send a document for e-signature">
      <div className="space-y-4 p-1">
        <Labelled label="Document">
          <Select
            value={documentId}
            onChange={setDocumentId}
            options={[
              { value: "", label: docs.length ? "Choose a document…" : "Upload a document first" },
              ...docs.map((d) => ({ value: d.document_id, label: d.title || d.document_number })),
            ]}
          />
        </Labelled>
        <Labelled label="Request type">
          <Select
            value={requestType}
            onChange={(v) => setRequestType(v as SignatureRequestType)}
            options={(Object.keys(REQUEST_TYPE_LABEL) as SignatureRequestType[]).map((k) => ({
              value: k,
              label: REQUEST_TYPE_LABEL[k],
            }))}
          />
        </Labelled>
        <Labelled label="Subject">
          <TextInput value={subject} onChange={setSubject} placeholder="Please sign: Service Agreement" />
        </Labelled>
        <Labelled label="Message (optional)">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
            placeholder="A short note to the signers…"
          />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Signing order">
            <Select
              value={order}
              onChange={(v) => setOrder(v as "sequential" | "parallel")}
              options={[
                { value: "sequential", label: "Sequential" },
                { value: "parallel", label: "Parallel" },
              ]}
            />
          </Labelled>
          <Labelled label="Expires (optional)">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
            />
          </Labelled>
        </div>

        {/* Signers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-text-muted">Signers</span>
            <button
              onClick={() => setSigners((s) => [...s, { signer_role: "signer", external_name: "", external_email: "" }])}
              className="text-[12px] text-accent-glow inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add signer
            </button>
          </div>
          {signers.map((s, idx) => (
            <div key={idx} className="rounded-xl border border-line p-3 space-y-2 relative">
              {signers.length > 1 && (
                <button
                  onClick={() => setSigners((arr) => arr.filter((_, i) => i !== idx))}
                  className="absolute top-2 right-2 text-text-faint hover:text-danger"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <TextInput
                value={s.external_name ?? ""}
                onChange={(v) => setSigners((arr) => arr.map((x, i) => (i === idx ? { ...x, external_name: v } : x)))}
                placeholder="Full name"
              />
              <TextInput
                value={s.external_email ?? ""}
                onChange={(v) => setSigners((arr) => arr.map((x, i) => (i === idx ? { ...x, external_email: v } : x)))}
                placeholder="email@example.com"
                mono
              />
              <TextInput
                value={s.signer_role}
                onChange={(v) => setSigners((arr) => arr.map((x, i) => (i === idx ? { ...x, signer_role: v } : x)))}
                placeholder="Role (e.g. partner, witness)"
              />
            </div>
          ))}
        </div>

        {create.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t create the request.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
          >
            Create request
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function SignatureDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuthStore();
  const reqQ = useSignatureRequest(id);
  const action = useSignatureAction();
  const req = reqQ.data as SignatureRequest | undefined;

  return (
    <Drawer open onClose={onClose} title={req?.subject ?? "Signature request"} subtitle={req ? REQUEST_TYPE_LABEL[req.request_type] : ""}>
      {reqQ.isLoading || !req ? (
        <div className="p-1 space-y-3">
          <Skeleton style={{ height: 24, width: "50%" }} />
          <Skeleton style={{ height: 60 }} />
        </div>
      ) : (
        <div className="space-y-4 p-1">
          <Pill tone={SIGNATURE_STATUS_TONE[req.status] ?? "neutral"}>{req.status}</Pill>

          {req.message && <p className="text-[13px] text-text-muted whitespace-pre-wrap">{req.message}</p>}

          <div>
            <div className="micro mb-2">Signers</div>
            <div className="space-y-2">
              {(req.signers ?? []).map((s) => (
                <div key={s.signer_id} className="flex items-center gap-2.5 rounded-lg border border-line p-2.5">
                  <span className="grid place-items-center w-8 h-8 rounded-full bg-panel-2 text-[11px] font-bold text-accent-glow border border-line">
                    {s.signing_step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">
                      {s.display_name_snapshot || s.external_name || "—"}
                    </div>
                    <div className="text-[11px] text-text-faint truncate">
                      {s.display_email_snapshot || s.external_email} · {s.signer_role}
                    </div>
                  </div>
                  <Pill tone={SIGNATURE_STATUS_TONE[s.status] ?? "neutral"} dot={false}>{s.status}</Pill>
                </div>
              ))}
            </div>
          </div>

          {req.events && req.events.length > 0 && (
            <div>
              <div className="micro mb-2">Audit trail</div>
              <div className="space-y-1.5">
                {req.events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11.5px] text-text-muted">
                    <Clock className="w-3 h-3 text-text-faint" />
                    <span className="font-medium">{e.event_type}</span>
                    <span className="text-text-faint">{new Date(e.occurred_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {can("documents", "edit") && req.status === "draft" && (
              <Button
                variant="primary"
                disabled={action.isPending}
                onClick={() => action.mutate({ id, action: "send" }, { onSuccess: onClose })}
                icon={action.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              >
                Send
              </Button>
            )}
            {can("documents", "edit") && (req.status === "sent" || req.status === "in_progress") && (
              <Button variant="secondary" onClick={() => action.mutate({ id, action: "cancel" })} icon={<Ban className="w-4 h-4" />}>
                Cancel
              </Button>
            )}
            {can("documents", "delete") && req.status !== "completed" && req.status !== "voided" && (
              <Button
                variant="danger"
                onClick={() => {
                  const reason = window.prompt("Reason for voiding (optional)") ?? undefined;
                  action.mutate({ id, action: "void", reason });
                }}
                icon={<Ban className="w-4 h-4" />}
              >
                Void
              </Button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ── Shared bits ─────────────────────────────────────────────

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`}
    />
  );
}
