import { useEffect, useState } from "react";
import {
  FileText,
  Receipt,
  FileSignature,
  Truck,
  RotateCcw,
  Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card } from "@/components/ui/primitives";
import { Field, TextInput, TextArea } from "@/components/ui/Form";
import { ErrorState } from "@/components/ui/controls";
import {
  useDocumentSettings,
  useUpdateDocumentSettings,
  type DocumentCopy,
} from "./documentSettings";

type DocKey = "invoice" | "receipt" | "quotation" | "delivery_note";
type EmailKind = "full" | "receipt" | null;

const DOCS: {
  key: DocKey;
  label: string;
  icon: typeof FileText;
  email: EmailKind;
  tokens: string;
}[] = [
  {
    key: "invoice",
    label: "Invoice",
    icon: FileText,
    email: "full",
    tokens: "{first_name} · {brand_name} · {invoice_number} · {total}",
  },
  {
    key: "receipt",
    label: "Receipt",
    icon: Receipt,
    email: "receipt",
    tokens: "{first_name} · {brand_name} · {order_number} · {total}",
  },
  {
    key: "quotation",
    label: "Quotation",
    icon: FileSignature,
    email: "full",
    tokens: "{first_name} · {brand_name} · {quotation_number} · {total}",
  },
  {
    key: "delivery_note",
    label: "Delivery Note",
    icon: Truck,
    email: null,
    tokens: "{first_name} · {brand_name} · {order_number}",
  },
];

// Deep-clone helper that tolerates older runtimes without structuredClone.
function clone<T>(v: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v ?? null));
}

export function DocumentSettingsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useDocumentSettings();
  const save = useUpdateDocumentSettings();

  const [doc, setDoc] = useState<DocKey>("invoice");
  const [form, setForm] = useState<DocumentCopy>({});

  useEffect(() => {
    if (data) setForm(clone(data.effective ?? {}));
  }, [data]);

  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="h-64 animate-pulse rounded-[14px] bg-text-primary/[0.04]" />
    );
  }

  const active = DOCS.find((d) => d.key === doc)!;

  // Read / write a nested value at form[doc][group][field].
  const val = (group: "pdf" | "email", field: string): string => {
    const g = (form[doc] as Record<string, Record<string, string>> | undefined)?.[
      group
    ];
    return (g?.[field] as string) ?? "";
  };
  const set = (group: "pdf" | "email", field: string, value: string) =>
    setForm((prev) => {
      const next = clone(prev);
      const d = (next[doc] ?? {}) as Record<string, Record<string, string>>;
      d[group] = { ...(d[group] ?? {}), [field]: value };
      (next as Record<string, unknown>)[doc] = d;
      return next;
    });

  const resetDoc = () =>
    setForm((prev) => {
      const next = clone(prev);
      (next as Record<string, unknown>)[doc] = clone(
        (data.defaults as Record<string, unknown>)[doc] ?? {},
      );
      return next;
    });

  const submit = () => save.mutate(form);

  return (
    <div className="space-y-4 max-w-[860px]">
      {/* Document selector */}
      <div
        className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto"
        role="tablist"
      >
        {DOCS.map((d) => {
          const on = d.key === doc;
          const Icon = d.icon;
          return (
            <button
              key={d.key}
              role="tab"
              aria-selected={on}
              onClick={() => setDoc(d.key)}
              className={cn(
                "inline-flex items-center gap-2 px-4 h-10 rounded-[10px] text-[13px] font-semibold whitespace-nowrap transition-all",
                on
                  ? "bg-accent-deep text-[#F4E9D9] shadow-[0_6px_18px_rgb(var(--accent-deep)/0.4)]"
                  : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
              )}
            >
              <Icon className="w-4 h-4" />
              {d.label}
            </button>
          );
        })}
      </div>

      <p className="text-[12px] text-text-faint">
        Wording printed on the {active.label.toLowerCase()} and its mail. Leave a
        field as-is to keep the curated default. Personalise with tokens:{" "}
        <span className="font-mono text-[11px] text-text-muted">
          {active.tokens}
        </span>
        .
      </p>

      {/* PDF copy */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-display text-[15px]">Document (PDF) copy</h3>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={resetDoc}
            >
              Reset to default
            </Button>
          )}
        </div>
        <div className="space-y-3">
          <Field label="Note heading" hint="label above the note card">
            <TextInput
              value={val("pdf", "note_label")}
              onChange={(e) => set("pdf", "note_label", e.target.value)}
              disabled={!canEdit}
              placeholder="Payment"
            />
          </Field>
          <Field label="Note" hint="the soft note card on the document">
            <TextArea
              value={val("pdf", "note")}
              onChange={(e) => set("pdf", "note", e.target.value)}
              disabled={!canEdit}
              rows={3}
            />
          </Field>
          {/* A paid invoice should never ask for payment — these replace the
              note above once it's settled. Invoice-only. */}
          {doc === "invoice" && (
            <>
              <Field
                label="Paid note heading"
                hint="label above the note once the invoice is fully paid"
              >
                <TextInput
                  value={val("pdf", "note_label_paid")}
                  onChange={(e) => set("pdf", "note_label_paid", e.target.value)}
                  disabled={!canEdit}
                  placeholder="Payment received"
                />
              </Field>
              <Field
                label="Paid note"
                hint="shown instead of the note above when the invoice is paid"
              >
                <TextArea
                  value={val("pdf", "note_paid")}
                  onChange={(e) => set("pdf", "note_paid", e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                />
              </Field>
            </>
          )}
          <Field
            label="Thank-you line"
            hint="the large, personal line near the total"
          >
            <TextArea
              value={val("pdf", "message")}
              onChange={(e) => set("pdf", "message", e.target.value)}
              disabled={!canEdit}
              rows={2}
            />
          </Field>
        </div>
      </Card>

      {/* Email copy */}
      {active.email && (
        <Card className="p-5">
          <h3 className="font-display text-[15px] mb-1">Mail copy</h3>
          <p className="text-[11.5px] text-text-faint mb-4">
            {active.key === "receipt"
              ? "Overrides the order-confirmation email sent when an order is paid. Blank → the email's built-in wording."
              : `Wording for the email that carries the ${active.label.toLowerCase()}.`}
          </p>
          {active.email === "full" ? (
            <div className="space-y-3">
              <Field label="Subject">
                <TextInput
                  value={val("email", "subject")}
                  onChange={(e) => set("email", "subject", e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Heading">
                <TextInput
                  value={val("email", "heading")}
                  onChange={(e) => set("email", "heading", e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Body">
                <TextArea
                  value={val("email", "body")}
                  onChange={(e) => set("email", "body", e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                />
              </Field>
              <Field label="Sign-off">
                <TextArea
                  value={val("email", "signoff")}
                  onChange={(e) => set("email", "signoff", e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field
                label="Opening line"
                hint="a personal line under the heading"
              >
                <TextArea
                  value={val("email", "intro")}
                  onChange={(e) => set("email", "intro", e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                />
              </Field>
              <Field label="Sign-off">
                <TextArea
                  value={val("email", "signoff")}
                  onChange={(e) => set("email", "signoff", e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                />
              </Field>
            </div>
          )}
        </Card>
      )}

      {!active.email && (
        <p className="text-[12px] text-text-faint">
          Delivery notes aren't emailed — there's no mail copy for this document.
        </p>
      )}

      {/* Save bar */}
      {save.isError && (
        <p className="text-[12px] text-danger">
          {save.error instanceof Error ? save.error.message : "Could not save."}
        </p>
      )}
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {save.isSuccess && !save.isPending && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
