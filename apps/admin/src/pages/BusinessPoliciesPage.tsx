import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { ExternalLink, Plus, Scale, Trash2 } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog, ErrorState, Select, Toggle } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useBusinessPolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useDeletePolicy,
  type BusinessPolicy,
} from "@/lib/settings";

const POLICY_TYPES = [
  { value: "privacy", label: "Privacy Policy" },
  { value: "refund", label: "Refund Policy" },
  { value: "qms", label: "Quality Management Statement" },
  { value: "terms", label: "Terms & Conditions" },
  { value: "cookie", label: "Cookie Policy" },
  { value: "shipping", label: "Shipping Policy" },
  { value: "returns", label: "Returns Policy" },
];

/**
 * Business Policies — Settings owns the CONTENT + editing.
 * Storefront Studio reads `is_published = true` rows to decide which
 * policies appear on the public website and where (footer link,
 * dedicated page, etc.). Content lives here, presentation lives there.
 *
 * Versioned (the service auto-bumps version on body change) so an
 * audit reviewer can diff revisions. Slug becomes the public URL path:
 * Studio surfaces /policies/{slug} once a policy is published AND
 * the storefront chooses to expose it.
 */
export function BusinessPoliciesPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Business Policies" }]);
  const biz = useActiveBusiness();
  const q = useBusinessPolicies();
  const del = useDeletePolicy();
  const update = useUpdatePolicy();
  const [drawer, setDrawer] = useState<BusinessPolicy | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BusinessPolicy | null>(null);

  if (q.isError)
    return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;

  const columns: Column<BusinessPolicy>[] = [
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.title}</div>
          <div className="text-[11px] text-text-faint font-mono truncate">/{r.slug}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "160px",
      render: (r) => (
        <span className="text-[12.5px]">
          {POLICY_TYPES.find((t) => t.value === r.policy_type)?.label ?? r.policy_type}
        </span>
      ),
    },
    {
      key: "version",
      header: "Version",
      width: "90px",
      render: (r) => <span className="font-mono">v{r.version}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (r) => (
        <Pill
          tone={r.status === "published" ? "success" : r.status === "draft" ? "warn" : "neutral"}
          dot={false}
        >
          {r.status}
        </Pill>
      ),
    },
    {
      key: "published",
      header: "Live",
      width: "100px",
      render: (r) => (
        <Toggle
          checked={r.is_published}
          onChange={(v) =>
            update.mutate({
              id: r.policy_id,
              patch: { is_published: v, status: v ? "published" : "draft" },
            })
          }
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "60px",
      render: (r) => (
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
      ),
    },
  ];

  return (
    <div className="max-w-[1000px] mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
            <Scale className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-medium">Business Policies</h2>
            <p className="text-text-muted text-[13px]">
              Privacy, Refund, QMS, Terms, Cookie & more.{" "}
              <Pill tone="info" dot={false}>Editing for {biz.name}</Pill>
            </p>
          </div>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawer("new")}>
          New policy
        </Button>
      </div>

      <Card className="p-4 border-info/30 bg-info/5">
        <p className="text-[12.5px] text-text-muted leading-relaxed">
          <strong className="text-text-primary">Settings owns the content.</strong> Toggle{" "}
          <em>Live</em> to mark a policy as published.{" "}
          <strong className="text-text-primary">Storefront Studio</strong> reads the published rows
          and decides which policies show on the public website and where (footer link, dedicated
          page, etc.).
        </p>
      </Card>

      <DataTable<BusinessPolicy>
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.policy_id}
        loading={q.isLoading}
        onRowClick={(r) => setDrawer(r)}
        empty={{
          icon: <Scale className="w-6 h-6 text-text-muted" />,
          title: "No policies yet",
          message: "Create your first business or legal policy.",
          action: (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawer("new")}>
              New policy
            </Button>
          ),
        }}
      />

      <PolicyDrawer target={drawer} onClose={() => setDrawer(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.policy_id);
          setPendingDelete(null);
        }}
        title="Delete policy?"
        message={
          pendingDelete && (
            <>
              This permanently removes <strong>{pendingDelete.title}</strong>. If it is currently
              published on the website, take it down in Storefront Studio first.
            </>
          )
        }
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}

function PolicyDrawer({
  target,
  onClose,
}: {
  target: BusinessPolicy | "new" | null;
  onClose: () => void;
}) {
  const create = useCreatePolicy();
  const update = useUpdatePolicy();
  const isNew = target === "new";
  const row = isNew ? null : (target as BusinessPolicy | null);

  const [slug, setSlug] = useState(row?.slug ?? "");
  const [title, setTitle] = useState(row?.title ?? "");
  const [policy_type, setType] = useState(row?.policy_type ?? "privacy");
  const [summary, setSummary] = useState(row?.summary ?? "");
  const [body_html, setBody] = useState(row?.body_html ?? "");
  const [is_published, setPublished] = useState(row?.is_published ?? false);

  const open = target !== null;
  const save = () => {
    const payload = {
      slug,
      title,
      policy_type,
      summary: summary || null,
      body_html,
      is_published,
      status: is_published ? ("published" as const) : ("draft" as const),
    };
    if (isNew) create.mutate(payload, { onSuccess: onClose });
    else if (row) update.mutate({ id: row.policy_id, patch: payload }, { onSuccess: onClose });
  };

  // Auto-slugify the title for a fresh policy.
  const onTitleChange = (v: string) => {
    setTitle(v);
    if (isNew && (slug === "" || slug === slugify(title))) {
      setSlug(slugify(v));
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New policy" : row?.title}
      subtitle={isNew ? "Versioned content; publish when ready" : `v${row?.version}`}
      wide
      footer={
        <div className="flex justify-between items-center w-full">
          {!isNew && row?.is_published && row?.public_url && (
            <a
              href={row.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-accent-glow inline-flex items-center gap-1 hover:underline"
            >
              View live <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <div className="flex justify-end gap-2 ml-auto">
            <button onClick={onClose} className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!title || !slug || create.isPending || update.isPending}
              className="h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] disabled:opacity-50 hover:bg-accent"
            >
              {create.isPending || update.isPending ? "Saving…" : isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Privacy Policy" />
          </Field>
          <Field label="Type">
            <Select<string>
              value={policy_type}
              onChange={setType}
              options={POLICY_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
        </div>
        <Field label="Slug" hint="Public URL path: /policies/{slug}">
          <TextInput
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            placeholder="privacy"
          />
        </Field>
        <Field label="Summary" hint="Plain-text preview for search & SmartComm answers">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 resize-none"
          />
        </Field>
        <Field label="Body (HTML)">
          <textarea
            value={body_html}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full font-mono text-[12px] px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50"
            placeholder="<h2>Privacy Policy</h2><p>...</p>"
          />
        </Field>
        <div className="flex items-center gap-3 py-1">
          <Toggle checked={is_published} onChange={setPublished} label="Mark as published" />
          <span className="text-[11.5px] text-text-faint">
            Storefront Studio decides whether to surface it on the website.
          </span>
        </div>
      </div>
    </Drawer>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
