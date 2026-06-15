import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { GitBranch, Loader2, Plus, Trash2 } from "lucide-react";
import {
  usePipelineStages,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  type PipelineStage,
} from "@/lib/settings";
import { useActiveBusiness } from "@/stores/business";
import { Drawer } from "@/components/ui/Drawer";
import {
  NumberField,
  Toggle,
  ConfirmDialog,
  ErrorState,
} from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { Button, Card, Pill, EmptyState, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Settings → Pipeline stages. Per-pipeline ordered stages with a kanban
 * preview and inline editing.
 */

const PIPELINES = ["crm", "delivery", "purchase_order", "production"] as const;
type Pipeline = (typeof PIPELINES)[number];

const PIPELINE_LABEL: Record<Pipeline, string> = {
  crm: "CRM",
  delivery: "Delivery",
  purchase_order: "Purchase Order",
  production: "Production",
};

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-text-primary/[0.04] border border-line rounded-[10px] px-2 h-[42px]">
      <input
        type="color"
        value={value || "#690909"}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 rounded-[6px] bg-transparent border-0 cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-[12.5px] font-mono outline-none min-w-0"
      />
    </div>
  );
}

export function PipelineStagesPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Pipeline Stages" }]);
  const active = useActiveBusiness();
  const [pipeline, setPipeline] = useState<Pipeline>("crm");
  const q = usePipelineStages(pipeline);
  const update = useUpdatePipelineStage();
  const del = useDeletePipelineStage();

  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PipelineStage | null>(null);

  const stages = [...(q.data ?? [])].sort(
    (a, b) => a.display_order - b.display_order,
  );

  return (
    <div className="max-w-[1000px] space-y-4 pb-12">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Pipeline stages</h1>
        <Pill tone="accent" dot={false}>
          Editing for: {active.name}
        </Pill>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PIPELINES.map((p) => (
          <button
            key={p}
            onClick={() => setPipeline(p)}
            className={cn(
              "px-3 py-1.5 text-[12px] font-semibold rounded-[10px] border transition-colors",
              pipeline === p
                ? "border-accent/45 text-accent-glow bg-accent/[0.08]"
                : "border-line text-text-muted hover:text-text-primary",
            )}
          >
            {PIPELINE_LABEL[p]}
          </button>
        ))}
      </div>

      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => q.refetch()} />
        </Card>
      ) : q.isLoading ? (
        <Card className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} style={{ height: 42 }} />
          ))}
        </Card>
      ) : stages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitBranch className="w-7 h-7" />}
            title="No stages yet"
            message={`Add stages to the ${PIPELINE_LABEL[pipeline]} pipeline.`}
            action={
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setAdding(true)}
              >
                Add stage
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* Kanban preview */}
          <Card className="p-4">
            <div className="micro mb-3">Kanban preview</div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {stages.map((s) => (
                <div
                  key={s.stage_id}
                  className="shrink-0 rounded-[11px] border px-3 py-2 text-[12px] font-semibold"
                  style={{
                    borderColor: s.colour || "rgb(var(--line))",
                    background: `${s.colour || "#690909"}1f`,
                    color: s.colour || "inherit",
                  }}
                >
                  <span className="text-text-primary">{s.stage_label}</span>
                  {s.is_terminal && (
                    <span className="ml-1.5 text-[9.5px] uppercase tracking-wide font-bold opacity-80">
                      {s.is_positive_terminal ? "Won" : "End"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Editable list */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="micro">Stages</div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setAdding(true)}
              >
                Add stage
              </Button>
            </div>
            <div className="space-y-2.5">
              {stages.map((s) => (
                <StageRow
                  key={s.stage_id}
                  stage={s}
                  onPatch={(patch) =>
                    update.mutate({ id: s.stage_id, patch })
                  }
                  onDelete={() => setConfirmDel(s)}
                />
              ))}
            </div>
          </Card>
        </>
      )}

      <AddStageDrawer
        open={adding}
        onClose={() => setAdding(false)}
        pipeline={pipeline}
        nextOrder={stages.length}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() =>
          confirmDel &&
          del.mutate(confirmDel.stage_id, {
            onSuccess: () => setConfirmDel(null),
          })
        }
        title="Delete stage"
        message={
          <>
            Delete the stage{" "}
            <strong>{confirmDel?.stage_label}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}

function StageRow({
  stage,
  onPatch,
  onDelete,
}: {
  stage: PipelineStage;
  onPatch: (patch: Partial<PipelineStage>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(stage.stage_label);
  const [colour, setColour] = useState(stage.colour);
  const [order, setOrder] = useState(String(stage.display_order));

  const commitLabel = () => {
    if (label !== stage.stage_label) onPatch({ stage_label: label });
  };
  const commitColour = (v: string) => {
    setColour(v);
    onPatch({ colour: v });
  };
  const commitOrder = (v: string) => {
    setOrder(v);
    const n = Number(v);
    if (!Number.isNaN(n) && n !== stage.display_order)
      onPatch({ display_order: n });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-[12px] border border-line bg-text-primary/[0.02]">
      <span className="font-mono text-[11px] text-text-faint shrink-0">
        {stage.stage_key}
      </span>
      <div className="flex-1 min-w-[160px]">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
        />
      </div>
      <div className="w-[150px]">
        <ColorInput value={colour} onChange={commitColour} />
      </div>
      <div className="w-[88px]">
        <NumberField value={order} onChange={commitOrder} allowDecimal={false} />
      </div>
      <Toggle
        checked={stage.is_terminal}
        onChange={(v) => onPatch({ is_terminal: v })}
        label="Terminal"
      />
      <Toggle
        checked={!!stage.is_positive_terminal}
        onChange={(v) => onPatch({ is_positive_terminal: v })}
        label="Positive"
        disabled={!stage.is_terminal}
      />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete stage"
        className="ml-auto grid place-items-center w-9 h-9 rounded-[10px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function AddStageDrawer({
  open,
  onClose,
  pipeline,
  nextOrder,
}: {
  open: boolean;
  onClose: () => void;
  pipeline: Pipeline;
  nextOrder: number;
}) {
  const create = useCreatePipelineStage();

  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [order, setOrder] = useState(String(nextOrder));
  const [colour, setColour] = useState("#690909");
  const [terminal, setTerminal] = useState(false);
  const [positive, setPositive] = useState(false);

  const reset = () => {
    setKey("");
    setLabel("");
    setOrder(String(nextOrder));
    setColour("#690909");
    setTerminal(false);
    setPositive(false);
  };

  const submit = () => {
    create.mutate(
      {
        pipeline_type: pipeline,
        stage_key: key.toLowerCase(),
        stage_label: label,
        display_order: Number(order) || 0,
        colour,
        is_terminal: terminal,
        is_positive_terminal: terminal ? positive : null,
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  const canSubmit = key.trim() && label.trim();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add stage"
      subtitle={PIPELINE_LABEL[pipeline]}
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
            Create stage
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Stage key" hint="lowercase">
          <TextInput
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="qualified"
            className="font-mono"
          />
        </Field>
        <Field label="Stage label">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Qualified"
          />
        </Field>
        <Field label="Display order">
          <NumberField value={order} onChange={setOrder} allowDecimal={false} />
        </Field>
        <Field label="Colour">
          <ColorInput value={colour} onChange={setColour} />
        </Field>
        <div className="flex flex-col gap-3 pt-1">
          <Toggle checked={terminal} onChange={setTerminal} label="Terminal stage" />
          <Toggle
            checked={positive}
            onChange={setPositive}
            label="Positive terminal (won)"
            disabled={!terminal}
          />
        </div>

        {create.isError && (
          <p className="text-[12px] text-danger">
            Couldn&rsquo;t create the stage. Please try again.
          </p>
        )}
      </div>
    </Drawer>
  );
}
