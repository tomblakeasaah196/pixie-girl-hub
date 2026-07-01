import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getCart, updateCartItem, removeCartItem, fmt } from "@/lib/storefront";
import { useCartDrawer, notifyCartChanged } from "@/lib/useStore";

/**
 * "Your bag" slide-over (ported to match the reference, simplified to the bag
 * step + summary — the full multi-step checkout lives on /checkout). Wired to
 * the persistent Hub cart; Continue routes to the storefront checkout.
 */
export function CartDrawer() {
  const { open, setOpen } = useCartDrawer();
  const navigate = useNavigate();

  const { data, refetch } = useQuery({
    queryKey: ["cart-drawer"],
    queryFn: () => getCart(),
    enabled: open,
  });
  const items = data?.items ?? [];

  useEffect(() => {
    const h = () => refetch();
    window.addEventListener("sf:cart-changed", h);
    return () => window.removeEventListener("sf:cart-changed", h);
  }, [refetch]);

  const n = (x: unknown) => (x == null ? 0 : Number(x) || 0);
  const subtotalNgn = items.reduce(
    (s, it) => s + n(it.unit_price_ngn) * (Number(it.quantity) || 1),
    0,
  );

  async function setQty(id: string, qty: number) {
    if (qty < 1) return remove(id);
    try {
      await updateCartItem(id, qty);
      notifyCartChanged();
    } catch {
      toast.error("Couldn't update quantity.");
    }
  }
  async function remove(id: string) {
    try {
      await removeCartItem(id);
      notifyCartChanged();
    } catch {
      toast.error("Couldn't remove item.");
    }
  }

  function checkout() {
    setOpen(false);
    navigate({ to: "/checkout" });
  }
  function keepShopping() {
    setOpen(false);
    navigate({ to: "/shop" });
  }

  // Bag summary shows canonical NGN; full multi-currency settlement is at checkout.
  const money = (ngn: number) => fmt(ngn, "NGN");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-ink/70 backdrop-blur-sm z-[95]"
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-ink text-cream border-l border-taupe/20 z-[96] flex flex-col"
          >
            <header className="flex items-center justify-between p-6 border-b border-taupe/15">
              <h2 className="font-display text-2xl">Your bag</h2>
              <button onClick={() => setOpen(false)} className="text-taupe text-xs tracking-[0.3em] uppercase hover:text-cream transition-colors">
                Close
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-6 p-10 text-center">
                  <p className="text-cream/50">Your bag is empty.</p>
                  <button onClick={keepShopping} className="border border-taupe/40 text-taupe px-8 py-3.5 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-taupe/10 transition-colors">
                    Continue shopping
                  </button>
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  {items.map((it) => (
                    <div key={it.cart_item_id} className="flex gap-4">
                      <div className="w-20 h-24 shrink-0 overflow-hidden bg-card">
                        {it.thumbnail_url_snapshot ? (
                          <img src={it.thumbnail_url_snapshot} alt={it.product_name_snapshot} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="flex-1 flex flex-col">
                        <div className="flex justify-between gap-2">
                          <h3 className="font-display text-lg leading-tight">{it.product_name_snapshot}</h3>
                          <span className="text-sm text-taupe whitespace-nowrap">
                            {money(n(it.unit_price_ngn) * (Number(it.quantity) || 1))}
                          </span>
                        </div>
                        {it.variant_label_snapshot ? (
                          <p className="text-[0.62rem] tracking-[0.2em] uppercase text-cream/50 mt-1">{it.variant_label_snapshot}</p>
                        ) : null}
                        <div className="mt-auto flex items-center justify-between pt-3">
                          <div className="flex items-center border border-taupe/30">
                            <button onClick={() => setQty(it.cart_item_id, (Number(it.quantity) || 1) - 1)} className="px-3 py-1 hover:bg-taupe/10 transition-colors">−</button>
                            <span className="px-3 text-sm">{it.quantity}</span>
                            <button onClick={() => setQty(it.cart_item_id, (Number(it.quantity) || 1) + 1)} className="px-3 py-1 hover:bg-taupe/10 transition-colors">+</button>
                          </div>
                          <button onClick={() => remove(it.cart_item_id)} className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/50 hover:text-cream transition-colors">
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="p-6 border-t border-taupe/15 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="tracking-[0.25em] uppercase text-cream/70">Subtotal</span>
                <span className="text-cream">{money(subtotalNgn)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="tracking-[0.25em] uppercase text-cream/70">Shipping</span>
                <span className="text-cream/70">Calculated at checkout</span>
              </div>
              <div className="flex justify-between items-end pt-2 border-t border-taupe/10">
                <span className="tracking-[0.3em] uppercase text-taupe text-xs">Total</span>
                <span className="font-display text-2xl">{money(subtotalNgn)}</span>
              </div>
              <button
                disabled={items.length === 0}
                onClick={checkout}
                className="w-full py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase disabled:opacity-40 hover:bg-cream transition-colors"
              >
                Continue
              </button>
              <p className="text-[0.55rem] tracking-[0.25em] uppercase text-cream/40 text-center">
                No card charged · concierge confirms within 24 hours
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
