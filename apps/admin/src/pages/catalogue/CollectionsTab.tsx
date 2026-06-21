import { useEffect, useState } from "react";
import {
  Plus,
  Layers,
  Image as ImageIcon,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog, Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useCollection,
  useAddCollectionMember,
  useRemoveCollectionMember,
  useStyledProducts,
  type Collection,
} from "@/lib/catalogue";
import { CoverImageEditor } from "./CoverImageEditor";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Collections — manual curation of STYLED products (a base product never joins
 * a collection). The card opens a full editor: rename, manage members, delete.
 */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

export function CollectionsTab() {
  const { can } = useAuthStore();
  const cols = useCollections();
  const [open, setOpen] = useState(false);
  const [coverFor, setCoverFor] = useState<Collection | null>(null);
  const [editFor, setEditFor] = useState<Collection | null>(null);
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
            message="Curate styled products into a storefront collection."
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
              <button
                type="button"
                onClick={() => canEdit && setEditFor(c)}
                disabled={!canEdit}
                className="w-full text-left disabled:cursor-default"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-display text-[15px] truncate">
                    {c.name}
                  </div>
                  <Pill
                    tone={c.mode === "rule" ? "info" : "neutral"}
                    dot={false}
                  >
                    {c.mode === "rule" ? "Rule-based" : "Manual"}
                  </Pill>
                </div>
                {c.description && (
                  <div className="text-[12px] text-text-faint">
                    {c.description}
                  </div>
                )}
                {canEdit && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-glow">
                    <Pencil className="w-3 h-3" /> Edit & manage products
                  </div>
                )}
              </button>
            </Card>
          ))}
        </div>
      )}

      <CreateCollectionModal open={open} onClose={() => setOpen(false)} />
      <CollectionCoverModal
        collection={coverFor}
        onClose={() => setCoverFor(null)}
      />
      <CollectionEditorModal
        collection={editFor}
        onClose={() => setEditFor(null)}
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

/** Full editor: rename / describe, add & remove styled products, delete. */
function CollectionEditorModal({
  collection,
  onClose,
}: {
  collection: Collection | null;
  onClose: () => void;
}) {
  const detail = useCollection(collection?.collection_id ?? null);
  const update = useUpdateCollection();
  const del = useDeleteCollection();
  const addMember = useAddCollectionMember();
  const removeMember = useRemoveCollectionMember(collection?.collection_id ?? "");
  const styled = useStyledProducts();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pick, setPick] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (collection) {
      setName(collection.name);
      setDescription(collection.description ?? "");
      setPick("");
    }
  }, [collection]);

  if (!collection) return null;

  const members = detail.data?.members ?? [];
  const memberIds = new Set(members.map((m) => m.styled_id));
  const pickOptions = [
    { value: "", label: "Add a styled product…" },
    ...(styled.data ?? [])
      .filter((s) => !memberIds.has(s.styled_id))
      .map((s) => ({ value: s.styled_id, label: s.name })),
  ];

  const dirty =
    name !== collection.name ||
    description !== (collection.description ?? "");

  const saveMeta = () =>
    update.mutate({
      id: collection.collection_id,
      patch: { name: name.trim(), description: description.trim() || null },
    });

  const add = (styledId: string) => {
    if (!styledId) return;
    addMember.mutate({ collectionId: collection.collection_id, styledId });
    setPick("");
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit — ${collection.name}`}
      footer={
        <>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors mr-auto"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete collection
          </button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || !name.trim() || update.isPending}
            onClick={saveMeta}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Description" hint="optional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Field>

        <div>
          <div className="micro mb-2">Products in this collection</div>
          <Select value={pick} onChange={add} options={pickOptions} />
          <div className="mt-3 space-y-2">
            {detail.isLoading ? (
              <div className="h-10 rounded-[11px] bg-text-primary/[0.05] animate-pulse" />
            ) : members.length === 0 ? (
              <p className="text-[11.5px] text-text-faint">
                No products yet. Add styled products above — only styled products
                can join a collection.
              </p>
            ) : (
              members.map((m) => (
                <div
                  key={m.styled_id}
                  className="flex items-center gap-2 rounded-[11px] border border-line bg-text-primary/[0.03] px-3 py-2"
                >
                  <div className="w-8 h-8 rounded-[7px] overflow-hidden bg-text-primary/[0.06] grid place-items-center shrink-0">
                    {m.image_url ? (
                      <img
                        src={m.image_url}
                        alt={m.styled_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5 text-text-faint" />
                    )}
                  </div>
                  <span className="flex-1 min-w-0 truncate text-[13px]">
                    {m.styled_name}
                  </span>
                  <button
                    onClick={() => removeMember.mutate(m.styled_id)}
                    disabled={removeMember.isPending}
                    className="grid place-items-center w-7 h-7 rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label="Remove product"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(collection.collection_id, {
            onSuccess: () => {
              setConfirmDelete(false);
              onClose();
            },
          })
        }
        title="Delete collection?"
        message="This removes the collection. The styled products inside it are not deleted — they simply leave this collection."
        confirmLabel="Delete"
        busy={del.isPending}
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
            className={inputCls}
          />
        </Field>
        <Field label="Description" hint="optional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
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
