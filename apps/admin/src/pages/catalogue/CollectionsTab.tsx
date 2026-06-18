import { useState } from "react";
import { Plus, Layers } from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import { useCollections, useCreateCollection, type Collection } from "@/lib/catalogue";

/**
 * Collections (manual + rule-based already exist in the backend). v1 lists
 * collections and creates manual ones; rule editing is a follow-up — flagged
 * so we never imply rule evaluation runs when it doesn't yet.
 */
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CollectionsTab() {
  const { can } = useAuthStore();
  const cols = useCollections();
  const [open, setOpen] = useState(false);
  const canCreate = can("catalogue", "create");

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
            New collection
          </Button>
        )}
      </div>

      {cols.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass rounded-[var(--radius)] h-20 animate-pulse" />
          ))}
        </div>
      ) : cols.isError ? (
        <ErrorState onRetry={() => cols.refetch()} />
      ) : (cols.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers className="w-8 h-8" />}
            title="No collections yet"
            message="Curate products into manual or rule-based collections."
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                  New collection
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(cols.data ?? []).map((c: Collection) => (
            <Card key={c.collection_id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-display text-[15px] truncate">{c.name}</div>
                <Pill tone={c.mode === "rule" ? "info" : "neutral"} dot={false}>
                  {c.mode === "rule" ? "Rule-based" : "Manual"}
                </Pill>
              </div>
              {c.description && <div className="text-[12px] text-text-faint">{c.description}</div>}
            </Card>
          ))}
        </div>
      )}

      <CreateCollectionModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateCollectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCollection();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), slug: slugify(name), description: description.trim() || null },
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
      title="New collection"
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
            {create.error instanceof Error ? create.error.message : "Could not create collection."}
          </p>
        )}
      </div>
    </Modal>
  );
}
