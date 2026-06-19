import { useEffect, useState } from "react";
import { Plus, Trash2, Settings as SettingsIcon } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Field, TextInput } from "@/components/ui/Form";
import { NumberField, ErrorState } from "@/components/ui/controls";
import { usePricingConfig, useUpdateConfig } from "./hooks";
import type { ConfigChannelFee } from "./types";

type FeeRow = { channel: string; label: string; pct: string; fixed: string };

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = usePricingConfig();
  const save = useUpdateConfig();

  const [threshold, setThreshold] = useState("");
  const [defaultMargin, setDefaultMargin] = useState("");
  const [roundTo, setRoundTo] = useState("");
  const [fees, setFees] = useState<FeeRow[]>([]);

  useEffect(() => {
    if (!data) return;
    setThreshold(String(data.instant_apply_threshold_pct ?? ""));
    setDefaultMargin(String(data.default_target_margin_pct ?? ""));
    setRoundTo(String(data.round_to_ngn ?? ""));
    setFees(
      (data.channel_fees ?? []).map((f) => ({
        channel: f.channel,
        label: f.label,
        pct: String(Math.round((f.pct ?? 0) * 1000) / 10), // fraction → %
        fixed: String(f.fixed_ngn ?? 0),
      })),
    );
  }, [data]);

  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return <div className="h-64 animate-pulse rounded-[14px] bg-text-primary/[0.04]" />;
  }

  const setFee = (i: number, key: keyof FeeRow, val: string) =>
    setFees((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const submit = () => {
    const channel_fees: ConfigChannelFee[] = fees
      .filter((f) => f.channel.trim())
      .map((f) => ({
        channel: f.channel.trim(),
        label: f.label.trim() || f.channel.trim(),
        pct: f.pct.trim() === "" ? 0 : Number(f.pct) / 100,
        fixed_ngn: f.fixed.trim() === "" ? 0 : Number(f.fixed),
      }));
    save.mutate({
      instant_apply_threshold_pct: threshold.trim() === "" ? undefined : Number(threshold),
      default_target_margin_pct: defaultMargin.trim() === "" ? undefined : Number(defaultMargin),
      round_to_ngn: roundTo.trim() === "" ? undefined : Number(roundTo),
      channel_fees,
    });
  };

  return (
    <div className="space-y-4 max-w-[820px]">
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="w-4 h-4 text-accent-glow" />
          <h3 className="font-display text-[15px]">Advisor settings</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Instant-apply threshold" hint="changes within this % apply instantly">
            <NumberField value={threshold} onChange={setThreshold} suffix="%" disabled={!canEdit} />
          </Field>
          <Field label="Default target margin" hint="advisor's starting margin">
            <NumberField value={defaultMargin} onChange={setDefaultMargin} suffix="%" disabled={!canEdit} />
          </Field>
          <Field label="Round suggestions to" hint="nearest ₦; 0 = off">
            <NumberField value={roundTo} onChange={setRoundTo} suffix="₦" disabled={!canEdit} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-display text-[15px]">Channel fees</h3>
          <span className="text-[11.5px] text-text-faint">
            used to gross up so the target margin survives the channel's cut
          </span>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-text-faint text-left border-b hairline">
                <th className="py-2 font-semibold">Channel key</th>
                <th className="py-2 font-semibold">Label</th>
                <th className="py-2 font-semibold w-[120px]">Fee %</th>
                <th className="py-2 font-semibold w-[140px]">Fixed (₦)</th>
                <th className="py-2 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {fees.map((f, i) => (
                <tr key={i} className="border-b hairline last:border-0 align-top">
                  <td className="py-2 pr-2">
                    <TextInput value={f.channel} onChange={(e) => setFee(i, "channel", e.target.value)} placeholder="jumia" />
                  </td>
                  <td className="py-2 pr-2">
                    <TextInput value={f.label} onChange={(e) => setFee(i, "label", e.target.value)} placeholder="Jumia" />
                  </td>
                  <td className="py-2 pr-2">
                    <NumberField value={f.pct} onChange={(v) => setFee(i, "pct", v)} suffix="%" disabled={!canEdit} />
                  </td>
                  <td className="py-2 pr-2">
                    <NumberField value={f.fixed} onChange={(v) => setFee(i, "fixed", v)} suffix="₦" disabled={!canEdit} />
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <button
                        onClick={() => setFees((rows) => rows.filter((_, idx) => idx !== i))}
                        className="text-text-faint hover:text-danger p-1 rounded-[8px] hover:bg-danger/10"
                        aria-label="Remove channel"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="w-3.5 h-3.5" />}
            className="mt-3"
            onClick={() => setFees((rows) => [...rows, { channel: "", label: "", pct: "", fixed: "" }])}
          >
            Add channel
          </Button>
        )}
      </Card>

      {save.isError && (
        <p className="text-[12px] text-danger">
          {save.error instanceof Error ? save.error.message : "Could not save."}
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
