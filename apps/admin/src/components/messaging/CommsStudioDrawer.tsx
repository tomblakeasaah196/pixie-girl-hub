import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Plus,
  Send,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  ShieldOff,
} from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput, TextArea } from "@/components/ui/Form";
import { Select, Toggle } from "@/components/ui/controls";
import { NumberField } from "@/components/ui/controls";
import {
  commsStudioApi,
  type Automation,
  type Block,
  type BlockType,
  type CadenceConfig,
  type Channel,
  BLOCK_LIBRARY,
} from "@/lib/comms-studio-api";
import { cn } from "@/lib/cn";

type Tab = "email" | "whatsapp" | "cadence" | "activity";

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "in_app_only", label: "In-app only" },
  { value: "respect_contact_pref", label: "Contact preference" },
  { value: "disabled", label: "Off" },
];

const FALLBACK_OPTIONS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "in_app_only", label: "In-app only" },
  { value: "disabled", label: "None" },
];

interface DraftState {
  channel_preference: Channel;
  fallback_channel: Channel | null;
  block_whatsapp: boolean;
  is_active: boolean;
  subject_template: string;
  preheader_template: string;
  email_blocks_json: Block[];
  whatsapp_body_template: string;
  cadence_config: CadenceConfig;
}

function fromAutomation(row: Automation): DraftState {
  return {
    channel_preference: row.channel_preference,
    fallback_channel: row.fallback_channel,
    block_whatsapp: row.block_whatsapp,
    is_active: row.is_active,
    subject_template: row.subject_template ?? "",
    preheader_template: row.preheader_template ?? "",
    email_blocks_json: Array.isArray(row.email_blocks_json)
      ? row.email_blocks_json
      : [],
    whatsapp_body_template: row.whatsapp_body_template ?? "",
    cadence_config: row.cadence_config ?? {},
  };
}

export function CommsStudioDrawer({
  eventKey,
  onClose,
  elevated,
}: {
  eventKey: string;
  onClose: () => void;
  elevated?: boolean;
}) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["comms-studio", "one", eventKey],
    queryFn: () => commsStudioApi.get(eventKey),
  });

  const [tab, setTab] = useState<Tab>("email");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (q.data) setDraft(fromAutomation(q.data));
  }, [q.data]);

  const save = useMutation({
    mutationFn: commsStudioApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comms-studio"] });
      queryClient.invalidateQueries({
        queryKey: ["comms-studio", "one", eventKey],
      });
    },
  });

  const sendTest = useMutation({ mutationFn: commsStudioApi.sendTest });

  if (!draft || !q.data) {
    return (
      <Drawer
        open
        onClose={onClose}
        title={eventKey}
        subtitle="Loading…"
        wide
        elevated={elevated}
      >
        <div className="animate-pulse h-64 rounded-2xl bg-text-primary/[0.04]" />
      </Drawer>
    );
  }

  const row = q.data;
  const setD = (patch: Partial<DraftState>) => setDraft({ ...draft, ...patch });

  const previewChannel =
    tab === "whatsapp" ? "whatsapp" : tab === "cadence" || tab === "activity" ? "email" : "email";

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      elevated={elevated}
      title={row.display_name || row.event_key}
      subtitle={row.description || row.event_key}
      leading={
        <div className="w-10 h-10 rounded-xl bg-accent/[0.12] border border-accent/30 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-accent-glow" />
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ event_key: row.event_key, ...draft })
            }
          >
            {save.isPending ? "Saving…" : "Save automation"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,540px)] gap-6">
        <div>
          <TopSummary
            row={row}
            draft={draft}
            setD={setD}
          />
          <Tabs value={tab} onChange={setTab} />
          <div className="mt-4">
            {tab === "email" && (
              <EmailTab
                draft={draft}
                setD={setD}
                variables={row.variables_schema}
              />
            )}
            {tab === "whatsapp" && (
              <WhatsAppTab
                draft={draft}
                setD={setD}
                whatsappBlocked={draft.block_whatsapp}
                variables={row.variables_schema}
              />
            )}
            {tab === "cadence" && (
              <CadenceTab row={row} draft={draft} setD={setD} />
            )}
            {tab === "activity" && <ActivityTab eventKey={row.event_key} />}
          </div>
        </div>

        <PreviewPane
          eventKey={row.event_key}
          draft={draft}
          channel={previewChannel}
          testTo={testTo}
          setTestTo={setTestTo}
          onSendTest={(channel, to) =>
            sendTest.mutate({
              event_key: row.event_key,
              channel,
              to,
            })
          }
          testSending={sendTest.isPending}
          testResult={
            sendTest.isSuccess
              ? "sent"
              : sendTest.isError
                ? (sendTest.error as Error).message
                : null
          }
        />
      </div>
    </Drawer>
  );
}

function TopSummary({
  row,
  draft,
  setD,
}: {
  row: Automation;
  draft: DraftState;
  setD: (p: Partial<DraftState>) => void;
}) {
  return (
    <Card className="!p-4 mb-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Field label="Channel">
            <Select
              value={draft.channel_preference}
              onChange={(v) => setD({ channel_preference: v as Channel })}
              options={CHANNEL_OPTIONS.filter(
                (o) => !(draft.block_whatsapp && o.value === "whatsapp"),
              )}
            />
          </Field>
        </div>
        <div>
          <Field label="Fallback if primary fails">
            <Select
              value={draft.fallback_channel ?? "disabled"}
              onChange={(v) =>
                setD({
                  fallback_channel: v === "disabled" ? null : (v as Channel),
                })
              }
              options={FALLBACK_OPTIONS}
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-6 flex-wrap">
        <Toggle
          checked={draft.is_active}
          onChange={(v) => setD({ is_active: v })}
          label="Automation active"
        />
        <Toggle
          checked={draft.block_whatsapp}
          onChange={(v) =>
            setD({
              block_whatsapp: v,
              // If blocking WA, downgrade the channel so we don't save an
              // invalid combination.
              channel_preference:
                v && draft.channel_preference === "whatsapp"
                  ? "email"
                  : draft.channel_preference,
            })
          }
          label={
            <span className="inline-flex items-center gap-1.5">
              <ShieldOff className="w-3.5 h-3.5" />
              Hard-block WhatsApp
            </span>
          }
        />
        {row.trigger_type && (
          <Pill tone="neutral">Trigger: {row.trigger_type}</Pill>
        )}
      </div>
    </Card>
  );
}

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const items: { value: Tab; label: string }[] = [
    { value: "email", label: "Email" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "cadence", label: "Cadence" },
    { value: "activity", label: "Activity" },
  ];
  return (
    <div className="flex items-center gap-1 border-b hairline">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cn(
            "px-3 py-2 text-[12px] font-semibold tracking-wide uppercase transition-colors relative",
            value === it.value
              ? "text-text-primary"
              : "text-text-muted hover:text-text-primary",
          )}
        >
          {it.label}
          {value === it.value && (
            <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent-deep rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Email tab (block editor) ─────────────────────────────────

function EmailTab({
  draft,
  setD,
  variables,
}: {
  draft: DraftState;
  setD: (p: Partial<DraftState>) => void;
  variables: Automation["variables_schema"];
}) {
  const updateBlock = (idx: number, patch: Partial<Block>) => {
    const next = draft.email_blocks_json.slice();
    next[idx] = { ...next[idx], ...patch };
    setD({ email_blocks_json: next });
  };
  const moveBlock = (idx: number, dir: -1 | 1) => {
    const next = draft.email_blocks_json.slice();
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setD({ email_blocks_json: next });
  };
  const removeBlock = (idx: number) => {
    setD({
      email_blocks_json: draft.email_blocks_json.filter((_, i) => i !== idx),
    });
  };
  const addBlock = (block: Block) => {
    setD({ email_blocks_json: [...draft.email_blocks_json, block] });
  };
  const duplicateBlock = (idx: number) => {
    const next = draft.email_blocks_json.slice();
    next.splice(idx + 1, 0, { ...next[idx] });
    setD({ email_blocks_json: next });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3">
        <Field label="Subject line" hint="Shown in the customer's inbox.">
          <TextInput
            value={draft.subject_template}
            onChange={(e) => setD({ subject_template: e.target.value })}
            placeholder="Order {{order_number}} — thank you, {{first_name}}"
          />
        </Field>
        <Field
          label="Preheader"
          hint="The preview snippet next to the subject in most inboxes."
        >
          <TextInput
            value={draft.preheader_template}
            onChange={(e) => setD({ preheader_template: e.target.value })}
            placeholder="Your order at {{brand_name}} is confirmed."
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted">
            Body blocks
          </div>
          <VariablesPalette variables={variables} />
        </div>

        <div className="space-y-3">
          {draft.email_blocks_json.map((block, i) => (
            <BlockEditor
              key={i}
              block={block}
              onChange={(patch) => updateBlock(i, patch)}
              onMoveUp={i > 0 ? () => moveBlock(i, -1) : undefined}
              onMoveDown={
                i < draft.email_blocks_json.length - 1
                  ? () => moveBlock(i, 1)
                  : undefined
              }
              onDuplicate={() => duplicateBlock(i)}
              onRemove={() => removeBlock(i)}
            />
          ))}
          {draft.email_blocks_json.length === 0 && (
            <div className="rounded-xl border border-dashed border-line/60 p-6 text-center text-text-muted text-[13px]">
              This automation has no email body yet. Add a block below.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {BLOCK_LIBRARY.map((lib) => (
            <Button
              key={lib.type}
              size="sm"
              variant="secondary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => addBlock({ ...lib.starter })}
            >
              {lib.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  onChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className="!p-3">
      <div className="flex items-center gap-2 mb-2">
        <Pill tone="neutral">{blockLabel(block.type)}</Pill>
        <div className="ml-auto flex items-center gap-1">
          {onMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              aria-label="Move up"
              className="w-7 h-7 rounded-lg hover:bg-text-primary/[0.06] flex items-center justify-center text-text-muted"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              aria-label="Move down"
              className="w-7 h-7 rounded-lg hover:bg-text-primary/[0.06] flex items-center justify-center text-text-muted"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate"
            className="w-7 h-7 rounded-lg hover:bg-text-primary/[0.06] flex items-center justify-center text-text-muted"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove"
            className="w-7 h-7 rounded-lg hover:bg-danger/10 flex items-center justify-center text-danger"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <BlockFields block={block} onChange={onChange} />
    </Card>
  );
}

function blockLabel(t: BlockType) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function BlockFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
}) {
  switch (block.type) {
    case "eyebrow":
      return (
        <TextInput
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="YOUR ORDER"
        />
      );
    case "heading":
      return (
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <TextInput
            value={block.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Order {{order_number}}"
          />
          <NumberField
            value={String(block.size ?? 30)}
            onChange={(v) => onChange({ size: Number(v) || 30 })}
            allowDecimal={false}
            suffix="px"
          />
        </div>
      );
    case "paragraph":
      return (
        <TextArea
          rows={3}
          value={block.html ?? ""}
          onChange={(e) => onChange({ html: e.target.value })}
          placeholder="Hi {{first_name}}, thank you for your order."
        />
      );
    case "button":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            value={block.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="View your order"
          />
          <TextInput
            value={block.href ?? ""}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="{{tracking_url}}"
          />
        </div>
      );
    case "spacer":
      return (
        <NumberField
          value={String(block.h ?? 16)}
          onChange={(v) => onChange({ h: Number(v) || 16 })}
          allowDecimal={false}
          suffix="px"
        />
      );
    case "perk":
      return (
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <TextInput
            value={block.glyph ?? ""}
            onChange={(e) => onChange({ glyph: e.target.value })}
            placeholder="✓"
          />
          <TextInput
            value={block.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Free shipping over ₦100,000"
          />
        </div>
      );
    case "divider":
      return (
        <div className="text-[11px] text-text-faint italic">
          A thin horizontal line at the accent colour hairline weight.
        </div>
      );
    default:
      return (
        <div className="text-[11px] text-text-faint italic">
          {block.type} — advanced block. Edit via API.
        </div>
      );
  }
}

function VariablesPalette({
  variables,
}: {
  variables: Automation["variables_schema"];
}) {
  if (!variables?.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap max-w-[60%] justify-end">
      <span className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-faint">
        Variables:
      </span>
      {variables.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(`{{${v.name}}}`);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-text-primary/[0.06] text-[11px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.09] transition-colors"
          title={
            v.description ||
            (v.example ? `e.g. ${v.example}` : "Click to copy the token")
          }
        >
          <code>{`{{${v.name}}}`}</code>
        </button>
      ))}
    </div>
  );
}

// ── WhatsApp tab ─────────────────────────────────────────────

function WhatsAppTab({
  draft,
  setD,
  whatsappBlocked,
  variables,
}: {
  draft: DraftState;
  setD: (p: Partial<DraftState>) => void;
  whatsappBlocked: boolean;
  variables: Automation["variables_schema"];
}) {
  return (
    <div className="space-y-4">
      {whatsappBlocked && (
        <Card className="!p-4 !border-warn/40 !bg-warn/[0.06]">
          <div className="flex items-start gap-2 text-[13px] text-warn">
            <ShieldOff className="w-4 h-4 mt-0.5" />
            <div>
              WhatsApp is hard-blocked for this automation. The template below
              is preserved but nothing sends over WhatsApp — the fallback
              channel is used instead.
            </div>
          </div>
        </Card>
      )}
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted">
          Body
        </div>
        <VariablesPalette variables={variables} />
      </div>
      <TextArea
        rows={8}
        value={draft.whatsapp_body_template}
        onChange={(e) => setD({ whatsapp_body_template: e.target.value })}
        placeholder="Hi {{first_name}}! …"
      />
      <div className="text-[11px] text-text-faint">
        Plain text only. WhatsApp charges apply per send once the 24h customer
        service window has closed. Template ~1024 char max.
      </div>
    </div>
  );
}

// ── Cadence tab ──────────────────────────────────────────────

function CadenceTab({
  row,
  draft,
  setD,
}: {
  row: Automation;
  draft: DraftState;
  setD: (p: Partial<DraftState>) => void;
}) {
  const c = draft.cadence_config ?? {};
  const setC = (patch: Partial<CadenceConfig>) =>
    setD({ cadence_config: { ...c, ...patch } });
  return (
    <div className="space-y-4">
      <Card className="!p-4">
        <div className="text-[13px] text-text-muted mb-3">
          Trigger type is <strong>{row.trigger_type ?? "event"}</strong> —{" "}
          {triggerBlurb(row.trigger_type)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {row.trigger_type === "scheduled" && (
            <>
              <Field label="Every (minutes)" hint="How often the cron sweeps.">
                <NumberField
                  value={String(c.every_min ?? 30)}
                  onChange={(v) =>
                    setC({ every_min: Number(v) || 30 })
                  }
                  allowDecimal={false}
                />
              </Field>
              <Field label="Only if paid ≥" hint="₦ minimum on order (layaway).">
                <NumberField
                  value={String(c.min_amount_paid_ngn ?? 0)}
                  onChange={(v) =>
                    setC({ min_amount_paid_ngn: Number(v) || 0 })
                  }
                />
              </Field>
            </>
          )}
          {row.trigger_type === "annual" && (
            <>
              <Field label="Hour of day (0–23)">
                <NumberField
                  value={String(c.hour_local ?? 9)}
                  onChange={(v) => setC({ hour_local: Number(v) || 9 })}
                  allowDecimal={false}
                />
              </Field>
              <Field label="Source">
                <TextInput
                  value={c.source ?? "contact.date_of_birth"}
                  onChange={(e) => setC({ source: e.target.value })}
                />
              </Field>
            </>
          )}
          {row.trigger_type === "event" && (
            <Field label="Event key" hint="Which domain event fires it.">
              <TextInput
                value={c.event ?? ""}
                onChange={(e) => setC({ event: e.target.value })}
                placeholder="order.placed"
              />
            </Field>
          )}
        </div>
      </Card>
    </div>
  );
}

function triggerBlurb(t: Automation["trigger_type"]) {
  switch (t) {
    case "scheduled":
      return "the cron sweeps on a fixed cadence.";
    case "annual":
      return "runs once a year on a contact-relative date.";
    case "recurring":
      return "fires on a recurring interval.";
    case "event":
    default:
      return "fires the moment a domain event happens.";
  }
}

// ── Activity tab ─────────────────────────────────────────────

function ActivityTab({ eventKey }: { eventKey: string }) {
  const q = useQuery({
    queryKey: ["comms-studio", eventKey, "send-log"],
    queryFn: () => commsStudioApi.sendLog(eventKey, 25),
  });
  if (q.isLoading) {
    return (
      <div className="animate-pulse h-40 rounded-2xl bg-text-primary/[0.04]" />
    );
  }
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-[13px] text-text-muted p-4 border border-dashed border-line/60 rounded-xl text-center">
        No sends recorded yet.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-text-primary/[0.04] text-text-muted">
          <tr>
            <th className="text-left px-3 py-2">When</th>
            <th className="text-left px-3 py-2">Channel</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.send_id} className="border-t border-line/60">
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(r.sent_at).toLocaleString()}
              </td>
              <td className="px-3 py-2">{r.channel}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2 text-text-muted">
                {r.failure_reason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Preview pane ─────────────────────────────────────────────

function PreviewPane({
  eventKey,
  draft,
  channel,
  testTo,
  setTestTo,
  onSendTest,
  testSending,
  testResult,
}: {
  eventKey: string;
  draft: DraftState;
  channel: "email" | "whatsapp";
  testTo: string;
  setTestTo: (v: string) => void;
  onSendTest: (channel: "email" | "whatsapp", to: string) => void;
  testSending: boolean;
  testResult: string | null;
}) {
  // Debounce the draft-to-preview request so typing doesn't hammer the server.
  const [debounced, setDebounced] = useState({ ...draft });
  useEffect(() => {
    const id = setTimeout(() => setDebounced({ ...draft }), 350);
    return () => clearTimeout(id);
  }, [draft]);

  const previewInput = useMemo(
    () => ({
      event_key: eventKey,
      channel,
      subject_template: debounced.subject_template,
      preheader_template: debounced.preheader_template,
      email_blocks_json: debounced.email_blocks_json,
      whatsapp_body_template: debounced.whatsapp_body_template,
    }),
    [
      eventKey,
      channel,
      debounced.subject_template,
      debounced.preheader_template,
      debounced.email_blocks_json,
      debounced.whatsapp_body_template,
    ],
  );

  const preview = useQuery({
    queryKey: ["comms-studio-preview", previewInput],
    queryFn: () => commsStudioApi.preview(previewInput),
  });

  return (
    <div className="space-y-3 xl:sticky xl:top-4">
      <Card className="!p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted">
            Preview · {channel}
          </div>
          {preview.isFetching && (
            <span className="text-[10px] text-text-faint">rendering…</span>
          )}
        </div>
        {channel === "email" ? (
          <>
            {preview.data?.subject && (
              <div className="mb-3">
                <div className="text-[11px] text-text-faint uppercase tracking-wide">
                  Subject
                </div>
                <div className="text-[13px] font-medium mt-0.5">
                  {preview.data.subject}
                </div>
                {preview.data.preheader && (
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {preview.data.preheader}
                  </div>
                )}
              </div>
            )}
            <div className="rounded-xl overflow-hidden border border-line bg-white">
              <iframe
                title="Email preview"
                srcDoc={preview.data?.html ?? "<p>Loading…</p>"}
                className="w-full h-[520px] bg-white"
                sandbox=""
              />
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-line bg-text-primary/[0.03] p-4 whitespace-pre-wrap text-[13px] leading-relaxed">
            {preview.data?.body ?? "—"}
          </div>
        )}
      </Card>

      <Card className="!p-4">
        <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-2">
          Send test
        </div>
        <div className="flex items-center gap-2">
          <TextInput
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={
              channel === "email"
                ? "your@email.com"
                : "234801… (E.164, no leading +)"
            }
            className="flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!testTo || testSending}
            onClick={() => onSendTest(channel, testTo)}
            icon={<Send className="w-3.5 h-3.5" />}
          >
            {testSending ? "Sending…" : "Send test"}
          </Button>
        </div>
        {testResult && (
          <div
            className={cn(
              "text-[11px] mt-2",
              testResult === "sent"
                ? "text-success"
                : "text-danger",
            )}
          >
            {testResult === "sent"
              ? "Test sent — check the destination."
              : testResult}
          </div>
        )}
      </Card>
    </div>
  );
}
