import { useState } from "react";
import { Plus, Scissors, Clock } from "lucide-react";
import { Button, Card, EmptyState, MoneyText, Pill } from "@/components/ui/primitives";
import { ErrorState, DeniedState, Toggle, NumberField } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useServices,
  useCreateService,
  useToggleService,
  type ServiceOffering,
} from "@/lib/catalogue";

/**
 * Service Catalogue (revamps, installs, repairs) — surfaced as a Catalogue
 * tab per V2.2. Backed by shared.service_offerings via /service-catalogue;
 * permission key is `service_catalogue`.
 */
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ServicesTab() {
  const { can } = useAuthStore();
  const services = useServices();
  const toggle = useToggleService();
  const [open, setOpen] = useState(false);

  if (!can("service_catalogue", "view")) {
    return (
      <DeniedState message="You don't have access to the Service Catalogue. Ask an admin in Org & Workflow." />
    );
  }
  const canCreate = can("service_catalogue", "create");
  const canEdit = can("service_catalogue", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center">
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
            <div key={i} className="glass rounded-[var(--radius)] h-24 animate-pulse" />
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
                <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                  New service
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(services.data ?? []).map((s: ServiceOffering) => (
            <Card key={s.service_id} className={`p-4 ${s.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="font-display text-[15px] truncate">{s.name}</div>
                  {s.category && (
                    <div className="font-mono text-[10.5px] text-accent-glow">{s.category}</div>
                  )}
                </div>
                {canEdit ? (
                  <Toggle
                    checked={s.is_active}
                    onChange={(v) => toggle.mutate({ id: s.service_id, is_active: v })}
                  />
                ) : (
                  <Pill tone={s.is_active ? "success" : "neutral"} dot={false}>
                    {s.is_active ? "Active" : "Off"}
                  </Pill>
                )}
              </div>
              {s.description && (
                <div className="text-[12px] text-text-faint line-clamp-2 mb-2">{s.description}</div>
              )}
              <div className="flex items-center gap-3 mt-2">
                {s.base_price_ngn != null && (
                  <MoneyText ngn={s.base_price_ngn} className="text-[15px]" />
                )}
                {s.duration_minutes != null && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-text-faint">
                    <Clock className="w-3 h-3" /> {s.duration_minutes} min
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateServiceModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateServiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateService();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [duration, setDuration] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        slug: slugify(name),
        base_price_ngn: price ? Number(price) : 0,
        category: category.trim() || null,
        duration_minutes: duration ? Number(duration) : null,
      },
      {
        onSuccess: () => {
          setName("");
          setPrice("");
          setCategory("");
          setDuration("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New service"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!name.trim() || create.isPending} onClick={submit}>
            {create.isPending ? "Creating…" : "Create"}
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
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base price">
            <NumberField value={price} onChange={setPrice} suffix="₦" />
          </Field>
          <Field label="Duration" hint="optional">
            <NumberField value={duration} onChange={setDuration} allowDecimal={false} suffix="min" />
          </Field>
        </div>
        <Field label="Category" hint="optional · e.g. revamp, install, repair">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        {create.isError && (
          <p className="text-[12px] text-danger">
            {create.error instanceof Error ? create.error.message : "Could not create service."}
          </p>
        )}
      </div>
    </Modal>
  );
}
