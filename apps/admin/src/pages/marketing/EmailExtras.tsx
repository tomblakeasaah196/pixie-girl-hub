import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import {
  Plus,
  Loader2,
  Trash2,
  Users,
  Crown,
  Beaker,
  Check,
  Mail,
  Tag,
  Clock,
  FileCode2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  LayoutTemplate,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { fillSample, parseDesign, type EmailDesign } from "@/lib/email-studio";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, Select, MultiSelect, Toggle } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { RichMailEditor } from "@/components/marketing/RichMailEditor";
import {
  useEmailTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useEmailSegments,
  useSaveSegment,
  useDeleteSegment,
  usePreviewAudience,
  useAbResults,
  useCreateVariant,
  useDeclareWinner,
  useBuildAudienceFromSegment,
  useBuildRecipients,
  useUpdateEmailCampaign,
  useEmailFrame,
  useSaveEmailFrame,
  useFrameShell,
  type EmailTemplate,
  type EmailCampaign,
  type CampaignMergeData,
  type EmailFrame,
} from "@/lib/marketing-api";

/* ════════════════════════════════════════════════════════════
   FRAMED PREVIEW — one composition path for editor + design tab
   ════════════════════════════════════════════════════════════ */

/** Legacy templates carry their own chrome (seeded premium HTML, old studio
 *  designs); rich-text bodies get the brand frame. Mirror of the server's
 *  isFullDocument. */
function isFullDocument(html: string | undefined): boolean {
  return /<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(String(html || ""));
}

/** Preview-only mirror of the server's inlineRichStyles — enough styling for
 *  the iframe to look like the sent mail (the real inlining happens at send). */
function previewRichStyles(html: string, accent: string): string {
  const rules: Record<string, string> = {
    p: "margin:0 0 14px 0;font-family:'Montserrat',Arial,sans-serif;font-size:15px;line-height:1.62;color:#1A1212",
    h1: "margin:22px 0 10px 0;font-family:'Playfair Display',Georgia,serif;font-size:28px;line-height:1.25;font-weight:600;color:#1A1212",
    h2: "margin:20px 0 8px 0;font-family:'Playfair Display',Georgia,serif;font-size:22px;line-height:1.3;font-weight:600;color:#1A1212",
    ul: "margin:0 0 14px 0;padding-left:22px",
    ol: "margin:0 0 14px 0;padding-left:22px",
    li: "margin:0 0 6px 0;font-family:'Montserrat',Arial,sans-serif;font-size:15px;line-height:1.62;color:#1A1212",
    a: `color:${accent};text-decoration:underline`,
    blockquote: `margin:0 0 14px 0;padding:2px 0 2px 16px;border-left:3px solid ${accent};font-family:'Montserrat',Arial,sans-serif;font-size:15px;line-height:1.62;color:#7A7068`,
    img: "max-width:100%;height:auto;border:0;border-radius:6px",
    hr: "border:none;border-top:1px solid #ECE5DC;margin:22px 0",
  };
  let out = html;
  for (const [tag, style] of Object.entries(rules)) {
    out = out.replace(
      new RegExp(`<${tag}(?![a-z0-9])(?![^>]*\\bstyle=)([^>]*)>`, "gi"),
      `<${tag} style="${style}"$1>`,
    );
  }
  return out;
}

function applyTokens(html: string, tokens: Record<string, string>): string {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) =>
    k in tokens ? tokens[k] : m,
  );
}

/** Compose the full framed preview: the server-rendered shell (real header +
 *  footer, brand tokens resolved) around the body being written. */
function composeFramedPreview(
  shell: { shell_html: string; tokens: Record<string, string> } | undefined,
  storedBody: string,
): string {
  const accent = shell?.tokens?.brand_color || "#690909";
  let body = previewRichStyles(storedBody, accent);
  if (shell) body = applyTokens(body, shell.tokens);
  body = fillSample(body); // sample sale values for leftover tokens
  if (!shell) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#F4EFE9;font-family:Arial,sans-serif">${body}</body></html>`;
  }
  return shell.shell_html.replace("<!--PGH_BODY-->", body);
}

/** The tall white iframe every preview renders into. */
function MailPreviewFrame({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <iframe
      title="Mail preview"
      sandbox=""
      srcDoc={html}
      className={
        className ??
        "w-full h-[420px] md:h-[520px] rounded-[13px] border border-line bg-white"
      }
    />
  );
}

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-text-muted">
          Write a mail once, reuse it in any campaign. The brand header and
          footer are added automatically.
        </p>
        {can("email_campaigns", "create") && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setEditing("new")}
          >
            New template
          </Button>
        )}
      </div>

      {templatesQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 44 }} />
          ))}
        </Card>
      ) : templatesQ.isError ? (
        <ErrorState onRetry={() => templatesQ.refetch()} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileCode2 className="w-7 h-7" />}
          title="No templates"
          message="Write your first mail — campaigns pick a template to send."
          action={
            can("email_campaigns", "create") ? (
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setEditing("new")}
              >
                New template
              </Button>
            ) : undefined
          }
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[13.5px] truncate">
                    {t.display_name}
                  </span>
                  <Pill tone={STATUS_TONE[t.status] ?? "neutral"} dot={false}>
                    {t.status}
                  </Pill>
                </div>
                <div className="text-[11.5px] text-text-faint truncate">
                  {t.subject_line}
                </div>
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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/** Best-effort conversion of an old block-studio design into rich-text HTML
 *  so the mail opens in the new editor instead of being lost. */
function designToRichHtml(design: EmailDesign): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  for (const b of design.blocks) {
    switch (b.type) {
      case "heading":
        parts.push(`<h1>${esc(b.text ?? "")}</h1>`);
        break;
      case "text":
        for (const line of String(b.text ?? "").split(/\n+/)) {
          if (line.trim()) parts.push(`<p>${esc(line)}</p>`);
        }
        break;
      case "button":
        if (b.label)
          parts.push(
            `<p><a href="${esc(b.href ?? "#")}"><strong>${esc(b.label)}</strong></a></p>`,
          );
        break;
      case "price":
        parts.push(
          `<p><strong>${esc(b.label ?? "")}</strong> ${
            b.text ? `<s>${esc(b.text)}</s>` : ""
          }</p>`,
        );
        break;
      case "deadline":
        if (b.text) parts.push(`<p><strong>${esc(b.text)}</strong></p>`);
        if (b.label) parts.push(`<p>${esc(b.label)}</p>`);
        break;
      case "hero":
      case "image":
        if (b.imageUrl)
          parts.push(`<img src="${esc(b.imageUrl)}" alt="${esc(b.alt ?? "")}"/>`);
        break;
      case "divider":
        parts.push("<hr/>");
        break;
      // header/footer/spacer: the brand frame handles chrome now
      default:
        break;
    }
  }
  return parts.join("\n") || "<p></p>";
}

const NEW_BODY =
  "<p>Hi <span data-token=\"first_name\"></span>,</p><p></p><p></p><p>With love,<br/><span data-token=\"brand_name\"></span></p>";

function TemplateEditor({
  template,
  onClose,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
}) {
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const shellQ = useFrameShell();
  const isNew = !template;

  // Decide how the stored body opens:
  //  • rich/plain HTML → straight into the editor
  //  • old block-studio design → converted to rich text
  //  • full HTML document (seeded premium templates) → read-only, with an
  //    explicit "rewrite" escape hatch so nothing is mangled silently.
  const stored = template?.html_body ?? "";
  const legacyDesign = useMemo(() => parseDesign(stored), [stored]);
  const legacyDocument = !legacyDesign && isFullDocument(stored);

  const [displayName, setDisplayName] = useState(template?.display_name ?? "");
  const [subject, setSubject] = useState(template?.subject_line ?? "");
  const [status, setStatus] = useState<EmailTemplate["status"]>(
    template?.status ?? "draft",
  );
  const [rewriting, setRewriting] = useState(false);
  const [body, setBody] = useState<string>(() => {
    if (isNew) return NEW_BODY.replace(/<span data-token="(\w+)"><\/span>/g, "{{$1}}");
    if (legacyDesign) return designToRichHtml(legacyDesign);
    if (legacyDocument) return "";
    return stored;
  });
  const richMode = !legacyDocument || rewriting;

  const busy = create.isPending || update.isPending;
  const error = create.isError || update.isError;

  const previewHtml = useMemo(() => {
    if (legacyDocument && !rewriting) return fillSample(stored);
    return composeFramedPreview(shellQ.data, body);
  }, [legacyDocument, rewriting, stored, shellQ.data, body]);

  function save() {
    const html_body = richMode ? body : stored;
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

  const canSave = !!displayName && !!subject && !busy && (richMode ? body.trim() !== "" : true);

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={isNew ? "New template" : "Edit template"}
      subtitle={isNew ? "Write the mail — the brand frame is added for you" : template?.template_key}
      footer={
        <>
          {error && (
            <p className="text-[12px] text-danger mr-auto">
              Couldn&rsquo;t save the template.
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={save}
            icon={
              busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )
            }
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-2 gap-5 p-1">
        <div className="space-y-4 min-w-0">
          <Field label="Template name">
            <Input
              value={displayName}
              onChange={setDisplayName}
              placeholder="June drop announcement"
            />
          </Field>
          <Field label="Subject line (what lands in the inbox)">
            <Input
              value={subject}
              onChange={setSubject}
              placeholder="Something new just landed ✨"
            />
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

          {richMode ? (
            <Field label="The mail">
              <RichMailEditor value={body} onChange={setBody} />
              <p className="text-[11px] text-text-faint mt-1.5">
                <Sparkles className="w-3 h-3 inline mr-1 text-accent-glow" />
                Use <span className="text-text-muted font-medium">Personalise</span> to
                greet each customer by name. Logo, colours and the unsubscribe
                footer are added automatically.
              </p>
            </Field>
          ) : (
            <div className="rounded-xl border border-line p-3.5 space-y-2">
              <div className="micro inline-flex items-center gap-1.5">
                <LayoutTemplate className="w-3.5 h-3.5 text-accent-glow" />
                Designed template
              </div>
              <p className="text-[12.5px] text-text-muted">
                This is one of the pre-designed templates. You can rename it,
                change the subject, and send it as-is — or rewrite it as a
                simple mail in the editor.
              </p>
              <Button size="sm" variant="secondary" onClick={() => { setRewriting(true); setBody(""); }}>
                Rewrite in the mail editor
              </Button>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="micro mb-1.5">
            Preview — exactly what recipients see
          </div>
          <MailPreviewFrame html={previewHtml} className="w-full h-[380px] lg:h-[560px] rounded-[13px] border border-line bg-white" />
        </div>
      </div>
    </Drawer>
  );
}

/* ════════════════════════════════════════════════════════════
   DESIGN — the brand frame (header + footer) config
   ════════════════════════════════════════════════════════════ */

const SAMPLE_BODY =
  "<p>Hi {{first_name}},</p><p>This is how every campaign mail is framed — your header above, your footer below. Write the middle in Templates.</p>";

export function DesignTab() {
  const { can } = useAuthStore();
  const frameQ = useEmailFrame();
  const shellQ = useFrameShell();
  const save = useSaveEmailFrame();
  const [draft, setDraft] = useState<EmailFrame | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (frameQ.data && !draft) setDraft(frameQ.data.frame);
  }, [frameQ.data, draft]);

  const canEdit = can("email_campaigns", "edit");
  const previewHtml = useMemo(
    () => composeFramedPreview(shellQ.data, SAMPLE_BODY),
    [shellQ.data],
  );

  if (frameQ.isLoading || !draft) {
    return (
      <Card className="p-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 44 }} />
        ))}
      </Card>
    );
  }
  if (frameQ.isError) return <ErrorState onRetry={() => frameQ.refetch()} />;

  const set = (patch: Partial<EmailFrame>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="space-y-4 min-w-0">
        <p className="text-[13px] text-text-muted">
          Every campaign mail is wrapped in this header and footer — already
          styled with your logo, address and unsubscribe link from Settings.
          Only touch it when you want to.
        </p>

        <Card className="p-4 space-y-3.5">
          <div className="micro">Header</div>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Show the brand logo
            <Toggle
              checked={draft.show_logo}
              onChange={(v) => set({ show_logo: v })}
              disabled={!canEdit}
            />
          </label>
          <Field label="Tagline under the logo (optional)">
            <Input
              value={draft.tagline}
              onChange={(v) => set({ tagline: v })}
              placeholder="Luxury hair, delivered"
              disabled={!canEdit}
            />
          </Field>
        </Card>

        <Card className="p-4 space-y-3.5">
          <div className="micro">Footer</div>
          <Field label="Why they're receiving this">
            <textarea
              value={draft.footer_note}
              onChange={(e) => set({ footer_note: e.target.value })}
              rows={2}
              disabled={!canEdit}
              className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2 text-[13px] outline-none focus:border-accent/50 resize-y disabled:opacity-60"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Show the business address
            <Toggle
              checked={draft.show_address}
              onChange={(v) => set({ show_address: v })}
              disabled={!canEdit}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Show website &amp; support email
            <Toggle
              checked={draft.show_contact}
              onChange={(v) => set({ show_contact: v })}
              disabled={!canEdit}
            />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Instagram link (optional)">
              <Input
                value={draft.instagram_url}
                onChange={(v) => set({ instagram_url: v })}
                placeholder="https://instagram.com/…"
                disabled={!canEdit}
              />
            </Field>
            <Field label="TikTok link (optional)">
              <Input
                value={draft.tiktok_url}
                onChange={(v) => set({ tiktok_url: v })}
                placeholder="https://tiktok.com/@…"
                disabled={!canEdit}
              />
            </Field>
          </div>
        </Card>

        {save.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t save.</p>
        )}
        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            {saved && !save.isPending && (
              <span className="text-[12px] text-success">
                Saved — every future mail uses this.
              </span>
            )}
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(draft, { onSuccess: () => setSaved(true) })
              }
              icon={
                save.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )
              }
            >
              Save header &amp; footer
            </Button>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="micro mb-1.5">Preview (updates when you save)</div>
        <MailPreviewFrame html={previewHtml} />
      </div>
    </div>
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
  const [viewing, setViewing] = useState<{
    name: string;
    filter: Record<string, unknown>;
  } | null>(null);
  const segments = segmentsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-text-muted">
          Saved audiences. A campaign builds its recipient list from a segment.
        </p>
        {can("email_campaigns", "create") && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setCreating(true)}
          >
            New segment
          </Button>
        )}
      </div>

      {segmentsQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 44 }} />
          ))}
        </Card>
      ) : segmentsQ.isError ? (
        <ErrorState onRetry={() => segmentsQ.refetch()} />
      ) : segments.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7" />}
          title="No segments"
          message="Create a saved audience to target with campaigns."
          action={
            can("email_campaigns", "create") ? (
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setCreating(true)}
              >
                New segment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {segments.map((s, i) => (
            <div
              key={s.segment_id}
              className={`p-4 flex items-center gap-3 ${
                i < segments.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Users className="w-4 h-4" />
              </span>
              <button
                className="flex-1 min-w-0 text-left"
                onClick={() =>
                  setViewing({ name: s.name, filter: s.filter ?? {} })
                }
              >
                <div className="font-medium text-[13.5px] truncate">
                  {s.name}
                </div>
                {s.description && (
                  <div className="text-[11.5px] text-text-faint truncate">
                    {s.description}
                  </div>
                )}
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setViewing({ name: s.name, filter: s.filter ?? {} })
                }
              >
                Who&rsquo;s in
              </Button>
              {can("email_campaigns", "delete") && (
                <button
                  onClick={() =>
                    window.confirm(`Delete segment "${s.name}"?`) &&
                    del.mutate(s.segment_id)
                  }
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
      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={`Audience · ${viewing.name}`}
        >
          <AudiencePreview filter={viewing.filter} alwaysOpen />
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

/** Debounce a changing value (for the live audience count). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Live who's-in preview for a filter: big count + expandable people list. */
function AudiencePreview({
  filter,
  alwaysOpen = false,
}: {
  filter: Record<string, unknown>;
  alwaysOpen?: boolean;
}) {
  const debounced = useDebounced(filter, 450);
  const previewQ = usePreviewAudience(debounced);
  const [open, setOpen] = useState(alwaysOpen);
  const data = previewQ.data;

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/[0.05] overflow-hidden">
      <div className="p-3 flex items-center gap-3">
        <Users className="w-4 h-4 text-accent-glow shrink-0" />
        <div className="flex-1 text-[13px]">
          {previewQ.isLoading || previewQ.isFetching ? (
            <span className="inline-flex items-center gap-2 text-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Counting…
            </span>
          ) : previewQ.isError ? (
            <span className="text-text-muted">
              Couldn&rsquo;t count this audience.
            </span>
          ) : (
            <>
              <span className="font-display text-[22px] tabular-nums align-middle">
                {(data?.count ?? 0).toLocaleString()}
              </span>
              <span className="text-text-muted ml-2">
                emailable contact{(data?.count ?? 0) === 1 ? "" : "s"} will get
                this
              </span>
            </>
          )}
        </div>
        {!alwaysOpen && (data?.count ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent-glow hover:underline shrink-0"
          >
            See who&rsquo;s in
            {open ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
      {open && data && (
        <div className="border-t border-line/60 max-h-52 overflow-y-auto">
          {data.sample.length === 0 ? (
            <p className="p-3 text-[12.5px] text-text-faint italic">
              No contacts match these filters.
            </p>
          ) : (
            <>
              {data.sample.map((c, idx) => (
                <div
                  key={c.contact_id}
                  className={`px-3 py-2 flex items-center justify-between gap-2 text-[12.5px] ${
                    idx < data.sample.length - 1 ? "border-b border-line/60" : ""
                  }`}
                >
                  <span className="truncate">{c.display_name || "—"}</span>
                  <span className="text-text-faint font-mono text-[11px] truncate">
                    {c.email}
                  </span>
                </div>
              ))}
              {data.count > data.sample.length && (
                <p className="px-3 py-2 text-[11.5px] text-text-faint">
                  …and {(data.count - data.sample.length).toLocaleString()} more
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

  const filter = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (contactTypes.length) f.contact_type = contactTypes;
    if (priorities.length) f.priority_level = priorities;
    const tagList = tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length) f.tag_names = tagList;
    if (minSpend && Number(minSpend) > 0) f.min_lifetime_spend = Number(minSpend);
    if (purchasedDays) f.purchased_within_days = Number(purchasedDays);
    if (birthdayDays && Number(birthdayDays) > 0)
      f.birthday_within_days = Number(birthdayDays);
    return f;
  }, [contactTypes, priorities, tags, minSpend, purchasedDays, birthdayDays]);

  const digits = (s: string) => s.replace(/[^0-9]/g, "");

  return (
    <Modal
      open
      onClose={onClose}
      title="New segment"
      footer={
        <>
          {save.isError && (
            <p className="text-[12px] text-danger mr-auto">
              Couldn&rsquo;t save.
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name || save.isPending}
            onClick={() =>
              save.mutate(
                { name, description: description || undefined, filter },
                { onSuccess: onClose },
              )
            }
            icon={
              save.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )
            }
          >
            Create segment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={setName} placeholder="Lagos VIPs" />
        </Field>
        <Field label="Description (optional)">
          <Input
            value={description}
            onChange={setDescription}
            placeholder="VIP customers who bought recently"
          />
        </Field>

        <div className="rounded-xl border border-line p-3 space-y-3">
          <div className="micro">
            Filters — leave empty to target all emailable contacts
          </div>
          <Field label="Contact type">
            <MultiSelect
              values={contactTypes}
              onChange={setContactTypes}
              options={CONTACT_TYPE_OPTIONS}
            />
          </Field>
          <Field label="Priority">
            <MultiSelect
              values={priorities}
              onChange={setPriorities}
              options={PRIORITY_OPTIONS}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <Input value={tags} onChange={setTags} placeholder="loyal, wholesale" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Bought within">
              <Select
                value={purchasedDays}
                onChange={setPurchasedDays}
                options={PURCHASED_OPTIONS}
              />
            </Field>
            <Field label="Min lifetime spend (₦)">
              <input
                value={minSpend}
                onChange={(e) => setMinSpend(digits(e.target.value))}
                placeholder="0"
                inputMode="numeric"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 tabular-nums" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
            </Field>
          </div>
          <Field label="Birthday within (days)">
            <input
              value={birthdayDays}
              onChange={(e) => setBirthdayDays(digits(e.target.value))}
              placeholder="e.g. 7"
              inputMode="numeric"
              className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 tabular-nums" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
        </div>

        {/* Live who's-in — updates as filters change, before anything is saved */}
        <AudiencePreview filter={filter} />
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════
   CAMPAIGN DETAIL SECTIONS (audience + sale + A/B)
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
          <div className="flex flex-col sm:flex-row gap-2">
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
              icon={
                fromSegment.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Users className="w-4 h-4" />
                )
              }
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
            <p className="text-[12px] text-success">
              Added {lastAdded.toLocaleString()} recipients.
            </p>
          )}
          {(fromSegment.isError || allContacts.isError) && (
            <p className="text-[12px] text-danger">
              Couldn&rsquo;t build the audience.
            </p>
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

/** Mirror of the server's countdown (email-render.js) so the builder previews
 *  exactly what recipients will read. */
function previewCountdown(iso: string): string {
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return "";
  const ms = end - Date.now();
  const hours = ms / 3_600_000;
  if (ms <= 0) return "Last chance";
  if (hours <= 24) return "Final hours — ends today";
  const days = Math.max(1, Math.round(hours / 24));
  return days <= 1 ? "Only 1 day left" : `Only ${days} days left`;
}

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local wants YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sale details a campaign carries — discount, link and end date — which the
 *  Sale Announcement template turns into the countdown, price framing and CTA. */
export function CampaignSaleSection({ campaign }: { campaign: EmailCampaign }) {
  const { can } = useAuthStore();
  const update = useUpdateEmailCampaign(campaign.campaign_id);
  const md = (campaign.merge_data ?? {}) as CampaignMergeData;
  const [discount, setDiscount] = useState(md.discount ? String(md.discount) : "");
  const [saleUrl, setSaleUrl] = useState(md.sale_url ? String(md.sale_url) : "");
  const [endsAt, setEndsAt] = useState(toLocalInput(md.sale_ends_at));
  const [saved, setSaved] = useState(false);

  const editable = campaign.status === "draft" || campaign.status === "scheduled";
  if (!can("email_campaigns", "edit")) return null;

  const countdownPreview = endsAt ? previewCountdown(new Date(endsAt).toISOString()) : "";

  function save() {
    setSaved(false);
    update.mutate(
      {
        merge_data: {
          ...md,
          discount: discount || undefined,
          sale_url: saleUrl || undefined,
          sale_ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
        },
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <div className="rounded-xl border border-line p-3 space-y-2.5">
      <div className="micro inline-flex items-center gap-1.5">
        <Tag className="w-3.5 h-3.5 text-accent-glow" /> Sale details
      </div>
      {editable ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Discount %">
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder="30"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 tabular-nums" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
            </Field>
            <Field label="Ends at">
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
              />
            </Field>
          </div>
          <Field label="Sale link (where the button goes)">
            <Input value={saleUrl} onChange={setSaleUrl} placeholder="pixiegirlglobal.com/sale" />
          </Field>
          {countdownPreview && (
            <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <Clock className="w-3.5 h-3.5 text-accent-glow" />
              Recipients will see: <span className="text-text-primary font-medium">⏳ {countdownPreview}</span>
            </div>
          )}
          <p className="text-[11px] text-text-faint">
            Feeds the mail&rsquo;s countdown, discount and button. The logo and
            colours come from Settings automatically.
          </p>
          {update.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t save.</p>}
          <div className="flex items-center justify-end gap-2">
            {saved && !update.isPending && <span className="text-[12px] text-success">Saved.</span>}
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending}
              onClick={save}
              icon={update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            >
              Save sale details
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[12px] text-text-faint">
          {md.discount ? `Up to ${md.discount}% off` : "No sale details"}
          {md.sale_ends_at && ` · ends ${formatDate(md.sale_ends_at)}`}
          {" · "}locked once the campaign leaves draft.
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
            <div className="flex gap-2 items-center flex-wrap">
              <input
                value={alloc}
                onChange={(e) => setAlloc(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Allocation %"
                className="w-28 h-[38px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50 tabular-nums" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 disabled:opacity-60" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
    />
  );
}
