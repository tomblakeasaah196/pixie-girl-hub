import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, KeyRound, DatabaseBackup, Mail } from "lucide-react";
import { getSettings, updateSettings } from "@/lib/api";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["kaizen", "settings"], queryFn: getSettings });

  const [daily, setDaily] = useState(7);
  const [weekly, setWeekly] = useState(4);
  const [monthly, setMonthly] = useState(6);
  const [recipients, setRecipients] = useState("");

  useEffect(() => {
    if (settings.data) {
      setDaily(settings.data.retention.daily);
      setWeekly(settings.data.retention.weekly);
      setMonthly(settings.data.retention.monthly);
      setRecipients((settings.data.alert_recipients ?? []).join(", "));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      updateSettings({
        retention: { daily, weekly, monthly },
        alert_recipients: recipients.trim()
          ? recipients.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kaizen", "settings"] }),
  });

  if (settings.isLoading) {
    return (
      <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-fog-400" /></div>
    );
  }
  if (settings.isError) {
    return (
      <EmptyState title="Couldn't load settings" hint={settings.error instanceof Error ? settings.error.message : undefined}
        action={<button className="btn-ghost" onClick={() => settings.refetch()}>Retry</button>} />
    );
  }

  const s = settings.data!;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-fog-100">Settings</h1>
        <p className="mt-1 text-sm text-fog-300">Retention, alert recipients, and integration status.</p>
      </div>

      <Card title="Backup retention" action={<DatabaseBackup className="h-4 w-4 text-fog-400" />}>
        <div className="grid grid-cols-3 gap-4">
          {([["Daily", daily, setDaily], ["Weekly", weekly, setWeekly], ["Monthly", monthly, setMonthly]] as const).map(
            ([label, val, set]) => (
              <div key={label}>
                <label className="label">{label}</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={val}
                  onChange={(e) => set(Number(e.target.value))}
                />
              </div>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-fog-400">
          Applied to logical pruning and the restic wrapper (keep-daily/weekly/monthly).
        </p>
      </Card>

      <Card title="Alert recipients" action={<Mail className="h-4 w-4 text-fog-400" />}>
        <label className="label">Emails (comma-separated)</label>
        <input
          className="input"
          placeholder="leave blank to use all active operators"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
        <p className="mt-2 text-xs text-fog-400">
          Blank = every active operator receives alerts.
        </p>
      </Card>

      <Card title="Integrations" action={<KeyRound className="h-4 w-4 text-fog-400" />}>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-fog-300">Frontend error ingest key</span>
            <StatusPill tone={s.ingest_key_configured ? "green" : "amber"}>
              {s.ingest_key_configured ? "configured" : "not set"}
            </StatusPill>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fog-300">Default backup destination</span>
            <span className="font-mono text-xs text-fog-200">
              {s.default_destination ? `${s.default_destination.name} (${s.default_destination.kind})` : "none"}
            </span>
          </div>
          {s.ingest_allowed_origins && (
            <div className="text-xs text-fog-400">Allowed origins: {s.ingest_allowed_origins}</div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          Save settings
        </button>
      </div>
      {save.isError && (
        <p className="text-right text-sm text-signal-red">
          {save.error instanceof Error ? save.error.message : "Save failed"}
        </p>
      )}
    </div>
  );
}
