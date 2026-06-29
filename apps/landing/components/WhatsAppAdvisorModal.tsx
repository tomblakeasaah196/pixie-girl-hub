"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronLeft, Package, Sparkles, X } from "lucide-react";
import type {
  LandingBundle,
  LandingPayload,
  LandingProduct,
} from "@/lib/types";
import { money } from "@/lib/format";

type Tab = "bundles" | "products";
type Step = "pick" | "preview";

interface Selection {
  bundleIds: Set<string>;
  productKeys: Set<string>;
}

function productKey(p: LandingProduct): string {
  return p.styled_id || p.product_id || p.name || "";
}

function effectiveProductPriceNgn(p: LandingProduct): number | null {
  const campaign = p.campaign_price_ngn;
  if (campaign != null && Number.isFinite(Number(campaign)))
    return Number(campaign);
  const regular = p.regular_price_ngn;
  if (regular != null && Number.isFinite(Number(regular))) return Number(regular);
  return null;
}

function bundlePriceNgn(b: LandingBundle): number | null {
  const v = b.campaign_bundle_price_ngn;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function campaignUrl(slug: string): string {
  if (typeof window === "undefined") return `/sale/${slug}`;
  return `${window.location.origin}/sale/${slug}`;
}

function buildMessage(
  payload: LandingPayload,
  bundles: LandingBundle[],
  products: LandingProduct[],
): string {
  const lines: string[] = [];
  lines.push(
    `Hi! I'm browsing the ${payload.name} drop and would love your advice on:`,
  );
  lines.push("");

  for (const b of bundles) {
    const price = bundlePriceNgn(b);
    lines.push(
      `📦 Bundle: ${b.bundle_name}${price != null ? ` — ${money(price)}` : ""}`,
    );
    if (b.total_savings_ngn && Number(b.total_savings_ngn) > 0) {
      lines.push(`   Save ${money(Number(b.total_savings_ngn))}`);
    }
    if (b.description) lines.push(`   ${b.description}`);
    if (b.components && b.components.length) {
      const items = b.components
        .map((c) => c.display_name)
        .filter(Boolean)
        .join(", ");
      if (items) lines.push(`   Includes: ${items}`);
    }
    lines.push("");
  }

  for (const p of products) {
    const price = effectiveProductPriceNgn(p);
    lines.push(
      `⭐ Product: ${p.name || "Featured piece"}${price != null ? ` — ${money(price)}` : ""}`,
    );
    if (p.short_description) lines.push(`   ${p.short_description}`);
    lines.push("");
  }

  lines.push("Could you help me decide what's best?");
  lines.push("");
  lines.push(`— Sent from ${campaignUrl(payload.slug)}`);
  return lines.join("\n");
}

export function WhatsAppAdvisorModal({
  open,
  onClose,
  payload,
  waNumber,
}: {
  open: boolean;
  onClose: () => void;
  payload: LandingPayload;
  waNumber: string;
}) {
  const bundles = useMemo(() => payload.bundles || [], [payload.bundles]);
  const products = useMemo(
    () => (payload.products || []).filter((p) => p && p.name),
    [payload.products],
  );

  const [tab, setTab] = useState<Tab>(
    bundles.length > 0 ? "bundles" : "products",
  );
  const [step, setStep] = useState<Step>("pick");
  const [selection, setSelection] = useState<Selection>({
    bundleIds: new Set(),
    productKeys: new Set(),
  });

  useEffect(() => {
    if (!open) {
      setStep("pick");
      setSelection({ bundleIds: new Set(), productKeys: new Set() });
      setTab(bundles.length > 0 ? "bundles" : "products");
    }
  }, [open, bundles.length]);

  const selectedBundles = useMemo(
    () => bundles.filter((b) => selection.bundleIds.has(b.bundle_id)),
    [bundles, selection.bundleIds],
  );
  const selectedProducts = useMemo(
    () => products.filter((p) => selection.productKeys.has(productKey(p))),
    [products, selection.productKeys],
  );
  const totalSelected = selectedBundles.length + selectedProducts.length;

  function toggleBundle(id: string) {
    setSelection((prev) => {
      const next = new Set(prev.bundleIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, bundleIds: next };
    });
  }

  function toggleProduct(key: string) {
    setSelection((prev) => {
      const next = new Set(prev.productKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, productKeys: next };
    });
  }

  const message = useMemo(
    () =>
      step === "preview"
        ? buildMessage(payload, selectedBundles, selectedProducts)
        : "",
    [step, payload, selectedBundles, selectedProducts],
  );

  function sendOnWhatsApp() {
    const phone = waNumber.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  const hasBundles = bundles.length > 0;
  const hasProducts = products.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 95,
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.62)",
              backdropFilter: "blur(4px)",
            }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Ask for advice on WhatsApp"
            className="dropglass relative flex w-[min(560px,96vw)] max-h-[88vh] flex-col rounded-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 pt-5 pb-4">
              <div className="flex items-start gap-3">
                {step === "preview" && (
                  <button
                    type="button"
                    onClick={() => setStep("pick")}
                    className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"
                    aria-label="Back to selection"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <div>
                  <h2 className="font-display text-[20px] leading-tight">
                    {step === "pick"
                      ? "Need advice on a piece?"
                      : "Your message"}
                  </h2>
                  <p className="mt-1 text-[12.5px] text-[rgb(var(--text-muted))]">
                    {step === "pick"
                      ? "Pick what you'd like guidance on — we'll craft the message for you."
                      : "Review and send. You can edit on WhatsApp before sending."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {step === "pick" && (
              <>
                <div className="flex gap-1 border-b border-white/10 px-5 pt-3">
                  {hasBundles && (
                    <TabButton
                      label="Bundles"
                      icon={<Package className="h-3.5 w-3.5" />}
                      active={tab === "bundles"}
                      count={selection.bundleIds.size}
                      onClick={() => setTab("bundles")}
                    />
                  )}
                  {hasProducts && (
                    <TabButton
                      label="Featured products"
                      icon={<Sparkles className="h-3.5 w-3.5" />}
                      active={tab === "products"}
                      count={selection.productKeys.size}
                      onClick={() => setTab("products")}
                    />
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {tab === "bundles" && (
                    <BundleList
                      bundles={bundles}
                      selectedIds={selection.bundleIds}
                      onToggle={toggleBundle}
                    />
                  )}
                  {tab === "products" && (
                    <ProductList
                      products={products}
                      selectedKeys={selection.productKeys}
                      onToggle={toggleProduct}
                    />
                  )}
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
                  <span className="text-[12px] text-[rgb(var(--text-muted))]">
                    {totalSelected === 0
                      ? "Pick at least one item"
                      : `${totalSelected} selected`}
                  </span>
                  <button
                    type="button"
                    disabled={totalSelected === 0}
                    onClick={() => setStep("preview")}
                    className="btn-cta cta-sheen h-11 rounded-xl px-6 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Preview message
                  </button>
                </footer>
              </>
            )}

            {step === "preview" && (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-4 font-body text-[13px] leading-relaxed text-[rgb(var(--text))]">
                    {message}
                  </pre>
                </div>
                <footer className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setStep("pick")}
                    className="h-11 rounded-xl border border-white/15 px-5 text-[13px] font-semibold hover:bg-white/5"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={sendOnWhatsApp}
                    className="btn-cta cta-sheen h-11 rounded-xl px-6 font-semibold"
                  >
                    Send on WhatsApp
                  </button>
                </footer>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12.5px] font-semibold transition",
        active
          ? "bg-white/8 text-[rgb(var(--text))]"
          : "text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]",
      ].join(" ")}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="ml-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-[rgb(var(--brand-accent))] px-1.5 text-[11px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function BundleList({
  bundles,
  selectedIds,
  onToggle,
}: {
  bundles: LandingBundle[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (bundles.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[rgb(var(--text-muted))]">
        No bundles in this drop.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {bundles.map((b) => {
        const selected = selectedIds.has(b.bundle_id);
        const price = bundlePriceNgn(b);
        return (
          <li key={b.bundle_id}>
            <button
              type="button"
              onClick={() => onToggle(b.bundle_id)}
              className={[
                "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition",
                selected
                  ? "border-[rgb(var(--brand-accent))] bg-[rgb(var(--brand-accent)/0.10)]"
                  : "border-white/10 hover:border-white/25 hover:bg-white/5",
              ].join(" ")}
              aria-pressed={selected}
            >
              <Thumb
                src={b.bundle_hero_image_url}
                alt={b.bundle_name}
                seed={b.bundle_id}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">
                  {b.bundle_name}
                </div>
                {b.description && (
                  <div className="line-clamp-1 text-[11.5px] text-[rgb(var(--text-muted))]">
                    {b.description}
                  </div>
                )}
                {price != null && (
                  <div className="mt-0.5 text-[12px] font-mono text-[rgb(var(--brand-accent))]">
                    {money(price)}
                  </div>
                )}
              </div>
              <SelectionDot selected={selected} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProductList({
  products,
  selectedKeys,
  onToggle,
}: {
  products: LandingProduct[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (products.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[rgb(var(--text-muted))]">
        No featured products in this drop.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {products.map((p) => {
        const key = productKey(p);
        const selected = selectedKeys.has(key);
        const price = effectiveProductPriceNgn(p);
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onToggle(key)}
              className={[
                "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition",
                selected
                  ? "border-[rgb(var(--brand-accent))] bg-[rgb(var(--brand-accent)/0.10)]"
                  : "border-white/10 hover:border-white/25 hover:bg-white/5",
              ].join(" ")}
              aria-pressed={selected}
            >
              <Thumb src={p.image_url} alt={p.name || "Product"} seed={key} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">
                  {p.name || "Styled piece"}
                </div>
                {p.short_description && (
                  <div className="line-clamp-1 text-[11.5px] text-[rgb(var(--text-muted))]">
                    {p.short_description}
                  </div>
                )}
                {price != null && (
                  <div className="mt-0.5 text-[12px] font-mono text-[rgb(var(--brand-accent))]">
                    {money(price)}
                  </div>
                )}
              </div>
              <SelectionDot selected={selected} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thumb({
  src,
  alt,
  seed,
}: {
  src?: string | null;
  alt: string;
  seed: string;
}) {
  if (!src) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return (
      <div
        className="h-12 w-12 flex-shrink-0 rounded-lg"
        style={{
          background: `linear-gradient(150deg, hsl(${h} 60% 35%), hsl(${(h + 60) % 360} 50% 25%))`,
        }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg">
      <Image src={src} alt={alt} fill className="object-cover" sizes="48px" />
    </div>
  );
}

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={[
        "grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border transition",
        selected
          ? "border-[rgb(var(--brand-accent))] bg-[rgb(var(--brand-accent))] text-white"
          : "border-white/30",
      ].join(" ")}
      aria-hidden="true"
    >
      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}
