import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BRANDS, type BrandId, type BrandTokens } from "@/lib/brands";

interface Ctx {
  brand: BrandTokens;
  brandId: BrandId;
  setBrandId: (id: BrandId) => void;
}

const BrandCtx = createContext<Ctx | null>(null);

export function BrandProvider({ children, initial = "pixie" }: { children: ReactNode; initial?: BrandId }) {
  const [brandId, setBrandId] = useState<BrandId>(initial);
  const brand = BRANDS[brandId];

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(brand.cssVars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.brand = brand.id;
  }, [brand]);

  const value = useMemo(() => ({ brand, brandId, setBrandId }), [brand, brandId]);
  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useBrand() {
  const ctx = useContext(BrandCtx);
  if (!ctx) throw new Error("useBrand must be used inside BrandProvider");
  return ctx;
}
