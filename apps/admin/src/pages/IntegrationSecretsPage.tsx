import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import {
  useIntegrationSecrets,
  useSetSecret,
  useDeleteSecret,
  type IntegrationSecret,
} from "@/lib/settings";

/**
 * Settings → Integration secrets. WRITE-ONLY: the secret value is never
 * displayed — only the provider, key name, last4, and status. Adding a key
 * with an existing provider/key_name rotates it.
 */

export function IntegrationSecretsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Integration Secrets" }]);
  const query = useIntegrationSecrets();
  const setSecret = useSetSecret();
  const del = useDeleteSecret();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [keyName, setKeyName] = useState("");
  const [secret, setSecretValue] = useState("");

  const [toDelete, setToDelete] = useState<IntegrationSecret | null>(null);

  const rows = query.data ?? [];

  const resetForm = () => {
    setProvider("");
    setKeyName("");
    setSecretValue("");
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    resetForm();
  };
  const canSave = provider.trim() && keyName.trim() && secret.trim();
  const submit = () => {
    if (!canSave) return;
    setSecret.mutate(
      { provider: provider.trim(), key_name: keyName.trim(), secret },
      { onSuccess: closeDrawer },
    );
  };

  const columns: Column<IntegrationSecret>[] = [
    { key: "provider", header: "Provider", render: (r) => <span className="font-semibold">{r.provider}</span> },
    { key: "key_name", header: "Key name", render: (r) => <span className="font-mono text-[12.5px]">{r.key_name}</span> },
    {
      key: "value",
      header: "Value",
      render: (r) => (
        <span className="font-mono text-text-muted">•••• {r.last4 ?? "????"}</span>
      ),
    },
    {
      key: "updated_at",
      header: "Updated",
      render: (r) => (
        <span className="text-text-muted">
          {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (r) =>
        r.is_active ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Inactive</Pill>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <button
          onClick={() => setToDelete(r)}
          className="inline-flex items-center justify-center w-8 h-8 rounded-[9px] text-text-muted hover:text-danger hover:bg-danger/10"
          aria-label="Delete key"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ),
    },
  ];

  if (query.isError) {
    return (
      <div className="max-w-[960px]">
        <Card className="overflow-hidden">
          <ErrorState
            message="We couldn't load integration secrets."
            onRetry={() => query.refetch()}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[960px]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-xl font-medium">Integration secrets</h2>
          <p className="text-[13px] text-text-muted mt-0.5">
            API keys and tokens for third-party providers.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          Add / rotate key
        </Button>
      </div>

      <Card className="p-3.5 mb-4 flex items-start gap-2.5 border-l-[3px] border-l-accent">
        <ShieldCheck className="w-4 h-4 text-accent-glow shrink-0 mt-0.5" />
        <p className="text-[12.5px] text-text-muted leading-relaxed">
          Keys are encrypted at rest (AES-256-GCM) and never displayed again —
          only replaced. This is safer than storing them in <code className="font-mono">.env</code>.
        </p>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.secret_id}
        loading={query.isLoading}
        empty={{
          icon: <KeyRound className="w-7 h-7" />,
          title: "No keys stored",
          message: "Add your first provider key. The value is encrypted and shown only as the last 4 characters.",
          action: (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
              Add / rotate key
            </Button>
          ),
        }}
      />

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title="Add / rotate key"
        subtitle="Write-only — the value is never shown again"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>Cancel</Button>
            <Button variant="primary" disabled={!canSave || setSecret.isPending} onClick={submit}>
              {setSecret.isPending ? "Saving…" : "Save key"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Provider" hint="e.g. paystack, sendgrid">
            <TextInput value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="paystack" />
          </Field>
          <Field label="Key name" hint="identifier for this key">
            <TextInput value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="secret_key" />
          </Field>
          <Field label="Secret" hint="entered once; encrypted at rest">
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 font-mono"
            />
          </Field>
          {setSecret.isError && (
            <p className="text-[12px] text-danger">
              {setSecret.error instanceof Error ? setSecret.error.message : "Failed to save key"}
            </p>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.secret_id, { onSuccess: () => setToDelete(null) })
        }
        title="Delete key"
        message={
          <>
            Delete the <strong>{toDelete?.provider}</strong> /{" "}
            <strong>{toDelete?.key_name}</strong> key? Integrations relying on it
            will stop working until a new key is added.
          </>
        }
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}
