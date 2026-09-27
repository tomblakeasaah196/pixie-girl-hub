import { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  Loader2,
  Package,
  Layers,
  Box,
  Sparkles,
  Droplets,
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
import { resolveMessagingSalesChannel } from "@/lib/messaging-utils";
import { cn } from "@/lib/cn";
import { toastReport } from "@/lib/error-report";
import type { ProductCard, Channel } from "@/lib/smartcomm-types";
import { useCareAvailability } from "@/lib/care-accessories";
import {
  StyledVariantPicker,
  type StyledPick,
} from "@/components/catalogue/StyledVariantPicker";

// The in-chat picker offers services too (the ERP-wide PRODUCT_KINDS does not).
// PR 3: Care & Accessories are chat-shareable. The search kind is "care"; the
// shared card + /o order-link item kind is "retail" and carries the EXACT
// variant id the operator picked (no default-size guessing). The chip is only
// offered when the brand's care gate is on; the server re-checks regardless.
type ChatKind = ProductKind;
type CardKind = ProductCard["kind"];
const CHAT_KINDS: { key: ChatKind; label: string }[] = [
  { key: "base", label: "Base Product" },
  { key: "styled", label: "Styled Product" },
  { key: "bundle", label: "Bundle" },
  { key: "service", label: "Service" },
  { key: "care", label: "Care & Accessories" },
];

const KIND_ICON: Record<ProductKind, typeof Package> = {
  base: Package,
  styled: Layers,
  bundle: Box,
  service: Sparkles,
  care: Droplets,
};

/** Search kind → shared card kind. */
const cardKind = (k: ProductKind): CardKind => (k === "care" ? "retail" : k);

const ngn = (v: string | number | null | undefined) =>
  v == null ? "—" : `₦${Number(v).toLocaleString()}`;

interface Selected extends ProductCard {
  qty: number;
}

/** True when a styled hit still needs a size/lace pick before it can be added. */
function isStyled(h: ProductHit) {
  return h.kind === "styled";
}

/**
 * Multi-select catalogue picker — kind tabs (Base / Styled / Bundle / Service),
 * search per kind, image thumbnails. The selected items render as a small
 * cart at the bottom; sending posts a `product_share` message into the chat.
 * The whole selection is minted as ONE short `/o/<slug>` order link (via
 * /smartcomm/order-link) so the customer opens a mini-shop, picks what they
 * want, and pays — without retyping their address.
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
  // Care chip only when the PXG gate + flag are on (server re-checks).
  const careAvail = useCareAvailability();
  const chatKinds = useMemo(
    () => CHAT_KINDS.filter((k) => k.key !== "care" || careAvail.data?.enabled === true),
    [careAvail.data?.enabled],
  );
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The currency the customer pays in — ₦ or $ (Nomba charges nothing else).
  // A $ link shows each item's catalogue USD price and charges in dollars.
  const [linkCurrency, setLinkCurrency] = useState<"NGN" | "USD">("NGN");
  // A styled hit awaiting a size/lace pick (opens StyledVariantPicker).
  const [pendingStyled, setPendingStyled] = useState<ProductHit | null>(null);

  // Reset when re-opened so the next chat doesn't see the previous selection.
  useEffect(() => {
    if (!open) {
      setSelected([]);
      setTerm("");
      setIntro("");
      setError(null);
      setHits([]);
      setPendingStyled(null);
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
    const chatKind: CardKind = cardKind(h.kind);
    const exists = selected.find((s) => s.kind === chatKind && s.id === h.id);
    if (exists) {
      setSelected((arr) =>
        arr.filter((s) => !(s.kind === chatKind && s.id === h.id)),
      );
      return;
    }
    // Styled products price by head size × lace × colour — pick the variant
    // before adding so the shared card + order carry the right price.
    if (isStyled(h)) {
      setPendingStyled(h);
      return;
    }
    setSelected((arr) => [
      ...arr,
      {
        kind: chatKind,
        id: h.id,
        name: h.label,
        price: h.price ?? null,
        image_url: h.image_url ?? null,
        sub: h.sub,
        qty: 1,
        // Care: the exact SKU behind the hit (id is its variant id).
        ...(h.kind === "care" && h.care
          ? { product_id: h.care.product_id, sku: h.care.sku }
          : {}),
      },
    ]);
  }

  function addStyledPick(h: ProductHit, pick: StyledPick) {
    const variant = {
      price: pick.price ?? h.price ?? null,
      sub: pick.spec || h.sub,
      spec: pick.spec || null,
      styled_variant_id: pick.styled_variant_id,
      size_code: pick.size_code,
      lace_code: pick.lace_code,
      colour_id: pick.colour_id,
    };
    // Items are identified by (kind,id), so re-picking a styled product
    // updates its chosen variant rather than adding a duplicate card.
    setSelected((arr) => {
      const existing = arr.find((s) => s.kind === "styled" && s.id === h.id);
      if (existing) {
        return arr.map((s) =>
          s.kind === "styled" && s.id === h.id ? { ...s, ...variant } : s,
        );
      }
      return [
        ...arr,
        {
          kind: "styled",
          id: h.id,
          name: h.label,
          image_url: h.image_url ?? null,
          qty: 1,
          ...variant,
        },
      ];
    });
    setPendingStyled(null);
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

  async function mintOrderLinkUrl(cards: Selected[]): Promise<string | null> {
    // Shared catalogues mint a short `/o/<slug>` order link: one mini-shop
    // page with the curated picks where the CUSTOMER chooses items +
    // quantities and pays. Services are orderable too (they become booking
    // requests). Works without a linked contact — checkout collects the
    // customer inline. Mint failures are surfaced, not swallowed: silent
    // 'Browse only' fallbacks hid a broken validator for weeks.
    if (cards.length === 0) return null;
    const r = await smartcommApi.createOrderLink({
      contact_id: contactId ?? undefined,
      channel_id: channel.channel_id,
      items: cards.map((c) => ({
        kind: c.kind,
        product_id:
          c.kind === "base"
            ? c.id
            : c.kind === "retail"
              ? (c.product_id ?? undefined)
              : undefined,
        variant_id: c.kind === "retail" ? c.id : undefined,
        sku: c.kind === "retail" ? (c.sku ?? undefined) : undefined,
        styled_id: c.kind === "styled" ? c.id : undefined,
        bundle_id: c.kind === "bundle" ? c.id : undefined,
        service_id: c.kind === "service" ? c.id : undefined,
        qty: c.qty,
        price_ngn: c.price != null ? String(c.price) : undefined,
        // Staff-picked styled variant → the order is priced + fulfilled
        // for this exact head size / lace / colour.
        styled_variant_id: c.styled_variant_id ?? undefined,
        size_code: c.size_code ?? undefined,
        lace_code: c.lace_code ?? undefined,
        colour_id: c.colour_id ?? undefined,
        spec: c.spec ?? undefined,
      })),
      sales_channel: resolveMessagingSalesChannel(channel.external_platform),
      currency: linkCurrency,
    });
    return r.url;
  }

  async function submit() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const capture_url = await mintOrderLinkUrl(selected);
      const cards: ProductCard[] = selected.map((s) => ({
        kind: s.kind,
        id: s.id,
        name: s.name,
        price: s.price ?? null,
        image_url: s.image_url ?? null,
        sub: s.sub ?? null,
        product_id: s.product_id ?? null,
        sku: s.sku ?? null,
        capture_url,
        // Carry the picked variant so the shared bubble shows the right
        // size/lace + price (not the base anchor).
        spec: s.spec ?? null,
        styled_variant_id: s.styled_variant_id ?? null,
        size_code: s.size_code ?? null,
        lace_code: s.lace_code ?? null,
        colour_id: s.colour_id ?? null,
      }));
      await smartcommApi.postMessage(channel.channel_id, {
        message_type: "product_share",
        metadata: { products: cards, intro: intro.trim() || undefined },
      });
      onSent();
      onClose();
    } catch (e: unknown) {
      toastReport("Messaging → Catalogue picker", "Send catalogue", e);
      setError(e instanceof Error ? e.message : "Could not send catalogue");
    } finally {
      setBusy(false);
    }
  }

  const isSelected = (h: ProductHit) =>
    selected.some((s) => s.kind === cardKind(h.kind) && s.id === h.id);

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
          <div
            className="mr-auto inline-flex items-center rounded-full border border-line p-0.5 text-[12px] font-semibold"
            role="group"
            aria-label="Customer pays in"
            title="Currency the customer pays in"
          >
            {(["NGN", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setLinkCurrency(c)}
                aria-pressed={linkCurrency === c}
                className={
                  "h-7 px-3 rounded-full transition-colors " +
                  (linkCurrency === c
                    ? "bg-accent/10 text-accent-readable"
                    : "text-text-muted hover:text-text-primary")
                }
              >
                {c === "NGN" ? "Pay in ₦" : "Pay in $"}
              </button>
            ))}
          </div>
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
        {chatKinds.map((k) => {
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
          className="w-full bg-transparent py-2 text-[12.5px] focus:outline-none placeholder:text-text-faint" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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
                  {s.spec && (
                    <div className="text-[10.5px] text-accent-glow truncate">
                      {s.spec}
                    </div>
                  )}
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
          No customer is linked to this thread yet — the order link will ask
          them for their details at checkout and link them automatically.
        </div>
      )}

      {pendingStyled && (
        <StyledVariantPicker
          styledId={pendingStyled.id}
          productName={pendingStyled.label}
          anchorPrice={
            pendingStyled.price != null ? Number(pendingStyled.price) : null
          }
          onCancel={() => setPendingStyled(null)}
          onConfirm={(pick) => addStyledPick(pendingStyled, pick)}
        />
      )}
    </Modal>
  );
}
