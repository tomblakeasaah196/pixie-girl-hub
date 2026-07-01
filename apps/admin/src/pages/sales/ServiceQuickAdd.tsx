import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/primitives";
import { useBusinessStore } from "@/stores/business";

export interface ServiceOffering {
  service_id: string;
  name: string;
  base_price_ngn: string;
  category: string | null;
}

/**
 * Add a service (a walk-in revamp, install, re-wig) to the sale — rings up right
 * beside any retail item. Deliberately one dropdown + one button.
 */
export function ServiceQuickAdd({
  onAdd,
}: {
  onAdd: (s: ServiceOffering) => void;
}) {
  const brand = useBusinessStore((s) => s.activeKey);
  const { data } = useQuery({
    queryKey: ["services-quick-add", brand],
    queryFn: () =>
      api.get<{ data: ServiceOffering[] }>("/service-catalogue?is_active=true"),
    select: (r) => r.data,
  });
  const [sel, setSel] = useState("");
  const services = data ?? [];
  const chosen = services.find((s) => s.service_id === sel);

  if (services.length === 0) return null;

  return (
    <div className="rounded-[11px] border border-line bg-text-primary/[0.02] p-3">
      <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold">
        <Scissors className="w-4 h-4 text-accent-glow" />
        Add a service (walk-in revamp, install…)
      </div>
      <div className="flex items-center gap-2">
        <select
          className="flex-1 rounded-lg border border-line bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
          value={sel}
          onChange={(e) => setSel(e.target.value)}
        >
          <option value="">Choose a service…</option>
          {services.map((s) => (
            <option key={s.service_id} value={s.service_id}>
              {s.name} — ₦{Number(s.base_price_ngn).toLocaleString()}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          disabled={!chosen}
          onClick={() => {
            if (chosen) {
              onAdd(chosen);
              setSel("");
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
