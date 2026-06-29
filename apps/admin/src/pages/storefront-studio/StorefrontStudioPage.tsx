/**
 * Storefront Studio - controls the customer-facing Storefront Website's
 * appearance (theme, branding, navigation, pages/sections, popups) with a
 * draft -> publish flow and one-click revision rollback. Renders inside the
 * app shell like every other module. Brand from the active business store.
 *
 * No-code by design: like the Landing Studio, everything is edited with
 * friendly labelled controls (colour pickers, sliders, toggles, image
 * uploads, structured list editors) - never raw JSON. The people running the
 * shops are not developers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/cn";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Tabs } from "@/pages/stock/parts";
import { useBusinessStore } from "@/stores/business";
import {
  useThemes,
  useSaveThemeDraft,
  usePublishTheme,
  useNavigation,
  useSaveNavDraft,
  usePublishNav,
  usePages,
  useSavePageDraft,
  usePublishPage,
  usePopups,
  useSavePopupDraft,
  usePublishPopup,
  useDeletePopup,
  useSectionTemplates,
  uploadStorefrontImage,
  usePreviewInfo,
  useRevisions,
  useRollbackRevision,
  pickActive,
  type PageRow,
  type PopupRow,
  type NavRow,
  type StudioStatus,
} from "@/lib/storefront-studio";

type Tab =
  | "theme"
  | "branding"
  | "navigation"
  | "pages"
  | "popups"
  | "preview"
  | "revisions";

const TABS: { key: Tab; label: string }[] = [
  { key: "theme", label: "Theme" },
  { key: "branding", label: "Branding" },
  { key: "navigation", label: "Navigation" },
  { key: "pages", label: "Pages" },
  { key: "popups", label: "Popups" },
  { key: "preview", label: "Preview" },
  { key: "revisions", label: "Revisions" },
];

const inputCls =
  "w-full rounded-[10px] border border-line bg-text-primary/[0.04] px-3 py-2 text-[13px] text-text-primary outline-none transition focus:border-accent-deep";
const labelCls = "mb-1 block text-[12px] font-medium text-text-muted";

function Status({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="mt-3 text-[13px] text-text-muted">{msg}</p>;
}

function StatusPill({ status }: { status?: StudioStatus }) {
  if (!status) return null;
  return (
    <Pill tone={status === "published" ? "success" : "neutral"} dot={false}>
      {status}
    </Pill>
  );
}

export function StorefrontStudioPage() {
  const brand = useBusinessStore((s) => s.activeKey);
  const [tab, setTab] = useState<Tab>("theme");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as Tab)} />
        <Pill tone="accent" dot={false}>
          {brand}
        </Pill>
      </div>

      <div>
        {tab === "theme" ? <ThemeTab /> : null}
        {tab === "branding" ? <BrandingTab /> : null}
        {tab === "navigation" ? <NavigationTab /> : null}
        {tab === "pages" ? <PagesTab /> : null}
        {tab === "popups" ? <PopupsTab /> : null}
        {tab === "preview" ? <PreviewTab /> : null}
        {tab === "revisions" ? <RevisionsTab /> : null}
      </div>
    </div>
  );
}

// ============================================================
// Friendly control primitives (no JSON, ever)
// ============================================================

function Section({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-[12px] border border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center justify-between px-4 text-left text-[13px] font-semibold text-text-primary hover:bg-text-primary/[0.03]"
      >
        <span>{title}</span>
        <span className="text-text-muted">{open ? "-" : "+"}</span>
      </button>
      {open ? (
        <div className="space-y-3 px-4 pb-4">
          {hint ? <p className="text-[12px] text-text-muted">{hint}</p> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function AreaField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <textarea
        className={cn(inputCls, "resize-y")}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <select
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // The colour picker only understands hex; if the saved value is something
  // else (e.g. an oklch token) the swatch shows a neutral default but the
  // text field still carries the real value so nothing is lost.
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : "#690909";
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-[8px] border border-line bg-transparent"
        />
        <input
          className={cn(inputCls, "font-mono uppercase")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 0.05,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className={labelCls}>
        {label}: {value}
        {suffix}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent-deep"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-1"
    >
      <span className="text-[13px] text-text-primary">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-accent-deep" : "bg-text-primary/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadStorefrontImage(file));
    } catch {
      setErr("Upload failed - try again or paste a URL.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex items-start gap-2">
        <div className="grid h-[60px] w-[60px] shrink-0 place-items-center overflow-hidden rounded-[8px] border border-line bg-text-primary/[0.04]">
          {value ? (
            <img src={value} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-[10px] text-text-muted">none</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Uploading..." : "Upload"}
            </Button>
            {value ? (
              <Button variant="ghost" size="sm" onClick={() => onChange("")}>
                Remove
              </Button>
            ) : null}
          </div>
          <input
            className={inputCls}
            value={value}
            placeholder="...or paste an image URL"
            onChange={(e) => onChange(e.target.value)}
          />
          {err ? <p className="text-[11px] text-danger">{err}</p> : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}

/** Drag-and-drop list wrapper. `ids` are stable-per-position keys; onReorder
 *  receives the from/to indices to apply via arrayMove. */
function DragList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(from, to);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** A draggable card with a handle, a title, and an optional Remove button. */
function SortableCard({
  id,
  title,
  onRemove,
  children,
}: {
  id: string;
  title: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="space-y-2 rounded-[10px] border border-line bg-text-primary/[0.03] p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none px-1 text-text-muted hover:text-text-primary active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <span className="text-[12px] font-medium text-text-muted">{title}</span>
        </div>
        {onRemove ? (
          <button
            onClick={onRemove}
            className="text-xs text-text-muted hover:text-danger"
          >
            Remove
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Theme - colours, fonts, corners (no JSON)
// ============================================================

const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: '"Work Sans Variable", system-ui, sans-serif', label: "Work Sans (modern sans)" },
  { value: '"Inter", system-ui, sans-serif', label: "Inter (clean sans)" },
  { value: '"Montserrat", system-ui, sans-serif', label: "Montserrat (geometric sans)" },
  { value: '"Poppins", system-ui, sans-serif', label: "Poppins (rounded sans)" },
  { value: '"Playfair Display", Georgia, serif', label: "Playfair Display (elegant serif)" },
  { value: '"Cormorant Garamond", Georgia, serif', label: "Cormorant (luxury serif)" },
  { value: "system-ui, sans-serif", label: "System default" },
];

function fontOptionsWith(current: string) {
  if (!current || FONT_OPTIONS.some((o) => o.value === current)) {
    return FONT_OPTIONS;
  }
  return [{ value: current, label: "Current (custom)" }, ...FONT_OPTIONS];
}

function remNumber(value: string | undefined): number {
  const n = parseFloat(String(value ?? "").replace("rem", ""));
  return Number.isFinite(n) ? n : 0.5;
}

function ThemeTab() {
  const { data, isLoading } = useThemes();
  const save = useSaveThemeDraft();
  const publish = usePublishTheme();
  const active = pickActive(data);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (active) setTokens(active.tokens || {});
  }, [active]);

  const set = (k: string, v: string) =>
    setTokens((t) => ({ ...t, [k]: v }));

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-text-primary">
          Theme
        </h2>
        <StatusPill status={active?.status} />
      </div>
      <p className="text-[13px] text-text-muted">
        Pick the colours, fonts and corner roundness for your website. Changes
        save as a draft; press Publish to make them live.
      </p>

      <Section title="Colours" defaultOpen>
        <ColorField
          label="Primary colour"
          value={tokens["--color-primary"] || ""}
          onChange={(v) => set("--color-primary", v)}
        />
        <ColorField
          label="Accent colour"
          value={tokens["--color-accent"] || ""}
          onChange={(v) => set("--color-accent", v)}
        />
      </Section>

      <Section title="Fonts">
        <SelectField
          label="Headings font"
          value={tokens["--font-heading"] || ""}
          onChange={(v) => set("--font-heading", v)}
          options={fontOptionsWith(tokens["--font-heading"] || "")}
        />
        <SelectField
          label="Body text font"
          value={tokens["--font-body"] || ""}
          onChange={(v) => set("--font-body", v)}
          options={fontOptionsWith(tokens["--font-body"] || "")}
        />
      </Section>

      <Section title="Corners">
        <RangeField
          label="Corner roundness"
          value={remNumber(tokens["--radius"])}
          min={0}
          max={1.5}
          step={0.05}
          suffix="rem"
          onChange={(v) => set("--radius", `${v}rem`)}
        />
      </Section>

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={async () => {
            await save.mutateAsync(tokens);
            setMsg("Draft saved.");
          }}
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={publish.isPending}
          onClick={async () => {
            await publish.mutateAsync();
            setMsg("Theme published.");
          }}
        >
          Publish
        </Button>
      </div>
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Branding (logo / favicon / OG -> theme tokens)
// ============================================================

function BrandingTab() {
  const { data, isLoading } = useThemes();
  const save = useSaveThemeDraft();
  const publish = usePublishTheme();
  const active = pickActive(data);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (active) setTokens(active.tokens || {});
  }, [active]);

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  const rows = [
    { key: "--logo-url", label: "Logo" },
    { key: "--favicon-url", label: "Favicon (a square logo works best)" },
    { key: "--og-image", label: "Share image (shown when the link is posted)" },
  ];
  return (
    <Card className="max-w-xl space-y-5 p-5">
      <p className="text-[13px] text-text-muted">
        Upload your logo, favicon and link-share image. Save as a draft, then
        Publish to go live.
      </p>
      {rows.map((r) => (
        <ImageField
          key={r.key}
          label={r.label}
          value={tokens[r.key] || ""}
          onChange={(v) => setTokens((t) => ({ ...t, [r.key]: v }))}
        />
      ))}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={async () => {
            await save.mutateAsync(tokens);
            setMsg("Draft saved.");
          }}
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={publish.isPending}
          onClick={async () => {
            await publish.mutateAsync();
            setMsg("Branding published.");
          }}
        >
          Publish
        </Button>
      </div>
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Navigation - header links, footer columns, socials (no JSON)
// ============================================================

type NavLink = { label: string; href: string };
type FooterCol = { title: string; links: NavLink[] };

const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "facebook",
  "twitter",
  "youtube",
  "whatsapp",
];

function NavigationTab() {
  const { data, isLoading } = useNavigation();
  const save = useSaveNavDraft();
  const publish = usePublishNav();
  const active = pickActive(data);

  const [header, setHeader] = useState<NavLink[]>([]);
  const [footer, setFooter] = useState<FooterCol[]>([]);
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (active) {
      setHeader((active.header_items as NavLink[]) || []);
      setFooter((active.footer_columns as FooterCol[]) || []);
      setSocials((active.socials as Record<string, string>) || {});
    }
  }, [active]);

  async function onSave() {
    const nav: NavRow = {
      header_items: header,
      footer_columns: footer,
      socials,
    };
    await save.mutateAsync(nav);
    setMsg("Draft saved.");
  }

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <p className="text-[13px] text-text-muted">
        Set the menu links in your header, the columns in your footer, and your
        social profiles. Save as a draft, then Publish.
      </p>

      <Section title="Header menu" defaultOpen>
        <DragList
          ids={header.map((_, i) => `hdr-${i}`)}
          onReorder={(from, to) =>
            setHeader((h) => arrayMove(h, from, to))
          }
        >
          {header.map((item, i) => (
            <SortableCard
              key={`hdr-${i}`}
              id={`hdr-${i}`}
              title={`Link ${i + 1}`}
              onRemove={() => setHeader((h) => h.filter((_, j) => j !== i))}
            >
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Label"
                  value={item.label}
                  placeholder="Shop"
                  onChange={(v) =>
                    setHeader((h) =>
                      h.map((x, j) => (j === i ? { ...x, label: v } : x)),
                    )
                  }
                />
                <TextField
                  label="Link (path)"
                  value={item.href}
                  placeholder="/shop"
                  onChange={(v) =>
                    setHeader((h) =>
                      h.map((x, j) => (j === i ? { ...x, href: v } : x)),
                    )
                  }
                />
              </div>
            </SortableCard>
          ))}
        </DragList>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() =>
            setHeader((h) => [...h, { label: "", href: "/" }])
          }
        >
          + Add menu link
        </Button>
      </Section>

      <Section title="Footer columns">
        <DragList
          ids={footer.map((_, i) => `col-${i}`)}
          onReorder={(from, to) =>
            setFooter((f) => arrayMove(f, from, to))
          }
        >
          {footer.map((col, ci) => (
            <SortableCard
              key={`col-${ci}`}
              id={`col-${ci}`}
              title={`Column ${ci + 1}`}
              onRemove={() => setFooter((f) => f.filter((_, j) => j !== ci))}
            >
              <TextField
                label="Column title"
                value={col.title}
                placeholder="Help"
                onChange={(v) =>
                  setFooter((f) =>
                    f.map((x, j) => (j === ci ? { ...x, title: v } : x)),
                  )
                }
              />
              <div className="border-l border-line pl-3">
                <DragList
                  ids={(col.links || []).map((_, k) => `col-${ci}-lnk-${k}`)}
                  onReorder={(from, to) =>
                    setFooter((f) =>
                      f.map((x, j) =>
                        j === ci
                          ? { ...x, links: arrayMove(x.links, from, to) }
                          : x,
                      ),
                    )
                  }
                >
                  {(col.links || []).map((lk, li) => (
                    <SortableCard
                      key={`col-${ci}-lnk-${li}`}
                      id={`col-${ci}-lnk-${li}`}
                      title={`Link ${li + 1}`}
                      onRemove={() =>
                        setFooter((f) =>
                          f.map((x, j) =>
                            j === ci
                              ? {
                                  ...x,
                                  links: x.links.filter((_, k) => k !== li),
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <TextField
                          label="Label"
                          value={lk.label}
                          onChange={(v) =>
                            setFooter((f) =>
                              f.map((x, j) =>
                                j === ci
                                  ? {
                                      ...x,
                                      links: x.links.map((y, k) =>
                                        k === li ? { ...y, label: v } : y,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <TextField
                          label="Link"
                          value={lk.href}
                          onChange={(v) =>
                            setFooter((f) =>
                              f.map((x, j) =>
                                j === ci
                                  ? {
                                      ...x,
                                      links: x.links.map((y, k) =>
                                        k === li ? { ...y, href: v } : y,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </SortableCard>
                  ))}
                </DragList>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setFooter((f) =>
                      f.map((x, j) =>
                        j === ci
                          ? {
                              ...x,
                              links: [...(x.links || []), { label: "", href: "/" }],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  + Add link
                </Button>
              </div>
            </SortableCard>
          ))}
        </DragList>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() =>
            setFooter((f) => [...f, { title: "", links: [] }])
          }
        >
          + Add footer column
        </Button>
      </Section>

      <Section title="Social profiles">
        {SOCIAL_PLATFORMS.map((p) => (
          <TextField
            key={p}
            label={p.charAt(0).toUpperCase() + p.slice(1)}
            value={socials[p] || ""}
            placeholder="https://..."
            onChange={(v) => setSocials((s) => ({ ...s, [p]: v }))}
          />
        ))}
      </Section>

      <div className="flex gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={onSave}>
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={publish.isPending}
          onClick={async () => {
            await publish.mutateAsync();
            setMsg("Navigation published.");
          }}
        >
          Publish
        </Button>
      </div>
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Pages + section composer (no JSON)
// ============================================================

type SectionFieldKind = "text" | "area" | "image";
type SectionFieldDef = { key: string; label: string; kind: SectionFieldKind };

const SECTION_SCHEMA: Record<
  string,
  { label: string; fields: SectionFieldDef[] }
> = {
  hero: {
    label: "Hero banner",
    fields: [
      { key: "subheading", label: "Eyebrow / subheading", kind: "text" },
      { key: "heading", label: "Headline", kind: "text" },
      { key: "body", label: "Body text", kind: "area" },
      { key: "cta_label", label: "Button label", kind: "text" },
      { key: "cta_href", label: "Button link", kind: "text" },
      { key: "image_url", label: "Background image", kind: "image" },
    ],
  },
  editorial: {
    label: "Editorial (image + text)",
    fields: [
      { key: "heading", label: "Headline", kind: "text" },
      { key: "body", label: "Body text", kind: "area" },
      { key: "image_url", label: "Image", kind: "image" },
      { key: "cta_label", label: "Button label", kind: "text" },
      { key: "cta_href", label: "Button link", kind: "text" },
    ],
  },
  product_grid: {
    label: "Product grid",
    fields: [{ key: "heading", label: "Section heading", kind: "text" }],
  },
  banner: {
    label: "Announcement banner",
    fields: [{ key: "text", label: "Banner text", kind: "text" }],
  },
};

type PageSection = { type: string } & Record<string, string>;

const BLANK_PAGE: PageRow = {
  page_key: "",
  template_key: "home_hero_v1",
  url_path: "/",
  meta_title: "",
  meta_description: "",
  og_image_url: "",
  slots: {},
};

function PagesTab() {
  const { data, isLoading } = usePages();
  const templates = useSectionTemplates();
  const save = useSavePageDraft();
  const publish = usePublishPage();
  const [sel, setSel] = useState<PageRow | null>(null);
  const [sections, setSections] = useState<PageSection[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const pages = useMemo(() => {
    const byKey: Record<string, PageRow> = {};
    for (const p of data || []) {
      if (!byKey[p.page_key] || p.status === "draft") byKey[p.page_key] = p;
    }
    return Object.values(byKey);
  }, [data]);

  function edit(p: PageRow) {
    setSel({ ...p });
    const s = (p.slots as { sections?: PageSection[] } | undefined)?.sections;
    setSections(Array.isArray(s) ? s : []);
    setMsg(null);
  }

  async function onSave() {
    if (!sel) return;
    await save.mutateAsync({ ...sel, slots: { sections } });
    setMsg("Draft saved.");
  }

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <div className="grid grid-cols-[220px_1fr] gap-5">
      <Card className="p-3">
        <Button
          variant="secondary"
          size="sm"
          className="mb-3 w-full"
          onClick={() => edit(BLANK_PAGE)}
        >
          + New page
        </Button>
        <ul className="space-y-1">
          {pages.map((p) => (
            <li key={p.page_key}>
              <button
                onClick={() => edit(p)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px]",
                  sel?.page_key === p.page_key
                    ? "bg-text-primary/[0.07] text-text-primary"
                    : "text-text-muted hover:bg-text-primary/[0.04] hover:text-text-primary",
                )}
              >
                <span>{p.page_key || "(unnamed)"}</span>
                <StatusPill status={p.status} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {sel ? (
        <Card className="max-w-2xl space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Page name (key)"
              value={sel.page_key}
              placeholder="home"
              onChange={(v) => setSel({ ...sel, page_key: v })}
            />
            <TextField
              label="URL path"
              value={sel.url_path}
              placeholder="/"
              onChange={(v) => setSel({ ...sel, url_path: v })}
            />
          </div>

          <Section title="Search & sharing (SEO)">
            <TextField
              label="Search title"
              value={sel.meta_title || ""}
              onChange={(v) => setSel({ ...sel, meta_title: v })}
            />
            <AreaField
              label="Search description"
              value={sel.meta_description || ""}
              onChange={(v) => setSel({ ...sel, meta_description: v })}
            />
            <ImageField
              label="Share image"
              value={sel.og_image_url || ""}
              onChange={(v) => setSel({ ...sel, og_image_url: v })}
            />
          </Section>

          <div>
            <label className={cn(labelCls, "text-[13px] text-text-primary")}>
              Page sections
            </label>
            <p className="mb-2 text-[12px] text-text-muted">
              Build the page by stacking sections. Drag the handle (::) to
              reorder them.
            </p>
            <SectionComposer
              sections={sections}
              onChange={setSections}
              templates={templates.data}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="primary" disabled={save.isPending} onClick={onSave}>
              Save draft
            </Button>
            <Button
              variant="secondary"
              disabled={!sel.page_key || publish.isPending}
              onClick={async () => {
                await publish.mutateAsync(sel.page_key);
                setMsg("Page published.");
              }}
            >
              Publish
            </Button>
          </div>
          <Status msg={msg} />
        </Card>
      ) : (
        <p className="text-[13px] text-text-muted">
          Select a page to edit, or create a new one.
        </p>
      )}
    </div>
  );
}

function SectionComposer({
  sections,
  onChange,
  templates,
}: {
  sections: PageSection[];
  onChange: (s: PageSection[]) => void;
  templates?: { template_key: string; display_name: string; default_slots: Record<string, unknown> }[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const update = (i: number, key: string, value: string) =>
    onChange(sections.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const remove = (i: number) =>
    onChange(sections.filter((_, idx) => idx !== i));

  // Stable-per-position ids for the sortable list.
  const ids = sections.map((_, i) => `section-${i}`);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(sections, from, to));
  }

  function addType(type: string) {
    onChange([...sections, { type } as PageSection]);
  }
  function addTemplate(t: { default_slots: Record<string, unknown> }) {
    const slots = t.default_slots || {};
    const type = String((slots as { type?: string }).type || "");
    const flat: PageSection = { type } as PageSection;
    for (const [k, v] of Object.entries(slots)) {
      if (k === "type") continue;
      flat[k] = typeof v === "string" ? v : "";
    }
    onChange([...sections, flat]);
  }

  // Prefer the seeded template library; fall back to the built-in schema.
  const addOptions =
    templates && templates.length
      ? templates
          .filter((t) =>
            Boolean((t.default_slots as { type?: string })?.type),
          )
          .map((t) => ({
            label: t.display_name,
            onClick: () => addTemplate(t),
          }))
      : Object.entries(SECTION_SCHEMA).map(([type, def]) => ({
          label: def.label,
          onClick: () => addType(type),
        }));

  return (
    <div className="space-y-3">
      {sections.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-[12px] text-text-muted">
          No sections yet. Add one below to start building the page.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sections.map((s, i) => (
                <SortableSection
                  key={ids[i]}
                  id={ids[i]}
                  section={s}
                  fields={SECTION_SCHEMA[s.type]?.fields || inferFields(s)}
                  title={
                    SECTION_SCHEMA[s.type]?.label || s.type.replace(/_/g, " ")
                  }
                  onUpdate={(key, value) => update(i, key, value)}
                  onRemove={() => remove(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex flex-wrap gap-2">
        {addOptions.map((o) => (
          <Button key={o.label} variant="ghost" size="sm" onClick={o.onClick}>
            + {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SortableSection({
  id,
  section,
  fields,
  title,
  onUpdate,
  onRemove,
}: {
  id: string;
  section: PageSection;
  fields: SectionFieldDef[];
  title: string;
  onUpdate: (key: string, value: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-[10px] border border-line bg-text-primary/[0.03] p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none px-1 text-text-muted hover:text-text-primary active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <span className="text-[13px] font-medium text-text-primary">
            {title}
          </span>
        </div>
        <button
          onClick={onRemove}
          className="text-xs text-text-muted hover:text-danger"
        >
          Remove
        </button>
      </div>
      <div className="space-y-2.5">
        {fields.map((f) => {
          if (f.kind === "area")
            return (
              <AreaField
                key={f.key}
                label={f.label}
                value={section[f.key] || ""}
                onChange={(v) => onUpdate(f.key, v)}
              />
            );
          if (f.kind === "image")
            return (
              <ImageField
                key={f.key}
                label={f.label}
                value={section[f.key] || ""}
                onChange={(v) => onUpdate(f.key, v)}
              />
            );
          return (
            <TextField
              key={f.key}
              label={f.label}
              value={section[f.key] || ""}
              onChange={(v) => onUpdate(f.key, v)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** For a section whose type isn't in the built-in schema, expose its existing
 *  string fields as plain text inputs so nothing is uneditable. */
function inferFields(s: PageSection): SectionFieldDef[] {
  return Object.keys(s)
    .filter((k) => k !== "type")
    .map((k) => ({
      key: k,
      label: k.replace(/_/g, " "),
      kind: k.includes("image") ? "image" : "text",
    }));
}

// ============================================================
// Popups (no JSON)
// ============================================================

const BLANK_POPUP: PopupRow = {
  popup_key: "",
  trigger_type: "time_delay",
  trigger_value: 5,
  audience: "all",
  content: {},
  display_rules: {},
  display_order: 0,
  is_active: true,
};

const FREQUENCY_OPTIONS = [
  { value: "once_per_session", label: "Once per visit" },
  { value: "once_per_day", label: "Once per day" },
  { value: "every_visit", label: "Every page load" },
];

function PopupsTab() {
  const { data, isLoading } = usePopups();
  const save = useSavePopupDraft();
  const publish = usePublishPopup();
  const del = useDeletePopup();
  const [sel, setSel] = useState<PopupRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const popups = useMemo(() => {
    const byKey: Record<string, PopupRow> = {};
    for (const p of data || []) {
      if (!byKey[p.popup_key] || p.status === "draft") byKey[p.popup_key] = p;
    }
    return Object.values(byKey);
  }, [data]);

  function edit(p: PopupRow) {
    setSel({ ...p });
    setMsg(null);
  }

  // Typed helpers over the free-form JSONB columns.
  const content = (sel?.content || {}) as Record<string, string>;
  const rules = (sel?.display_rules || {}) as Record<string, unknown>;
  const setContent = (k: string, v: string) =>
    setSel((p) => (p ? { ...p, content: { ...p.content, [k]: v } } : p));
  const setRule = (k: string, v: unknown) =>
    setSel((p) =>
      p ? { ...p, display_rules: { ...p.display_rules, [k]: v } } : p,
    );

  async function onSave() {
    if (!sel) return;
    await save.mutateAsync(sel);
    setMsg("Draft saved.");
  }

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <div className="grid grid-cols-[220px_1fr] gap-5">
      <Card className="p-3">
        <Button
          variant="secondary"
          size="sm"
          className="mb-3 w-full"
          onClick={() => edit(BLANK_POPUP)}
        >
          + New popup
        </Button>
        <ul className="space-y-1">
          {popups.map((p) => (
            <li key={p.popup_key}>
              <button
                onClick={() => edit(p)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px]",
                  sel?.popup_key === p.popup_key
                    ? "bg-text-primary/[0.07] text-text-primary"
                    : "text-text-muted hover:bg-text-primary/[0.04] hover:text-text-primary",
                )}
              >
                <span>{p.popup_key || "(unnamed)"}</span>
                <StatusPill status={p.status} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {sel ? (
        <Card className="max-w-2xl space-y-4 p-5">
          <TextField
            label="Popup name (key)"
            value={sel.popup_key}
            placeholder="newsletter"
            onChange={(v) => setSel({ ...sel, popup_key: v })}
          />

          <Section title="What it says" defaultOpen>
            <TextField
              label="Heading"
              value={content.heading || ""}
              onChange={(v) => setContent("heading", v)}
            />
            <AreaField
              label="Message"
              value={content.body || ""}
              onChange={(v) => setContent("body", v)}
            />
            <ImageField
              label="Image (optional)"
              value={content.image_url || ""}
              onChange={(v) => setContent("image_url", v)}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label="Button label"
                value={content.button_label || ""}
                onChange={(v) => setContent("button_label", v)}
              />
              <TextField
                label="Button link"
                value={content.button_href || ""}
                onChange={(v) => setContent("button_href", v)}
              />
            </div>
            <TextField
              label="Discount code (optional)"
              value={content.discount_code || ""}
              onChange={(v) => setContent("discount_code", v)}
            />
          </Section>

          <Section title="When it shows" defaultOpen>
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Trigger"
                value={sel.trigger_type}
                onChange={(v) =>
                  setSel({ ...sel, trigger_type: v as PopupRow["trigger_type"] })
                }
                options={[
                  { value: "time_delay", label: "After a delay" },
                  { value: "scroll_depth", label: "After scrolling" },
                  { value: "exit_intent", label: "On exit intent" },
                  { value: "page_load", label: "On page load" },
                  { value: "add_to_cart", label: "On add to cart" },
                ]}
              />
              <label className="block">
                <span className={labelCls}>
                  {sel.trigger_type === "time_delay"
                    ? "Delay (seconds)"
                    : sel.trigger_type === "scroll_depth"
                      ? "Scroll (%)"
                      : "Value"}
                </span>
                <input
                  type="number"
                  className={inputCls}
                  value={sel.trigger_value ?? 0}
                  onChange={(e) =>
                    setSel({
                      ...sel,
                      trigger_value: parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </label>
            </div>
            <SelectField
              label="Who sees it"
              value={sel.audience}
              onChange={(v) =>
                setSel({ ...sel, audience: v as PopupRow["audience"] })
              }
              options={[
                { value: "all", label: "Everyone" },
                { value: "new", label: "New visitors" },
                { value: "returning", label: "Returning visitors" },
                { value: "guest", label: "Guests (not signed in)" },
                { value: "member", label: "Signed-in customers" },
              ]}
            />
            <SelectField
              label="How often"
              value={(rules.frequency as string) || "once_per_session"}
              onChange={(v) => setRule("frequency", v)}
              options={FREQUENCY_OPTIONS}
            />
            <ToggleField
              label="Active"
              checked={sel.is_active}
              onChange={(v) => setSel({ ...sel, is_active: v })}
            />
          </Section>

          <div className="flex gap-2 pt-1">
            <Button variant="primary" disabled={save.isPending} onClick={onSave}>
              Save draft
            </Button>
            <Button
              variant="secondary"
              disabled={!sel.popup_key || publish.isPending}
              onClick={async () => {
                await publish.mutateAsync(sel.popup_key);
                setMsg("Popup published.");
              }}
            >
              Publish
            </Button>
            <Button
              variant="danger"
              disabled={!sel.popup_key || del.isPending}
              onClick={async () => {
                await del.mutateAsync(sel.popup_key);
                setSel(null);
              }}
            >
              Delete
            </Button>
          </div>
          <Status msg={msg} />
        </Card>
      ) : (
        <p className="text-[13px] text-text-muted">
          Select a popup to edit, or create a new one.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Revisions (publish history + rollback)
// ============================================================

function RevisionsTab() {
  const { data, isLoading } = useRevisions();
  const rollback = useRollbackRevision();
  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;
  const revs = data || [];
  return (
    <Card className="max-w-3xl p-5">
      <h2 className="text-[15px] font-semibold text-text-primary">
        Publish history
      </h2>
      <p className="mb-4 mt-1 text-[13px] text-text-muted">
        Every publish is snapshotted. Restore brings a snapshot back as a draft
        to review and re-publish.
      </p>
      {revs.length === 0 ? (
        <p className="text-[13px] text-text-muted">No publishes yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-text-muted">
              <th className="py-2 font-medium">When</th>
              <th className="font-medium">Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {revs.map((r) => (
              <tr key={r.revision_id} className="border-b border-line">
                <td className="py-2 text-text-primary">
                  {new Date(r.published_at).toLocaleString()}
                </td>
                <td className="capitalize text-text-primary">{r.entity_type}</td>
                <td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={rollback.isPending}
                    onClick={async () => {
                      await rollback.mutateAsync(r.revision_id);
                      setMsg("Restored to draft - review and publish.");
                    }}
                  >
                    Restore to draft
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Preview (embedded iframe + open-live)
// ============================================================

function PreviewTab() {
  const { data, isLoading, refetch } = usePreviewInfo();

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading preview...</p>;
  if (!data?.base_url)
    return (
      <Card className="max-w-xl p-5">
        <p className="text-[13px] text-text-muted">
          Set this brand's storefront domain in Business settings to enable
          preview.
        </p>
      </Card>
    );

  const url = `${data.base_url.replace(/\/$/, "")}/?preview=${encodeURIComponent(
    data.token,
  )}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-text-muted">
          Live draft preview - shows unpublished changes. The preview link
          expires in ~30 minutes.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(url, "_blank", "noopener")}
          >
            Open live preview
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden p-0">
        <iframe
          title="Storefront preview"
          src={url}
          className="h-[70vh] w-full border-0 bg-white"
        />
      </Card>
    </div>
  );
}
