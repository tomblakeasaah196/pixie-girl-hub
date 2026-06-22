import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Send,
  Archive,
  Undo2,
  Trash2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, MoneyText, Pill } from "@/components/ui/primitives";
import {
  ErrorState,
  ConfirmDialog,
  NumberField,
} from "@/components/ui/controls";
import { FormSection, Field } from "@/components/ui/Form";
import {
  useStyledProduct,
  useCreateStyled,
  useUpdateStyled,
  usePublishStyled,
  useUnpublishStyled,
  useRemoveStyled,
  type StyledProduct,
} from "@/lib/catalogue";
import { AvailabilityPill, StyledStatusBadge } from "./parts";
import { BaseProductPicker } from "./BaseProductPicker";
import { StyledVariantsManager } from "./StyledVariantsManager";
import { AddToCollection } from "./AddToCollection";
import { AddToBundle } from "./AddToBundle";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Detail + create for a styled product. /new renders the create form; an id
 *  renders the editor with publish controls. */
export function StyledProductPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  return isNew ? <StyledCreate /> : <StyledDetail id={id!} />;
}

/* ── Create ─────────────────────────────────────────────── */
function StyledCreate() {
  const nav = useNavigate();
  useBreadcrumbs([
    { label: "Catalogue", href: "/catalogue" },
    { label: "New styled" },
  ]);
  const create = useCreateStyled();
  const [baseId, setBaseId] = useState("");
  const [name, setName] = useState("");
  const [retail, setRetail] = useState("");

  const submit = () => {
    if (!baseId || !name.trim()) return;
    create.mutate(
      {
        base_product_id: baseId,
        name: name.trim(),
        slug: slugify(name),
        retail_price_ngn: retail ? Number(retail) : undefined,
      },
      { onSuccess: (s) => nav(`/catalogue/styled/${s.styled_id}`) },
    );
  };

  return (
    <div className="max-w-[640px]">
      <BackBar label="New styled product" />
      <Card className="p-5">
        <FormSection title="Basics">
          <Field
            label="Base product"
            hint="the raw base this styling sits on — stock is drawn from here"
          >
            <BaseProductPicker value={baseId} onChange={setBaseId} />
          </Field>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bardot Bob — Bridal Edit"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
          </Field>
          <Field
            label="Retail price"
            hint="the styled product's own price (size S); add colours & sizes next"
          >
            <NumberField value={retail} onChange={setRetail} suffix="₦" />
          </Field>
        </FormSection>
        {create.isError && (
          <p className="text-[12px] text-danger mb-3">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav("/catalogue")}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!baseId || !name.trim() || create.isPending}
            onClick={submit}
          >
            {create.isPending ? "Creating…" : "Create draft"}
          </Button>
        </div>
        <p className="text-[11.5px] text-text-faint mt-3">
          New styled products start as a{" "}
          <span className="text-text-primary">draft</span>. Publish from the
          detail screen once reviewed.
        </p>
      </Card>
    </div>
  );
}

/* ── Detail / edit ──────────────────────────────────────── */
function StyledDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const styled = useStyledProduct(id);
  useBreadcrumbs([
    { label: "Catalogue", href: "/catalogue" },
    { label: styled.data?.name ?? "Styled product" },
  ]);

  if (styled.isLoading) {
    return (
      <div className="max-w-[860px]">
        <BackBar label="Styled product" />
        <Card className="p-6 h-64 animate-pulse">
          <span />
        </Card>
      </div>
    );
  }
  if (styled.isError || !styled.data) {
    return (
      <div className="max-w-[860px]">
        <BackBar label="Styled product" />
        <ErrorState onRetry={() => styled.refetch()} />
      </div>
    );
  }

  return (
    <StyledEditor
      s={styled.data}
      canPublish={can("catalogue", "publish")}
      canEdit={can("catalogue", "edit")}
      onBack={() => nav("/catalogue")}
    />
  );
}

function StyledEditor({
  s,
  canPublish,
  canEdit,
  onBack,
}: {
  s: StyledProduct;
  canPublish: boolean;
  canEdit: boolean;
  onBack: () => void;
}) {
  const update = useUpdateStyled(s.styled_id);
  const publish = usePublishStyled();
  const unpublish = useUnpublishStyled();
  const remove = useRemoveStyled();

  const [name, setName] = useState(s.name);
  const [shortDesc, setShortDesc] = useState(s.short_description ?? "");
  const [longDesc, setLongDesc] = useState(s.long_description ?? "");
  const [retail, setRetail] = useState(
    s.retail_price_ngn != null ? String(s.retail_price_ngn) : "",
  );
  const [retailUsd, setRetailUsd] = useState(
    s.retail_price_usd != null ? String(s.retail_price_usd) : "",
  );
  const [compareAt, setCompareAt] = useState(
    s.compare_at_price_ngn != null ? String(s.compare_at_price_ngn) : "",
  );
  const [compareAtUsd, setCompareAtUsd] = useState(
    s.compare_at_price_usd != null ? String(s.compare_at_price_usd) : "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(s.name);
    setShortDesc(s.short_description ?? "");
    setLongDesc(s.long_description ?? "");
    setRetail(s.retail_price_ngn != null ? String(s.retail_price_ngn) : "");
    setRetailUsd(s.retail_price_usd != null ? String(s.retail_price_usd) : "");
    setCompareAt(
      s.compare_at_price_ngn != null ? String(s.compare_at_price_ngn) : "",
    );
    setCompareAtUsd(
      s.compare_at_price_usd != null ? String(s.compare_at_price_usd) : "",
    );
  }, [s]);

  const dirty =
    name !== s.name ||
    shortDesc !== (s.short_description ?? "") ||
    longDesc !== (s.long_description ?? "") ||
    retail !== (s.retail_price_ngn != null ? String(s.retail_price_ngn) : "") ||
    retailUsd !==
      (s.retail_price_usd != null ? String(s.retail_price_usd) : "") ||
    compareAt !==
      (s.compare_at_price_ngn != null ? String(s.compare_at_price_ngn) : "") ||
    compareAtUsd !==
      (s.compare_at_price_usd != null ? String(s.compare_at_price_usd) : "");

  const save = () =>
    update.mutate({
      name: name.trim(),
      short_description: shortDesc.trim() || null,
      long_description: longDesc.trim() || null,
      retail_price_ngn: retail ? Number(retail) : null,
      retail_price_usd: retailUsd ? Number(retailUsd) : null,
      compare_at_price_ngn: compareAt ? Number(compareAt) : null,
      compare_at_price_usd: compareAtUsd ? Number(compareAtUsd) : null,
    });

  return (
    <div className="max-w-[920px]">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={onBack}
        >
          Catalogue
        </Button>
        <StyledStatusBadge status={s.status} />
        {s.ai_drafted && (
          <Pill tone="accent" dot={false}>
            <Sparkles className="w-3 h-3" /> AI draft
            {s.ai_confidence != null
              ? ` · ${Math.round(s.ai_confidence * 100)}%`
              : ""}
          </Pill>
        )}
        <div className="ml-auto flex gap-2">
          {canPublish && s.status !== "live" && (
            <Button
              variant="primary"
              size="sm"
              icon={<Send className="w-3.5 h-3.5" />}
              disabled={publish.isPending}
              onClick={() => publish.mutate(s.styled_id)}
            >
              Publish
            </Button>
          )}
          {canPublish && s.status === "live" && (
            <Button
              size="sm"
              icon={<Undo2 className="w-3.5 h-3.5" />}
              disabled={unpublish.isPending}
              onClick={() => unpublish.mutate({ id: s.styled_id })}
            >
              Unpublish
            </Button>
          )}
          {canPublish && s.status !== "archived" && (
            <Button
              size="sm"
              icon={<Archive className="w-3.5 h-3.5" />}
              disabled={unpublish.isPending}
              onClick={() =>
                unpublish.mutate({ id: s.styled_id, archive: true })
              }
            >
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Editor */}
        <Card className="p-5">
          <FormSection title="Listing">
            <Field label="Name">
              <input
                value={name}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-60"
              />
            </Field>
            <Field label="Short description" hint="storefront teaser">
              <textarea
                value={shortDesc}
                disabled={!canEdit}
                onChange={(e) => setShortDesc(e.target.value)}
                rows={2}
                className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y disabled:opacity-60"
              />
            </Field>
            <Field label="Long description">
              <textarea
                value={longDesc}
                disabled={!canEdit}
                onChange={(e) => setLongDesc(e.target.value)}
                rows={5}
                className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y disabled:opacity-60"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Retail price" hint="Naira · size S">
                <NumberField
                  value={retail}
                  onChange={setRetail}
                  suffix="₦"
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Retail price" hint="US Dollar · size S">
                <NumberField
                  value={retailUsd}
                  onChange={setRetailUsd}
                  suffix="$"
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Compare-at" hint="Naira · was/now">
                <NumberField
                  value={compareAt}
                  onChange={setCompareAt}
                  suffix="₦"
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Compare-at" hint="US Dollar · was/now">
                <NumberField
                  value={compareAtUsd}
                  onChange={setCompareAtUsd}
                  suffix="$"
                  disabled={!canEdit}
                />
              </Field>
            </div>
          </FormSection>

          {canEdit && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty || update.isPending}
                onClick={save}
              >
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </Card>

        {/* Summary */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="micro mb-2">Availability</div>
            <AvailabilityPill availability={s.availability} />
            {s.availability.state === "preorder" && s.availability.message && (
              <p className="text-[11.5px] text-text-faint mt-2">
                {s.availability.message}
              </p>
            )}
          </Card>
          <Card className="p-4">
            <div className="micro mb-1.5">Price</div>
            {s.price_range ? (
              s.price_range.min === s.price_range.max ? (
                <MoneyText ngn={s.price_range.min} className="text-[22px]" />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <MoneyText ngn={s.price_range.min} className="text-[20px]" />
                  <span className="text-text-faint text-[13px]">–</span>
                  <MoneyText ngn={s.price_range.max} className="text-[16px]" />
                </div>
              )
            ) : s.retail_price_ngn != null ? (
              <MoneyText ngn={s.retail_price_ngn} className="text-[22px]" />
            ) : (
              <span className="text-text-faint text-[13px]">
                Set a retail price
              </span>
            )}
            <p className="text-[11px] text-text-faint mt-1">
              across colours &amp; sizes
            </p>
          </Card>
          <Card className="p-4">
            <div className="micro mb-1.5">Base product</div>
            <div className="text-[13px]">{s.base_name}</div>
            <div className="font-mono text-[10.5px] text-accent-glow">
              {s.base_product_code}
            </div>
            <p className="text-[11px] text-text-faint mt-1.5">
              wholesale base · stock source
            </p>
          </Card>
          {canEdit && (
            <Card className="p-4">
              <AddToCollection styledId={s.styled_id} />
            </Card>
          )}
          {canEdit && (
            <Card className="p-4">
              <AddToBundle styledId={s.styled_id} />
            </Card>
          )}
        </div>
      </div>

      {/* Colours + colour×size variants */}
      <div className="mt-4">
        <StyledVariantsManager
          styledId={s.styled_id}
          anchorPrice={s.retail_price_ngn}
          canEdit={canEdit}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(s.styled_id, { onSuccess: onBack })}
        title="Delete styled product?"
        message="This moves the styled product, its colours, and all variants to the trash. They can be restored within 15 days — after that they are permanently purged. The base product and its stock are unaffected."
        confirmLabel="Move to trash"
        busy={remove.isPending}
      />
    </div>
  );
}

function BackBar({ label }: { label: string }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-3 mb-4">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="w-4 h-4" />}
        onClick={() => nav("/catalogue")}
      >
        Catalogue
      </Button>
      <span className="font-display text-lg">{label}</span>
    </div>
  );
}
