import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { Hash, Loader2 } from "lucide-react";
import {
  useDocSequences,
  useUpdateDocSequence,
  type DocSequence,
} from "@/lib/settings";
import { useActiveBusiness } from "@/stores/business";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { NumberField, ErrorState } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { Button, Card, Pill } from "@/components/ui/primitives";

/**
 * Settings → Document numbering. Prefixes drive every document number.
 * A prefix locks once the first document is issued (next_number > 1).
 */

function sample(prefix: string, padding: number, next: number) {
  return `${prefix}-${String(next).padStart(Math.max(0, padding), "0")}`;
}

export function DocumentNumberingPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Document Numbering" }]);
  const q = useDocSequences();
  const update = useUpdateDocSequence();
  const active = useActiveBusiness();

  const [editing, setEditing] = useState<DocSequence | null>(null);
  const [prefix, setPrefix] = useState("");
  const [padding, setPadding] = useState("");

  const open = (row: DocSequence) => {
    setEditing(row);
    setPrefix(row.prefix);
    setPadding(String(row.padding));
  };
  const close = () => setEditing(null);

  const locked = !!editing && editing.next_number > 1;

  const save = () => {
    if (!editing) return;
    const patch: { prefix?: string; padding?: number } = {};
    if (!locked && prefix !== editing.prefix) patch.prefix = prefix;
    const pad = Number(padding);
    if (!Number.isNaN(pad) && pad !== editing.padding) patch.padding = pad;
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    update.mutate({ id: editing.seq_id, patch }, { onSuccess: close });
  };

  const columns: Column<DocSequence>[] = [
    {
      key: "document_type",
      header: "Document type",
      render: (r) => <span className="font-semibold">{r.document_type}</span>,
    },
    {
      key: "prefix",
      header: "Prefix",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono">{r.prefix}</span>
          {r.next_number > 1 && (
            <Pill tone="neutral" dot={false}>
              Locked
            </Pill>
          )}
        </span>
      ),
    },
    {
      key: "padding",
      header: "Padding",
      align: "right",
      render: (r) => <span className="tabular-nums">{r.padding}</span>,
    },
    {
      key: "next_number",
      header: "Next #",
      align: "right",
      render: (r) => <span className="tabular-nums">{r.next_number}</span>,
    },
    {
      key: "sample",
      header: "Sample",
      render: (r) => (
        <span className="font-mono text-accent-glow">
          {sample(r.prefix, r.padding, r.next_number)}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-[900px] space-y-4 pb-12">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Document numbering</h1>
        <Pill tone="accent" dot={false}>
          Editing for: {active.name}
        </Pill>
      </div>

      <div className="glass rounded-[var(--radius)] shadow-glass border-l-[3px] border-l-accent p-4 text-[12.5px] text-text-muted leading-relaxed">
        Prefixes drive every document number (e.g.{" "}
        <span className="font-mono text-text-primary">PXG-INV-0001</span>). A
        prefix locks once the first document is issued.
      </div>

      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <DataTable<DocSequence>
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.seq_id}
          loading={q.isLoading}
          onRowClick={open}
          empty={{
            icon: <Hash className="w-7 h-7" />,
            title: "No document sequences",
            message:
              "Document sequences appear here once the business is provisioned.",
          }}
        />
      )}

      <Drawer
        open={!!editing}
        onClose={close}
        title={editing ? `Edit ${editing.document_type}` : "Edit sequence"}
        subtitle={editing ? sample(prefix || editing.prefix, Number(padding) || editing.padding, editing.next_number) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={update.isPending}
              icon={update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
            >
              Save changes
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field
              label="Prefix"
              hint={locked ? "Locked — documents already issued" : undefined}
            >
              <span
                title={
                  locked ? "Locked — documents already issued" : undefined
                }
              >
                <TextInput
                  value={prefix}
                  disabled={locked}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </span>
            </Field>

            <Field label="Padding" hint="digits, zero-padded">
              <NumberField
                value={padding}
                onChange={setPadding}
                allowDecimal={false}
              />
            </Field>

            <div className="text-[12px] text-text-faint">
              Sample:{" "}
              <span className="font-mono text-accent-glow">
                {sample(
                  prefix || editing.prefix,
                  Number(padding) || editing.padding,
                  editing.next_number,
                )}
              </span>
            </div>

            {update.isError && (
              <p className="text-[12px] text-danger">
                Couldn&rsquo;t save. Please try again.
              </p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
