import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Layers } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { MultiSelect } from "@/components/ui/controls";
import { toastReport } from "@/lib/error-report";
import {
  useSizeConfig,
  useCloneBaseProduct,
  useCreateSiblingSizes,
  type BaseProduct,
} from "@/lib/catalogue";

const SIZE_SUFFIX = /\s*-\s*(Small|Medium|Large|XL|Adjustable)\s*$/i;

/** Strip a trailing size suffix so we can re-append other sizes. Prefers the
 *  base's own cap size, then the common size words. */
function familyName(p: BaseProduct): string {
  if (p.cap_size) {
    const re = new RegExp(`\\s*-\\s*${p.cap_size}\\s*$`, "i");
    if (re.test(p.name)) return p.name.replace(re, "").trim();
  }
  return p.name.replace(SIZE_SUFFIX, "").trim();
}

/** Clone this base, and "Create other sizes" — spin up sibling bases (same
 *  everything, different size) for the sizes you pick. */
export function CloneAndSizesBar({ product }: { product: BaseProduct }) {
  const nav = useNavigate();
  const clone = useCloneBaseProduct();
  const sizesM = useCreateSiblingSizes(product.product_id);
  const cfg = useSizeConfig();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const family = familyName(product);
  const tiers = useMemo(
    () => (cfg.data?.tiers ?? []).filter((t) => t.is_active),
    [cfg.data],
  );
  // Offer sizes this base isn't already (by cap size).
  const options = tiers
    .filter((t) => t.label.toLowerCase() !== (product.cap_size ?? "").toLowerCase())
    .map((t) => ({ value: t.size_code, label: t.label }));

  const doClone = () =>
    clone.mutate(product.product_id, {
      onSuccess: (created) => nav(`/catalogue/base/${created.product_id}`),
      onError: (err) => toastReport("Catalogue → Base product", "Clone base", err),
    });

  const doCreateSizes = () => {
    const chosen = tiers.filter((t) => picked.includes(t.size_code));
    sizesM.mutate(
      chosen.map((t) => ({ name: `${family} - ${t.label}`, cap_size: t.label })),
      {
        onSuccess: () => {
          setSizesOpen(false);
          setPicked([]);
          nav("/catalogue?tab=base");
        },
        onError: (err) =>
          toastReport("Catalogue → Base product", "Create other sizes", err),
      },
    );
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        icon={<Copy className="w-3.5 h-3.5" />}
        disabled={clone.isPending}
        onClick={doClone}
      >
        {clone.isPending ? "Cloning…" : "Clone"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={<Layers className="w-3.5 h-3.5" />}
        onClick={() => setSizesOpen(true)}
      >
        Create other sizes
      </Button>

      <Modal
        open={sizesOpen}
        onClose={() => setSizesOpen(false)}
        title="Create other sizes"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSizesOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked.length === 0 || sizesM.isPending}
              onClick={doCreateSizes}
            >
              {sizesM.isPending
                ? "Creating…"
                : `Create ${picked.length || ""} size${picked.length === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-text-muted mb-3">
          Clones “{family}” into new base products for the sizes you pick — same
          texture, lace, supported lace and prices, just a different size.
        </p>
        {options.length === 0 ? (
          <p className="text-[12px] text-text-faint">
            No other sizes available. Add size tiers under Catalogue → Config.
          </p>
        ) : (
          <MultiSelect values={picked} onChange={setPicked} options={options} />
        )}
      </Modal>
    </div>
  );
}
