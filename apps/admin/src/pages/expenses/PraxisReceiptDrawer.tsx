import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Sparkles,
  Mic,
  Square,
  X,
  Paperclip,
  Send,
  Receipt,
  AlertTriangle,
  ArrowLeft,
  FileText,
  Trash2,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useExpenseCategories, useExpenseMutations, useExtractExpense } from "./hooks";
import { uploadExpenseReceipt } from "./api";
import type { ExpenseExtraction, ExtractedExpenseLine } from "./api";

const EXPENSE_TYPES = [
  { value: "reimbursement", label: "Reimbursement" },
  { value: "company_card", label: "Company card" },
  { value: "direct_invoice", label: "Direct invoice" },
  { value: "advance_settlement", label: "Advance settlement" },
];

const CONFIDENCE_TONE = {
  high: "success",
  medium: "warn",
  low: "danger",
} as const;

/** A minimal in-memory voice recorder (MediaRecorder → Blob). No server round
 *  trip here — the clip is handed to the extract endpoint, which transcribes it
 *  server-side (Groq Whisper) under the Expenses permission. */
function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Couldn't access the microphone.");
      return;
    }
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const type = rec.mimeType || "audio/webm";
      setBlob(new Blob(chunksRef.current, { type }));
      chunksRef.current = [];
      recRef.current = null;
      setRecording(false);
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
    // Safety cap: auto-stop after 3 minutes.
    setTimeout(() => {
      if (recRef.current === rec && rec.state === "recording") rec.stop();
    }, 180_000);
  }, []);

  const stop = useCallback(() => {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  const clear = useCallback(() => {
    setBlob(null);
    setSeconds(0);
  }, []);

  useEffect(
    () => () => {
      if (recRef.current?.state === "recording") recRef.current.stop();
    },
    [],
  );

  return { supported, recording, seconds, blob, error, start, stop, clear };
}

function mmss(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Inline Praxis receipt capture. Upload a receipt/invoice + an optional voice
 * note, Praxis reads it, and you review the suggested expense before it's
 * created. Everything stays inside the Expenses module.
 */
export function PraxisReceiptDrawer({ onClose }: { onClose: () => void }) {
  const can = useAuthStore((s) => s.can);
  const canSubmit = can("expenses", "edit");
  const categoriesQ = useExpenseCategories();
  const categories = (categoriesQ.data ?? []).filter((c) => c.is_active);

  const extract = useExtractExpense();
  const { create, submitExpense } = useExpenseMutations();
  const recorder = useAudioRecorder();

  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<ExpenseExtraction | null>(null);
  const [expenseType, setExpenseType] = useState("reimbursement");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function readReceipt() {
    if (!file) return;
    extract.mutate(
      {
        file,
        note: note.trim() || undefined,
        audio: recorder.blob ?? undefined,
        audioName: "voice-note.webm",
      },
      { onSuccess: (d) => setDraft(d) },
    );
  }

  function patchLine(idx: number, patch: Partial<ExtractedExpenseLine>) {
    setDraft((d) =>
      d
        ? { ...d, lines: d.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }
        : d,
    );
  }
  function removeLine(idx: number) {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((_, i) => i !== idx) } : d));
  }

  const linesValid =
    !!draft &&
    draft.lines.length > 0 &&
    draft.lines.every((l) => l.category_id && Number(l.amount_ngn) > 0);
  const canCreate =
    !!draft && !!draft.title && !!draft.expense_date && linesValid && !saving;

  const total = draft
    ? draft.lines.reduce((sum, l) => sum + (Number(l.amount_ngn) || 0), 0)
    : 0;

  async function handleCreate(andSubmit: boolean) {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await create.mutateAsync({
        title: draft.title,
        expense_date: draft.expense_date,
        expense_type: expenseType,
        description: draft.notes || note.trim() || undefined,
        lines: draft.lines.map((l) => ({
          category_id: l.category_id as string,
          description: l.description || draft.title,
          amount_ngn: Number(l.amount_ngn),
          vat_amount_ngn: Number(l.vat_amount_ngn) || undefined,
          vendor_name: l.vendor_name || draft.vendor_name || undefined,
        })),
      });
      if (file) {
        // Expense is saved already — a failed receipt upload shouldn't block it.
        try {
          await uploadExpenseReceipt(created.expense_id, file);
        } catch {
          /* re-attach later from the detail view */
        }
      }
      if (andSubmit) await submitExpense.mutateAsync(created.expense_id);
      onClose();
    } catch {
      setSaveError("Couldn't create the expense — please review and try again.");
    } finally {
      setSaving(false);
    }
  }

  const reading = extract.isPending;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Scan receipt with Praxis"
      subtitle={draft ? "Review the suggested expense" : "Upload a receipt or invoice"}
    >
      <div className="space-y-4 p-1">
        {!draft ? (
          <CaptureStep
            file={file}
            setFile={setFile}
            note={note}
            setNote={setNote}
            recorder={recorder}
            reading={reading}
            error={extract.isError}
            onRead={readReceipt}
          />
        ) : (
          <ReviewStep
            draft={draft}
            setDraft={setDraft}
            categories={categories}
            expenseType={expenseType}
            setExpenseType={setExpenseType}
            patchLine={patchLine}
            removeLine={removeLine}
            total={total}
          />
        )}

        {saveError && <p className="text-[12px] text-danger">{saveError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          {draft ? (
            <>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setDraft(null)}
                icon={<ArrowLeft className="w-4 h-4" />}
              >
                Back
              </Button>
              <Button
                variant="secondary"
                disabled={!canCreate}
                onClick={() => handleCreate(false)}
                icon={
                  saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Receipt className="w-4 h-4" />
                  )
                }
              >
                Save as Draft
              </Button>
              {canSubmit && (
                <Button
                  variant="primary"
                  disabled={!canCreate}
                  onClick={() => handleCreate(true)}
                  icon={
                    saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )
                  }
                >
                  Create &amp; Submit
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!file || reading}
                onClick={readReceipt}
                icon={
                  reading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )
                }
              >
                {reading ? "Reading…" : "Read with Praxis"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function CaptureStep({
  file,
  setFile,
  note,
  setNote,
  recorder,
  reading,
  error,
  onRead,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  note: string;
  setNote: (v: string) => void;
  recorder: ReturnType<typeof useAudioRecorder>;
  reading: boolean;
  error: boolean;
  onRead: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-text-muted leading-relaxed">
        Upload a photo or PDF of the receipt or invoice, and (optionally) record
        a quick voice note explaining what the money was for. Praxis reads both
        and proposes an expense for you to review — nothing is saved until you
        confirm.
      </p>

      {/* Receipt file */}
      <div>
        <span className="block text-[11.5px] text-text-muted mb-1.5">
          Receipt or invoice
        </span>
        {file ? (
          <div className="flex items-center justify-between gap-2 rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px]">
            <span className="flex items-center gap-2 text-[13px] truncate">
              <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="truncate">{file.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-text-muted hover:text-danger transition-colors shrink-0"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-1.5 cursor-pointer rounded-[14px] bg-text-primary/[0.04] border border-line border-dashed px-3 py-7 text-[13px] text-text-muted hover:border-accent/50 transition-colors">
            <Paperclip className="w-5 h-5" />
            <span>Tap to upload a receipt photo or PDF</span>
            <span className="text-[11px] text-text-faint">JPG, PNG, HEIC or PDF</span>
            <input
              type="file"
              accept="image/*,.heic,.heif,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>

      {/* Voice note */}
      <div>
        <span className="block text-[11.5px] text-text-muted mb-1.5">
          Voice note (optional)
        </span>
        <div className="flex items-center gap-2">
          {recorder.recording ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={recorder.stop}
              icon={<Square className="w-3.5 h-3.5 fill-current" />}
            >
              Stop · {mmss(recorder.seconds)}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={!recorder.supported}
              onClick={recorder.start}
              icon={<Mic className="w-3.5 h-3.5" />}
            >
              {recorder.blob ? "Re-record" : "Record"}
            </Button>
          )}
          {recorder.blob && !recorder.recording && (
            <span className="flex items-center gap-2 text-[12px] text-text-muted">
              <Pill tone="success">Voice note ready · {mmss(recorder.seconds)}</Pill>
              <button
                type="button"
                onClick={recorder.clear}
                className="text-text-muted hover:text-danger transition-colors"
                aria-label="Discard voice note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>
        {!recorder.supported && (
          <p className="text-[11px] text-text-faint mt-1">
            Recording isn&rsquo;t available here — type a note below instead.
          </p>
        )}
        {recorder.error && (
          <p className="text-[11px] text-danger mt-1">{recorder.error}</p>
        )}
      </div>

      {/* Typed note */}
      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1.5">
          Or type a note (optional)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. Fuel for the Lekki delivery run this morning"
          className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
        />
      </label>

      {reading && (
        <div className="flex items-center gap-2 rounded-[11px] bg-accent/[0.06] border border-accent/20 px-3 py-3 text-[12.5px] text-accent-glow">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Praxis is reading your receipt…
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-[11px] bg-danger/[0.06] border border-danger/20 px-3 py-3 text-[12.5px] text-danger">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Praxis couldn&rsquo;t read that one. Try a clearer, well-lit photo —
            or{" "}
            <button className="underline" onClick={onRead} type="button">
              try again
            </button>
            .
          </span>
        </div>
      )}
    </div>
  );
}

function ReviewStep({
  draft,
  setDraft,
  categories,
  expenseType,
  setExpenseType,
  patchLine,
  removeLine,
  total,
}: {
  draft: ExpenseExtraction;
  setDraft: React.Dispatch<React.SetStateAction<ExpenseExtraction | null>>;
  categories: { category_id: string; category_display: string }[];
  expenseType: string;
  setExpenseType: (v: string) => void;
  patchLine: (idx: number, patch: Partial<ExtractedExpenseLine>) => void;
  removeLine: (idx: number) => void;
  total: number;
}) {
  const catOptions = [
    { value: "", label: categories.length ? "Choose a category…" : "No categories" },
    ...categories.map((c) => ({ value: c.category_id, label: c.category_display })),
  ];

  return (
    <div className="space-y-4">
      {/* Confidence + warnings */}
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={CONFIDENCE_TONE[draft.confidence]}>
          {draft.confidence} confidence
        </Pill>
        {draft.transcript && (
          <Pill tone="accent">
            <Mic className="w-3 h-3 inline mr-1" />
            Voice note read
          </Pill>
        )}
      </div>

      {!draft.is_receipt && (
        <div className="flex items-start gap-2 rounded-[11px] bg-warn/[0.08] border border-warn/25 px-3 py-2.5 text-[12px] text-warn">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This doesn&rsquo;t look like a receipt. Double-check the details
            before creating the expense.
          </span>
        </div>
      )}
      {!draft.currency_is_ngn && (
        <div className="flex items-start gap-2 rounded-[11px] bg-warn/[0.08] border border-warn/25 px-3 py-2.5 text-[12px] text-warn">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Praxis read this receipt in <b>{draft.currency}</b>, not Naira. The
            amounts below are the numbers on the receipt — convert them to ₦
            before you submit.
          </span>
        </div>
      )}

      {draft.transcript && (
        <div className="rounded-[11px] bg-text-primary/[0.03] border border-line px-3 py-2.5">
          <span className="block text-[10.5px] uppercase tracking-wide text-text-faint mb-1">
            Praxis heard
          </span>
          <p className="text-[12.5px] text-text-muted italic">
            &ldquo;{draft.transcript}&rdquo;
          </p>
        </div>
      )}

      <Field label="Title">
        <Input
          value={draft.title}
          onChange={(v) => setDraft((d) => (d ? { ...d, title: v } : d))}
          placeholder="Expense title"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={expenseType} onChange={setExpenseType} options={EXPENSE_TYPES} />
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={draft.expense_date}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, expense_date: e.target.value } : d))
            }
            className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
      </div>

      {/* Line items */}
      <div>
        <span className="block text-[11.5px] text-text-muted mb-1.5">
          Line items
        </span>
        <div className="space-y-2.5">
          {draft.lines.map((l, idx) => (
            <div
              key={idx}
              className="rounded-[12px] bg-text-primary/[0.03] border border-line p-2.5 space-y-2"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Select
                    value={l.category_id ?? ""}
                    onChange={(v) => {
                      const cat = categories.find((c) => c.category_id === v);
                      patchLine(idx, {
                        category_id: v || null,
                        category_display: cat?.category_display ?? null,
                      });
                    }}
                    options={catOptions}
                  />
                </div>
                {draft.lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="text-text-muted hover:text-danger transition-colors shrink-0"
                    aria-label="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Input
                value={l.description}
                onChange={(v) => patchLine(idx, { description: v })}
                placeholder="What was this line for?"
              />
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  value={l.amount_ngn}
                  onChange={(v) => patchLine(idx, { amount_ngn: v })}
                  allowDecimal
                  placeholder="Amount ₦"
                />
                <Input
                  value={l.vendor_name ?? ""}
                  onChange={(v) => patchLine(idx, { vendor_name: v || null })}
                  placeholder="Vendor (optional)"
                />
              </div>
              {!l.category_id && (
                <p className="text-[11px] text-warn">Pick a category for this line.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5">
        <span className="text-[12px] text-text-muted">Total</span>
        <span className="text-[15px] font-semibold">
          <MoneyText ngn={total} />
        </span>
      </div>

      {categories.length === 0 && (
        <p className="text-[12px] text-warn">
          No expense categories exist yet — add one from the normal &ldquo;New
          Expense&rdquo; form first, then Praxis can file receipts against it.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
      autoComplete="off"
    />
  );
}
