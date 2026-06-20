import { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  Loader2,
  Package,
  Layers,
  Box,
  Sparkles,
  Plus,
  Check,
  ShoppingBag,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import {
  searchByKind,
  type ProductKind,
  type ProductHit,
} from "@/lib/product-search";
import { smartcommApi } from "@/lib/smartcomm-api";
import { cn } from "@/lib/cn";
import type { ProductCard, Channel } from "@/lib/smartcomm-types";

// The in-chat picker offers services too (the ERP-wide PRODUCT_KINDS does not).
const CHAT_KINDS: { key: ProductKind; label: string }[] = [
  { key: "base", label: "Base Product" },
  { key: "styled", label: "Styled Product" },
  { key: "bundle", label: "Bundle" },
  { key: "service", label: "Service" },
];

const KIND_ICON: Record<ProductKind, typeof Package> = {
  base: Package,
  styled: Layers,
  bundle: Box,
  service: Sparkles,
};

const ngn = (v: string | number | null | undefined) =>
  v == null ? "—" : `₦${Number(v).toLocaleString()}`;

interface Selected extends ProductCard {
  qty: number;
}

/**
 * Multi-select catalogue picker — kind tabs (Base / Styled / Bundle / Service),
 * search per kind, image thumbnails. The selected items render as a small
 * cart at the bottom; sending posts a `product_share` message into the chat.
 * Product cards (not service) get a tap-to-order JWT link minted from the
 * existing /smartcomm/order-capture endpoint, so the customer can pay
 * without retyping their address.
 */
export function CataloguePickerModal({
  open,
  onClose,
  channel,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  channel: Channel;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<ProductKind>("styled");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when re-opened so the next chat doesn't see the previous selection.
  useEffect(() => {
    if (!open) {
      setSelected([]);
      setTerm("");
      setIntro("");
      setError(null);
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchByKind(kind, q);
        if (!cancelled) setHits(r);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, kind, term]);

  const contactId = useMemo(() => {
    const m = (channel.members ?? []).find((mm) => mm.contact_id);
    return m?.contact_id ?? channel.metadata?.contact_id ?? null;
  }, [channel]);

  function toggle(h: ProductHit) {
    setSelected((arr) => {
      const exists = arr.find((s) => s.kind === h.kind && s.id === h.id);
      if (exists)
        return arr.filter((s) => !(s.kind === h.kind && s.id === h.id));
      return [
        ...arr,
        {
          kind: h.kind,
          id: h.id,
          name: h.label,
          price: h.price ?? null,
          image_url: h.image_url ?? null,
          sub: h.sub,
          qty: 1,
        },
      ];
    });
  }

  function setQty(card: Selected, qty: number) {
    if (qty < 1) qty = 1;
    setSelected((arr) =>
      arr.map((s) =>
        s.kind === card.kind && s.id === card.id ? { ...s, qty } : s,
      ),
    );
  }

  function remove(card: Selected) {
    setSelected((arr) =>
      arr.filter((s) => !(s.kind === card.kind && s.id === card.id)),
    );
  }

  async function mintCaptureUrl(cards: Selected[]): Promise<string | null> {
    // Tap-to-order is only meaningful for product kinds (services convert
    // through the service-job flow). Skip when nothing's sellable, or when
    // we don't know the customer — the cards still render as a browse-only
    // carousel and the rep can drop a link manually.
    const products = cards.filter((c) => c.kind !== "service");
    if (!contactId || products.length === 0) return null;
    try {
      const r = await smartcommApi.createOrderCapture({
        contact_id: contactId,
        items: products.map((c) => ({
          product_id: c.id,
          qty: c.qty,
          price_ngn: c.price != null ? String(c.price) : undefined,
        })),
        sales_channel: channel.external_platform ?? undefined,
      });
      return r.url;
    } catch {
      return null;
    }
  }

  async function submit() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const capture_url = await mintCaptureUrl(selected);
      const cards: ProductCard[] = selected.map((s) => ({
        kind: s.kind,
        id: s.id,
        name: s.name,
        price: s.price ?? null,
        image_url: s.image_url ?? null,
        sub: s.sub ?? null,
        capture_url: s.kind === "service" ? null : capture_url,
      }));
      await smartcommApi.postMessage(channel.channel_id, {
        message_type: "product_share",
        metadata: { products: cards, intro: intro.trim() || undefined },
      });
      onSent();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send catalogue");
    } finally {
      setBusy(false);
    }
  }

  const isSelected = (h: ProductHit) =>
    selected.some((s) => s.kind === h.kind && s.id === h.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-accent" />
          Share catalogue
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={busy || selected.length === 0}
            icon={
              busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : undefined
            }
          >
            Send {selected.length ? `(${selected.length})` : ""}
          </Button>
        </>
      }
    >
      {/* Kind tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CHAT_KINDS.map((k) => {
          const Icon = KIND_ICON[k.key];
          const on = kind === k.key;
          return (
            <button
              key={k.key}
              onClick={() => {
                setKind(k.key);
                setHits([]);
                setTerm("");
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition-colors",
                on
                  ? "bg-accent/15 border-accent text-accent-glow"
                  : "hairline text-text-muted hover:text-text-primary",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border hairline bg-panel-2 px-2.5">
        <Search className="w-3.5 h-3.5 text-text-faint" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={
            kind === "service"
              ? "Find a service (revamp, install, repair…)"
              : "Find a product (min 2 chars)…"
          }
          className="w-full bg-transparent py-2 text-[12.5px] focus:outline-none placeholder:text-text-faint"
        />
        {loading && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-text-faint" />
        )}
      </div>

      {/* Results grid */}
      <div className="max-h-[36vh] overflow-y-auto -mx-1 px-1 mb-3">
        {term.trim().length < 2 ? (
          <div className="py-6 text-center text-[12px] text-text-faint">
            Start typing to search the {kind} catalogue
          </div>
        ) : hits.length === 0 && !loading ? (
          <div className="py-6 text-center text-[12px] text-text-faint">
            No matches
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {hits.map((h) => {
              const on = isSelected(h);
              return (
                <button
                  key={`${h.kind}-${h.id}`}
                  onClick={() => toggle(h)}
                  className={cn(
                    "group relative flex flex-col items-stretch text-left rounded-lg border hairline bg-panel-2 overflow-hidden hover:border-accent/50 transition-colors",
                    on && "border-accent ring-1 ring-accent/40",
                  )}
                >
                  <div className="aspect-square bg-panel grid place-items-center text-text-faint relative">
                    {h.image_url ? (
                      <img
                        src={h.image_url}
                        alt={h.label}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="w-6 h-6" />
                    )}
                    {on && (
                      <span className="absolute top-1.5 right-1.5 grid place-items-center w-5 h-5 rounded-full bg-accent text-bg shadow">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[12px] font-medium truncate">
                      {h.label}
                    </div>
                    <div className="text-[10.5px] text-text-faint truncate">
                      {h.sub}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart */}
      {selected.length > 0 && (
        <div className="border-t hairline pt-2 mb-3">
          <div className="text-[11px] uppercase tracking-wide text-text-faint mb-1.5">
            In carousel ({selected.length})
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {selected.map((s) => (
              <div
                key={`${s.kind}-${s.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-panel-2"
              >
                <div className="w-8 h-8 rounded bg-panel overflow-hidden grid place-items-center shrink-0">
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="w-3.5 h-3.5 text-text-faint" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate">{s.name}</div>
                  <div className="text-[10.5px] text-text-faint truncate">
                    {ngn(s.price)}
                  </div>
                </div>
                {s.kind !== "service" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setQty(s, s.qty - 1)}
                      className="grid place-items-center w-6 h-6 rounded-full hairline text-text-muted hover:text-text-primary"
                    >
                      <X className="w-3 h-3 rotate-45" />
                    </button>
                    <span className="text-[11.5px] font-mono w-5 text-center">
                      {s.qty}
                    </span>
                    <button
                      onClick={() => setQty(s, s.qty + 1)}
                      className="grid place-items-center w-6 h-6 rounded-full hairline text-text-muted hover:text-text-primary"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => remove(s)}
                  className="text-text-faint hover:text-danger"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional intro line */}
      <label className="block text-[11px] uppercase tracking-wide text-text-faint mb-1">
        Intro (optional)
      </label>
      <textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        placeholder="e.g. Hi love 💕 here are two styled cuts I think will suit you…"
        rows={2}
        className="w-full rounded-lg border hairline bg-panel-2 p-2 text-[12.5px] focus:outline-none placeholder:text-text-faint resize-none"
      />

      {error && <div className="mt-2 text-[11.5px] text-danger">{error}</div>}
      {selected.length > 0 && !contactId && (
        <div className="mt-2 text-[11px] text-text-faint">
          No customer is linked to this thread — cards will send for browsing
          only (no tap-to-order link).
        </div>
      )}
    </Modal>
  );
}
