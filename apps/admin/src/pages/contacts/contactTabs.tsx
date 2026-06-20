import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Plus,
  CheckCircle2,
  Circle,
  CalendarDays,
  Receipt,
  FileText,
  Upload,
  Download,
  Trash2,
  History,
  ArrowUpRight,
} from "lucide-react";
import { api, getAccessToken } from "@/lib/api";
import { Button, Pill, Skeleton, MoneyText } from "@/components/ui/primitives";
import { useBusinessStore } from "@/stores/business";
import { useUpdateContact } from "./hooks";
import type { Contact } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Shared contact-profile tabs (universal to every stakeholder): Tasks,
// Calendar, Invoices (clients), Notes, Documents, Audit. All wired to the
// real shared endpoints, scoped to the contact via reference_type=contact.
// ──────────────────────────────────────────────────────────────────────────

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

/** Endpoints inconsistently return an array or { data }. Normalise. */
function asArray<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const d = (res as { data?: T[] })?.data;
  return Array.isArray(d) ? d : [];
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtBytes(n?: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function TabHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[11px] tracking-widest uppercase text-accent-glow inline-flex items-center gap-1.5">
        {icon} {title}
      </h3>
      {action}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-8 text-center text-[13px] text-text-faint">{children}</div>
  );
}

function Rows({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  if (loading)
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-[10px]" />
        ))}
      </div>
    );
  return <div className="space-y-2">{children}</div>;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

interface Task {
  task_id: string;
  title: string;
  status: string;
  due_date?: string | null;
  priority?: string;
}

export function TasksTab({ contactId }: { contactId: string; contactName?: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const key = ["contacts", contactId, "tasks"];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ data: Task[] }>(
        `/tasks?reference_type=contact&reference_id=${contactId}&page_size=100`,
      ),
  });
  const tasks = asArray<Task>(data);

  const add = useMutation({
    mutationFn: () =>
      api.post("/tasks", {
        title: title.trim(),
        reference_type: "contact",
        reference_id: contactId,
        ...(due ? { due_date: due } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const toggle = useMutation({
    mutationFn: (t: Task) =>
      api.post(`/tasks/${t.task_id}/status`, {
        status: t.status === "done" ? "to_do" : "done",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div>
      <TabHeader icon={<CheckCircle2 className="w-3.5 h-3.5" />} title={`Tasks · ${tasks.length}`} />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className="flex-1 h-[38px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && title.trim() && add.mutate()}
        />
        <input
          type="date"
          className="h-[38px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          disabled={!title.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          Add
        </Button>
      </div>
      <Rows loading={isLoading}>
        {tasks.length === 0 ? (
          <EmptyRow>No tasks yet — add the first above.</EmptyRow>
        ) : (
          tasks.map((t) => {
            const done = t.status === "done" || t.status === "cancelled";
            return (
              <div
                key={t.task_id}
                className="flex items-center gap-3 p-3 rounded-[10px] bg-text-primary/[0.04] border hairline"
              >
                <button
                  onClick={() => toggle.mutate(t)}
                  className="text-text-muted hover:text-accent-glow"
                  aria-label="Toggle task"
                >
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </button>
                <span
                  className={`flex-1 text-[13px] ${done ? "line-through text-text-faint" : "text-text-primary"}`}
                >
                  {t.title}
                </span>
                {t.due_date && (
                  <span className="text-[11px] text-text-faint">
                    {fmtDate(t.due_date)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </Rows>
    </div>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

interface CalEvent {
  event_id: string;
  title: string;
  starts_at?: string | null;
  start_at?: string | null;
  event_type?: string | null;
}

export function CalendarTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", contactId, "calendar"],
    queryFn: () =>
      api.get(
        `/calendar/by-reference?reference_type=contact&reference_id=${contactId}`,
      ),
  });
  const events = asArray<CalEvent>(data);

  return (
    <div>
      <TabHeader icon={<CalendarDays className="w-3.5 h-3.5" />} title={`Calendar · ${events.length}`} />
      <Rows loading={isLoading}>
        {events.length === 0 ? (
          <EmptyRow>No events scheduled with this contact.</EmptyRow>
        ) : (
          events.map((e) => (
            <div
              key={e.event_id}
              className="flex items-center justify-between p-3 rounded-[10px] bg-text-primary/[0.04] border hairline"
            >
              <span className="text-[13px] text-text-primary">{e.title}</span>
              <span className="text-[11px] text-text-faint">
                {fmtDate(e.starts_at ?? e.start_at)}
              </span>
            </div>
          ))
        )}
      </Rows>
    </div>
  );
}

// ── Invoices (clients) ──────────────────────────────────────────────────────

interface Invoice {
  invoice_id: string;
  invoice_number: string;
  status: string;
  total_amount?: string | number;
  total?: string | number;
  due_date?: string | null;
}

export function InvoicesTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", contactId, "invoices"],
    queryFn: () =>
      api.get(`/invoicing?contact_id=${contactId}&page_size=50`),
  });
  const invoices = asArray<Invoice>(data);

  return (
    <div>
      <TabHeader
        icon={<Receipt className="w-3.5 h-3.5" />}
        title={`Invoices · ${invoices.length}`}
        action={
          <Link to={`/invoicing?contact=${contactId}`}>
            <Button variant="secondary" size="sm" icon={<ArrowUpRight className="w-3.5 h-3.5" />}>
              Invoicing
            </Button>
          </Link>
        }
      />
      <Rows loading={isLoading}>
        {invoices.length === 0 ? (
          <EmptyRow>No invoices issued to this client yet.</EmptyRow>
        ) : (
          invoices.map((inv) => (
            <Link
              key={inv.invoice_id}
              to={`/invoicing/${inv.invoice_id}`}
              className="flex items-center justify-between p-3 rounded-[10px] bg-text-primary/[0.04] border hairline hover:border-accent/40 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-text-muted">
                  {inv.invoice_number}
                </span>
                <Pill
                  tone={
                    inv.status === "paid"
                      ? "success"
                      : inv.status === "overdue"
                        ? "danger"
                        : "neutral"
                  }
                  dot
                >
                  {inv.status}
                </Pill>
              </span>
              <MoneyText ngn={Number(inv.total_amount ?? inv.total ?? 0)} />
            </Link>
          ))
        )}
      </Rows>
    </div>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────

export function NotesTab({ contact }: { contact: Contact }) {
  const update = useUpdateContact(contact.contact_id);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const dirty = notes !== (contact.notes ?? "");

  return (
    <div>
      <TabHeader
        icon={<FileText className="w-3.5 h-3.5" />}
        title="Notes"
        action={
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || update.isPending}
            onClick={() => update.mutate({ notes })}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        }
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={10}
        placeholder="Internal notes about this contact…"
        className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 resize-y"
      />
    </div>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

interface Doc {
  document_id: string;
  title: string;
  file_size_bytes?: number;
  created_at: string;
  file_name?: string;
}

export function DocumentsTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const business = useBusinessStore((s) => s.activeKey);

  const key = ["contacts", contactId, "documents"];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get(
        `/documents?reference_type=contact&reference_id=${contactId}&page_size=100`,
      ),
  });
  const docs = asArray<Doc>(data);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("reference_type", "contact");
      form.append("reference_id", contactId);
      form.append("title", file.name);
      form.append("document_type", "other");
      if (business) form.append("business", business);
      return api.postForm("/documents", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const download = async (d: Doc) => {
    const res = await fetch(`${API_BASE}/documents/${d.document_id}/download`, {
      headers: {
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
        ...(business ? { "X-Brand-Context": business } : {}),
      },
      credentials: "include",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = d.file_name || d.title || "document";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <TabHeader
        icon={<FileText className="w-3.5 h-3.5" />}
        title={`Documents · ${docs.length}`}
        action={
          <>
            <input
              ref={inputRef}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Upload className="w-3.5 h-3.5" />}
              loading={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              Upload
            </Button>
          </>
        }
      />
      <Rows loading={isLoading}>
        {docs.length === 0 ? (
          <EmptyRow>No documents linked to this contact yet.</EmptyRow>
        ) : (
          docs.map((d) => (
            <div
              key={d.document_id}
              className="flex items-center gap-3 p-3 rounded-[10px] bg-text-primary/[0.04] border hairline"
            >
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-text-primary/[0.06] text-accent-glow shrink-0">
                <FileText className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-text-primary truncate">
                  {d.title}
                </span>
                <span className="block text-[11px] text-text-faint">
                  {fmtBytes(d.file_size_bytes)} · {fmtDate(d.created_at)}
                </span>
              </span>
              <button
                onClick={() => download(d)}
                className="p-2 text-text-muted hover:text-text-primary"
                aria-label="Download"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => remove.mutate(d.document_id)}
                className="p-2 text-text-muted hover:text-danger"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </Rows>
    </div>
  );
}

// ── Audit ───────────────────────────────────────────────────────────────────

interface AuditEntry {
  log_id: string;
  occurred_at: string;
  user_name?: string | null;
  action: string;
}

export function AuditTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", contactId, "audit"],
    queryFn: () => api.get(`/audit/record/contacts/${contactId}`),
  });
  const entries = asArray<AuditEntry>(data);

  return (
    <div>
      <TabHeader icon={<History className="w-3.5 h-3.5" />} title={`Audit · ${entries.length}`} />
      <Rows loading={isLoading}>
        {entries.length === 0 ? (
          <EmptyRow>No changes recorded for this contact yet.</EmptyRow>
        ) : (
          entries.map((a) => (
            <div
              key={a.log_id}
              className="flex items-center justify-between p-3 rounded-[10px] bg-text-primary/[0.04] border hairline"
            >
              <span className="text-[13px] text-text-primary">
                {a.action}
                {a.user_name ? (
                  <span className="text-text-faint"> · {a.user_name}</span>
                ) : null}
              </span>
              <span className="text-[11px] text-text-faint">
                {fmtDate(a.occurred_at)}
              </span>
            </div>
          ))
        )}
      </Rows>
    </div>
  );
}
