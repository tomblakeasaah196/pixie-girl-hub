import { useEffect, useRef } from "react";
import { create } from "zustand";

export interface Crumb {
  label: string;
  href?: string;
}

interface BreadcrumbState {
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
  clear: () => void;
}

export const useBreadcrumbStore = create<BreadcrumbState>()((set) => ({
  crumbs: [],
  setCrumbs: (crumbs) => set({ crumbs }),
  clear: () => set({ crumbs: [] }),
}));

export function useBreadcrumbs(crumbs: Crumb[]) {
  const setCrumbs = useBreadcrumbStore((s) => s.setCrumbs);
  const clear = useBreadcrumbStore((s) => s.clear);
  const serialised = JSON.stringify(crumbs);
  const prev = useRef(serialised);

  useEffect(() => {
    if (prev.current !== serialised) prev.current = serialised;
    setCrumbs(crumbs);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, setCrumbs, clear]);
}
