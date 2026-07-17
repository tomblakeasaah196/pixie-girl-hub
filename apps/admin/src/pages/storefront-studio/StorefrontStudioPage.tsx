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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
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
import { Plus, Newspaper, ChevronLeft, Smartphone, Tablet, Monitor } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { Toggle, Select, ConfirmDialog } from "@/components/ui/controls";
import { Tabs } from "@/pages/stock/parts";
import { useBusinessStore } from "@/stores/business";
import { useContentPosts, type ContentPost } from "@/lib/content-posts";
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
import { toast } from "@/stores/toast";
import { describeError } from "@/lib/error-report";
import { formatDateTime } from "@/lib/format";
import { ContentTab, type ContentJump } from "./ContentTab";
import { VideoField } from "./VideoField";

/**
 * Run a Studio mutation with unmissable feedback. Success shows a toast (plus
 * the optional inline note via onOk); failure — previously a SILENT no-op that
 * let operators close the tab thinking they'd saved — shows an error toast with
 * a one-tap "Contact System Admin" (JBS Praxis) report attached.
 */
async function runStudio(
  run: () => Promise<unknown>,
  opts: { area: string; action: string; success: string; onOk?: () => void },
): Promise<void> {
  try {
    await run();
    opts.onOk?.();
    toast.success(opts.success);
  } catch (err) {
    const { message, detail } = describeError(err);
    toast.error(`Couldn't ${opts.action.toLowerCase()}`, {
      description: message,
      report: { area: opts.area, action: opts.action, message, detail },
    });
  }
}

const STUDIO_AREA = "Storefront Studio";

type Tab =
  | "theme"
  | "branding"
  | "toolbar"
  | "navigation"
  | "pages"
  | "content"
  | "popups"
  | "preview"
  | "revisions";

const TABS: { key: Tab; label: string }[] = [
  { key: "theme", label: "Theme" },
  { key: "branding", label: "Branding" },
  { key: "toolbar", label: "Toolbar" },
  { key: "navigation", label: "Navigation" },
  { key: "pages", label: "Pages" },
  { key: "content", label: "Content" },
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

/**
 * Mobile "back to the list" affordance for the master/detail tabs (Pages,
 * Popups, Content). On phones the list and editor are a two-screen drill-down
 * — this returns to the list — so it's hidden from `lg` up where both panes
 * sit side by side and the button would be meaningless.
 */
function BackToList({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 mb-1 inline-flex items-center gap-1 self-start rounded-[9px] py-1 pl-1 pr-2 text-[13px] font-medium text-text-muted hover:text-text-primary lg:hidden"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

export function StorefrontStudioPage() {
  const brand = useBusinessStore((s) => s.activeKey);
  const [tab, setTab] = useUrlTab<Tab>(
    "theme",
    TABS.map((t) => t.key),
  );
  // Pages → journal links "view/create article" straight into Content, so the
  // operator never has to re-find what they just clicked.
  const [contentJump, setContentJump] = useState<ContentJump | null>(null);
  const clearContentJump = useCallback(() => setContentJump(null), []);
  const jumpToContent = useCallback(
    (jump: ContentJump) => {
      setContentJump(jump);
      setTab("content");
    },
    [setTab],
  );

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Segmented tab strip. On phones the strip scrolls horizontally
          (min-w-0 lets it shrink inside the row) so the brand chip never gets
          pushed off-screen — the whole header behaves like a native app's
          scrollable top segmented control. */}
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as Tab)} />
        </div>
        <Pill tone="accent" dot={false}>
          {brand}
        </Pill>
      </div>

      <div>
        {tab === "theme" ? <ThemeTab /> : null}
        {tab === "branding" ? <BrandingTab /> : null}
        {tab === "toolbar" ? <ToolbarTab /> : null}
        {tab === "navigation" ? <NavigationTab /> : null}
        {tab === "pages" ? <PagesTab onJumpToContent={jumpToContent} /> : null}
        {tab === "content" ? (
          <ContentTab jumpTo={contentJump} onJumpHandled={clearContentJump} />
        ) : null}
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

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? "bg-accent-deep" : "bg-text-primary/20"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </button>
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
        onChange={(e) => onChange(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function ColorField({
  label,
  hint,
  value,
  defaultColor,
  onChange,
  onReset,
}: {
  label: string;
  hint?: string;
  /** The saved override, or "" when the site is using its default colour. */
  value: string;
  /** The live default (any CSS colour — hex OR oklch) shown when unset, so the
   *  swatch always reflects the colour the website is actually painting. */
  defaultColor?: string;
  onChange: (v: string) => void;
  /** Clears the override and falls back to the website default. */
  onReset?: () => void;
}) {
  // The swatch shows the *effective* colour (override, else default) using the
  // raw CSS value — so an oklch default renders correctly, not as a grey
  // placeholder. The OS colour picker only speaks hex, so it seeds from the
  // effective colour when that's a hex and a neutral otherwise; picking always
  // writes a hex, which the storefront applies verbatim.
  const effective = value || defaultColor || "#690909";
  const pickerHex = HEX_RE.test(effective) ? effective : "#690909";
  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-muted">{label}</span>
        {value && onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-medium text-text-muted hover:text-text-primary"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <label
          className="relative h-9 w-10 shrink-0 cursor-pointer overflow-hidden rounded-[8px] border border-line"
          style={{ background: effective }}
        >
          <input
            type="color"
            value={pickerHex}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className="no-min-h absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          className={cn(inputCls, "font-mono uppercase")}
          value={value}
          placeholder={defaultColor || ""}
          onChange={(e) => onChange(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </div>
      {hint ? <p className="mt-1 text-[11px] text-text-muted">{hint}</p> : null}
    </div>
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
      toast.success("Image uploaded.");
    } catch (e) {
      const { message, detail } = describeError(e);
      setErr("Upload failed - try again or paste a URL.");
      toast.error("Couldn't upload the image", {
        description: message,
        report: {
          area: `${STUDIO_AREA} → ${label}`,
          action: "Upload image",
          message,
          detail,
        },
      });
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
            onChange={(e) => onChange(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          {err ? <p className="text-[11px] text-danger">{err}</p> : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
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
// Theme — every colour, font and corner the website paints with (no JSON)
//
// These controls write the *actual* CSS variables the storefront renders
// (apps/storefront/src/styles.css → `.dark`, forwarded verbatim by
// apps/storefront/src/routes/__root.tsx → tokensToCss). Each `def` is the
// storefront's shipped dark-mode default so an unset control still shows the
// real live colour; only controls the operator changes are persisted, so an
// untouched site keeps its pristine defaults.
// ============================================================

// The curated font roster the storefront self-hosts (apps/storefront/src/
// styles.css @imports). Only these render on the live site — no CDN fonts —
// so we never offer a choice that would silently fall back to a system face.
const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: '"Work Sans Variable", ui-sans-serif, system-ui, sans-serif', label: "Work Sans (modern sans)" },
  { value: '"Montserrat", ui-sans-serif, system-ui, sans-serif', label: "Montserrat (geometric sans)" },
  { value: '"Archivo Black", ui-sans-serif, sans-serif', label: "Archivo Black (heavy sans)" },
  { value: '"Playfair Display", ui-serif, Georgia, serif', label: "Playfair Display (editorial serif)" },
  { value: '"Cormorant Garamond", ui-serif, Georgia, serif', label: "Cormorant (luxury serif)" },
  { value: '"EB Garamond", ui-serif, Georgia, serif', label: "EB Garamond (classic serif)" },
  { value: '"Prata", ui-serif, Georgia, serif', label: "Prata (fashion serif)" },
  { value: '"Marcellus", ui-serif, Georgia, serif', label: "Marcellus (refined serif)" },
  { value: '"Cinzel", ui-serif, Georgia, serif', label: "Cinzel (roman caps)" },
  { value: '"Instrument Serif", ui-serif, Georgia, serif', label: "Instrument Serif (display serif)" },
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
  return Number.isFinite(n) ? n : 0.25;
}

/** A colour control: one visible swatch that may drive several CSS variables
 *  (e.g. "Muted surfaces" tints chips, inputs and quiet fills together). */
type ColorControl = { label: string; hint?: string; keys: string[]; def: string };

const CORE_COLORS: ColorControl[] = [
  {
    label: "Page background",
    keys: ["--ink"],
    def: "oklch(0.14 0.012 60)",
    hint: "The base colour behind the whole site.",
  },
  {
    label: "Cards & panels",
    keys: ["--card", "--popover"],
    def: "oklch(0.18 0.012 60)",
  },
  {
    label: "Muted surfaces",
    keys: ["--secondary", "--muted", "--input"],
    def: "oklch(0.22 0.015 60)",
    hint: "Chips, form fields and quiet fills.",
  },
  { label: "Main text", keys: ["--cream"], def: "oklch(0.96 0.018 80)" },
  {
    label: "Subtle text",
    keys: ["--muted-foreground"],
    def: "oklch(0.68 0.025 70)",
    hint: "Captions, hints and secondary copy.",
  },
  { label: "Lines & dividers", keys: ["--border"], def: "oklch(0.28 0.015 60)" },
];

const ACCENT_COLORS: ColorControl[] = [
  {
    label: "Primary — buttons & links",
    keys: ["--taupe"],
    def: "oklch(0.82 0.045 60)",
  },
  { label: "Soft accent", keys: ["--champagne"], def: "oklch(0.71 0.06 60)" },
  { label: "Gold highlight", keys: ["--gold"], def: "oklch(0.78 0.11 75)" },
  { label: "Rose", keys: ["--rose"], def: "oklch(0.62 0.13 18)" },
  { label: "Deep burgundy", keys: ["--burgundy"], def: "oklch(0.32 0.11 25)" },
];

type FontControl = { label: string; hint?: string; key: string; def: string };

const FONT_CONTROLS: FontControl[] = [
  {
    label: "Headings font",
    key: "--font-display",
    def: '"Work Sans Variable", ui-sans-serif, system-ui, sans-serif',
  },
  {
    label: "Body text font",
    key: "--font-sans",
    def: '"Work Sans Variable", ui-sans-serif, system-ui, sans-serif',
  },
  {
    label: "Elegant accent font",
    key: "--font-couture",
    def: '"Cormorant Garamond", ui-serif, Georgia, serif',
    hint: "The serif used for italic flourishes.",
  },
];

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

  const set = (k: string, v: string) => setTokens((t) => ({ ...t, [k]: v }));
  const setMany = (keys: string[], v: string) =>
    setTokens((t) => {
      const n = { ...t };
      for (const k of keys) n[k] = v;
      return n;
    });
  const clearMany = (keys: string[]) =>
    setTokens((t) => {
      const n = { ...t };
      for (const k of keys) delete n[k];
      return n;
    });
  // Effective value for the live preview: the override, else the site default.
  const eff = (key: string, def: string) => tokens[key] || def;

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  const renderColors = (list: ColorControl[]) =>
    list.map((c) => (
      <ColorField
        key={c.keys[0]}
        label={c.label}
        hint={c.hint}
        value={tokens[c.keys[0]] || ""}
        defaultColor={c.def}
        onChange={(v) => setMany(c.keys, v)}
        onReset={() => clearMany(c.keys)}
      />
    ));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text-primary">Theme</h2>
          <StatusPill status={active?.status} />
        </div>
        <p className="text-[13px] text-text-muted">
          This tab controls the whole look of your website — every colour, font
          and corner. Leave anything untouched to keep its default; the preview
          updates live. Changes save as a draft; press Publish to go live.
        </p>

        <Section title="Core colours" defaultOpen>
          {renderColors(CORE_COLORS)}
        </Section>

        <Section title="Brand accents">{renderColors(ACCENT_COLORS)}</Section>

        <Section title="Fonts">
          {FONT_CONTROLS.map((f) => (
            <div key={f.key}>
              <SelectField
                label={f.label}
                value={tokens[f.key] || ""}
                onChange={(v) => (v ? set(f.key, v) : clearMany([f.key]))}
                options={[
                  { value: "", label: "Website default" },
                  ...fontOptionsWith(tokens[f.key] || ""),
                ]}
              />
              {f.hint ? (
                <p className="mt-1 text-[11px] text-text-muted">{f.hint}</p>
              ) : null}
            </div>
          ))}
        </Section>

        <Section title="Corners">
          <RangeField
            label="Corner roundness"
            value={remNumber(tokens["--radius"] || "0.25rem")}
            min={0}
            max={1.5}
            step={0.05}
            suffix="rem"
            onChange={(v) => set("--radius", `${v}rem`)}
          />
        </Section>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={save.isPending || publish.isPending}
            onClick={() =>
              runStudio(() => save.mutateAsync(tokens), {
                area: `${STUDIO_AREA} → Theme`,
                action: "Save theme draft",
                success: "Draft saved.",
                onOk: () => setMsg("Draft saved."),
              })
            }
          >
            Save draft
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || publish.isPending}
            onClick={() =>
              runStudio(
                async () => {
                  await save.mutateAsync(tokens);
                  await publish.mutateAsync();
                },
                {
                  area: `${STUDIO_AREA} → Theme`,
                  action: "Publish theme",
                  success: "Theme published — it's live now.",
                  onOk: () => setMsg("Theme published."),
                },
              )
            }
          >
            Publish
          </Button>
        </div>
        <Status msg={msg} />
      </Card>

      <ThemePreview get={eff} />
    </div>
  );
}

/** A quick, live approximation of the dark-mode storefront using the current
 *  (draft) theme tokens, so operators see a colour/font/corner change land
 *  before they ever publish. Not pixel-perfect — a confidence check. */
function ThemePreview({ get }: { get: (key: string, def: string) => string }) {
  const bg = get("--ink", "oklch(0.14 0.012 60)");
  const card = get("--card", "oklch(0.18 0.012 60)");
  const text = get("--cream", "oklch(0.96 0.018 80)");
  const muted = get("--muted-foreground", "oklch(0.68 0.025 70)");
  const border = get("--border", "oklch(0.28 0.015 60)");
  const primary = get("--taupe", "oklch(0.82 0.045 60)");
  const champagne = get("--champagne", "oklch(0.71 0.06 60)");
  const gold = get("--gold", "oklch(0.78 0.11 75)");
  const rose = get("--rose", "oklch(0.62 0.13 18)");
  const burgundy = get("--burgundy", "oklch(0.32 0.11 25)");
  const heading = get(
    "--font-display",
    '"Work Sans Variable", ui-sans-serif, system-ui, sans-serif',
  );
  const body = get(
    "--font-sans",
    '"Work Sans Variable", ui-sans-serif, system-ui, sans-serif',
  );
  const couture = get(
    "--font-couture",
    '"Cormorant Garamond", ui-serif, Georgia, serif',
  );
  const radius = get("--radius", "0.25rem");

  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <p className="mb-2 text-[12px] font-medium text-text-muted">Live preview</p>
      <div className="overflow-hidden rounded-[14px] border border-line shadow-glass">
        <div style={{ background: bg, fontFamily: body, color: text }} className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span
              style={{ fontFamily: couture, color: primary }}
              className="text-[16px] italic"
            >
              Maison
            </span>
            <div className="flex gap-1.5">
              {[champagne, gold, rose, burgundy].map((c, i) => (
                <span
                  key={i}
                  style={{ background: c }}
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-black/20"
                />
              ))}
            </div>
          </div>
          <div
            style={{ background: card, borderColor: border, borderRadius: radius }}
            className="border p-4"
          >
            <p
              style={{ color: muted }}
              className="text-[9.5px] font-semibold uppercase tracking-[0.22em]"
            >
              New in
            </p>
            <h3
              style={{ fontFamily: heading, color: text }}
              className="mt-1.5 text-[21px] font-semibold leading-tight"
            >
              The Pixie Cut Wig
            </h3>
            <p style={{ color: muted }} className="mt-1.5 text-[12px] leading-relaxed">
              Most realistic HD lace — hand-tied and ready to wear.
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <button
                type="button"
                style={{ background: primary, color: bg, borderRadius: radius }}
                className="px-3.5 py-2 text-[12px] font-semibold"
              >
                Add to bag
              </button>
              <button
                type="button"
                style={{ borderColor: border, color: text, borderRadius: radius }}
                className="border px-3.5 py-2 text-[12px] font-semibold"
              >
                Details
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-text-muted">
        An approximation of your dark-mode storefront. Publish to see it live.
      </p>
    </div>
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
    if (!active) return;
    const t = { ...(active.tokens || {}) };
    // Migrate a previously-single logo/favicon into the dark slot so it stays
    // visible in the editor and keeps rendering on the (dark-default) site.
    if (!t["--logo-url-dark"] && t["--logo-url"])
      t["--logo-url-dark"] = t["--logo-url"];
    if (!t["--favicon-url-dark"] && t["--favicon-url"])
      t["--favicon-url-dark"] = t["--favicon-url"];
    setTokens(t);
  }, [active]);

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  const rows = [
    {
      key: "--logo-url-dark",
      label: "Logo — dark mode (a light/cream logo, for the dark site)",
    },
    {
      key: "--logo-url-light",
      label: "Logo — light mode (a dark logo, for the light site)",
    },
    {
      key: "--favicon-url-dark",
      label: "Favicon — dark browsers (square; use a light mark)",
    },
    {
      key: "--favicon-url-light",
      label: "Favicon — light browsers (square; use a dark mark)",
    },
    { key: "--og-image", label: "Share image (shown when the link is posted)" },
  ];
  return (
    <Card className="max-w-xl space-y-5 p-5">
      <p className="text-[13px] text-text-muted">
        Upload a logo for dark mode and one for light mode — each is used in both
        the header and the footer, and swaps automatically with the site theme.
        The favicon is the little icon in the browser tab; give a light one for
        dark browsers and a dark one for light browsers. Leave a light-mode slot
        empty to reuse the dark one. Save as a draft, then Publish to go live.
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
          disabled={save.isPending || publish.isPending}
          onClick={() =>
            runStudio(() => save.mutateAsync(tokens), {
              area: `${STUDIO_AREA} → Branding`,
              action: "Save branding draft",
              success: "Draft saved.",
              onOk: () => setMsg("Draft saved."),
            })
          }
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={save.isPending || publish.isPending}
          onClick={() =>
            runStudio(
              async () => {
                await save.mutateAsync(tokens);
                await publish.mutateAsync();
              },
              {
                area: `${STUDIO_AREA} → Branding`,
                action: "Publish branding",
                success: "Branding published — it's live now.",
                onOk: () => setMsg("Branding published."),
              },
            )
          }
        >
          Publish
        </Button>
      </div>
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Toolbar — the storefront's draggable floating toolbar (stored in theme
// tokens.toolbar, so it rides the same theme draft/publish lifecycle)
// ============================================================

type ToolbarStep = { title: string; body: string };
type ToolbarCfg = {
  enabled: boolean;
  dock: "left" | "right";
  buttons: { currency: boolean; theme: boolean; whatsapp: boolean; help: boolean };
  whatsapp: { number: string; greeting: string };
  help: { title: string; steps: ToolbarStep[] };
};

const DEFAULT_TOOLBAR_CFG: ToolbarCfg = {
  enabled: true,
  dock: "left",
  buttons: { currency: true, theme: true, whatsapp: true, help: true },
  whatsapp: {
    number: "",
    greeting: "Hi! I'd love some help choosing the right piece.",
  },
  help: {
    title: "How to shop",
    steps: [
      { title: "Browse the maison", body: "Explore the catalogue, bundles and shades. Tap any piece to see photos, details and sizing." },
      { title: "Choose your options", body: "Pick your length, texture or shade — the price updates live as you choose." },
      { title: "Add to bag", body: "Tap Add to bag. Your currency (₦ or $) follows the toggle on this toolbar." },
      { title: "Checkout securely", body: "Open your bag, tap Checkout, add delivery details and pay. We ship worldwide from Lagos." },
    ],
  },
};

function readToolbarCfg(tokens: Record<string, unknown>): ToolbarCfg {
  const raw = tokens.toolbar;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const b = (o.buttons && typeof o.buttons === "object" ? o.buttons : {}) as Record<string, unknown>;
  const wa = (o.whatsapp && typeof o.whatsapp === "object" ? o.whatsapp : {}) as Record<string, unknown>;
  const help = (o.help && typeof o.help === "object" ? o.help : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const steps = Array.isArray(help.steps)
    ? (help.steps as unknown[]).map((s) => {
        const so = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
        return {
          title: typeof so.title === "string" ? so.title : "",
          body: typeof so.body === "string" ? so.body : "",
        };
      })
    : DEFAULT_TOOLBAR_CFG.help.steps;
  return {
    enabled: bool(o.enabled, true),
    dock: o.dock === "right" ? "right" : "left",
    buttons: {
      currency: bool(b.currency, true),
      theme: bool(b.theme, true),
      whatsapp: bool(b.whatsapp, true),
      help: bool(b.help, true),
    },
    whatsapp: {
      number: typeof wa.number === "string" ? wa.number : "",
      greeting: typeof wa.greeting === "string" ? wa.greeting : DEFAULT_TOOLBAR_CFG.whatsapp.greeting,
    },
    help: {
      title: typeof help.title === "string" && help.title ? help.title : DEFAULT_TOOLBAR_CFG.help.title,
      steps: steps.length ? steps : DEFAULT_TOOLBAR_CFG.help.steps,
    },
  };
}

function ToolbarTab() {
  const { data, isLoading } = useThemes();
  const save = useSaveThemeDraft();
  const publish = usePublishTheme();
  const active = pickActive(data);
  const [tokens, setTokens] = useState<Record<string, unknown>>({});
  const [cfg, setCfg] = useState<ToolbarCfg>(DEFAULT_TOOLBAR_CFG);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const t = (active.tokens || {}) as Record<string, unknown>;
    setTokens(t);
    setCfg(readToolbarCfg(t));
  }, [active]);

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  const patchButtons = (p: Partial<ToolbarCfg["buttons"]>) =>
    setCfg((c) => ({ ...c, buttons: { ...c.buttons, ...p } }));
  const patchWa = (p: Partial<ToolbarCfg["whatsapp"]>) =>
    setCfg((c) => ({ ...c, whatsapp: { ...c.whatsapp, ...p } }));
  const setSteps = (steps: ToolbarStep[]) =>
    setCfg((c) => ({ ...c, help: { ...c.help, steps } }));

  // Persist toolbar under the theme's tokens, preserving every other token
  // (branding logos/favicons, colour overrides) untouched.
  const nextTokens = { ...tokens, toolbar: cfg } as unknown as Record<string, string>;

  return (
    <Card className="max-w-xl space-y-5 p-5">
      <p className="text-[13px] text-text-muted">
        The floating toolbar is a draggable cluster of round buttons on every
        storefront page. Choose which buttons show, where it sits, and edit the
        WhatsApp details and the &ldquo;How to shop&rdquo; steps. Save as a draft,
        then Publish to go live.
      </p>

      <div className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3">
        <span className="text-[13px] font-medium text-text-primary">Show the toolbar</span>
        <Toggle checked={cfg.enabled} onChange={(v) => setCfg((c) => ({ ...c, enabled: v }))} />
      </div>

      <div>
        <span className={labelCls}>Dock side (customers can drag it anywhere)</span>
        <Select
          value={cfg.dock}
          onChange={(v) => setCfg((c) => ({ ...c, dock: v }))}
          options={[
            { value: "left", label: "Left edge" },
            { value: "right", label: "Right edge" },
          ]}
        />
      </div>

      <Section title="Buttons" defaultOpen>
        <div className="space-y-3">
          <Toggle checked={cfg.buttons.currency} onChange={(v) => patchButtons({ currency: v })} label="Currency toggle (₦ / $)" />
          <Toggle checked={cfg.buttons.theme} onChange={(v) => patchButtons({ theme: v })} label="Dark / light theme" />
          <Toggle checked={cfg.buttons.whatsapp} onChange={(v) => patchButtons({ whatsapp: v })} label="WhatsApp chat" />
          <Toggle checked={cfg.buttons.help} onChange={(v) => patchButtons({ help: v })} label="How-to-shop help" />
        </div>
      </Section>

      <Section title="WhatsApp" hint="Used by the WhatsApp button. Leave the number blank to fall back to your Navigation → Socials WhatsApp.">
        <TextField
          label="WhatsApp number (international, e.g. 2348012345678)"
          value={cfg.whatsapp.number}
          onChange={(v) => patchWa({ number: v })}
          placeholder="2348012345678"
        />
        <AreaField
          label="Pre-filled greeting"
          value={cfg.whatsapp.greeting}
          onChange={(v) => patchWa({ greeting: v })}
          rows={2}
        />
      </Section>

      <Section title="How-to-shop steps">
        <TextField
          label="Title"
          value={cfg.help.title}
          onChange={(v) => setCfg((c) => ({ ...c, help: { ...c.help, title: v } }))}
        />
        <div className="space-y-3">
          {cfg.help.steps.map((s, i) => (
            <div key={i} className="space-y-2 rounded-[10px] border border-line bg-text-primary/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-text-muted">Step {i + 1}</span>
                <button
                  onClick={() => setSteps(cfg.help.steps.filter((_, j) => j !== i))}
                  className="text-xs text-text-muted hover:text-danger"
                >
                  Remove
                </button>
              </div>
              <TextField
                label="Heading"
                value={s.title}
                onChange={(v) => setSteps(cfg.help.steps.map((x, j) => (j === i ? { ...x, title: v } : x)))}
              />
              <AreaField
                label="Text"
                value={s.body}
                rows={2}
                onChange={(v) => setSteps(cfg.help.steps.map((x, j) => (j === i ? { ...x, body: v } : x)))}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSteps([...cfg.help.steps, { title: "", body: "" }])}
          >
            + Add step
          </Button>
        </div>
      </Section>

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={save.isPending || publish.isPending}
          onClick={() =>
            runStudio(() => save.mutateAsync(nextTokens), {
              area: `${STUDIO_AREA} → Toolbar`,
              action: "Save toolbar draft",
              success: "Draft saved.",
              onOk: () => setMsg("Draft saved."),
            })
          }
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={save.isPending || publish.isPending}
          onClick={() =>
            runStudio(
              async () => {
                await save.mutateAsync(nextTokens);
                await publish.mutateAsync();
              },
              {
                area: `${STUDIO_AREA} → Toolbar`,
                action: "Publish toolbar",
                success: "Toolbar published — it's live now.",
                onOk: () => setMsg("Toolbar published."),
              },
            )
          }
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

  function buildNav(): NavRow {
    return { header_items: header, footer_columns: footer, socials };
  }

  async function onSave() {
    await runStudio(() => save.mutateAsync(buildNav()), {
      area: `${STUDIO_AREA} → Navigation`,
      action: "Save navigation draft",
      success: "Draft saved.",
      onOk: () => setMsg("Draft saved."),
    });
  }

  async function onPublish() {
    await runStudio(
      async () => {
        await save.mutateAsync(buildNav());
        await publish.mutateAsync();
      },
      {
        area: `${STUDIO_AREA} → Navigation`,
        action: "Publish navigation",
        success: "Navigation published — it's live now.",
        onOk: () => setMsg("Navigation published."),
      },
    );
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        <Button
          variant="primary"
          disabled={save.isPending || publish.isPending}
          onClick={onSave}
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabled={save.isPending || publish.isPending}
          onClick={onPublish}
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

const BLANK_PAGE: PageRow = {
  page_key: "",
  template_key: "home_hero_v1",
  url_path: "/",
  meta_title: "",
  meta_description: "",
  og_image_url: "",
  slots: {},
};

function PagesTab({
  onJumpToContent,
}: {
  onJumpToContent: (jump: { postId?: string }) => void;
}) {
  const { data, isLoading } = usePages();
  const save = useSavePageDraft();
  const publish = usePublishPage();
  const [sel, setSel] = useState<PageRow | null>(null);
  const [slots, setSlots] = useState<Record<string, unknown>>({});
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
    setSlots((p.slots as Record<string, unknown>) || {});
    setMsg(null);
  }

  // Send ONLY the editable fields — never spread the loaded row, whose DB-only
  // keys (page_id, business, status, timestamps) tripped the backend validator
  // with "Invalid input" and blocked every save.
  function buildPagePayload(p: PageRow) {
    return {
      page_key: p.page_key,
      template_key: p.template_key,
      url_path: p.url_path,
      meta_title: p.meta_title ?? undefined,
      meta_description: p.meta_description ?? undefined,
      og_image_url: p.og_image_url ?? undefined,
      slots,
    };
  }

  async function onSave() {
    if (!sel) return;
    await runStudio(() => save.mutateAsync(buildPagePayload(sel)), {
      area: `${STUDIO_AREA} → Pages (${sel.page_key || "new"})`,
      action: "Save page draft",
      success: "Draft saved.",
      onOk: () => setMsg("Draft saved."),
    });
  }

  async function onPublish() {
    if (!sel) return;
    await runStudio(
      async () => {
        await save.mutateAsync(buildPagePayload(sel));
        await publish.mutateAsync(sel.page_key);
      },
      {
        area: `${STUDIO_AREA} → Pages (${sel.page_key})`,
        action: "Publish page",
        success: "Page published — it's live now.",
        onOk: () => setMsg("Page published."),
      },
    );
  }

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr] lg:gap-5">
      <Card className={cn("p-3", sel && "hidden lg:block")}>
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

      <div className={cn(!sel && "hidden lg:block")}>
      {sel ? (
        <Card className="flex flex-col space-y-4 p-5 lg:max-w-2xl">
          <BackToList label="All pages" onClick={() => setSel(null)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              Page content
            </label>
            <p className="mb-2 text-[12px] text-text-muted">
              Edit the text and images for this page. Changes save as a draft;
              press Publish to make them live.
            </p>
            <SlotsEditor value={slots} onChange={setSlots} />
          </div>

          {sel.page_key === "journal" ? (
            <JournalArticlesPanel onJumpToContent={onJumpToContent} />
          ) : null}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              disabled={save.isPending || publish.isPending}
              onClick={onSave}
            >
              Save draft
            </Button>
            <Button
              variant="secondary"
              disabled={!sel.page_key || save.isPending || publish.isPending}
              onClick={onPublish}
            >
              Publish
            </Button>
          </div>
          <Status msg={msg} />
        </Card>
      ) : (
        <p className="hidden text-[13px] text-text-muted lg:block">
          Select a page to edit, or create a new one.
        </p>
      )}
      </div>
    </div>
  );
}

/** Read-only preview of journal articles, shown right on the "journal" page's
 *  editor — this page is only the listing banner (eyebrow/heading), so this
 *  panel answers "where are my actual articles?" and hands off to the real
 *  editor (Content tab) rather than duplicating it here. */
function JournalArticlesPanel({
  onJumpToContent,
}: {
  onJumpToContent: (jump: { postId?: string }) => void;
}) {
  const { data, isLoading } = useContentPosts();
  const articles = useMemo(
    () => (data || []).filter((p) => p.post_type === "journal"),
    [data],
  );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className={cn(labelCls, "text-[13px] text-text-primary")}>
          Journal articles
        </label>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => onJumpToContent({})}
        >
          New article
        </Button>
      </div>
      <p className="mb-2 text-[12px] text-text-muted">
        The banner above is all this page controls. Individual articles are
        written and published in Content — click one to open it there.
      </p>
      <Card className="p-2">
        {isLoading ? (
          <p className="px-2 py-3 text-[13px] text-text-muted">Loading…</p>
        ) : articles.length === 0 ? (
          <p className="px-2 py-4 text-center text-[12.5px] text-text-muted">
            No articles yet. Click “New article” to write your first one.
          </p>
        ) : (
          <ul className="space-y-1">
            {articles.map((a: ContentPost) => (
              <li key={a.post_id}>
                <button
                  onClick={() => onJumpToContent({ postId: a.post_id })}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] text-text-muted hover:bg-text-primary/[0.04] hover:text-text-primary"
                >
                  <Newspaper className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">
                    {a.title || "(untitled)"}
                  </span>
                  <Pill tone={a.status === "published" ? "success" : "neutral"} dot={false}>
                    {a.status === "published" ? "Live" : "Draft"}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Generic keyed-slots editor — edits the exact `slots` object the storefront
// reads (hero/heading/body/image fields, string lists, nested groups, lists of
// objects). No JSON, ever. Works for any page shape the seed produced.
// ============================================================

function humanize(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

const AREA_HINT = /(body|description|desc|note|message|answer|quote|excerpt|content)/i;
const IMAGE_HINT = /(image|img|url|logo|photo|cover|banner|avatar|hero)/i;
const IMAGE_LIST_HINT = /(image|photo|gallery|slide|banner)/i;
// A `video` slot holds the looping-clip object the upload endpoint returns —
// it gets the trim/crop studio, never the generic object editor.
const VIDEO_HINT = /video/i;

// The Instagram identity shown under the home "Gallery" rotating showcase. It's
// injected into the Gallery group (like the hero video/image below) so it's
// editable even on pages published before the field existed. Keep in sync with
// the storefront default in apps/storefront/src/lib/home-content.ts.
const GALLERY_PROFILE_DEFAULT = {
  handle: "@faitlynhair",
  followers: "84.9K",
  bio: "Most Realistic Pixie Wigs · Luxury Hair + Premium HD Lace",
  verified: true,
};

function SlotValue({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = humanize(fieldKey);

  if (!Array.isArray(value) && VIDEO_HINT.test(fieldKey)) {
    return <VideoField label={label} value={value} onChange={onChange} />;
  }

  if (typeof value === "boolean") {
    return <BooleanField label={label} value={value} onChange={onChange} />;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const s = value == null ? "" : String(value);
    if (IMAGE_HINT.test(fieldKey))
      return <ImageField label={label} value={s} onChange={onChange} />;
    if (AREA_HINT.test(fieldKey) || s.length > 80)
      return <AreaField label={label} value={s} onChange={onChange} />;
    return <TextField label={label} value={s} onChange={onChange} />;
  }

  if (Array.isArray(value)) {
    const arr = value as unknown[];
    const isObjectList = arr.some(
      (x) => x !== null && typeof x === "object" && !Array.isArray(x),
    );
    if (isObjectList)
      return (
        <ObjectListField
          label={label}
          items={arr as Record<string, unknown>[]}
          onChange={(v) => onChange(v)}
        />
      );
    const strItems = arr.map((x) => (x == null ? "" : String(x)));
    if (IMAGE_LIST_HINT.test(fieldKey))
      return (
        <ImageListField label={label} items={strItems} onChange={(v) => onChange(v)} />
      );
    return (
      <StringListField label={label} items={strItems} onChange={(v) => onChange(v)} />
    );
  }

  // Plain object -> collapsible group of sub-fields.
  const obj = value as Record<string, unknown>;
  // Hero sections always offer the looping-video upload AND a background-image
  // upload, even on pages saved before those fields existed (their slots have
  // no `video` / `imageUrl` key yet). The background image fills the desktop
  // "room" behind the video vitrine; on mobile the video plays full-bleed.
  const isHero = /hero/i.test(fieldKey);
  const offerHeroVideo = isHero && !("video" in obj);
  const offerHeroImage = isHero && !("imageUrl" in obj);
  // The home Gallery gets an Instagram "Profile" group (handle, followers,
  // tagline, verified badge) shown under the rotating showcase — offered even
  // on pages saved before the field existed.
  const offerGalleryProfile = /gallery/i.test(fieldKey) && !("profile" in obj);
  return (
    <Section title={label}>
      {Object.entries(obj).map(([k, v]) => (
        <SlotValue
          key={k}
          fieldKey={k}
          value={v}
          onChange={(nv) => onChange({ ...obj, [k]: nv })}
        />
      ))}
      {offerHeroImage ? (
        <ImageField
          label="Background Image (desktop room behind the video)"
          value=""
          onChange={(nv) => onChange({ ...obj, imageUrl: nv })}
        />
      ) : null}
      {offerHeroVideo ? (
        <VideoField
          label="Looping Video"
          value={undefined}
          onChange={(nv) => onChange({ ...obj, video: nv })}
        />
      ) : null}
      {offerGalleryProfile ? (
        <SlotValue
          fieldKey="profile"
          value={GALLERY_PROFILE_DEFAULT}
          onChange={(nv) => onChange({ ...obj, profile: nv })}
        />
      ) : null}
    </Section>
  );
}

function StringListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={inputCls}
              value={it}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? e.target.value : x)))
              } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...items, ""])}
      >
        + Add
      </Button>
    </div>
  );
}

function ImageListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Section title={label}>
      {items.map((it, i) => (
        <div key={i} className="space-y-1">
          <ImageField
            label={`${label} ${i + 1}`}
            value={it}
            onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
          />
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...items, ""])}
      >
        + Add image
      </Button>
    </Section>
  );
}

function emptyLike(sample: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(sample || {})) out[k] = "";
  return out;
}

function ObjectListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  return (
    <Section title={label}>
      {items.map((item, i) => (
        <div
          key={i}
          className="space-y-2 rounded-[10px] border border-line bg-text-primary/[0.03] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-text-muted">
              {label} {i + 1}
            </span>
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-xs text-text-muted hover:text-danger"
            >
              Remove
            </button>
          </div>
          {Object.entries(item).map(([k, v]) => (
            <SlotValue
              key={k}
              fieldKey={k}
              value={v}
              onChange={(nv) =>
                onChange(items.map((x, j) => (j === i ? { ...x, [k]: nv } : x)))
              }
            />
          ))}
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...items, emptyLike(items[0])])}
      >
        + Add
      </Button>
    </Section>
  );
}

function SlotsEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(value);
  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-[12px] text-text-muted">
          No fields yet. Add one below.
        </p>
      ) : (
        entries.map(([k, v]) => (
          <SlotValue
            key={k}
            fieldKey={k}
            value={v}
            onChange={(nv) => onChange({ ...value, [k]: nv })}
          />
        ))
      )}
      <div className="flex items-end gap-2 border-t border-line pt-3">
        <label className="flex-1">
          <span className={labelCls}>Add a field (name)</span>
          <input
            className={inputCls}
            value={newKey}
            placeholder="e.g. heading"
            onChange={(e) => setNewKey(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={!newKey.trim() || newKey.trim() in value}
          onClick={() => {
            onChange({ ...value, [newKey.trim()]: "" });
            setNewKey("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    await runStudio(() => save.mutateAsync(sel), {
      area: `${STUDIO_AREA} → Popups (${sel.popup_key || "new"})`,
      action: "Save popup draft",
      success: "Draft saved.",
      onOk: () => setMsg("Draft saved."),
    });
  }

  async function onPublish() {
    if (!sel) return;
    await runStudio(
      async () => {
        await save.mutateAsync(sel);
        await publish.mutateAsync(sel.popup_key);
      },
      {
        area: `${STUDIO_AREA} → Popups (${sel.popup_key})`,
        action: "Publish popup",
        success: "Popup published — it's live now.",
        onOk: () => setMsg("Popup published."),
      },
    );
  }

  if (isLoading)
    return <p className="text-[13px] text-text-muted">Loading...</p>;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr] lg:gap-5">
      <Card className={cn("p-3", sel && "hidden lg:block")}>
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

      <div className={cn(!sel && "hidden lg:block")}>
      {sel ? (
        <Card className="flex flex-col space-y-4 p-5 lg:max-w-2xl">
          <BackToList label="All popups" onClick={() => setSel(null)} />
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="primary"
              disabled={save.isPending || publish.isPending}
              onClick={onSave}
            >
              Save draft
            </Button>
            <Button
              variant="secondary"
              disabled={!sel.popup_key || save.isPending || publish.isPending}
              onClick={onPublish}
            >
              Publish
            </Button>
            <Button
              variant="danger"
              disabled={!sel.popup_key || del.isPending}
              onClick={() => setConfirmDelete(true)}
              className="sm:ml-auto"
            >
              Delete
            </Button>
          </div>
          <Status msg={msg} />

          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() =>
              runStudio(() => del.mutateAsync(sel.popup_key), {
                area: `${STUDIO_AREA} → Popups (${sel.popup_key})`,
                action: "Delete popup",
                success: "Popup deleted.",
                onOk: () => {
                  setConfirmDelete(false);
                  setSel(null);
                },
              })
            }
            title="Delete popup"
            message={`Delete the "${sel.popup_key}" popup? This removes both the draft and published versions and can't be undone.`}
            confirmLabel="Delete"
            tone="danger"
            busy={del.isPending}
          />
        </Card>
      ) : (
        <p className="hidden text-[13px] text-text-muted lg:block">
          Select a popup to edit, or create a new one.
        </p>
      )}
      </div>
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
        // A responsive list, not a <table>: each publish stacks into a tidy
        // row on phones (details on top, a full-width Restore below) and lines
        // up in columns on wider screens — no horizontal scroll on mobile.
        <ul className="divide-y divide-line">
          {revs.map((r) => (
            <li
              key={r.revision_id}
              className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0">
                <div className="text-[13px] text-text-primary">
                  {formatDateTime(r.published_at)}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {r.entity_type}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                disabled={rollback.isPending}
                onClick={() =>
                  runStudio(() => rollback.mutateAsync(r.revision_id), {
                    area: `${STUDIO_AREA} → Revisions`,
                    action: "Restore revision",
                    success: "Restored to draft — review and publish.",
                    onOk: () =>
                      setMsg("Restored to draft - review and publish."),
                  })
                }
              >
                Restore to draft
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Status msg={msg} />
    </Card>
  );
}

// ============================================================
// Preview (embedded iframe + open-live)
// ============================================================

type PreviewDevice = "phone" | "tablet" | "desktop";
const PREVIEW_DEVICES: {
  key: PreviewDevice;
  label: string;
  icon: React.ReactNode;
  width: number | null;
}[] = [
  { key: "phone", label: "Phone", icon: <Smartphone className="h-4 w-4" />, width: 390 },
  { key: "tablet", label: "Tablet", icon: <Tablet className="h-4 w-4" />, width: 768 },
  { key: "desktop", label: "Desktop", icon: <Monitor className="h-4 w-4" />, width: null },
];

function PreviewTab() {
  const { data, isLoading, refetch } = usePreviewInfo();
  const [device, setDevice] = useState<PreviewDevice>("phone");

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
  const activeDevice = PREVIEW_DEVICES.find((d) => d.key === device)!;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-text-muted">
          Live draft preview - shows unpublished changes. The preview link
          expires in ~30 minutes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Frame the site at real device widths so operators can sanity-check
              their own mobile responsiveness from inside the Studio. */}
          <div
            role="tablist"
            aria-label="Preview device size"
            className="inline-flex items-center gap-0.5 rounded-[11px] border border-line bg-text-primary/[0.03] p-0.5"
          >
            {PREVIEW_DEVICES.map((d) => (
              <button
                key={d.key}
                role="tab"
                aria-selected={d.key === device}
                aria-label={d.label}
                title={d.label}
                onClick={() => setDevice(d.key)}
                className={cn(
                  "grid h-8 w-9 place-items-center rounded-[9px] transition-colors",
                  d.key === device
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {d.icon}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(url, "_blank", "noopener")}
          >
            Open
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden p-0">
        <div
          className={cn(
            "mx-auto w-full transition-[max-width] duration-300",
            activeDevice.width ? "p-3 sm:p-5" : "",
          )}
          style={activeDevice.width ? { maxWidth: activeDevice.width } : undefined}
        >
          <iframe
            title="Storefront preview"
            src={url}
            className={cn(
              "h-[70vh] w-full border-0 bg-white",
              activeDevice.width
                ? "rounded-[24px] border border-line shadow-glass"
                : "",
            )}
          />
        </div>
      </Card>
    </div>
  );
}
