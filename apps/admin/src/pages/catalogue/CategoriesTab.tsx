import { useState } from "react";
import { Plus, Tags, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useCategories,
  useCreateCategory,
  useArchiveCategory,
  type Category,
} from "@/lib/catalogue";

/** Dynamic categories (Tab 3 of the catalogue model). Manual list + create. */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CategoriesTab() {
  const { can } = useAuthStore();
  const cats = useCategories();
  const archive = useArchiveCategory();
  const [open, setOpen] = useState(false);
  const canCreate = can("catalogue", "create");
  const canDelete = can("catalogue", "delete");

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
            New category
          </Button>
        )}
      </div>

      {cats.isLoading ? (
        <Card className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-[11px] bg-text-primary/[0.05] animate-pulse"
            />
          ))}
        </Card>
      ) : cats.isError ? (
        <ErrorState onRetry={() => cats.refetch()} />
      ) : (cats.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tags className="w-8 h-8" />}
            title="No categories yet"
            message="Group products into dynamic categories for the storefront."
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setOpen(true)}
                >
                  New category
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {(cats.data ?? []).map((c: Category) => (
            <Card key={c.category_id} className="p-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate">
                  {c.name}
                </div>
                {c.description && (
                  <div className="text-[12px] text-text-faint truncate">
                    {c.description}
                  </div>
                )}
              </div>
              {!c.is_visible_storefront && (
                <Pill tone="neutral" dot={false}>
                  Hidden
                </Pill>
              )}
              {canDelete && (
                <button
                  onClick={() => archive.mutate(c.category_id)}
                  disabled={archive.isPending}
                  className="grid place-items-center w-8 h-8 rounded-[9px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                  aria-label="Archive category"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateCategoryModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateCategoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateCategory();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        slug: slugify(name),
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New category"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || create.isPending}
            onClick={submit}
          >
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
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        <Field label="Description" hint="optional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        {create.isError && (
          <p className="text-[12px] text-danger">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create category."}
          </p>
        )}
      </div>
    </Modal>
  );
}
