import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartLine = {
  id: string;
  slug: string;
  name: string;
  image: string;
  price: number;
  variant: string;
  qty: number;
};

type CartCtx = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (line: Omit<CartLine, "id" | "qty"> & { qty?: number }) => void;
  remove: (id: string) => void;
  update: (id: string, qty: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "faitlyn.cart.v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch {}
  }, [lines]);

  const value = useMemo<CartCtx>(() => ({
    lines,
    open,
    setOpen,
    count: lines.reduce((s, l) => s + l.qty, 0),
    subtotal: lines.reduce((s, l) => s + l.qty * l.price, 0),
    add: (line) => {
      const id = `${line.slug}::${line.variant}`;
      setLines((cur) => {
        const ex = cur.find((l) => l.id === id);
        if (ex) return cur.map((l) => l.id === id ? { ...l, qty: l.qty + (line.qty ?? 1) } : l);
        return [...cur, { ...line, id, qty: line.qty ?? 1 }];
      });
      setOpen(true);
    },
    remove: (id) => setLines((cur) => cur.filter((l) => l.id !== id)),
    update: (id, qty) => setLines((cur) => qty <= 0 ? cur.filter((l) => l.id !== id) : cur.map((l) => l.id === id ? { ...l, qty } : l)),
    clear: () => setLines([]),
  }), [lines, open]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
