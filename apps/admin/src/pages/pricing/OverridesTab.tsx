import { useEffect, useState } from "react";
import { Plus, Layers, Trash2 } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import { NumberField, Select, ConfirmDialog, ErrorState } from "@/components/ui/controls";
import type { BaseProduct } from "@/lib/catalogue";
import { ProductVariantPicker } from "./parts";
import { useOverrides, useOverrideMutations } from "./hooks";
import { CHANNEL_OPTIONS, channelLabel, fmtDate } from "./constants";
import type { Channel, Override } from "./types";

export function OverridesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useOverrides();
  const { create, remove } = useOverrideMutations();
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Override | null>(null);

  const cols: Column<Override>[] = [
    {
      key: "variant",
      header: "Variant",
      render: (r) => <span className="font-mono text-[11px] text-text-muted">{r.variant_id.slice(0, 8)}…</span>,
    },
    {
      key: "channel",
      header: "Channel",
      width: "120px",
      render: (r) => <span className="text-text-muted text-xs">{channelLabel(r.channel)}</span>,
    },
    {
      key: "price",
      header: "Override price",
      align: "right",
      width: "140px",
      render: (r) => <MoneyText ngn={Number(r.override_price_ngn)} className="text-[13px]" />,
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => <span className="text-text-muted text-xs truncate">{r.reason ?? "—"}</span>,
    },
    {
      key: "dates",
      header: "Window",
      width: "150px",
      render: (r) => (
        <span className="text-text-faint text-xs">
          {r.effective_from ? fmtDate(r.effective_from) : "—"}
          {r.effective_to ? ` → ${fmtDate(r.effective_to)}` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (r) => <Pill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Pill>,
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: "56px",
            render: (r: Override) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDel(r);
                }}
                className="text-text-faint hover:text-danger p-1.5 rounded-[9px] hover:bg-danger/10"
                aria-label="Remove override"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ),
          } satisfies Column<Override>,
        ]
      : []),
  ];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>
            New override
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={data ?? []}
        rowKey={(r) => r.override_id}
        loading={isLoading}
        empty={{
          icon: <Layers className="w-7 h-7" />,
          title: "No price overrides",
          message: "Pin a fixed price for a specific variant on a specific channel.",
          action: canEdit ? (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
              New override
            </Button>
          ) : undefined,
        }}
      />

      <OverrideDrawer
        open={creating}
        saving={create.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(input) => create.mutate(input, { onSuccess: () => setCreating(false) })}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() =>
          confirmDel &&
          remove.mutate(confirmDel.override_id, { onSuccess: () => setConfirmDel(null) })
        }
        title="Remove override?"
        message="The variant reverts to its rule-driven / catalogue price on this channel."
        confirmLabel="Remove"
        busy={remove.isPending}
      />
    </div>
  );
}

function OverrideDrawer({
  open,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: {
    variant_id: string;
    channel: Channel;
    override_price_ngn: number;
    reason: string;
    effective_from?: string;
    effective_to?: string;
  }) => void;
}) {
  const [product, setProduct] = useState<BaseProduct | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("storefront");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!open) return;
    setProduct(null);
    setVariantId(null);
    setChannel("storefront");
    setPrice("");
    setReason("");
    setFrom("");
    setTo("");
  }, [open]);

  const valid = !!variantId && price.trim() !== "" && reason.trim() !== "";

  const submit = () => {
    if (!valid || !variantId) return;
    onSubmit({
      variant_id: variantId,
      channel,
      override_price_ngn: Number(price),
      reason: reason.trim(),
      effective_from: from || undefined,
      effective_to: to || undefined,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New price override"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || !valid} onClick={submit}>
            {saving ? "Creating…" : "Create override"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ProductVariantPicker
          productId={product?.product_id ?? null}
          variantId={variantId}
          onProduct={setProduct}
          onVariant={(id) => setVariantId(id)}
        />
        <Field label="Channel">
          <Select value={channel} onChange={(v) => setChannel(v)} options={CHANNEL_OPTIONS} />
        </Field>
        <Field label="Override price (₦)">
          <NumberField value={price} onChange={setPrice} suffix="₦" placeholder="0.00" />
        </Field>
        <Field label="Reason">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this price is pinned" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from" hint="optional">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
          </Field>
          <Field label="Effective to" hint="optional">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}
