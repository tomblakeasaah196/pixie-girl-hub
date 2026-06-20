import { useMemo, useRef, useState } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  Eye,
  FileCode2,
  Users,
  Crown,
  Beaker,
  Check,
  Mail,
  Wand2,
  Code2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useActiveBusiness } from "@/stores/business";
import {
  newBlock,
  defaultDesign,
  parseDesign,
  serializeDesign,
  previewEmailHtml,
  fillSample,
  BLOCK_LABELS,
  type EmailDesign,
  type EmailBlock,
  type EmailBlockType,
} from "@/lib/email-studio";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, Select, MultiSelect } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import {
  useEmailTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useEmailSegments,
  useSaveSegment,
  useDeleteSegment,
  usePreviewSegment,
  useAbResults,
  useCreateVariant,
  useDeclareWinner,
  useBuildAudienceFromSegment,
  useBuildRecipients,
  TEMPLATE_VARIABLES,
  type EmailTemplate,
  type EmailSegment,
  type SegmentPreview,
  type EmailCampaign,
} from "@/lib/marketing-api";

/* ════════════════════════════════════════════════════════════
   TEMPLATES
   ════════════════════════════════════════════════════════════ */

const STATUS_TONE = {
  draft: "neutral",
  review: "warn",
  approved: "success",
  archived: "neutral",
} as const;

export function TemplatesTab() {
  const { can } = useAuthStore();
  const templatesQ = useEmailTemplates();
  const [editing, setEditing] = useState<EmailTemplate | null | "new">(null);
  const templates = templatesQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">
          Reusable email designs with merge variables and a live preview.
        </p>
        {can("email_campaigns", "create") && (
          <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
            New template
          </Button>
        )}
      </div>

      {templatesQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 44 }} />)}
        </Card>
      ) : templatesQ.isError ? (
        <ErrorState onRetry={() => templatesQ.refetch()} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileCode2 className="w-7 h-7" />}
          title="No templates"
          message="Create a reusable email template — campaigns pick one to send."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {templates.map((t, i) => (
            <button
              key={t.template_id}
              onClick={() => setEditing(t)}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] ${
                i < templates.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Mail className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[13.5px] truncate">{t.display_name}</span>
                  <Pill tone={STATUS_TONE[t.status] ?? "neutral"} dot={false}>{t.status}</Pill>
                </div>
                <div className="text-[11.5px] text-text-faint truncate">{t.subject_line}</div>
              </div>
            </button>
          ))}
        </Card>
      )}

      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
}) {
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const business = useActiveBusiness();
  const isNew = !template;
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Re-open a studio-built template in the studio; raw HTML opens in HTML mode.
  const existingDesign = useMemo(() => parseDesign(template?.html_body), [template]);

  const [mode, setMode] = useState<"design" | "html">(() =>
    isNew ? "design" : existingDesign ? "design" : "html",
  );
  const [displayName, setDisplayName] = useState(template?.display_name ?? "");
  const [subject, setSubject] = useState(template?.subject_line ?? "");
  const [status, setStatus] = useState<EmailTemplate["status"]>(template?.status ?? "draft");
  const [design, setDesign] = useState<EmailDesign>(
    () => existingDesign ?? defaultDesign(business.name),
  );
  const [html, setHtml] = useState(
    template?.html_body ??
      '<div style="font-family:Arial,sans-serif;padding:24px">\n  <h1>Hello {{customer_name}},</h1>\n  <p>Write your message here…</p>\n</div>',
  );

  const busy = create.isPending || update.isPending;
  const error = create.isError || update.isError;
  const previewSrc = mode === "design" ? previewEmailHtml(design) : fillSample(html);

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setHtml((h) => h + token);
      return;
    }
    const start = el.selectionStart ?? html.length;
    const end = el.selectionEnd ?? html.length;
    setHtml(html.slice(0, start) + token + html.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  function save() {
    const html_body = mode === "design" ? serializeDesign(design) : html;
    if (isNew) {
      create.mutate(
        {
          template_key: slugify(displayName) || `template_${Date.now()}`,
          display_name: displayName,
          subject_line: subject,
          html_body,
        },
        { onSuccess: onClose },
      );
    } else {
      update.mutate(
        {
          id: template!.template_id,
          patch: { display_name: displayName, subject_line: subject, html_body, status },
        },
        { onSuccess: onClose },
      );
    }
  }

  const canSave = !!displayName && !!subject && !busy;

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? "New template" : "Edit template"}
      subtitle={isNew ? "Design a reusable email" : template?.template_key}
    >
      <div className="space-y-4 p-1">
        <Field label="Template name">
          <Input value={displayName} onChange={setDisplayName} placeholder="June drop announcement" />
        </Field>
        <Field label="Subject line">
          <Input value={subject} onChange={setSubject} placeholder="Something new just landed ✨" />
        </Field>

        {!isNew && (
          <Field label="Status">
            <Select
              value={status}
              onChange={(v) => setStatus(v as EmailTemplate["status"])}
              options={[
                { value: "draft", label: "Draft" },
                { value: "review", label: "In review" },
                { value: "approved", label: "Approved" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Field>
        )}

        <div className="inline-flex rounded-[10px] border border-line overflow-hidden">
          <ModeBtn active={mode === "design"} onClick={() => setMode("design")} icon={<Wand2 className="w-3.5 h-3.5" />}>
            Design
          </ModeBtn>
          <ModeBtn active={mode === "html"} onClick={() => setMode("html")} icon={<Code2 className="w-3.5 h-3.5" />}>
            HTML
          </ModeBtn>
        </div>

        {mode === "design" ? (
          <StudioEditor design={design} setDesign={setDesign} />
        ) : (
          <Field label="HTML body">
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertToken(v.token)}
                  className="text-[11px] rounded-md border border-line px-2 py-1 text-text-muted hover:text-accent-glow hover:border-accent/40"
                  title={`Insert ${v.label}`}
                >
                  {v.token}
                </button>
              ))}
            </div>
            <textarea
              ref={bodyRef}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={10}
              spellCheck={false}
              className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[12px] font-mono outline-none focus:border-accent/50 resize-y"
            />
          </Field>
        )}

        <Field label="Live preview (sample data)">
          <iframe
            title="preview"
            className="w-full h-[320px] rounded-[11px] border border-line bg-white"
            srcDoc={previewSrc}
          />
        </Field>

        {error && <p className="text-[12px] text-danger">Couldn&rsquo;t save the template.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={save}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        active ? "bg-accent/[0.12] text-accent-glow" : "text-text-muted hover:text-text-primary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

const ADD_BLOCKS: EmailBlockType[] = [
  "heading",
  "text",
  "button",
  "image",
  "hero",
  "divider",
  "spacer",
  "header",
  "footer",
];

function StudioEditor({
  design,
  setDesign,
}: {
  design: EmailDesign;
  setDesign: (d: EmailDesign) => void;
}) {
  const patchBlock = (id: string, patch: Partial<EmailBlock>) =>
    setDesign({ ...design, blocks: design.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addBlock = (type: EmailBlockType) =>
    setDesign({ ...design, blocks: [...design.blocks, newBlock(type)] });
  const removeBlock = (id: string) =>
    setDesign({ ...design, blocks: design.blocks.filter((b) => b.id !== id) });
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...design.blocks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setDesign({ ...design, blocks: next });
  };
  const setTheme = (patch: Partial<EmailDesign["theme"]>) =>
    setDesign({ ...design, theme: { ...design.theme, ...patch } });

  return (
    <div className="space-y-3">
      {/* Theme + add */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11.5px] text-text-muted">
          Accent
          <input type="color" value={design.theme.accent} onChange={(e) => setTheme({ accent: e.target.value })} className="w-7 h-7 rounded border border-line bg-transparent" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[11.5px] text-text-muted">
          Background
          <input type="color" value={design.theme.background} onChange={(e) => setTheme({ background: e.target.value })} className="w-7 h-7 rounded border border-line bg-transparent" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ADD_BLOCKS.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addBlock(type)}
            className="text-[11px] rounded-md border border-line px-2 py-1 text-text-muted hover:text-accent-glow hover:border-accent/40 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            {BLOCK_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Blocks */}
      <div className="space-y-2">
        {design.blocks.map((b, i) => (
          <div key={b.id} className="rounded-xl border border-line p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-widest text-text-faint">{BLOCK_LABELS[b.type]}</span>
              <div className="flex items-center gap-1">
                <IconBtn onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                <IconBtn onClick={() => move(i, 1)} disabled={i === design.blocks.length - 1}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                <IconBtn onClick={() => removeBlock(b.id)} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
              </div>
            </div>
            <BlockFields block={b} onChange={(p) => patchBlock(b.id, p)} />
          </div>
        ))}
        {design.blocks.length === 0 && (
          <p className="text-[12.5px] text-text-faint italic">Add a block to start designing.</p>
        )}
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: EmailBlock; onChange: (p: Partial<EmailBlock>) => void }) {
  const t = block.type;
  return (
    <div className="space-y-2">
      {t === "header" && (
        <>
          <Input value={block.text ?? ""} onChange={(v) => onChange({ text: v })} placeholder="Brand name" />
          <Input value={block.imageUrl ?? ""} onChange={(v) => onChange({ imageUrl: v })} placeholder="Logo image URL (optional)" />
        </>
      )}
      {(t === "hero" || t === "image") && (
        <>
          <Input value={block.imageUrl ?? ""} onChange={(v) => onChange({ imageUrl: v })} placeholder="Image URL" />
          <Input value={block.alt ?? ""} onChange={(v) => onChange({ alt: v })} placeholder="Alt text" />
          <Input value={block.href ?? ""} onChange={(v) => onChange({ href: v })} placeholder="Link URL (optional)" />
        </>
      )}
      {(t === "heading" || t === "text") && (
        <>
          {t === "text" ? (
            <textarea
              value={block.text ?? ""}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={3}
              className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2 text-[13px] outline-none focus:border-accent/50 resize-y"
            />
          ) : (
            <Input value={block.text ?? ""} onChange={(v) => onChange({ text: v })} placeholder="Heading" />
          )}
          <div className="flex items-center justify-between">
            <AlignToggle value={block.align ?? "left"} onChange={(a) => onChange({ align: a })} />
            <div className="flex gap-1">
              {["{{customer_name}}", "{{email}}"].map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => onChange({ text: (block.text ?? "") + tok })}
                  className="text-[10.5px] rounded border border-line px-1.5 py-0.5 text-text-muted hover:text-accent-glow"
                >
                  {tok}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {t === "button" && (
        <>
          <Input value={block.label ?? ""} onChange={(v) => onChange({ label: v })} placeholder="Button label" />
          <Input value={block.href ?? ""} onChange={(v) => onChange({ href: v })} placeholder="https://…" />
          <AlignToggle value={block.align ?? "center"} onChange={(a) => onChange({ align: a })} />
        </>
      )}
      {t === "spacer" && (
        <input
          value={String(block.height ?? 24)}
          onChange={(e) => onChange({ height: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
          inputMode="numeric"
          className="w-28 rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[40px] text-[13px] outline-none focus:border-accent/50 tabular-nums"
          placeholder="Height px"
        />
      )}
      {t === "footer" && (
        <textarea
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2 text-[13px] outline-none focus:border-accent/50 resize-y"
        />
      )}
      {t === "divider" && <p className="text-[11.5px] text-text-faint">A horizontal rule.</p>}
    </div>
  );
}

function AlignToggle({
  value,
  onChange,
}: {
  value: "left" | "center" | "right";
  onChange: (a: "left" | "center" | "right") => void;
}) {
  return (
    <div className="inline-flex rounded-[8px] border border-line overflow-hidden">
      {(["left", "center", "right"] as const).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          className={`px-2 py-1 text-[11px] capitalize ${
            value === a ? "bg-accent/[0.12] text-accent-glow" : "text-text-muted hover:text-text-primary"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

function IconBtn({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg bg-panel-2 border border-line p-1.5 disabled:opacity-30 ${
        danger ? "hover:border-danger/40 text-text-muted hover:text-danger" : "hover:border-accent/40 text-text-muted"
      }`}
    >
      {children}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════
   SEGMENTS
   ════════════════════════════════════════════════════════════ */

export function SegmentsTab() {
  const { can } = useAuthStore();
  const segmentsQ = useEmailSegments();
  const del = useDeleteSegment();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ segment: EmailSegment; data?: SegmentPreview } | null>(null);
  const previewM = usePreviewSegment();
  const segments = segmentsQ.data ?? [];

  function openPreview(seg: EmailSegment) {
    setPreview({ segment: seg });
    previewM.mutate(seg.segment_id, {
      onSuccess: (data) => setPreview({ segment: seg, data }),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">
          Saved audiences. A campaign builds its recipient list from a segment.
        </p>
        {can("email_campaigns", "create") && (
          <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New segment
          </Button>
        )}
      </div>

      {segmentsQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 44 }} />)}
        </Card>
      ) : segmentsQ.isError ? (
        <ErrorState onRetry={() => segmentsQ.refetch()} />
      ) : segments.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7" />}
          title="No segments"
          message="Create a saved audience to target with campaigns."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {segments.map((s, i) => (
            <div
              key={s.segment_id}
              className={`p-4 flex items-center gap-3 ${i < segments.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Users className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] truncate">{s.name}</div>
                {s.description && <div className="text-[11.5px] text-text-faint truncate">{s.description}</div>}
              </div>
              <Button size="sm" variant="ghost" icon={<Eye className="w-4 h-4" />} onClick={() => openPreview(s)}>
                Preview
              </Button>
              {can("email_campaigns", "delete") && (
                <button
                  onClick={() => window.confirm(`Delete segment "${s.name}"?`) && del.mutate(s.segment_id)}
                  className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {creating && <SegmentCreate onClose={() => setCreating(false)} />}
      {preview && (
        <Modal open onClose={() => setPreview(null)} title={`Audience · ${preview.segment.name}`}>
          {previewM.isPending && !preview.data ? (
            <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-text-faint" /></div>
          ) : preview.data ? (
            <div className="space-y-3">
              <div className="text-[13px]">
                <span className="font-display text-[24px] tabular-nums">{preview.data.count.toLocaleString()}</span>
                <span className="text-text-muted ml-2">emailable contacts</span>
              </div>
              <div className="rounded-xl border border-line overflow-hidden">
                {preview.data.sample.length === 0 ? (
                  <p className="p-3 text-[12.5px] text-text-faint italic">No contacts match.</p>
                ) : (
                  preview.data.sample.map((c, idx) => (
                    <div
                      key={c.contact_id}
                      className={`p-2.5 flex items-center justify-between text-[12.5px] ${
                        idx < preview.data!.sample.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <span className="truncate">{c.display_name || "—"}</span>
                      <span className="text-text-faint font-mono text-[11px] truncate ml-2">{c.email}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-text-faint">Couldn&rsquo;t load the preview.</p>
          )}
        </Modal>
      )}
    </div>
  );
}

const CONTACT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "stylist_partner", label: "Stylist" },
  { value: "retail_partner", label: "Retail partner" },
  { value: "supplier", label: "Supplier" },
  { value: "staff", label: "Staff" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "vip", label: "VIP" },
  { value: "regular", label: "Regular" },
  { value: "new", label: "New" },
];

const PURCHASED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last year" },
];

function SegmentCreate({ onClose }: { onClose: () => void }) {
  const save = useSaveSegment();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contactTypes, setContactTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [purchasedDays, setPurchasedDays] = useState("");
  const [birthdayDays, setBirthdayDays] = useState("");

  function buildFilter(): Record<string, unknown> {
    const f: Record<string, unknown> = {};
    if (contactTypes.length) f.contact_type = contactTypes;
    if (priorities.length) f.priority_level = priorities;
    const tagList = tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length) f.tag_names = tagList;
    if (minSpend && Number(minSpend) > 0) f.min_lifetime_spend = Number(minSpend);
    if (purchasedDays) f.purchased_within_days = Number(purchasedDays);
    if (birthdayDays && Number(birthdayDays) > 0) f.birthday_within_days = Number(birthdayDays);
    return f;
  }

  const digits = (s: string) => s.replace(/[^0-9]/g, "");

  return (
    <Modal open onClose={onClose} title="New segment">
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={setName} placeholder="Lagos VIPs" />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={setDescription} placeholder="VIP customers who bought recently" />
        </Field>

        <div className="rounded-xl border border-line p-3 space-y-3">
          <div className="micro">Filters — leave empty to target all emailable contacts</div>
          <Field label="Contact type">
            <MultiSelect
              values={contactTypes}
              onChange={setContactTypes}
              options={CONTACT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="Priority">
            <MultiSelect
              values={priorities}
              onChange={setPriorities}
              options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <Input value={tags} onChange={setTags} placeholder="loyal, wholesale" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bought within">
              <Select value={purchasedDays} onChange={setPurchasedDays} options={PURCHASED_OPTIONS} />
            </Field>
            <Field label="Min lifetime spend (₦)">
              <input
                value={minSpend}
                onChange={(e) => setMinSpend(digits(e.target.value))}
                placeholder="0"
                inputMode="numeric"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 tabular-nums"
              />
            </Field>
          </div>
          <Field label="Birthday within (days)">
            <input
              value={birthdayDays}
              onChange={(e) => setBirthdayDays(digits(e.target.value))}
              placeholder="e.g. 7"
              inputMode="numeric"
              className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 tabular-nums"
            />
          </Field>
        </div>

        <p className="text-[11.5px] text-text-faint">
          Save, then <span className="text-text-muted">Preview</span> to see how
          many contacts match. Campaigns build their recipients from this segment.
        </p>
        {save.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t save.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name || save.isPending}
            onClick={() =>
              save.mutate(
                { name, description: description || undefined, filter: buildFilter() },
                { onSuccess: onClose },
              )
            }
            icon={save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════
   CAMPAIGN DETAIL SECTIONS (audience + A/B)
   ════════════════════════════════════════════════════════════ */

export function CampaignAudienceSection({ campaign }: { campaign: EmailCampaign }) {
  const { can } = useAuthStore();
  const segmentsQ = useEmailSegments();
  const fromSegment = useBuildAudienceFromSegment(campaign.campaign_id);
  const allContacts = useBuildRecipients(campaign.campaign_id);
  const [segmentId, setSegmentId] = useState(campaign.segment_id ?? "");
  const segments = segmentsQ.data ?? [];

  const editable = campaign.status === "draft";
  const lastAdded = fromSegment.data?.recipients_added ?? allContacts.data?.added;

  if (!can("email_campaigns", "edit")) return null;

  return (
    <div className="rounded-xl border border-line p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="micro">Audience</div>
        {campaign.recipients_count != null && (
          <span className="text-[11.5px] text-text-faint">
            {campaign.recipients_count.toLocaleString()} recipients
          </span>
        )}
      </div>
      {editable ? (
        <>
          <div className="flex gap-2">
            <Select
              value={segmentId}
              onChange={setSegmentId}
              options={[
                { value: "", label: segments.length ? "Choose a segment…" : "No segments" },
                ...segments.map((s) => ({ value: s.segment_id, label: s.name })),
              ]}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!segmentId || fromSegment.isPending}
              onClick={() => fromSegment.mutate(segmentId)}
              icon={fromSegment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            >
              Build
            </Button>
          </div>
          <button
            onClick={() => allContacts.mutate(undefined)}
            disabled={allContacts.isPending}
            className="text-[12px] text-accent-glow hover:underline disabled:opacity-50"
          >
            {allContacts.isPending ? "Adding…" : "Or add all emailable contacts"}
          </button>
          {lastAdded != null && (
            <p className="text-[12px] text-success">Added {lastAdded.toLocaleString()} recipients.</p>
          )}
          {(fromSegment.isError || allContacts.isError) && (
            <p className="text-[12px] text-danger">Couldn&rsquo;t build the audience.</p>
          )}
        </>
      ) : (
        <p className="text-[12px] text-text-faint">
          The audience is locked once a campaign leaves draft.
        </p>
      )}
    </div>
  );
}

export function CampaignVariantsSection({ campaign }: { campaign: EmailCampaign }) {
  const { can } = useAuthStore();
  const isAb = campaign.campaign_type === "ab_test";
  const abQ = useAbResults(campaign.campaign_id, isAb);
  const createVariant = useCreateVariant(campaign.campaign_id);
  const declareWinner = useDeclareWinner(campaign.campaign_id);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [subject, setSubject] = useState("");
  const [alloc, setAlloc] = useState("50");

  if (!isAb) return null;
  const results = abQ.data;
  const canEdit = can("email_campaigns", "edit");

  return (
    <div className="rounded-xl border border-line p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="micro inline-flex items-center gap-1.5">
          <Beaker className="w-3.5 h-3.5 text-accent-glow" /> A/B variants
        </div>
        {results?.metric && (
          <span className="text-[11px] text-text-faint">winner by {results.metric.replace("_", " ")}</span>
        )}
      </div>

      {abQ.isLoading ? (
        <Skeleton style={{ height: 40 }} />
      ) : !results || results.variants.length === 0 ? (
        <p className="text-[12.5px] text-text-faint italic">No variants yet.</p>
      ) : (
        <div className="space-y-1.5">
          {results.variants.map((v) => {
            const leading = results.leading_variant_id === v.variant_id;
            return (
              <div key={v.variant_id} className="flex items-center gap-2 rounded-lg border border-line p-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[13px]">{v.variant_label}</span>
                    {v.is_winner && <Pill tone="success" dot={false}>Winner</Pill>}
                    {leading && !v.is_winner && <Pill tone="accent" dot={false}>Leading</Pill>}
                  </div>
                  {v.subject_line && <div className="text-[11px] text-text-faint truncate">{v.subject_line}</div>}
                </div>
                <div className="text-right text-[11px] text-text-muted shrink-0">
                  <div>Open {v.open_rate_pct}%</div>
                  <div>Click {v.click_rate_pct}%</div>
                </div>
                {canEdit && !v.is_winner && (
                  <button
                    onClick={() => declareWinner.mutate(v.variant_id)}
                    title="Declare winner"
                    className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-accent/40"
                  >
                    <Crown className="w-3.5 h-3.5 text-warn" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        adding ? (
          <div className="rounded-lg border border-line p-2.5 space-y-2">
            <Input value={label} onChange={setLabel} placeholder="Variant label (e.g. B)" />
            <Input value={subject} onChange={setSubject} placeholder="Subject line for this variant" />
            <div className="flex gap-2 items-center">
              <input
                value={alloc}
                onChange={(e) => setAlloc(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Allocation %"
                className="w-28 h-[38px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50 tabular-nums"
              />
              <span className="text-[12px] text-text-faint">% of audience</span>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!label || !alloc || createVariant.isPending}
                onClick={() =>
                  createVariant.mutate(
                    { variant_label: label, subject_line: subject || undefined, allocation_pct: Number(alloc) },
                    { onSuccess: () => { setAdding(false); setLabel(""); setSubject(""); } },
                  )
                }
              >
                Add
              </Button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="text-[12px] text-accent-glow hover:underline inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add variant
          </button>
        )
      )}
    </div>
  );
}

/* ── Shared bits (local) ───────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
    />
  );
}
