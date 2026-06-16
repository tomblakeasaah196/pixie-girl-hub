import { useState } from "react";
import {
  Button,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/controls";
import type { ChemicalRecipe, Ingredient, CreateRecipeInput } from "./types";
import { useRecipes, useRecipeMutations } from "./hooks";

// ── Ingredient row (inside recipe form) ───────────────────

function IngredientRow({
  ing,
  onChange,
  onRemove,
}: {
  ing: Ingredient;
  onChange: (patch: Partial<Ingredient>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="glass p-2 rounded-lg space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <input
          className="input col-span-2"
          placeholder="Chemical name *"
          value={ing.chemical_name}
          onChange={(e) => onChange({ chemical_name: e.target.value })}
        />
        <input
          className="input"
          placeholder="Brand"
          value={ing.brand ?? ""}
          onChange={(e) => onChange({ brand: e.target.value || undefined })}
        />
        <input
          className="input"
          placeholder="Role (e.g. developer)"
          value={ing.role ?? ""}
          onChange={(e) => onChange({ role: e.target.value || undefined })}
        />
        <input
          className="input"
          type="number"
          min="0"
          step="0.1"
          placeholder="Qty (ml)"
          value={ing.qty_ml ?? ""}
          onChange={(e) =>
            onChange({ qty_ml: e.target.value ? parseFloat(e.target.value) : undefined })
          }
        />
        <input
          className="input"
          type="number"
          min="0"
          step="0.1"
          placeholder="Qty (g)"
          value={ing.qty_g ?? ""}
          onChange={(e) =>
            onChange({ qty_g: e.target.value ? parseFloat(e.target.value) : undefined })
          }
        />
      </div>
      <button
        type="button"
        className="text-xs text-danger hover:underline"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

// ── Recipe form ────────────────────────────────────────────

function RecipeForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<CreateRecipeInput>;
  onSave: (data: CreateRecipeInput) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<CreateRecipeInput>({
    recipe_key: initial?.recipe_key ?? "",
    display_name: initial?.display_name ?? "",
    ingredients: initial?.ingredients ?? [{ chemical_name: "" }],
    instructions: initial?.instructions ?? "",
    target_shade: initial?.target_shade ?? "",
    notes: initial?.notes ?? "",
    is_active: initial?.is_active ?? true,
  });

  const updateIng = (i: number, patch: Partial<Ingredient>) => {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((ing, idx) =>
        idx === i ? { ...ing, ...patch } : ing,
      ),
    }));
  };

  const addIng = () =>
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { chemical_name: "" }] }));

  const removeIng = (i: number) =>
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.filter((_, idx) => idx !== i),
    }));

  const valid =
    form.recipe_key.trim() &&
    form.display_name.trim() &&
    form.ingredients.length > 0 &&
    form.ingredients.every((ing) => ing.chemical_name.trim());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Recipe key *</label>
          <input
            className="input w-full font-mono"
            placeholder="e.g. warm_brunette_v2"
            value={form.recipe_key}
            onChange={(e) => setForm((f) => ({ ...f, recipe_key: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Display name *</label>
          <input
            className="input w-full"
            placeholder="e.g. Warm Brunette v2"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <label className="label">Target shade</label>
        <input
          className="input w-full"
          placeholder="e.g. Level 6 Warm Brown"
          value={form.target_shade}
          onChange={(e) => setForm((f) => ({ ...f, target_shade: e.target.value }))}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Ingredients *</label>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={addIng}
          >
            + Add ingredient
          </button>
        </div>
        <div className="space-y-2">
          {form.ingredients.map((ing, i) => (
            <IngredientRow
              key={i}
              ing={ing}
              onChange={(patch) => updateIng(i, patch)}
              onRemove={() => removeIng(i)}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="label">Instructions</label>
        <textarea
          className="input w-full h-24 text-sm"
          placeholder="Step-by-step mixing and application instructions…"
          value={form.instructions}
          onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
        />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="input w-full h-16 text-sm"
          placeholder="Additional notes, cautions, substitutions…"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => valid && onSave(form)} disabled={!valid || isSaving}>
          {isSaving ? "Saving…" : "Save Recipe"}
        </Button>
      </div>
    </div>
  );
}

// ── Recipe card (list) ─────────────────────────────────────

function RecipeCard({
  recipe,
  onEdit,
}: {
  recipe: ChemicalRecipe;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧪</span>
          <div>
            <p className="font-semibold text-sm">{recipe.display_name}</p>
            <p className="text-xs font-mono text-muted">{recipe.recipe_key}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Pill tone={recipe.is_active ? "success" : "neutral"} dot={false}>
            {recipe.is_active ? "Active" : "Inactive"}
          </Pill>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>

      {recipe.target_shade && (
        <p className="text-xs text-muted">
          Target shade: <span className="text-foreground">{recipe.target_shade}</span>
        </p>
      )}

      <button
        type="button"
        className="text-xs text-accent hover:underline flex items-center gap-1"
        onClick={() => setExpanded((v) => !v)}
      >
        {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
        <span>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="space-y-1 pl-2 border-l-2 border-accent/30">
          {recipe.ingredients.map((ing, i) => (
            <div key={i} className="text-xs flex items-center gap-2">
              <span className="text-muted">{i + 1}.</span>
              <span className="font-medium">{ing.chemical_name}</span>
              {ing.brand && <span className="text-muted">({ing.brand})</span>}
              {ing.qty_ml && <span className="font-mono ml-auto">{ing.qty_ml} ml</span>}
              {ing.qty_g && <span className="font-mono ml-auto">{ing.qty_g} g</span>}
              {ing.role && <span className="text-muted italic">{ing.role}</span>}
            </div>
          ))}
          {recipe.instructions && (
            <p className="text-xs text-muted mt-2 border-t border-white/10 pt-2">
              {recipe.instructions}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────

export function RecipesPanel({ canCreate }: { canCreate: boolean }) {
  const { data: recipes = [], isLoading, isError } = useRecipes();
  const { create, update } = useRecipeMutations();
  const [editingRecipe, setEditingRecipe] = useState<ChemicalRecipe | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">Chemical Recipes</h3>
          <p className="text-sm text-muted">
            Colour formulas and mixing guides used in service jobs
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>+ New Recipe</Button>
        )}
      </div>

      {recipes.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">🧪</span>}
          title="No recipes yet"
          message="Create your first colour recipe"
          action={canCreate ? <Button size="sm" onClick={() => setShowCreate(true)}>New Recipe</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.recipe_id}
              recipe={recipe}
              onEdit={() => setEditingRecipe(recipe)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <Drawer open onClose={() => setShowCreate(false)} title="New Chemical Recipe">
          <RecipeForm
            onSave={(data) =>
              create.mutate(data, { onSuccess: () => setShowCreate(false) })
            }
            onCancel={() => setShowCreate(false)}
            isSaving={create.isPending}
          />
        </Drawer>
      )}

      {editingRecipe && (
        <Drawer
          open
          onClose={() => setEditingRecipe(null)}
          title={`Edit: ${editingRecipe.display_name}`}
        >
          <RecipeForm
            initial={{
              recipe_key: editingRecipe.recipe_key,
              display_name: editingRecipe.display_name,
              ingredients: editingRecipe.ingredients,
              instructions: editingRecipe.instructions ?? undefined,
              target_shade: editingRecipe.target_shade ?? undefined,
              notes: editingRecipe.notes ?? undefined,
              is_active: editingRecipe.is_active,
            }}
            onSave={(data) =>
              update.mutate(
                [editingRecipe.recipe_id, data],
                { onSuccess: () => setEditingRecipe(null) },
              )
            }
            onCancel={() => setEditingRecipe(null)}
            isSaving={update.isPending}
          />
        </Drawer>
      )}
    </div>
  );
}
