import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { Check, ListPlus, Loader2, Plus } from "lucide-react";
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  type CustomField,
} from "@/lib/settings";
import { useActiveBusiness } from "@/stores/business";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import {
  NumberField,
  Toggle,
  Select,
  MultiSelect,
  ErrorState,
} from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Settings → Custom fields. Per-entity custom field definitions.
 */

const ENTITIES = [
  "product",
  "contact",
  "crm_deal",
  "sales_order",
  "stylist_partner",
] as const;
type Entity = (typeof ENTITIES)[number];

const FIELD_TYPES = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "boolean",
  "url",
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const ROLES = [
  "owner",
  "admin",
  "manager",
  "staff",
  "accountant",
  "viewer",
] as const;
type Role = (typeof ROLES)[number];

const ENTITY_LABEL: Record<Entity, string> = {
  product: "Product",
  contact: "Contact",
  crm_deal: "CRM Deal",
  sales_order: "Sales Order",
  stylist_partner: "Stylist Partner",
};

function Dot({ on }: { on: boolean }) {
  return on ? (
    <Check className="w-4 h-4 text-success inline" />
  ) : (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-primary/20" />
  );
}

export function CustomFieldsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Custom Fields" }]);
  const active = useActiveBusiness();
  const [entity, setEntity] = useState<Entity>("product");
  const q = useCustomFields(entity);
  const update = useUpdateCustomField();

  const [adding, setAdding] = useState(false);

  const columns: Column<CustomField>[] = [
    {
      key: "field_label",
      header: "Label",
      render: (r) => <span className="font-semibold">{r.field_label}</span>,
    },
    {
      key: "field_key",
      header: "Key",
      render: (r) => <span className="font-mono text-text-muted">{r.field_key}</span>,
    },
    {
      key: "field_type",
      header: "Type",
      render: (r) => (
        <Pill tone="info" dot={false}>
          {r.field_type}
        </Pill>
      ),
    },
    {
      key: "required",
      header: "Req",
      align: "right",
      render: (r) => <Dot on={r.is_required} />,
    },
    {
      key: "searchable",
      header: "Search",
      align: "right",
      render: (r) => <Dot on={r.is_searchable} />,
    },
    {
      key: "filterable",
      header: "Filter",
      align: "right",
      render: (r) => <Dot on={r.is_filterable} />,
    },
    {
      key: "display_order",
      header: "Order",
      align: "right",
      render: (r) => <span className="tabular-nums">{r.display_order}</span>,
    },
    {
      key: "active",
      header: "Active",
      align: "right",
      render: (r) => (
        <Toggle
          checked={r.is_active}
          onChange={(v) =>
            update.mutate({ id: r.field_id, patch: { is_active: v } })
          }
        />
      ),
    },
  ];

  return (
    <div className="max-w-[1000px] mx-auto space-y-4 pb-12">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Custom fields</h1>
        <Pill tone="accent" dot={false}>
          Editing for: {active.name}
        </Pill>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ENTITIES.map((e) => (
          <button
            key={e}
            onClick={() => setEntity(e)}
            className={cn(
              "px-3 py-1.5 text-[12px] font-semibold rounded-[10px] border transition-colors",
              entity === e
                ? "border-accent/45 text-accent-glow bg-accent/[0.08]"
                : "border-line text-text-muted hover:text-text-primary",
            )}
          >
            {ENTITY_LABEL[e]}
          </button>
        ))}
      </div>

      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <DataTable<CustomField>
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.field_id}
          loading={q.isLoading}
          toolbar={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              className="ml-auto"
              onClick={() => setAdding(true)}
            >
              Add field
            </Button>
          }
          empty={{
            icon: <ListPlus className="w-7 h-7" />,
            title: "No custom fields",
            message: `No custom fields defined for ${ENTITY_LABEL[entity]} yet.`,
            action: (
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setAdding(true)}
              >
                Add field
              </Button>
            ),
          }}
        />
      )}

      <AddFieldDrawer
        open={adding}
        onClose={() => setAdding(false)}
        entity={entity}
      />
    </div>
  );
}

function AddFieldDrawer({
  open,
  onClose,
  entity,
}: {
  open: boolean;
  onClose: () => void;
  entity: Entity;
}) {
  const create = useCreateCustomField();

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [optionsRaw, setOptionsRaw] = useState("");
  const [required, setRequired] = useState(false);
  const [searchable, setSearchable] = useState(false);
  const [filterable, setFilterable] = useState(false);
  const [order, setOrder] = useState("0");
  const [roles, setRoles] = useState<Role[]>([]);

  const hasOptions = type === "select" || type === "multiselect";

  const reset = () => {
    setLabel("");
    setKey("");
    setType("text");
    setOptionsRaw("");
    setRequired(false);
    setSearchable(false);
    setFilterable(false);
    setOrder("0");
    setRoles([]);
  };

  const submit = () => {
    const options = hasOptions
      ? optionsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((value) => ({ label: value, value }))
      : [];
    create.mutate(
      {
        entity_type: entity,
        field_label: label,
        field_key: key.toLowerCase(),
        field_type: type,
        options,
        is_required: required,
        is_searchable: searchable,
        is_filterable: filterable,
        display_order: Number(order) || 0,
        visible_to_roles: roles,
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  const canSubmit = label.trim() && key.trim();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add field"
      subtitle={ENTITY_LABEL[entity]}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || create.isPending}
            icon={
              create.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : undefined
            }
          >
            Create field
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Field label">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Preferred contact time"
          />
        </Field>

        <Field label="Field key" hint="lowercase">
          <TextInput
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="preferred_contact_time"
            className="font-mono"
          />
        </Field>

        <Field label="Field type">
          <Select<FieldType>
            value={type}
            onChange={setType}
            options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>

        {hasOptions && (
          <Field label="Options" hint="comma-separated">
            <TextInput
              value={optionsRaw}
              onChange={(e) => setOptionsRaw(e.target.value)}
              placeholder="Small, Medium, Large"
            />
          </Field>
        )}

        <div className="flex flex-col gap-3 pt-1">
          <Toggle checked={required} onChange={setRequired} label="Required" />
          <Toggle
            checked={searchable}
            onChange={setSearchable}
            label="Searchable"
          />
          <Toggle
            checked={filterable}
            onChange={setFilterable}
            label="Filterable"
          />
        </div>

        <Field label="Display order">
          <NumberField value={order} onChange={setOrder} allowDecimal={false} />
        </Field>

        <Field label="Visible to roles">
          <MultiSelect<Role>
            values={roles}
            onChange={setRoles}
            options={ROLES.map((r) => ({ value: r, label: r }))}
          />
        </Field>

        {create.isError && (
          <p className="text-[12px] text-danger">
            Couldn&rsquo;t create the field. Please try again.
          </p>
        )}
      </div>
    </Drawer>
  );
}
