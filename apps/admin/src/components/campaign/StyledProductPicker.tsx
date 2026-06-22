import { useState, useEffect, useCallback } from "react";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Search,
  Square,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, MoneyText, Pill } from "@/components/ui/primitives";
import { useStyledProducts, type StyledProduct } from "@/lib/catalogue";

const PAGE_SIZE = 100;

interface PickerProps {
  excludeIds?: Set<string>;
  onAdd: (items: StyledProduct[]) => void | Promise<void>;
  onClose: () => void;
}

export function StyledProductPicker({
  excludeIds = new Set(),
  onAdd,
  onClose,
}: PickerProps) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, StyledProduct>>(
    new Map(),
  );

  const query = useStyledProducts({
    q: q.trim() || undefined,
    status: "live",
    page,
    page_size: PAGE_SIZE,
  });

  const raw = query.data ?? [];
  const items = raw.filter(
    (p: StyledProduct) => !excludeIds.has(p.styled_id),
  );
  const total = (query as any).data?.meta?.total ?? items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [q]);

  const toggle = useCallback(
    (p: StyledProduct) => {
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(p.styled_id)) next.delete(p.styled_id);
        else next.set(p.styled_id, p);
        return next;
      });
    },
    [],
  );

  const selectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of items) next.set(p.styled_id, p);
      return next;
    });
  };

  const clearAll = () => setSelected(new Map());

  const confirm = async () => {
    setAddError(null);
    setAdding(true);
    try {
      // Await so a failed save keeps the picker open with a visible error
      // instead of silently closing (the bug that hid the batch 400).
      await onAdd(Array.from(selected.values()));
      onClose();
    } catch (e: unknown) {
      setAddError(
        (e as Error)?.message ||
          "Couldn't add those products. Please try again.",
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      {/* Search bar */}
      <div className="p-4 border-b border-line space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search styled products by name, code…"
            className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <button
            type="button"
            onClick={selectAll}
            className="font-semibold text-accent-glow hover:underline"
          >
            Select all on page
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-text-faint">·</span>
              <button
                type="button"
                onClick={clearAll}
                className="font-semibold text-text-muted hover:underline"
              >
                Clear ({selected.size})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {query.isLoading ? (
          <div className="py-8 text-center text-text-faint text-[13px]">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-text-faint text-[13px]">
            {q.trim()
              ? `No styled products match "${q.trim()}"`
              : "No styled products available"}
          </div>
        ) : (
          items.map((p: StyledProduct) => {
            const isSelected = selected.has(p.styled_id);
            return (
              <button
                key={p.styled_id}
                type="button"
                onClick={() => toggle(p)}
                className={cn(
                  "w-full text-left flex items-center gap-3 p-2.5 rounded-[12px] border transition-colors",
                  isSelected
                    ? "border-accent/50 bg-accent/[0.06]"
                    : "border-transparent hover:bg-text-primary/[0.04]",
                )}
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-accent-glow shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-text-faint shrink-0" />
                )}
                <div
                  className="w-11 h-11 rounded-[10px] bg-text-primary/[0.06] flex-shrink-0 grid place-items-center overflow-hidden"
                  style={
                    p.primary_image_url
                      ? {
                          backgroundImage: `url(${p.primary_image_url})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!p.primary_image_url && (
                    <ImageIcon className="w-4 h-4 text-text-faint" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">
                    {p.name}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-text-faint">
                    <span className="font-mono text-accent-glow">
                      {p.styled_code}
                    </span>
                    {p.base_name && <span>· {p.base_name}</span>}
                  </div>
                </div>
                {p.effective_price_ngn != null && (
                  <MoneyText
                    ngn={p.effective_price_ngn}
                    className="text-[12px] text-text-muted shrink-0"
                  />
                )}
                {p.availability && (
                  <Pill
                    tone={
                      p.availability.state === "in_stock"
                        ? "success"
                        : p.availability.state === "preorder"
                          ? "warn"
                          : "neutral"
                    }
                    dot={false}
                  >
                    {p.availability.state === "in_stock"
                      ? "In stock"
                      : p.availability.state === "preorder"
                        ? "Preorder"
                        : "OOS"}
                  </Pill>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-2 border-t border-line flex items-center justify-between text-[12px]">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 font-semibold text-text-muted hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="text-text-faint tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 font-semibold text-text-muted hover:text-text-primary disabled:opacity-40"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="p-4 border-t border-line flex items-center justify-between">
        <span className="text-[12px]">
          {addError ? (
            <span className="text-danger">{addError}</span>
          ) : (
            <span className="text-text-muted">
              {selected.size > 0
                ? `${selected.size} selected`
                : "Pick products to add"}
            </span>
          )}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0 || adding}
            onClick={confirm}
          >
            {adding ? "Adding…" : `Add ${selected.size > 0 ? `(${selected.size})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
