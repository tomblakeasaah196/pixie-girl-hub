import { useEffect, useState } from "react";
import { Plus, Shield, Trash2 } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import {
  NumberField,
  Select,
  ConfirmDialog,
  ErrorState,
} from "@/components/ui/controls";
import { useFloors, useFloorMutations } from "./hooks";
import {
  CHANNEL_OPTIONS,
  FLOOR_TYPE_LABELS,
  FLOOR_TYPE_OPTIONS,
  FLOOR_VALUE_IS_NGN,
  channelLabel,
  fmtDate,
} from "./constants";
import type { Floor, FloorType } from "./types";

export function FloorsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useFloors();
  const { create, remove } = useFloorMutations();
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Floor | null>(null);

  const cols: Column<Floor>[] = [
    {
      key: "type",
      header: "Type",
      width: "170px",
      render: (r) => (
        <span className="font-semibold text-[13px]">
          {FLOOR_TYPE_LABELS[r.floor_type]}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      width: "150px",
      render: (r) =>
        FLOOR_VALUE_IS_NGN[r.floor_type] ? (
          <MoneyText ngn={Number(r.floor_value)} className="text-[13px]" />
        ) : (
          <span className="font-mono text-[13px]">{r.floor_value}%</span>
        ),
    },
    {
      key: "channel",
      header: "Channel",
      width: "120px",
      render: (r) => (
        <span className="text-text-muted text-xs">
          {channelLabel(r.channel)}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => (
        <span className="text-text-muted text-xs truncate">
          {r.reason ?? "—"}
        </span>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      width: "110px",
      render: (r) => (
        <span className="text-text-faint text-xs">
          {r.expires_at ? fmtDate(r.expires_at) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (r) => (
        <Pill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </Pill>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: "56px",
            render: (r: Floor) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDel(r);
                }}
                className="text-text-faint hover:text-danger p-1.5 rounded-[9px] hover:bg-danger/10"
                aria-label="Deactivate floor"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ),
          } satisfies Column<Floor>,
        ]
      : []),
  ];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setCreating(true)}
          >
            New floor
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={data ?? []}
        rowKey={(r) => r.floor_id}
        loading={isLoading}
        empty={{
          icon: <Shield className="w-7 h-7" />,
          title: "No price floors",
          message:
            "Set minimum prices, margins or markups to protect against under-pricing.",
          action: canEdit ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setCreating(true)}
            >
              New floor
            </Button>
          ) : undefined,
        }}
      />

      <FloorDrawer
        open={creating}
        saving={create.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(input) =>
          create.mutate(input, { onSuccess: () => setCreating(false) })
        }
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() =>
          confirmDel &&
          remove.mutate(confirmDel.floor_id, {
            onSuccess: () => setConfirmDel(null),
          })
        }
        title="Deactivate floor?"
        message="This deactivates the floor. Recreate it to change its value (floors are not editable in place)."
        confirmLabel="Deactivate"
        busy={remove.isPending}
      />
    </div>
  );
}

function FloorDrawer({
  open,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: {
    floor_type: FloorType;
    floor_value: number;
    channel?: string;
    reason?: string;
  }) => void;
}) {
  const [floorType, setFloorType] = useState<FloorType>("min_price_ngn");
  const [value, setValue] = useState("");
  const [channel, setChannel] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setFloorType("min_price_ngn");
    setValue("");
    setChannel("");
    setReason("");
  }, [open]);

  const isNgn = FLOOR_VALUE_IS_NGN[floorType];

  const submit = () => {
    if (value.trim() === "") return;
    onSubmit({
      floor_type: floorType,
      floor_value: Number(value),
      channel: channel || undefined,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New price floor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || value.trim() === ""}
            onClick={submit}
          >
            {saving ? "Creating…" : "Create floor"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Floor type">
          <Select
            value={floorType}
            onChange={(v) => setFloorType(v)}
            options={FLOOR_TYPE_OPTIONS}
          />
        </Field>
        <Field label={isNgn ? "Floor value (₦)" : "Floor value (%)"}>
          <NumberField
            value={value}
            onChange={setValue}
            suffix={isNgn ? "₦" : "%"}
            placeholder="0"
          />
        </Field>
        <Field label="Channel" hint="optional — applies to all if blank">
          <Select
            value={channel}
            onChange={setChannel}
            options={[{ value: "", label: "All channels" }, ...CHANNEL_OPTIONS]}
          />
        </Field>
        <Field label="Reason" hint="optional">
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this floor exists"
          />
        </Field>
      </div>
    </Drawer>
  );
}
