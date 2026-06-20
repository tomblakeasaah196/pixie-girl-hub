import { useEffect, useState } from "react";
import { Plus, Tag, Trash2 } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import { NumberField, Select, ConfirmDialog } from "@/components/ui/controls";
import { ErrorState } from "@/components/ui/controls";
import { useRules, useRuleMutations } from "./hooks";
import {
  CHANNEL_OPTIONS,
  RULE_TYPE_LABELS,
  RULE_TYPE_OPTIONS,
  RULE_VALUE_IS_NGN,
  channelLabel,
} from "./constants";
import type { Rule, RuleType } from "./types";

export function RulesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useRules();
  const { create, update, remove } = useRuleMutations();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Rule | null>(null);

  const cols: Column<Rule>[] = [
    {
      key: "name",
      header: "Rule",
      render: (r) => (
        <div>
          <div className="font-semibold text-[13px]">{r.rule_name}</div>
          {r.description && (
            <div className="text-[11px] text-text-faint truncate max-w-[220px]">
              {r.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "150px",
      render: (r) => (
        <span className="text-text-muted text-xs">
          {RULE_TYPE_LABELS[r.rule_type]}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      width: "130px",
      render: (r) =>
        r.rule_value == null ? (
          <span className="text-text-faint">—</span>
        ) : RULE_VALUE_IS_NGN[r.rule_type] ? (
          <MoneyText ngn={Number(r.rule_value)} className="text-[13px]" />
        ) : (
          <span className="font-mono text-[13px]">{r.rule_value}%</span>
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
      key: "priority",
      header: "Priority",
      align: "right",
      width: "80px",
      render: (r) => <span className="font-mono text-xs">{r.priority}</span>,
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
            render: (r: Rule) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDel(r);
                }}
                className="text-text-faint hover:text-danger p-1.5 rounded-[9px] hover:bg-danger/10"
                aria-label="Deactivate rule"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ),
          } satisfies Column<Rule>,
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
            New rule
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={data ?? []}
        rowKey={(r) => r.rule_id}
        onRowClick={canEdit ? setEditing : undefined}
        loading={isLoading}
        empty={{
          icon: <Tag className="w-7 h-7" />,
          title: "No pricing rules",
          message:
            "Define markup, margin, fixed-price or discount rules to automate pricing.",
          action: canEdit ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setCreating(true)}
            >
              New rule
            </Button>
          ) : undefined,
        }}
      />

      <RuleDrawer
        open={creating || !!editing}
        rule={editing}
        saving={create.isPending || update.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(input) => {
          if (editing) {
            update.mutate(
              { id: editing.rule_id, input },
              { onSuccess: () => setEditing(null) },
            );
          } else {
            create.mutate(input, { onSuccess: () => setCreating(false) });
          }
        }}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() =>
          confirmDel &&
          remove.mutate(confirmDel.rule_id, {
            onSuccess: () => setConfirmDel(null),
          })
        }
        title={`Deactivate "${confirmDel?.rule_name}"?`}
        message="This deactivates the rule. It stops affecting prices but stays on record."
        confirmLabel="Deactivate"
        busy={remove.isPending}
      />
    </div>
  );
}

function RuleDrawer({
  open,
  rule,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  rule: Rule | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: {
    rule_name: string;
    rule_type: RuleType;
    rule_value?: number;
    channel?: string;
    priority?: number;
    description?: string;
    is_active?: boolean;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("markup_pct");
  const [value, setValue] = useState("");
  const [channel, setChannel] = useState("");
  const [priority, setPriority] = useState("10");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(rule?.rule_name ?? "");
    setRuleType(rule?.rule_type ?? "markup_pct");
    setValue(rule?.rule_value != null ? String(rule.rule_value) : "");
    setChannel(rule?.channel ?? "");
    setPriority(String(rule?.priority ?? 10));
    setDescription(rule?.description ?? "");
    setIsActive(rule?.is_active ?? true);
  }, [open, rule]);

  const isNgn = RULE_VALUE_IS_NGN[ruleType];
  const needsValue =
    ruleType !== "cost_pass_through" && ruleType !== "tiered_quantity";

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      rule_name: name.trim(),
      rule_type: ruleType,
      rule_value: needsValue && value.trim() !== "" ? Number(value) : undefined,
      channel: channel || undefined,
      priority: priority.trim() === "" ? undefined : Number(priority),
      description: description.trim() || undefined,
      ...(rule ? { is_active: isActive } : {}),
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rule ? "Edit rule" : "New pricing rule"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim()}
            onClick={submit}
          >
            {saving ? "Saving…" : rule ? "Save" : "Create rule"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Rule name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Storefront base markup"
          />
        </Field>
        <Field label="Rule type">
          <Select
            value={ruleType}
            onChange={(v) => setRuleType(v)}
            options={RULE_TYPE_OPTIONS}
          />
        </Field>
        {needsValue && (
          <Field label={isNgn ? "Value (₦)" : "Value (%)"}>
            <NumberField
              value={value}
              onChange={setValue}
              suffix={isNgn ? "₦" : "%"}
              placeholder="0"
            />
          </Field>
        )}
        <Field label="Channel" hint="optional — applies to all if blank">
          <Select
            value={channel}
            onChange={setChannel}
            options={[{ value: "", label: "All channels" }, ...CHANNEL_OPTIONS]}
          />
        </Field>
        <Field label="Priority" hint="lower = higher priority">
          <NumberField
            value={priority}
            onChange={setPriority}
            allowDecimal={false}
          />
        </Field>
        <Field label="Description" hint="optional">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {rule && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-accent-deep w-4 h-4"
            />
            <span className="text-[13px]">Active</span>
          </label>
        )}
      </div>
    </Drawer>
  );
}
