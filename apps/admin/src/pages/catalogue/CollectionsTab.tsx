import { useState } from "react";
import { Plus, Layers, Image as ImageIcon, Pencil } from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  type Collection,
} from "@/lib/catalogue";
import { CoverImageEditor } from "./CoverImageEditor";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Collections (manual + rule-based already exist in the backend). v1 lists
 * collections and creates manual ones; rule editing is a follow-up — flagged
 * so we never imply rule evaluation runs when it doesn't yet.
 */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CollectionsTab() {
  const { can } = useAuthStore();
  const cols = useCollections();
  const [open, setOpen] = useState(false);
  const [coverFor, setCoverFor] = useState<Collection | null>(null);
  const canCreate = can("catalogue", "create");
  const canEdit = can("catalogue", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {canCreate && (
          <ImportExportControls
            label="Collections"
            templatePath="/catalogue/collections/import-template"
            exportPath="/catalogue/collections/export"
            importPath="/catalogue/collections/import"
            onImported={() => cols.refetch()}
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
            New collection
          </Button>
        )}
      </div>

      {cols.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="glass rounded-[var(--radius)] h-20 animate-pulse"
            />
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setOpen(true)}
                >
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
              <div className="aspect-[16/9] -mx-4 -mt-4 mb-3 overflow-hidden rounded-t-[var(--radius)] bg-text-primary/[0.04] relative group">
                {c.hero_image_url ? (
                  <img
                    src={c.hero_image_url}
                    alt={c.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-text-faint">
                    <ImageIcon className="w-7 h-7" />
                  </div>
                )}
                {canEdit && (
                  <button
                    onClick={() => setCoverFor(c)}
                    className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 h-7 rounded-[8px] text-[11px] font-semibold dropglass text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="w-3 h-3" /> Cover
                  </button>
                )}
              </div>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-display text-[15px] truncate">
                  {c.name}
                </div>
                <Pill tone={c.mode === "rule" ? "info" : "neutral"} dot={false}>
                  {c.mode === "rule" ? "Rule-based" : "Manual"}
                </Pill>
              </div>
              {c.description && (
                <div className="text-[12px] text-text-faint">
                  {c.description}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateCollectionModal open={open} onClose={() => setOpen(false)} />
      <CollectionCoverModal
        collection={coverFor}
        onClose={() => setCoverFor(null)}
      />
    </div>
  );
}

function CollectionCoverModal({
  collection,
  onClose,
}: {
  collection: Collection | null;
  onClose: () => void;
}) {
  const update = useUpdateCollection();
  if (!collection) return null;
  const save = (url: string | null) =>
    update.mutate(
      { id: collection.collection_id, patch: { hero_image_url: url } },
      { onSuccess: onClose },
    );
  return (
    <Modal open onClose={onClose} title={`Cover — ${collection.name}`}>
      <CoverImageEditor
        value={collection.hero_image_url}
        referenceType="collection"
        referenceId={collection.collection_id}
        onChange={save}
      />
    </Modal>
  );
}

function CreateCollectionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateCollection();
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
      title="New collection"
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
              : "Could not create collection."}
          </p>
        )}
      </div>
    </Modal>
  );
}
