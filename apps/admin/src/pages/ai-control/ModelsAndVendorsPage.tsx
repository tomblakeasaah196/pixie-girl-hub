import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Plus,
  Loader2,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Sparkles,
  AlertCircle,
  Star,
  StarOff,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/controls";
import {
  aiGovernanceApi,
  type AiModel,
  type AiVendor,
  type AiVendorRow,
} from "@/lib/ai-governance-api";

/**
 * Vendors + Model Catalogue editor.
 *
 * Vendors table at the top: each row has the current_model dropdown
 * (reading from the catalogue) so the CEO can switch
 * `gemini-2.5-flash` → `gemini-2.5-flash-lite` with one click. The
 * spend meter recomputes from the new model's NGN rates on the next
 * call.
 *
 * Catalogue table at the bottom: lists every model with its
 * input/output cost per 1M tokens. Inline editing — bump the rates
 * when Google/OpenAI/DeepSeek raise their prices.
 */
export function ModelsAndVendorsPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Vendors & Models" },
  ]);
  const qc = useQueryClient();

  const vendorsQ = useQuery({
    queryKey: ["ai", "vendors"],
    queryFn: () => aiGovernanceApi.listVendors(),
  });
  const modelsQ = useQuery({
    queryKey: ["ai", "models"],
    queryFn: () => aiGovernanceApi.listModels(),
  });

  const modelsByVendor = useMemo(() => {
    const m = new Map<AiVendor, AiModel[]>();
    for (const model of modelsQ.data ?? []) {
      const arr = m.get(model.vendor) ?? [];
      arr.push(model);
      m.set(model.vendor, arr);
    }
    return m;
  }, [modelsQ.data]);

  const [editingModel, setEditingModel] = useState<AiModel | null>(null);

  const setCurrentModel = useMutation({
    mutationFn: ({
      vendor,
      current_model,
    }: {
      vendor: AiVendorRow;
      current_model: string | null;
    }) =>
      aiGovernanceApi.upsertVendor({
        vendor: vendor.vendor,
        display_name: vendor.display_name,
        current_model,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "vendors"] });
    },
  });

  return (
    <div className="max-w-[1080px] mx-auto space-y-7">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <KeyRound className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">
            Vendors & Models
          </h2>
          <p className="text-text-muted text-[13px]">
            Switch models without a code deploy. The spend meter reads costs
            from the catalogue, so flipping{" "}
            <code className="font-mono text-[11px] bg-panel-2 px-1 rounded">
              gemini-2.5-flash
            </code>{" "}
            →{" "}
            <code className="font-mono text-[11px] bg-panel-2 px-1 rounded">
              gemini-2.5-flash-lite
            </code>{" "}
            recomputes the bill immediately.
          </p>
        </div>
      </header>

      {/* Vendors */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[16px]">Configured vendors</h3>
          <p className="text-[11px] text-text-faint">
            Primary: <code className="font-mono">deepseek</code> · Fallback:{" "}
            <code className="font-mono">gemini</code>
          </p>
        </div>
        <Card className="p-0 overflow-hidden">
          {vendorsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (vendorsQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No vendors configured yet. Add one below.
            </p>
          ) : (
            (vendorsQ.data ?? []).map((row, i, arr) => {
              const models = modelsByVendor.get(row.vendor) ?? [];
              const chatModels = models.filter(
                (m) => m.capability === "chat" && m.is_active,
              );
              return (
                <div
                  key={row.credential_id}
                  className={`p-4 ${i !== arr.length - 1 ? "border-b hairline" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] font-mono uppercase tracking-widest text-accent-glow shrink-0 mt-1">
                      {row.vendor}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13.5px] truncate">
                        {row.display_name}
                      </div>
                      <div className="text-[11.5px] text-text-faint mt-0.5 flex items-center gap-2">
                        <span>
                          {row.has_api_key ? (
                            <span className="inline-flex items-center gap-1 text-green-300">
                              <Check className="w-3 h-3" />
                              Key on file
                            </span>
                          ) : (
                            <span className="text-amber-300">No API key</span>
                          )}
                        </span>
                        {row.last_rotated_at && (
                          <span>
                            · rotated{" "}
                            {new Date(row.last_rotated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-[260px] shrink-0">
                      <span className="block text-[10.5px] uppercase tracking-widest text-text-faint mb-1">
                        Current model
                      </span>
                      <Select
                        value={row.current_model ?? ""}
                        onChange={(v) =>
                          setCurrentModel.mutate({
                            vendor: row,
                            current_model: v || null,
                          })
                        }
                        disabled={setCurrentModel.isPending}
                        options={[
                          {
                            value: "",
                            label:
                              (chatModels.find((m) => m.is_default)
                                ?.display_name ?? "Default") + " (auto)",
                          },
                          ...chatModels.map((m) => ({
                            value: m.model_id,
                            label: `${m.display_name} · ₦${Number(m.input_cost_per_1m_ngn).toLocaleString()}/M in · ₦${Number(m.output_cost_per_1m_ngn).toLocaleString()}/M out`,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      </section>

      {/* Model catalogue */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[16px]">Model catalogue</h3>
          <button
            onClick={() =>
              setEditingModel({
                model_id: "",
                vendor: "deepseek",
                display_name: "",
                capability: "chat",
                supports_tools: false,
                supports_streaming: true,
                input_cost_per_1m_ngn: 0,
                output_cost_per_1m_ngn: 0,
                cost_per_audio_minute_ngn: 0,
                is_default: false,
                is_active: true,
                updated_at: new Date().toISOString(),
              } as AiModel)
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40"
          >
            <Plus className="w-3.5 h-3.5" />
            New model
          </button>
        </div>
        <Card className="p-0 overflow-hidden">
          {modelsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (
            <ModelsTable models={modelsQ.data ?? []} onEdit={setEditingModel} />
          )}
        </Card>
        <p className="mt-2 text-[11px] text-text-faint">
          Pricing is NGN per 1M tokens. Bump these rows when vendors publish new
          rates.
        </p>
      </section>

      {editingModel && (
        <ModelEditor
          draft={editingModel}
          onClose={() => setEditingModel(null)}
          onSaved={() => {
            setEditingModel(null);
            qc.invalidateQueries({ queryKey: ["ai", "models"] });
          }}
        />
      )}
    </div>
  );
}

// ── Models table ──────────────────────────────────────────

function ModelsTable({
  models,
  onEdit,
}: {
  models: AiModel[];
  onEdit: (m: AiModel) => void;
}) {
  if (models.length === 0) {
    return (
      <p className="p-5 text-center text-[12.5px] text-text-faint italic">
        No models in the catalogue yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[12.5px]">
        <thead className="bg-panel-2 text-text-faint uppercase tracking-widest text-[10px]">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Model</th>
            <th className="text-left px-3 py-2 font-semibold">Vendor</th>
            <th className="text-left px-3 py-2 font-semibold">Capability</th>
            <th className="text-right px-3 py-2 font-semibold">₦/1M in</th>
            <th className="text-right px-3 py-2 font-semibold">₦/1M out</th>
            <th className="text-center px-3 py-2 font-semibold">Default</th>
            <th className="text-center px-3 py-2 font-semibold">Active</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr
              key={m.model_id}
              className="border-t hairline hover:bg-panel-2/40"
            >
              <td className="px-3 py-2">
                <div className="font-medium text-text-primary">
                  {m.display_name}
                </div>
                <code className="text-[10.5px] text-text-faint font-mono">
                  {m.model_id}
                </code>
              </td>
              <td className="px-3 py-2 font-mono text-accent-glow">
                {m.vendor}
              </td>
              <td className="px-3 py-2 text-text-muted">{m.capability}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {Number(m.input_cost_per_1m_ngn).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {Number(m.output_cost_per_1m_ngn).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-center">
                {m.is_default ? (
                  <Star className="w-3.5 h-3.5 text-amber-300 inline" />
                ) : (
                  <StarOff className="w-3.5 h-3.5 text-text-faint inline" />
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {m.is_active ? (
                  <Eye className="w-3.5 h-3.5 text-green-300 inline" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-text-faint inline" />
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onEdit(m)}
                  className="text-text-muted hover:text-accent-glow"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Model editor modal ────────────────────────────────────

function ModelEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: AiModel;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [m, setM] = useState<AiModel>(draft);
  const save = useMutation({
    mutationFn: () =>
      aiGovernanceApi.upsertModel({
        model_id: m.model_id,
        vendor: m.vendor,
        display_name: m.display_name,
        family: m.family,
        capability: m.capability,
        context_window: m.context_window,
        supports_tools: m.supports_tools,
        supports_streaming: m.supports_streaming,
        input_cost_per_1m_ngn: Number(m.input_cost_per_1m_ngn),
        output_cost_per_1m_ngn: Number(m.output_cost_per_1m_ngn),
        cost_per_audio_minute_ngn: Number(m.cost_per_audio_minute_ngn),
        is_default: m.is_default,
        is_active: m.is_active,
        notes: m.notes,
      }),
    onSuccess: onSaved,
  });
  const isNew = !draft.model_id;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-glow" />
          {isNew ? "Add" : "Edit"} model
        </span>
      }
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!m.model_id || !m.display_name || save.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldText
          label="Model ID"
          value={m.model_id}
          disabled={!isNew}
          onChange={(v) => setM({ ...m, model_id: v })}
        />
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Vendor
          </span>
          <Select
            value={m.vendor}
            onChange={(v) => setM({ ...m, vendor: v as AiVendor })}
            options={[
              { value: "deepseek", label: "DeepSeek" },
              { value: "gemini", label: "Gemini" },
              { value: "openai", label: "OpenAI" },
              { value: "groq", label: "Groq" },
              { value: "self_hosted", label: "Self-hosted" },
              { value: "other", label: "Other" },
            ]}
          />
        </label>
        <FieldText
          label="Display name"
          value={m.display_name}
          onChange={(v) => setM({ ...m, display_name: v })}
        />
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Capability
          </span>
          <Select
            value={m.capability}
            onChange={(v) =>
              setM({ ...m, capability: v as AiModel["capability"] })
            }
            options={[
              { value: "chat", label: "Chat" },
              { value: "embedding", label: "Embedding" },
              { value: "audio", label: "Audio (Whisper-style)" },
              { value: "vision", label: "Vision" },
            ]}
          />
        </label>
        <FieldNumber
          label="₦ per 1M input tokens"
          value={Number(m.input_cost_per_1m_ngn)}
          onChange={(v) => setM({ ...m, input_cost_per_1m_ngn: v })}
        />
        <FieldNumber
          label="₦ per 1M output tokens"
          value={Number(m.output_cost_per_1m_ngn)}
          onChange={(v) => setM({ ...m, output_cost_per_1m_ngn: v })}
        />
        <FieldNumber
          label="₦ per audio minute (Whisper)"
          value={Number(m.cost_per_audio_minute_ngn)}
          onChange={(v) => setM({ ...m, cost_per_audio_minute_ngn: v })}
        />
        <FieldNumber
          label="Context window (tokens)"
          value={m.context_window ?? 0}
          onChange={(v) => setM({ ...m, context_window: v })}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={m.is_default}
            onChange={(e) => setM({ ...m, is_default: e.target.checked })}
            className="accent-accent"
          />
          Default for this (vendor, capability)
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={m.is_active}
            onChange={(e) => setM({ ...m, is_active: e.target.checked })}
            className="accent-accent"
          />
          Active (selectable)
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={m.supports_tools}
            onChange={(e) => setM({ ...m, supports_tools: e.target.checked })}
            className="accent-accent"
          />
          Supports tools / function calling
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={m.supports_streaming}
            onChange={(e) =>
              setM({ ...m, supports_streaming: e.target.checked })
            }
            className="accent-accent"
          />
          Supports streaming
        </label>
        <div className="col-span-1 sm:col-span-2">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Notes
          </span>
          <textarea
            value={m.notes ?? ""}
            onChange={(e) => setM({ ...m, notes: e.target.value })}
            rows={2}
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12.5px] focus:outline-none focus:border-accent/40"
          />
        </div>
      </div>
      {save.isError && (
        <div className="px-0 pt-2 text-[12px] text-danger inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          Couldn&rsquo;t save.
        </div>
      )}
    </Modal>
  );
}

function FieldText({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 disabled:opacity-60"
      />
    </label>
  );
}
function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      <input
        type="number"
        step="0.0001"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 tabular-nums"
      />
    </label>
  );
}
