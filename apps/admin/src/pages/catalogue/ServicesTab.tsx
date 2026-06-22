import { useEffect, useState } from "react";
import { Plus, Scissors, Clock, Globe, Star, Pencil } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  MoneyText,
  Pill,
} from "@/components/ui/primitives";
import {
  ErrorState,
  DeniedState,
  ConfirmDialog,
  Toggle,
  NumberField,
  Select,
} from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useServices,
  useCreateService,
  useToggleService,
  useUpdateService,
  useDeleteService,
  type ServiceOffering,
  type ServiceInput,
} from "@/lib/catalogue";
import { Trash2 } from "lucide-react";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Service Catalogue (revamps, installs, repairs) — surfaced as a Catalogue
 * tab per V2.2. Backed by shared.service_offerings via /service-catalogue;
 * permission key is `service_catalogue`.
 */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ServicesTab() {
  const { can } = useAuthStore();
  const services = useServices();
  const toggle = useToggleService();
  const update = useUpdateService();
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<ServiceOffering | null>(null);

  if (!can("service_catalogue", "view")) {
    return (
      <DeniedState message="You don't have access to the Service Catalogue. Ask an admin in Org & Workflow." />
    );
  }
  const canCreate = can("service_catalogue", "create");
  const canEdit = can("service_catalogue", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {canCreate && (
          <ImportExportControls
            label="Services"
            templatePath="/service-catalogue/import-template"
            exportPath="/service-catalogue/export"
            importPath="/service-catalogue/import"
            onImported={() => services.refetch()}
          />
        )}
        {canCreate && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setOpen(true)}
          >
            New service
          </Button>
        )}
      </div>

      {services.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="glass rounded-[var(--radius)] h-24 animate-pulse"
            />
          ))}
        </div>
      ) : services.isError ? (
        <ErrorState onRetry={() => services.refetch()} />
      ) : (services.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scissors className="w-8 h-8" />}
            title="No services yet"
            message="Revamps, installs, custom styles and repairs live here. Add one to offer it."
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setOpen(true)}
                >
                  New service
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(services.data ?? []).map((s: ServiceOffering) => (
            <Card
              key={s.service_id}
              className={`p-4 ${s.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="font-display text-[15px] truncate">
                    {s.name}
                  </div>
                  {s.category && (
                    <div className="font-mono text-[10.5px] text-accent-glow">
                      {s.category}
                    </div>
                  )}
                </div>
                {canEdit ? (
                  <Toggle
                    checked={s.is_active}
                    onChange={(v) =>
                      toggle.mutate({ id: s.service_id, is_active: v })
                    }
                  />
                ) : (
                  <Pill tone={s.is_active ? "success" : "neutral"} dot={false}>
                    {s.is_active ? "Active" : "Off"}
                  </Pill>
                )}
              </div>
              {s.description && (
                <div className="text-[12px] text-text-faint line-clamp-2 mb-2">
                  {s.description}
                </div>
              )}
              <div className="flex items-center gap-3 mt-2">
                {s.base_price_ngn != null && (
                  <span className="inline-flex items-baseline gap-1">
                    {s.price_is_from && (
                      <span className="text-[10px] text-text-faint">from</span>
                    )}
                    <MoneyText ngn={s.base_price_ngn} className="text-[15px]" />
                  </span>
                )}
                {s.duration_minutes != null && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-text-faint">
                    <Clock className="w-3 h-3" /> {s.duration_minutes} min
                  </span>
                )}
                {s.is_featured && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-accent-glow">
                    <Star className="w-3 h-3" fill="currentColor" /> Featured
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t hairline">
                <Globe className="w-3.5 h-3.5 text-text-faint" />
                {canEdit ? (
                  <Toggle
                    checked={s.is_visible_storefront}
                    onChange={(v) =>
                      update.mutate({
                        id: s.service_id,
                        patch: { is_visible_storefront: v },
                      })
                    }
                    label={s.is_visible_storefront ? "On website" : "Hidden"}
                  />
                ) : (
                  <span className="text-[11.5px] text-text-faint">
                    {s.is_visible_storefront ? "On website" : "Hidden"}
                  </span>
                )}
                <Pill tone="neutral" dot={false}>
                  {s.sale_mode === "buy"
                    ? "Buy now"
                    : s.sale_mode === "enquire"
                      ? "Enquiry"
                      : "Bookable"}
                </Pill>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditFor(s)}
                    className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-glow"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ServiceModal open={open} onClose={() => setOpen(false)} />
      <ServiceModal
        open={!!editFor}
        service={editFor}
        onClose={() => setEditFor(null)}
      />
    </div>
  );
}

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

const SALE_MODES = [
  { value: "book", label: "Bookable" },
  { value: "buy", label: "Buy now" },
  { value: "enquire", label: "Enquiry" },
];
const LOCATIONS = [
  { value: "", label: "—" },
  { value: "in_studio", label: "In studio" },
  { value: "home", label: "Home service" },
  { value: "virtual", label: "Virtual" },
];

function ServiceModal({
  open,
  service,
  onClose,
}: {
  open: boolean;
  service?: ServiceOffering | null;
  onClose: () => void;
}) {
  const create = useCreateService();
  const update = useUpdateService();
  const del = useDeleteService();
  const isEdit = !!service;
  const [name, setName] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [longDesc, setLongDesc] = useState("");
  const [price, setPrice] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [priceFrom, setPriceFrom] = useState(false);
  const [compareAt, setCompareAt] = useState("");
  const [duration, setDuration] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [visible, setVisible] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [saleMode, setSaleMode] = useState("book");
  const [location, setLocation] = useState("");
  const [depositReq, setDepositReq] = useState(false);
  const [depositPct, setDepositPct] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reset = () => {
    setName("");
    setShortDesc("");
    setLongDesc("");
    setPrice("");
    setPriceUsd("");
    setPriceFrom(false);
    setCompareAt("");
    setDuration("");
    setCategory("");
    setTags("");
    setImageUrl("");
    setVisible(false);
    setFeatured(false);
    setSaleMode("book");
    setLocation("");
    setDepositReq(false);
    setDepositPct("");
  };

  // Pre-fill when editing (or clear when opened for create).
  useEffect(() => {
    if (service) {
      setName(service.name);
      setShortDesc(service.short_description ?? "");
      setLongDesc(service.long_description ?? "");
      setPrice(service.base_price_ngn != null ? String(service.base_price_ngn) : "");
      setPriceUsd(
        service.base_price_usd != null ? String(service.base_price_usd) : "",
      );
      setPriceFrom(service.price_is_from);
      setCompareAt(
        service.compare_at_price_ngn != null
          ? String(service.compare_at_price_ngn)
          : "",
      );
      setDuration(
        service.duration_minutes != null ? String(service.duration_minutes) : "",
      );
      setCategory(service.category ?? "");
      setTags((service.tags ?? []).join(", "));
      setImageUrl(service.image_url ?? "");
      setVisible(service.is_visible_storefront);
      setFeatured(service.is_featured);
      setSaleMode(service.sale_mode);
      setLocation(service.location_type ?? "");
      setDepositReq(service.deposit_required);
      setDepositPct(service.deposit_pct != null ? String(service.deposit_pct) : "");
    } else {
      reset();
    }
  }, [service]);

  const submit = () => {
    if (!name.trim()) return;
    const input: ServiceInput = {
      name: name.trim(),
      slug: slugify(name),
      short_description: shortDesc.trim() || null,
      long_description: longDesc.trim() || null,
      base_price_ngn: price ? Number(price) : 0,
      base_price_usd: priceUsd ? Number(priceUsd) : null,
      price_is_from: priceFrom,
      compare_at_price_ngn: compareAt ? Number(compareAt) : null,
      duration_minutes: duration ? Number(duration) : null,
      category: category.trim() || null,
      tags: tags.trim()
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : null,
      image_url: imageUrl.trim() || null,
      is_visible_storefront: visible,
      is_featured: featured,
      sale_mode: saleMode as ServiceInput["sale_mode"],
      location_type: (location || null) as ServiceInput["location_type"],
      deposit_required: depositReq,
      deposit_pct: depositReq && depositPct ? Number(depositPct) : null,
    };
    if (isEdit && service) {
      update.mutate(
        { id: service.service_id, patch: input },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(input, {
        onSuccess: () => {
          reset();
          onClose();
        },
      });
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit — ${service?.name}` : "New service"}
      footer={
        <>
          {isEdit && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors mr-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || busy}
            onClick={submit}
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wig Revamp"
            className={inputCls}
          />
        </Field>
        <Field label="Short description" hint="card tagline">
          <input
            value={shortDesc}
            onChange={(e) => setShortDesc(e.target.value)}
            placeholder="Refresh, wash and restyle your unit"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base price" hint="Naira">
            <NumberField value={price} onChange={setPrice} suffix="₦" />
          </Field>
          <Field label="Base price" hint="US Dollar">
            <NumberField value={priceUsd} onChange={setPriceUsd} suffix="$" />
          </Field>
          <Field label="Compare-at" hint="optional 'was' price">
            <NumberField value={compareAt} onChange={setCompareAt} suffix="₦" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <Field label="Duration" hint="optional">
            <NumberField
              value={duration}
              onChange={setDuration}
              allowDecimal={false}
              suffix="min"
            />
          </Field>
          <Toggle
            checked={priceFrom}
            onChange={setPriceFrom}
            label="Show price as 'from'"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tags" hint="comma-separated · site filtering">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="revamp, styling"
              className={inputCls}
            />
          </Field>
          <Field label="Category" hint="optional">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Image URL" hint="primary photo for the website card">
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
        </Field>

        {/* Website & booking */}
        <div className="pt-3 border-t hairline space-y-3">
          <div className="micro">Website &amp; booking</div>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle
              checked={visible}
              onChange={setVisible}
              label="Show on website"
            />
            <Toggle checked={featured} onChange={setFeatured} label="Featured" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sells as">
              <Select
                value={saleMode}
                onChange={setSaleMode}
                options={SALE_MODES}
              />
            </Field>
            <Field label="Location">
              <Select
                value={location}
                onChange={setLocation}
                options={LOCATIONS}
              />
            </Field>
          </div>
          {saleMode === "book" && (
            <div className="grid grid-cols-2 gap-3 items-end">
              <Toggle
                checked={depositReq}
                onChange={setDepositReq}
                label="Deposit to book"
              />
              {depositReq && (
                <Field label="Deposit %">
                  <NumberField
                    value={depositPct}
                    onChange={setDepositPct}
                    suffix="%"
                  />
                </Field>
              )}
            </div>
          )}
        </div>

        <Field label="Long description" hint="full service-page copy">
          <textarea
            value={longDesc}
            onChange={(e) => setLongDesc(e.target.value)}
            rows={3}
            className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y"
          />
        </Field>

        {(create.isError || update.isError) && (
          <p className="text-[12px] text-danger">
            {(create.error || update.error) instanceof Error
              ? (create.error || update.error)!.message
              : "Could not save service."}
          </p>
        )}
      </div>

      {isEdit && service && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            del.mutate(service.service_id, {
              onSuccess: () => {
                setConfirmDelete(false);
                onClose();
              },
            })
          }
          title="Delete service?"
          message="This removes the service offering from the catalogue and the website."
          confirmLabel="Delete"
          busy={del.isPending}
        />
      )}
    </Modal>
  );
}
