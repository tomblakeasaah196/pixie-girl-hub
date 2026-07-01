import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wand2, Save } from "lucide-react";
import { api } from "@/lib/api";
import { Card, Button, Pill } from "@/components/ui/primitives";
import { useBusinessStore } from "@/stores/business";
import { useServiceTypes, useRecipes } from "@/pages/service-jobs/hooks";

interface BomItem {
  bom_id: string;
  kind: "discrete" | "chemical";
  chemical_name: string | null;
  variant_id: string | null;
  default_quantity: string | null;
}
interface SopStep {
  step?: number;
  text: string;
}
interface Production {
  styled_id: string;
  default_service_type_id: string | null;
  default_recipe_id: string | null;
  standard_turnaround_days: number | null;
  sop_steps: SopStep[];
  bom: BomItem[];
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent transition-colors";

/**
 * Production DNA — the friendly "how this style is made" panel. Whatever is set
 * here is inherited by every job opened for the style, so a stylist always gets
 * the same clear recipe, steps and materials. Nothing here is required.
 */
export function StyledProductionManager({
  styledId,
  canEdit,
}: {
  styledId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const brand = useBusinessStore((s) => s.activeKey);
  const { data: types } = useServiceTypes(true);
  const { data: recipes } = useRecipes(true);

  const { data, isLoading } = useQuery({
    queryKey: ["styled-production", styledId, brand],
    queryFn: () =>
      api.get<{ data: Production }>(
        `/catalogue/styled-products/${styledId}/production`,
      ),
    select: (r) => r.data,
  });

  const [serviceType, setServiceType] = useState("");
  const [recipe, setRecipe] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [newMaterial, setNewMaterial] = useState("");

  // Seed the form once the server row arrives.
  useEffect(() => {
    if (!data) return;
    setServiceType(data.default_service_type_id ?? "");
    setRecipe(data.default_recipe_id ?? "");
    setTurnaround(
      data.standard_turnaround_days != null
        ? String(data.standard_turnaround_days)
        : "",
    );
    setSteps(data.sop_steps?.map((s) => s.text) ?? []);
  }, [data]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["styled-production", styledId, brand] });

  const save = useMutation({
    mutationFn: () =>
      api.put(`/catalogue/styled-products/${styledId}/production`, {
        default_service_type_id: serviceType || null,
        default_recipe_id: recipe || null,
        standard_turnaround_days: turnaround ? Number(turnaround) : null,
        sop_steps: steps
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text, i) => ({ step: i + 1, text })),
      }),
    onSuccess: invalidate,
  });

  const addMaterial = useMutation({
    mutationFn: (chemical_name: string) =>
      api.post(`/catalogue/styled-products/${styledId}/bom`, {
        kind: "chemical",
        chemical_name,
      }),
    onSuccess: () => {
      setNewMaterial("");
      invalidate();
    },
  });
  const removeMaterial = useMutation({
    mutationFn: (bomId: string) =>
      api.delete(`/catalogue/styled-products/${styledId}/bom/${bomId}`),
    onSuccess: invalidate,
  });

  const bom = data?.bom ?? [];

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Wand2 size={18} className="text-accent-glow" />
        <div>
          <h3 className="font-display text-lg">Production DNA</h3>
          <p className="text-muted text-xs">
            How this style is made — inherited by every job. All optional.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : (
        <>
          {/* The 3 dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs text-muted">Default service</span>
              <select
                className={inputCls}
                disabled={!canEdit}
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
              >
                <option value="">— none —</option>
                {types?.map((t) => (
                  <option key={t.service_type_id} value={t.service_type_id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted">Default recipe</span>
              <select
                className={inputCls}
                disabled={!canEdit}
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
              >
                <option value="">— none —</option>
                {recipes?.map((r) => (
                  <option key={r.recipe_id} value={r.recipe_id}>
                    {r.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted">Turnaround (days)</span>
              <input
                type="number"
                min={1}
                className={inputCls}
                disabled={!canEdit}
                value={turnaround}
                onChange={(e) => setTurnaround(e.target.value)}
                placeholder="e.g. 5"
              />
            </label>
          </div>

          {/* SOP steps — a simple numbered checklist */}
          <div className="space-y-2">
            <span className="text-xs text-muted">Steps (SOP)</span>
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-accent-glow font-mono text-sm w-5 text-right">
                  {i + 1}.
                </span>
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={s}
                  onChange={(e) => {
                    const next = [...steps];
                    next[i] = e.target.value;
                    setSteps(next);
                  }}
                  placeholder="Describe this step…"
                />
                {canEdit && (
                  <button
                    type="button"
                    className="text-muted hover:text-danger"
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                    aria-label="Remove step"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setSteps([...steps, ""])}
              >
                Add step
              </Button>
            )}
          </div>

          {/* Default materials (chemicals checklist) */}
          <div className="space-y-2">
            <span className="text-xs text-muted">
              Default materials (chemicals)
            </span>
            <div className="flex flex-wrap gap-2">
              {bom.length === 0 && (
                <span className="text-muted text-sm">None yet.</span>
              )}
              {bom.map((b) => (
                <Pill key={b.bom_id} tone="neutral">
                  <span className="mr-1">{b.chemical_name ?? "item"}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeMaterial.mutate(b.bom_id)}
                      aria-label="Remove material"
                      className="hover:text-danger"
                    >
                      ×
                    </button>
                  )}
                </Pill>
              ))}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <input
                  className={inputCls}
                  value={newMaterial}
                  onChange={(e) => setNewMaterial(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newMaterial.trim()) {
                      e.preventDefault();
                      addMaterial.mutate(newMaterial.trim());
                    }
                  }}
                  placeholder="Add a chemical (e.g. Toner 6.1) and press Enter"
                />
                <Button
                  size="sm"
                  disabled={!newMaterial.trim() || addMaterial.isPending}
                  onClick={() => addMaterial.mutate(newMaterial.trim())}
                >
                  Add
                </Button>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              <Button
                icon={<Save className="w-4 h-4" />}
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? "Saving…" : "Save production"}
              </Button>
              {save.isSuccess && (
                <span className="text-success text-sm">Saved ✓</span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
