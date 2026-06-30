import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Palette,
  Image as ImageIcon,
  Pencil,
  Trash2,
  X,
  Link2,
} from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog, Toggle, NumberField } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useShades,
  useShade,
  useCreateShade,
  useUpdateShade,
  useDeleteShade,
  useAssignShadeMembers,
  useRemoveShadeMember,
  type Shade,
} from "@/lib/catalogue";
import { CoverImageEditor } from "./CoverImageEditor";
import { BundleProductPicker } from "./BundleProductPicker";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Product Shades ("Shop by shade") — a standalone storefront section beside
 * Collections. Each shade is a content page: cover, short + long copy ("how to
 * blend it"), SEO slug. STYLED products carry a shade. The editor's "products"
 * section is the Flow-2 bulk-assign: search is pre-seeded to the shade name, so
 * every product carrying that colour surfaces — tick "select all", hit Add.
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
const areaCls =
  "w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y min-h-[80px]";

export function ShadesTab() {
  const { can } = useAuthStore();
  const shades = useShades();
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<Shade | null>(null);
  const canCreate = can("catalogue", "create");
  const canEdit = can("catalogue", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {canCreate && (
          <ImportExportControls
            label="Shades"
            templatePath="/catalogue/shades/import-template"
            exportPath="/catalogue/shades/export"
            importPath="/catalogue/shades/import"
            onImported={() => shades.refetch()}
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
            New shade
          </Button>
        )}
      </div>

      {shades.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="glass rounded-[var(--radius)] h-44 animate-pulse"
            />
          ))}
        </div>
      ) : shades.isError ? (
        <ErrorState onRetry={() => shades.refetch()} />
      ) : (shades.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Palette className="w-8 h-8" />}
            title="No shades yet"
            message="Build your “Shop by shade” section — each shade is a standalone page with its own cover, copy and styled products."
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                  New shade
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(shades.data ?? []).map((s) => (
            <Card key={s.shade_id} className="p-4">
              <div className="aspect-[16/9] -mx-4 -mt-4 mb-3 overflow-hidden rounded-t-[var(--radius)] bg-text-primary/[0.04] relative">
                {s.cover_image_url ? (
                  <img
                    src={s.cover_image_url}
                    alt={s.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-text-faint">
                    <ImageIcon className="w-7 h-7" />
                  </div>
                )}
                {!s.is_active && (
                  <span className="absolute top-2 left-2">
                    <Pill tone="neutral" dot={false}>
                      Hidden
                    </Pill>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => canEdit && setEditFor(s)}
                disabled={!canEdit}
                className="w-full text-left disabled:cursor-default"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-display text-[15px] truncate">
                    {s.name}
                  </div>
                  <Pill tone="info" dot={false}>
                    {s.product_count ?? 0}{" "}
                    {(s.product_count ?? 0) === 1 ? "product" : "products"}
                  </Pill>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-text-faint">
                  <Link2 className="w-3 h-3" />
                  /shades/{s.slug}
                </div>
                {s.short_description && (
                  <div className="text-[12px] text-text-faint mt-1 line-clamp-2">
                    {s.short_description}
                  </div>
                )}
                {canEdit && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-glow">
                    <Pencil className="w-3 h-3" /> Edit &amp; add products
                  </div>
                )}
              </button>
            </Card>
          ))}
        </div>
      )}

      <CreateShadeModal open={open} onClose={() => setOpen(false)} />
      <ShadeEditorModal shade={editFor} onClose={() => setEditFor(null)} />
    </div>
  );
}

function CreateShadeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateShade();
  const [name, setName] = useState("");
  const [shortDesc, setShortDesc] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        slug: slugify(name),
        short_description: shortDesc.trim() || null,
      },
      {
        onSuccess: () => {
          setName("");
          setShortDesc("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New shade"
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
        <Field label="Shade name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Icy Grey"
            className={inputCls}
          />
        </Field>
        <Field label="Short description" hint="optional">
          <input
            value={shortDesc}
            onChange={(e) => setShortDesc(e.target.value)}
            placeholder="A cool ashen grey."
            className={inputCls}
          />
        </Field>
        {name.trim() && (
          <p className="text-[11.5px] text-text-faint">
            Page URL: <span className="font-mono">/shades/{slugify(name)}</span>
          </p>
        )}
        {create.isError && (
          <p className="text-[12px] text-danger">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create shade."}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Full editor: metadata + cover + blend copy + the Flow-2 product picker. */
function ShadeEditorModal({
  shade,
  onClose,
}: {
  shade: Shade | null;
  onClose: () => void;
}) {
  const detail = useShade(shade?.shade_id ?? null);
  const update = useUpdateShade();
  const del = useDeleteShade();
  const removeMember = useRemoveShadeMember(shade?.shade_id ?? "");

  const [name, setName] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [longDesc, setLongDesc] = useState("");
  const [order, setOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (shade) {
      setName(shade.name);
      setShortDesc(shade.short_description ?? "");
      setLongDesc(shade.long_description ?? "");
      setOrder(String(shade.display_order ?? 0));
      setActive(shade.is_active);
      setMetaTitle(shade.meta_title ?? "");
      setMetaDesc(shade.meta_description ?? "");
    }
  }, [shade]);

  if (!shade) return null;

  const members = detail.data?.members ?? [];

  const dirty =
    name !== shade.name ||
    shortDesc !== (shade.short_description ?? "") ||
    longDesc !== (shade.long_description ?? "") ||
    Number(order) !== shade.display_order ||
    active !== shade.is_active ||
    metaTitle !== (shade.meta_title ?? "") ||
    metaDesc !== (shade.meta_description ?? "");

  const saveMeta = () =>
    update.mutate({
      id: shade.shade_id,
      patch: {
        name: name.trim(),
        short_description: shortDesc.trim() || null,
        long_description: longDesc.trim() || null,
        display_order: Number(order) || 0,
        is_active: active,
        meta_title: metaTitle.trim() || null,
        meta_description: metaDesc.trim() || null,
      },
    });

  const saveCover = (url: string | null) =>
    update.mutate({ id: shade.shade_id, patch: { cover_image_url: url } });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Edit — ${shade.name}`}
      footer={
        <>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors mr-auto"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete shade
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
      <div className="space-y-5">
        {/* Cover */}
        <div>
          <div className="micro mb-2">Cover image</div>
          <CoverImageEditor
            value={shade.cover_image_url}
            referenceType="shade"
            referenceId={shade.shade_id}
            onChange={saveCover}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Shade name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Display order" hint="lower shows first">
            <NumberField value={order} onChange={setOrder} />
          </Field>
        </div>

        <Field label="Short description" hint="list teaser">
          <input
            value={shortDesc}
            onChange={(e) => setShortDesc(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Long description" hint="how to blend it · shown on the shade page">
          <textarea
            value={longDesc}
            onChange={(e) => setLongDesc(e.target.value)}
            className={areaCls}
            rows={4}
          />
        </Field>

        <div className="flex items-center gap-2">
          <Toggle checked={active} onChange={setActive} label="Active" />
          <span className="text-[11.5px] text-text-faint">
            Inactive shades are hidden from the storefront (kept, not deleted).
          </span>
        </div>

        {/* SEO meta — optional per-page overrides for the shade page. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Meta title" hint="SEO · falls back to the shade name">
            <input
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field
            label="Meta description"
            hint="SEO · falls back to the short description"
          >
            <input
              value={metaDesc}
              onChange={(e) => setMetaDesc(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        {/* Flow-2 product picker */}
        <ShadeProductPicker
          shadeId={shade.shade_id}
          shadeName={shade.name}
          members={members}
          membersLoading={detail.isLoading}
          onRemoveMember={(id) => removeMember.mutate(id)}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(shade.shade_id, {
            onSuccess: () => {
              setConfirmDelete(false);
              onClose();
            },
          })
        }
        title="Delete shade?"
        message="This removes the shade page. The styled products inside it are not deleted — they simply become unshaded."
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </Modal>
  );
}

/**
 * Shade product picker — the very same picker the Bundles tab uses
 * (BundleProductPicker), imported here so a shade is curated exactly like a
 * bundle: lace filters, a thumbnail grid, "select all" and one batch Add. The
 * search is seeded with the shade name (the colour) so the matching styled
 * products surface first — the <2s path. Adding bulk-assigns the whole
 * selection to the shade in a single call; the assigned list below removes one
 * at a time. This is what powers "shop by shade" on the storefront.
 */
function ShadeProductPicker({
  shadeId,
  shadeName,
  members,
  membersLoading,
  onRemoveMember,
}: {
  shadeId: string;
  shadeName: string;
  members: { styled_id: string; styled_name: string; status: string; image_url: string | null }[];
  membersLoading: boolean;
  onRemoveMember: (styledId: string) => void;
}) {
  const assign = useAssignShadeMembers();
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.styled_id)),
    [members],
  );

  return (
    <div className="rounded-[12px] border border-line p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="micro">Products in this shade</div>
        <span className="text-[11px] text-text-faint">
          {members.length} assigned
        </span>
      </div>

      {/* The Bundles-tab picker, reused verbatim. `key` remounts it per shade so
          the search re-seeds with the new shade name; the batch Add drops the
          whole selection into the shade in one call. */}
      <BundleProductPicker
        key={shadeId}
        initialQuery={shadeName}
        existingStyledIds={memberIds}
        busy={assign.isPending}
        onAdd={async (items) => {
          await assign.mutateAsync({
            shadeId,
            styledIds: items.map((i) => i.styled_id),
          });
        }}
      />

      {/* Current members */}
      {members.length > 0 && (
        <div className="pt-1 border-t hairline space-y-1.5">
          <div className="micro pt-2">Assigned</div>
          {membersLoading ? (
            <div className="h-9 rounded-[10px] bg-text-primary/[0.05] animate-pulse" />
          ) : (
            members.map((m) => (
              <div
                key={m.styled_id}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-text-primary/[0.03] px-3 py-1.5"
              >
                <div className="w-7 h-7 rounded-[6px] overflow-hidden bg-text-primary/[0.06] grid place-items-center shrink-0">
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
                  onClick={() => onRemoveMember(m.styled_id)}
                  className="grid place-items-center w-7 h-7 rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                  aria-label="Remove from shade"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
