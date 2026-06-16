import { useMemo, useState } from "react";
import {
  ShoppingCart,
  Loader2,
  Plus,
  X,
  Send,
  Search,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { smartcommApi } from "@/lib/smartcomm-api";
import { useBaseProducts } from "@/lib/catalogue";
import type { Channel } from "@/lib/smartcomm-types";

interface Props {
  open: boolean;
  onClose: () => void;
  channel: Channel;
  onSentLink: (url: string) => void | Promise<void>;
}

interface LineItem {
  product_id: string;
  name: string;
  qty: number;
  note?: string;
}

/**
 * Order Capture modal — staff picks products + quantities, the Hub
 * mints a token-bound pre-fill URL, and the link gets sent into the
 * chat as a message. Customer opens it, confirms address (pre-filled
 * from contact_addresses), pays via gateway.
 *
 * The `sales_channel` rides the platform the conversation came from,
 * so commission attribution + revenue-by-channel reports stay clean.
 */
export function OrderCaptureModal({
  open,
  onClose,
  channel,
  onSentLink,
}: Props) {
  const customer = channel.members?.find((m) => m.contact_id);
  const contactId = customer?.contact_id ?? null;
  const platform: string = channel.external_platform || "whatsapp";

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const productsQ = useBaseProducts({ q: search || undefined });

  const total = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);
  const canSend = items.length > 0 && contactId;

  function addItem(product_id: string, name: string) {
    setItems((arr) => {
      const existing = arr.find((i) => i.product_id === product_id);
      if (existing) {
        return arr.map((i) =>
          i.product_id === product_id ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...arr, { product_id, name, qty: 1 }];
    });
  }
  function setQty(product_id: string, qty: number) {
    if (qty <= 0) {
      setItems((arr) => arr.filter((i) => i.product_id !== product_id));
      return;
    }
    setItems((arr) =>
      arr.map((i) => (i.product_id === product_id ? { ...i, qty } : i)),
    );
  }
  function setNote(product_id: string, note: string) {
    setItems((arr) =>
      arr.map((i) => (i.product_id === product_id ? { ...i, note } : i)),
    );
  }
  function remove(product_id: string) {
    setItems((arr) => arr.filter((i) => i.product_id !== product_id));
  }

  async function generate() {
    if (!contactId) {
      setError("This thread isn't linked to a customer. Open the Online QR form first.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const r = await smartcommApi.createOrderCapture({
        contact_id: contactId,
        items: items.map((i) => ({
          product_id: i.product_id,
          qty: i.qty,
          note: i.note,
        })),
        sales_channel: platform === "internal" ? "whatsapp" : platform,
        notes: notes || undefined,
      });
      setGeneratedUrl(r.url);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't create the order link. Try again.",
      );
    } finally {
      setSending(false);
    }
  }

  async function sendAndClose() {
    if (!generatedUrl) return;
    try {
      setSending(true);
      await onSentLink(generatedUrl);
      onClose();
      // Reset for next open
      setItems([]);
      setNotes("");
      setGeneratedUrl(null);
      setSearch("");
    } finally {
      setSending(false);
    }
  }

  function copyLink() {
    if (!generatedUrl) return;
    navigator.clipboard?.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal open={open} onClose={onClose} title="Capture an order">
      <div className="space-y-4">
        {!contactId && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200">
            <AlertCircle className="w-3.5 h-3.5 mt-[2px] shrink-0" />
            <div>
              This thread isn&rsquo;t linked to a customer profile yet. Send
              the Online QR welcome form first so the order can attach to
              their record.
            </div>
          </div>
        )}

        {/* Search */}
        <div>
          <span className="block text-[11px] uppercase tracking-widest text-text-faint mb-1.5">
            Add products
          </span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name or code…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-panel-2 border hairline text-[13px] focus:outline-none focus:border-accent/40"
            />
          </div>
          {search && (
            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border hairline bg-panel-2/70">
              {productsQ.isLoading ? (
                <div className="p-3 text-center text-[12px] text-text-faint">
                  <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
                  Loading…
                </div>
              ) : productsQ.data && productsQ.data.length > 0 ? (
                productsQ.data.slice(0, 15).map((p) => (
                  <button
                    key={p.product_id}
                    onClick={() => {
                      addItem(p.product_id, p.name);
                      setSearch("");
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-panel border-b hairline last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] truncate">{p.name}</div>
                      <div className="text-[10.5px] text-text-faint font-mono">
                        {p.product_code}
                      </div>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-accent-glow shrink-0" />
                  </button>
                ))
              ) : (
                <p className="p-3 text-center text-[12px] italic text-text-faint">
                  No products match &ldquo;{search}&rdquo;.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div>
            <span className="block text-[11px] uppercase tracking-widest text-text-faint mb-1.5">
              {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
              {total} unit{total === 1 ? "" : "s"}
            </span>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {items.map((i) => (
                <div
                  key={i.product_id}
                  className="rounded-xl bg-panel-2 border hairline p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[12.5px] truncate">
                      {i.name}
                    </span>
                    <div className="inline-flex items-center gap-1 bg-panel rounded-lg p-0.5">
                      <button
                        onClick={() => setQty(i.product_id, i.qty - 1)}
                        className="w-6 h-6 grid place-items-center hover:text-accent-glow"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-[12.5px] font-medium">
                        {i.qty}
                      </span>
                      <button
                        onClick={() => setQty(i.product_id, i.qty + 1)}
                        className="w-6 h-6 grid place-items-center hover:text-accent-glow"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => remove(i.product_id)}
                      className="text-text-muted hover:text-danger"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    value={i.note ?? ""}
                    onChange={(e) => setNote(i.product_id, e.target.value)}
                    placeholder="Note for this item (colour, custom style…)"
                    className="w-full mt-1.5 bg-transparent border-t hairline pt-1.5 text-[11.5px] focus:outline-none placeholder:text-text-faint"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-text-faint mb-1.5">
            Internal note (optional)
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. priority shipping requested"
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12.5px] focus:outline-none focus:border-accent/40"
          />
        </label>

        {error && (
          <p className="text-[12px] text-danger inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </p>
        )}

        {/* Generated link */}
        {generatedUrl && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <span className="block text-[11px] uppercase tracking-widest text-text-faint mb-1.5">
              Link ready
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-[11.5px] font-mono text-text-primary bg-bg/50 rounded-lg px-2 py-1.5 border hairline">
                {generatedUrl}
              </code>
              <button
                onClick={copyLink}
                title="Copy"
                className="rounded-lg bg-panel-2 border hairline p-2 hover:border-accent/40"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-text-muted" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-text-faint mt-1.5">
              Customer confirms their address + pays via the gateway. Link
              expires in 24 hours.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        {!generatedUrl ? (
          <button
            onClick={generate}
            disabled={!canSend || sending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <ShoppingCart className="w-3.5 h-3.5" />
                Generate link
              </>
            )}
          </button>
        ) : (
          <button
            onClick={sendAndClose}
            disabled={sending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                Send into chat
              </>
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}
