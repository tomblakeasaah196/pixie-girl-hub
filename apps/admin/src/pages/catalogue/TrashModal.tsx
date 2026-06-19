import { useState } from "react";
import { Undo2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import {
  useStyledTrash,
  useRestoreStyled,
  useProductTrash,
  useRestoreProduct,
} from "@/lib/catalogue";

/**
 * Trash bin (catalogue PR). Soft-deleted styled + base products, each
 * restorable. Deleting frees the name (partial-unique), so a restore may come
 * back lightly renamed if the original name was reused — we flag that.
 */
export function TrashModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"styled" | "base">("styled");
  return (
    <Modal open={open} onClose={onClose} title="Trash" size="md">
      <div className="flex gap-1 p-1 rounded-[12px] glass mb-4 w-fit">
        {(["styled", "base"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "px-3.5 h-8 rounded-[9px] text-[12.5px] font-semibold transition-colors " +
              (tab === k
                ? "bg-accent-deep text-[#F4E9D9]"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {k === "styled" ? "Styled products" : "Base products"}
          </button>
        ))}
      </div>
      {tab === "styled" ? (
        <StyledTrash open={open} />
      ) : (
        <BaseTrash open={open} />
      )}
    </Modal>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 text-text-faint">
      <Trash2 className="w-7 h-7 mb-2 opacity-60" />
      <p className="text-[13px]">{label}</p>
    </div>
  );
}

function StyledTrash({ open }: { open: boolean }) {
  const trash = useStyledTrash(open);
  const restore = useRestoreStyled();
  const items = trash.data ?? [];
  if (trash.isLoading) return <Skeleton />;
  if (!items.length) return <Empty label="No styled products in the trash." />;
  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
      {items.map((s) => (
        <Row
          key={s.styled_id}
          title={s.name}
          subtitle={`${s.styled_code} · on ${s.base_name}`}
          busy={restore.isPending && restore.variables === s.styled_id}
          onRestore={() => restore.mutate(s.styled_id)}
        />
      ))}
    </div>
  );
}

function BaseTrash({ open }: { open: boolean }) {
  const trash = useProductTrash(open);
  const restore = useRestoreProduct();
  const items = trash.data ?? [];
  if (trash.isLoading) return <Skeleton />;
  if (!items.length) return <Empty label="No base products in the trash." />;
  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
      {items.map((p) => (
        <Row
          key={p.product_id}
          title={p.name}
          subtitle={p.product_code}
          busy={restore.isPending && restore.variables === p.product_id}
          onRestore={() => restore.mutate(p.product_id)}
        />
      ))}
    </div>
  );
}

function Row({
  title,
  subtitle,
  onRestore,
  busy,
}: {
  title: string;
  subtitle: string;
  onRestore: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[11px] border border-line p-3">
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold truncate">{title}</div>
        <div className="text-[11px] text-text-faint font-mono truncate">
          {subtitle}
        </div>
      </div>
      <Button
        size="sm"
        icon={<Undo2 className="w-3.5 h-3.5" />}
        disabled={busy}
        onClick={onRestore}
      >
        {busy ? "Restoring…" : "Restore"}
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[58px] rounded-[11px] bg-text-primary/[0.04] animate-pulse"
        />
      ))}
    </div>
  );
}
