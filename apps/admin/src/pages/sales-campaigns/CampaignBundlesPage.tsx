import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Edit3, Package, Plus, Search } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, MoneyText, Pill, Skeleton } from "@/components/ui/primitives";
import { DeniedState, ErrorState, NumberField, Toggle } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import {
  type Bundle,
  useBundleList,
  useCreateBundle,
  useUpdateBundle,
} from "@/lib/campaigns";

export function CampaignBundlesPage() {
  useBreadcrumbs([
    { label: "Sales Campaigns", href: "/sales-campaigns" },
    { label: "Bundles" },
  ]);
  const { can } = useAuthStore();
  const [q, setQ] = useState("");
  const list = useBundleList(q || undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  if (!can("sales_campaigns", "view")) return <DeniedState />;
  const canCreate = can("sales_campaigns", "create");
  const canEdit = can("sales_campaigns", "edit");
  const bundles = list.data?.data || [];

  return (
    <div className="space-y-4">
      <Card className="p-5 relative overflow-hidden">
        <div
          className="absolute -top-12 -right-8 w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgb(var(--accent-deep)/0.4), transparent 70%)",
            filter: "blur(34px)",
          }}
        />
        <div className="relative flex items-center gap-3 flex-wrap">
          <Link to="/sales-campaigns" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary">
            <ArrowLeft className="w-3.5 h-3.5" /> Sales Campaigns
          </Link>
        </div>
        <div className="relative mt-3 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-[28px] leading-tight">Catalogue bundles</h1>
            <p className="text-text-muted text-[13px] mt-1 max-w-[600px]">
              Curated, fixed-composition product sets. Reusable across campaigns. Set the per-item ₦
              discount and the preorder discount-loss % here.
            </p>
          </div>
          {canCreate && (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              New bundle
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bundles…"
            className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </div>
      </Card>

      {list.isLoading && <Skeleton style={{ height: 180 }} />}
      {list.isError && <ErrorState onRetry={() => list.refetch()} />}
      {!list.isLoading && bundles.length === 0 && (
        <Card className="p-2">
          <EmptyState
            icon={<Package className="w-7 h-7" />}
            title="No bundles yet"
            message="Create your first bundle — fixed composition, per-item ₦ off, before/after totals shown on the landing."
            action={canCreate ? <Button variant="primary" onClick={() => setCreateOpen(true)}>Create a bundle</Button> : null}
          />
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {bundles.map((b) => (
          <Card key={b.bundle_id} className="p-4 flex gap-3">
            <div
              className="w-20 h-20 rounded-[14px] bg-text-primary/[0.06] grid place-items-center text-text-faint flex-shrink-0"
              style={
                b.hero_image_url
                  ? {
                      backgroundImage: `url(${b.hero_image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!b.hero_image_url && <Package className="w-7 h-7" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-display font-medium text-[16px] truncate flex-1">{b.name}</div>
                <Pill tone={b.status === "active" ? "success" : "neutral"} dot={false}>{b.status}</Pill>
              </div>
              <div className="micro mt-0.5">/{b.slug}</div>
              <div className="flex flex-wrap gap-2 mt-2 text-[11.5px] text-text-muted">
                <span>Per item: <MoneyText ngn={Number(b.default_per_item_discount_ngn || 0)} /></span>
                <span>·</span>
                <span>Preorder-loss: <span className="font-mono">{Math.round(b.default_preorder_loss_pct * 100)}%</span></span>
              </div>
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setEditId(b.bundle_id)} className="text-[11.5px] font-semibold text-accent-glow hover:underline inline-flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> Edit
                  </button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <CreateBundleModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editId && <EditBundleModal open={Boolean(editId)} onClose={() => setEditId(null)} id={editId} />}
    </div>
  );
}

function CreateBundleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateBundle();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [perItem, setPerItem] = useState("");
  const [preorderLoss, setPreorderLoss] = useState("0.7");
  const [heroImage, setHeroImage] = useState("");

  function makeSlug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      name,
      slug: slug || makeSlug(name),
      hero_image_url: heroImage || undefined,
      default_per_item_discount_ngn: Number(perItem) || 0,
      default_preorder_loss_pct: Number(preorderLoss) || 0.7,
    });
    setName("");
    setSlug("");
    setSlugTouched(false);
    setPerItem("");
    setHeroImage("");
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="New bundle">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Bundle name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(makeSlug(e.target.value));
            }}
            required
            placeholder="The 5-Frontal Set"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </Field>
        <Field label="Slug">
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(makeSlug(e.target.value));
            }}
            required
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[13px]"
          />
        </Field>
        <Field label="Hero image URL (optional)">
          <input
            value={heroImage}
            onChange={(e) => setHeroImage(e.target.value)}
            placeholder="https://…"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[12px]"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default per-item ₦ off">
            <NumberField value={perItem} onChange={setPerItem} suffix="NGN" allowDecimal={false} />
          </Field>
          <Field label="Preorder loss %" hint="0.7 = 70% of the discount is lost on preorder">
            <NumberField value={preorderLoss} onChange={setPreorderLoss} suffix="" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.06]">
            Cancel
          </button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditBundleModal({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const update = useUpdateBundle(id);
  const list = useBundleList();
  const bundle = (list.data?.data || []).find((b: Bundle) => b.bundle_id === id);
  const [name, setName] = useState(bundle?.name || "");
  const [perItem, setPerItem] = useState(bundle?.default_per_item_discount_ngn?.toString() || "");
  const [preorderLoss, setPreorderLoss] = useState(bundle?.default_preorder_loss_pct?.toString() || "0.7");
  const [heroImage, setHeroImage] = useState(bundle?.hero_image_url || "");
  const [archived, setArchived] = useState(bundle?.status === "archived");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await update.mutateAsync({
      name,
      default_per_item_discount_ngn: Number(perItem) || 0,
      default_preorder_loss_pct: Number(preorderLoss) || 0.7,
      hero_image_url: heroImage || undefined,
      status: archived ? "archived" : "active",
    });
    onClose();
  }

  if (!bundle) return null;
  return (
    <Modal open={open} onClose={onClose} title="Edit bundle">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Bundle name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </Field>
        <Field label="Hero image URL">
          <input
            value={heroImage}
            onChange={(e) => setHeroImage(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[12px]"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Per-item ₦ off">
            <NumberField value={perItem} onChange={setPerItem} suffix="NGN" allowDecimal={false} />
          </Field>
          <Field label="Preorder loss %">
            <NumberField value={preorderLoss} onChange={setPreorderLoss} suffix="" />
          </Field>
        </div>
        <Field label="Status">
          <Toggle checked={archived} onChange={setArchived} label={archived ? "Archived" : "Active"} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.06]">
            Cancel
          </button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
