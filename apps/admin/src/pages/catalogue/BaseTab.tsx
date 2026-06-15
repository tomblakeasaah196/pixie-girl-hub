import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Boxes, ShieldCheck, Factory } from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useBaseProducts, type BaseProduct } from "@/lib/catalogue";
import { SearchBox, CardGrid, CardGridSkeleton } from "./parts";
import { CostVaultGrants } from "./CostVaultGrants";

/**
 * Base products — the China-origin, stock-bearing register (the only place
 * stock lives). Ops/CEO manage these; styled skins draw down from them.
 * The cost-vault grants panel is owner-only.
 */
export function BaseTab() {
  const nav = useNavigate();
  const { can, user } = useAuthStore();
  const [q, setQ] = useState("");
  const [grantsOpen, setGrantsOpen] = useState(false);

  const filters = useMemo(() => ({ q: q.trim() || undefined }), [q]);
  const products = useBaseProducts(filters);
  const canCreate = can("catalogue", "create");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <SearchBox value={q} onChange={setQ} placeholder="Search base products…" />
        <div className="ml-auto flex gap-2">
          {user?.isCeo && (
            <Button
              size="sm"
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
              onClick={() => setGrantsOpen(true)}
            >
              Cost-vault access
            </Button>
          )}
          {canCreate && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => nav("/catalogue/base/new")}
            >
              New base product
            </Button>
          )}
        </div>
      </div>

      {products.isLoading ? (
        <CardGridSkeleton />
      ) : products.isError ? (
        <ErrorState onRetry={() => products.refetch()} />
      ) : (products.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes className="w-8 h-8" />}
            title="No base products"
            message="Base products are your China-origin, stock-bearing items. Add one to get started."
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => nav("/catalogue/base/new")}>
                  New base product
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <CardGrid>
          {(products.data ?? []).map((p) => (
            <BaseCard key={p.product_id} p={p} onOpen={() => nav(`/catalogue/base/${p.product_id}`)} />
          ))}
        </CardGrid>
      )}

      <CostVaultGrants open={grantsOpen} onClose={() => setGrantsOpen(false)} />
    </div>
  );
}

function BaseCard({ p, onOpen }: { p: BaseProduct; onOpen: () => void }) {
  const specs = [p.texture_type, p.lace_type, p.hair_length_inches ? `${p.hair_length_inches}"` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      onClick={onOpen}
      className="text-left glass rounded-[var(--radius)] shadow-glass p-4 transition-all hover:border-accent/40 hover:-translate-y-0.5 focus:outline-none focus:border-accent/50"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-mono text-[10.5px] text-accent-glow">{p.product_code}</span>
        {p.is_visible_storefront ? (
          <Pill tone="success" dot={false}>Storefront</Pill>
        ) : (
          <Pill tone="neutral" dot={false}>Hidden</Pill>
        )}
      </div>
      <div className="font-display text-[16px] leading-tight mb-1 truncate">{p.name}</div>
      <div className="text-[11.5px] text-text-faint mb-3 truncate">{specs || "—"}</div>
      {p.preorder_enabled && (
        <Pill tone="info" dot={false}>
          <Factory className="w-3 h-3" /> Pre-order ready
        </Pill>
      )}
    </button>
  );
}
