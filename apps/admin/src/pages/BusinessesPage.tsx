import { useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import {
  useBusinesses,
  useProvisionBusiness,
  type BusinessRow,
} from "@/lib/settings";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { Button, Card, Pill } from "@/components/ui/primitives";

/**
 * Settings → Businesses. Lists every business (NOT per-brand) and lets an
 * admin provision a new one.
 */

const KEY_RE = /^[a-z][a-z0-9_]+$/;

export function BusinessesPage() {
  const q = useBusinesses();
  const [adding, setAdding] = useState(false);

  const columns: Column<BusinessRow>[] = [
    {
      key: "display_name",
      header: "Business",
      render: (r) => <span className="font-semibold">{r.display_name}</span>,
    },
    {
      key: "business_key",
      header: "Key",
      render: (r) => <span className="font-mono text-text-muted">{r.business_key}</span>,
    },
    {
      key: "legal_name",
      header: "Legal name",
      render: (r) => <span className="text-text-muted">{r.legal_name}</span>,
    },
    {
      key: "document_prefix",
      header: "Doc prefix",
      render: (r) => <span className="font-mono">{r.document_prefix}</span>,
    },
    {
      key: "active",
      header: "Status",
      align: "right",
      render: (r) => (
        <Pill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </Pill>
      ),
    },
  ];

  return (
    <div className="max-w-[1000px] space-y-4 pb-12">
      <h1 className="font-display text-2xl font-medium">Businesses</h1>

      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <DataTable<BusinessRow>
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.config_id}
          loading={q.isLoading}
          toolbar={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              className="ml-auto"
              onClick={() => setAdding(true)}
            >
              Add a business
            </Button>
          }
          empty={{
            icon: <Building2 className="w-7 h-7" />,
            title: "No businesses",
            message: "Provision your first business to get started.",
            action: (
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setAdding(true)}
              >
                Add a business
              </Button>
            ),
          }}
        />
      )}

      <AddBusinessDrawer open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddBusinessDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const provision = useProvisionBusiness();

  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [prefix, setPrefix] = useState("");

  const keyValid = KEY_RE.test(key);
  const canSubmit =
    keyValid && displayName.trim() && legalName.trim() && prefix.trim();

  const reset = () => {
    setKey("");
    setDisplayName("");
    setLegalName("");
    setPrefix("");
  };

  const submit = () => {
    provision.mutate(
      {
        business_key: key,
        display_name: displayName,
        legal_name: legalName,
        document_prefix: prefix.toUpperCase(),
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add a business"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || provision.isPending}
            icon={
              provision.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : undefined
            }
          >
            Provision business
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="glass rounded-[12px] border-l-[3px] border-l-accent p-3 text-[12px] text-text-muted leading-relaxed">
          Provisioning creates the business config — its settings, sequences,
          and defaults. You can fine-tune everything afterwards.
        </div>

        <Field label="Business key" hint="lowercase, ^[a-z][a-z0-9_]+$">
          <TextInput
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="pixiegirl"
            className="font-mono"
          />
          {key && !keyValid && (
            <p className="text-[11px] text-danger mt-1.5">
              Must start with a letter and use only lowercase letters, digits,
              and underscores.
            </p>
          )}
        </Field>

        <Field label="Display name">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Pixie Girl"
          />
        </Field>

        <Field label="Legal name">
          <TextInput
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Pixie Girl Ltd."
          />
        </Field>

        <Field label="Document prefix" hint="uppercase">
          <TextInput
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            placeholder="PXG"
            className="font-mono"
          />
        </Field>

        {provision.isError && (
          <p className="text-[12px] text-danger">
            Couldn&rsquo;t provision the business. Please try again.
          </p>
        )}
      </div>
    </Drawer>
  );
}
