import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Coins,
  AlertTriangle,
  Send,
  CheckCircle2,
  Settings2,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useActiveBusiness } from "@/stores/business";
import {
  whatsappTemplatesApi,
  CATEGORY_META,
  fmtRateNgn,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-templates-api";

/**
 * Composer template picker + send confirmation.
 *
 * Two (or three) steps:
 *   1. Pick an APPROVED template from the dropdown/list.
 *   2. Fill any {{1}} {{2}} body variables.
 *   3. Confirm — a full preview + the exact ₦ cost of this send, so no
 *      message goes out by accident. Only then does it reach the client.
 *
 * The parent handles the actual send via `onSend`, which receives the
 * Meta addressing + filled components and the rendered body (for the
 * thread bubble).
 */

export interface TemplateSendPayload {
  template_id: string;
  template_name: string;
  language: string;
  category: string;
  /** Meta send-time components (body parameters), or undefined if none. */
  components?: Array<Record<string, unknown>>;
  /** Body with variables substituted — shown in the thread. */
  rendered_body: string;
}

/** Positional {{n}} variables in the BODY component specifically. */
function bodyVariables(tpl: WhatsAppTemplate): number[] {
  const body = (tpl.components || []).find(
    (c) => (c.type || "").toUpperCase() === "BODY",
  );
  const text = body?.text || tpl.body_text || "";
  const out = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}

function renderBody(tpl: WhatsAppTemplate, values: Record<number, string>): string {
  const body = (tpl.components || []).find(
    (c) => (c.type || "").toUpperCase() === "BODY",
  );
  const text = body?.text || tpl.body_text || "";
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
    const v = values[Number(n)];
    return v && v.trim() ? v : `{{${n}}}`;
  });
}

export function TemplatePickerModal({
  open,
  onClose,
  onSend,
  sending,
  toName,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (payload: TemplateSendPayload) => void;
  sending?: boolean;
  toName?: string;
}) {
  const business = useActiveBusiness();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-templates", business.key],
    queryFn: () => whatsappTemplatesApi.list(),
    enabled: open,
  });

  const approved = useMemo(
    () => (data?.templates ?? []).filter((t) => t.status === "APPROVED"),
    [data],
  );
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return approved;
    return approved.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.body_text || "").toLowerCase().includes(needle),
    );
  }, [approved, q]);

  function reset() {
    setSelected(null);
    setValues({});
    setConfirm(false);
    setQ("");
  }

  function close() {
    reset();
    onClose();
  }

  function pick(tpl: WhatsAppTemplate) {
    setSelected(tpl);
    setValues({});
    const vars = bodyVariables(tpl);
    // No variables → go straight to confirm.
    setConfirm(vars.length === 0);
  }

  function doSend() {
    if (!selected) return;
    const vars = bodyVariables(selected);
    const components =
      vars.length > 0
        ? [
            {
              type: "body",
              parameters: vars.map((n) => ({
                type: "text",
                text: values[n] || "",
              })),
            },
          ]
        : undefined;
    onSend({
      template_id: selected.template_id,
      template_name: selected.name,
      language: selected.language,
      category: selected.category,
      components,
      rendered_body: renderBody(selected, values),
    });
  }

  const vars = selected ? bodyVariables(selected) : [];
  const allFilled = vars.every((n) => (values[n] || "").trim().length > 0);

  const title = confirm
    ? "Confirm send"
    : selected
      ? "Fill in the details"
      : "Send an approved template";

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={
        <span className="flex items-center gap-2">
          {(selected || confirm) && (
            <button
              onClick={() => (confirm && vars.length ? setConfirm(false) : reset())}
              className="p-1 -ml-1 rounded-lg hover:bg-panel-2 text-text-muted"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {title}
        </span>
      }
      footer={
        confirm && selected ? (
          <>
            <button
              onClick={close}
              className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={doSend}
              disabled={sending}
              className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Send to {toName || "customer"}
            </button>
          </>
        ) : selected && vars.length > 0 ? (
          <>
            <button
              onClick={reset}
              className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
            >
              Back
            </button>
            <button
              onClick={() => setConfirm(true)}
              disabled={!allFilled}
              className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              Review
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </>
        ) : undefined
      }
    >
      {/* Step 3 — confirm */}
      {confirm && selected ? (
        <ConfirmView tpl={selected} rendered={renderBody(selected, values)} />
      ) : selected && vars.length > 0 ? (
        /* Step 2 — fill variables */
        <div className="space-y-3">
          <p className="text-[12.5px] text-text-muted">
            <span className="font-mono text-accent-glow">{selected.name}</span>{" "}
            uses {vars.length} value{vars.length > 1 ? "s" : ""}. Fill them in —
            you&rsquo;ll see the final message before it sends.
          </p>
          {vars.map((n) => (
            <label key={n} className="block">
              <span className="block text-[11.5px] text-text-muted mb-1">
                Value for{" "}
                <code className="font-mono bg-panel-2 px-1 rounded">{`{{${n}}}`}</code>
              </span>
              <input
                value={values[n] || ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [n]: e.target.value }))
                }
                autoFocus={n === vars[0]}
                className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
              />
            </label>
          ))}
          <div className="rounded-xl bg-panel-2 border hairline p-3">
            <div className="text-[10.5px] uppercase tracking-widest text-text-faint mb-1">
              Preview
            </div>
            <p className="text-[13px] whitespace-pre-wrap">
              {renderBody(selected, values)}
            </p>
          </div>
        </div>
      ) : (
        /* Step 1 — pick */
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-panel-2 border hairline px-3 py-2 focus-within:border-accent/40">
            <Search className="w-4 h-4 text-text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search approved templates…"
              className="bg-transparent flex-1 text-[13px] focus:outline-none"
              autoComplete="off"
            />
          </div>

          {isLoading ? (
            <div className="py-8 grid place-items-center text-text-faint">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : approved.length === 0 ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-[12.5px] text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-[1px] shrink-0" />
                <div>
                  No approved templates yet. Create one and get it approved by
                  Meta under{" "}
                  <Link
                    to="/settings/whatsapp-templates"
                    onClick={close}
                    className="underline underline-offset-2 inline-flex items-center gap-1"
                  >
                    <Settings2 className="w-3 h-3" /> WhatsApp Templates
                  </Link>
                  .
                </div>
              </div>
            </div>
          ) : matches.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-text-faint italic">
              No templates match &ldquo;{q}&rdquo;.
            </p>
          ) : (
            <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1 space-y-1.5">
              {matches.map((t) => {
                const cat = CATEGORY_META[t.category];
                const free = t.cost && Number(t.cost.amount_ngn) === 0;
                return (
                  <button
                    key={t.template_id}
                    onClick={() => pick(t)}
                    className="w-full text-left rounded-xl border hairline bg-panel-2 hover:border-accent/40 p-3 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12.5px] text-accent-glow truncate">
                        {t.name}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-mono shrink-0">
                        <Coins className="w-3 h-3 text-text-faint" />
                        <span className={free ? "text-green-300" : "text-text-primary"}>
                          {t.cost ? fmtRateNgn(t.cost.amount_ngn) : "—"}
                        </span>
                      </span>
                    </div>
                    <p className="text-[12px] text-text-muted mt-1 line-clamp-2">
                      {t.body_text || "(no body)"}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-text-faint">
                        {cat?.label ?? t.category}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-text-faint ml-auto group-hover:text-accent-glow group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ConfirmView({
  tpl,
  rendered,
}: {
  tpl: WhatsAppTemplate;
  rendered: string;
}) {
  const cat = CATEGORY_META[tpl.category];
  const free = tpl.cost && Number(tpl.cost.amount_ngn) === 0;
  const header = (tpl.components || []).find(
    (c) => (c.type || "").toUpperCase() === "HEADER",
  );
  const footer = (tpl.components || []).find(
    (c) => (c.type || "").toUpperCase() === "FOOTER",
  );
  const buttons =
    ((tpl.components || []).find(
      (c) => (c.type || "").toUpperCase() === "BUTTONS",
    )?.buttons as Array<Record<string, unknown>>) || [];

  return (
    <div className="space-y-3">
      {/* WhatsApp-style bubble preview */}
      <div className="rounded-xl bg-[rgb(37_211_102/0.06)] border border-[rgb(37_211_102/0.25)] p-3.5">
        <div className="text-[10.5px] uppercase tracking-widest text-text-faint mb-2">
          This is exactly what {tpl.name} sends
        </div>
        {header?.text && (
          <p className="text-[13px] font-semibold mb-1">{header.text}</p>
        )}
        <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed">
          {rendered}
        </p>
        {footer?.text && (
          <p className="text-[11.5px] text-text-faint mt-1.5">{footer.text}</p>
        )}
        {buttons.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {buttons.map((b, i) => (
              <span
                key={i}
                className="text-[11.5px] text-info border border-info/30 bg-info/5 rounded-lg px-2.5 py-1"
              >
                {String(b.text || "")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Cost callout */}
      <div
        className={`flex items-center justify-between rounded-xl border p-3 ${
          free
            ? "border-green-400/30 bg-green-400/5"
            : "border-amber-400/30 bg-amber-400/5"
        }`}
      >
        <div className="flex items-center gap-2">
          <Coins
            className={`w-4 h-4 ${free ? "text-green-300" : "text-amber-300"}`}
          />
          <div>
            <div className="text-[12.5px] font-medium">
              {cat?.label ?? tpl.category} template
            </div>
            <div className="text-[11px] text-text-faint">
              Billed by Meta on send
            </div>
          </div>
        </div>
        <div
          className={`font-mono text-[16px] ${
            free ? "text-green-300" : "text-amber-200"
          }`}
        >
          {tpl.cost ? fmtRateNgn(tpl.cost.amount_ngn) : "—"}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11.5px] text-text-faint">
        <CheckCircle2 className="w-3.5 h-3.5 text-accent-glow" />
        Double-check the details above — this goes straight to the customer.
      </p>
    </div>
  );
}
