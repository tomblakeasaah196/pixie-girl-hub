import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { FileSignature, Plus, Star, Trash2 } from "lucide-react";
import { Button, Card, Pill, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog, ErrorState, Select, Toggle } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useDocumentTemplates,
  useCreateDocumentTemplate,
  useUpdateDocumentTemplate,
  useSetDefaultTemplate,
  useDeleteDocumentTemplate,
  type DocumentTemplate,
} from "@/lib/settings";

const DOC_TYPES = [
  "invoice",
  "purchase_order",
  "delivery",
  "receipt",
  "contract",
  "quotation",
  "credit_note",
  "settlement",
];

/**
 * Document templates — Invoices, POs, Delivery Notes, Receipts,
 * Contracts and more, per-brand. The renderer reads the default
 * template per (brand, doc_type); css_vars carries the brand colours
 * so the same body renders Pixie-red on Pixie docs and bronze on
 * Faitlyn docs without code paths. Tokens like {{customer_name}},
 * {{line_items}}, {{total}} are substituted at render.
 */
export function DocumentTemplatesPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Document Templates" }]);
  const biz = useActiveBusiness();
  const q = useDocumentTemplates();
  const setDefault = useSetDefaultTemplate();
  const del = useDeleteDocumentTemplate();

  const [drawer, setDrawer] = useState<DocumentTemplate | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentTemplate | null>(null);

  if (q.isError)
    return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;

  // Group by doc_type so the user sees one section per document family.
  const byType = (q.data ?? []).reduce<Record<string, DocumentTemplate[]>>((acc, t) => {
    (acc[t.doc_type] ||= []).push(t);
    return acc;
  }, {});

  const columns = (): Column<DocumentTemplate>[] => [
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <span className="font-medium flex items-center gap-2">
          {r.name}
          {r.is_default && <Star className="w-3.5 h-3.5 text-accent-glow fill-current" />}
        </span>
      ),
    },
    { key: "version", header: "Version", render: (r) => <span className="font-mono">v{r.version}</span>, width: "100px" },
    {
      key: "status",
      header: "Status",
      width: "140px",
      render: (r) => (
        <Pill
          tone={r.status === "published" ? "success" : r.status === "draft" ? "warn" : "neutral"}
          dot={false}
        >
          {r.status}
        </Pill>
      ),
    },
    { key: "updated_at", header: "Updated", render: (r) => new Date(r.updated_at).toLocaleDateString(), width: "120px" },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "180px",
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          {!r.is_default && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDefault.mutate(r.template_id);
              }}
              className="text-[11.5px] font-semibold text-accent-glow hover:underline"
            >
              Set default
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPendingDelete(r);
            }}
            className="text-danger hover:text-danger/80 p-1"
            aria-label="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-[1000px] mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
            <FileSignature className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-medium">Document Templates</h2>
            <p className="text-text-muted text-[13px]">
              Invoices, POs, Delivery Notes, Receipts, Contracts.{" "}
              <Pill tone="info" dot={false}>Editing for {biz.name}</Pill>
            </p>
          </div>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawer("new")}>
          New template
        </Button>
      </div>

      <div className="text-[12px] text-text-muted">
        The renderer reads the default template per document type. Tokens like{" "}
        <code className="font-mono">{"{{customer_name}}"}</code>,{" "}
        <code className="font-mono">{"{{line_items}}"}</code>,{" "}
        <code className="font-mono">{"{{total}}"}</code> are substituted at render. The active brand's
        colours come from <span className="text-text-primary">css_vars</span>.
      </div>

      {DOC_TYPES.map((t) => {
        const rows = byType[t] || [];
        if (q.isLoading) {
          return (
            <Card key={t} className="p-4">
              <div className="micro mb-3">{labelFor(t)}</div>
              <DataTable<DocumentTemplate>
                columns={columns()}
                rows={[]}
                rowKey={(r) => r.template_id}
                loading
              />
            </Card>
          );
        }
        if (rows.length === 0) return null;
        return (
          <Card key={t} className="p-0 overflow-hidden">
            <div className="px-5 pt-4 pb-2 micro">{labelFor(t)}</div>
            <DataTable<DocumentTemplate>
              columns={columns()}
              rows={rows}
              rowKey={(r) => r.template_id}
              onRowClick={(r) => setDrawer(r)}
            />
          </Card>
        );
      })}

      {!q.isLoading && (q.data ?? []).length === 0 && (
        <EmptyState
          icon={<FileSignature className="w-6 h-6 text-text-muted" />}
          title="No templates yet"
          message="Create your first document template — Invoices, POs, Delivery Notes, Receipts, Contracts."
          action={
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawer("new")}>
              New template
            </Button>
          }
        />
      )}

      <TemplateDrawer
        target={drawer}
        onClose={() => setDrawer(null)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.template_id);
          setPendingDelete(null);
        }}
        title="Delete template?"
        message={
          pendingDelete && (
            <>
              This permanently removes <strong>{pendingDelete.name}</strong>{" "}
              (v{pendingDelete.version}). Documents already rendered with it are unaffected.
            </>
          )
        }
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}

function labelFor(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TemplateDrawer({
  target,
  onClose,
}: {
  target: DocumentTemplate | "new" | null;
  onClose: () => void;
}) {
  const create = useCreateDocumentTemplate();
  const update = useUpdateDocumentTemplate();
  const isNew = target === "new";
  const row = isNew ? null : (target as DocumentTemplate | null);

  const [doc_type, setDocType] = useState(row?.doc_type ?? "invoice");
  const [name, setName] = useState(row?.name ?? "");
  const [status, setStatus] = useState<"draft" | "published" | "archived">(row?.status ?? "draft");
  const [header_html, setHeader] = useState(row?.header_html ?? "");
  const [body_html, setBody] = useState(row?.body_html ?? "");
  const [footer_html, setFooter] = useState(row?.footer_html ?? "");
  const [is_default, setIsDefault] = useState(row?.is_default ?? false);

  const open = target !== null;
  const save = () => {
    const payload = {
      doc_type,
      name,
      status,
      header_html: header_html || null,
      body_html: body_html || null,
      footer_html: footer_html || null,
      is_default,
    };
    if (isNew) create.mutate(payload, { onSuccess: onClose });
    else if (row) update.mutate({ id: row.template_id, patch: payload }, { onSuccess: onClose });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New document template" : row?.name}
      subtitle={isNew ? "Create a versioned template" : `v${row?.version}`}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name || create.isPending || update.isPending}
            className="h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] disabled:opacity-50 hover:bg-accent"
          >
            {create.isPending || update.isPending ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Document type">
            <Select<string>
              value={doc_type}
              onChange={setDocType}
              options={DOC_TYPES.map((t) => ({ value: t, label: labelFor(t) }))}
            />
          </Field>
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Invoice" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <Field label="Status">
            <Select<"draft" | "published" | "archived">
              value={status}
              onChange={setStatus}
              options={[
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Field>
          <div className="pb-1.5">
            <Toggle checked={is_default} onChange={setIsDefault} label="Default for this document type" />
          </div>
        </div>
        <Field label="Header HTML">
          <textarea
            value={header_html}
            onChange={(e) => setHeader(e.target.value)}
            rows={4}
            className="w-full font-mono text-[12px] px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50"
          />
        </Field>
        <Field label="Body HTML">
          <textarea
            value={body_html}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full font-mono text-[12px] px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50"
            placeholder="Hello {{customer_name}}, ..."
          />
        </Field>
        <Field label="Footer HTML">
          <textarea
            value={footer_html}
            onChange={(e) => setFooter(e.target.value)}
            rows={3}
            className="w-full font-mono text-[12px] px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50"
          />
        </Field>
      </div>
    </Drawer>
  );
}
