/**
 * Storefront Studio → Content → journal article body.
 *
 * A magazine layout is an ordered stack of typed blocks — text, an image, a
 * YouTube clip, an Instagram embed, an uploaded video — instead of one flat
 * textarea. Blocks are added from a picker, dragged to reorder (dnd-kit, same
 * pattern as the header/footer editors elsewhere in this page), edited inline,
 * and removed only after an explicit confirm.
 */

import { useRef, useState } from "react";
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
import {
  GripVertical,
  Trash2,
  Type,
  Image as ImageIcon,
  Youtube,
  Instagram,
  Clapperboard,
  Wand2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/controls";
import { toast } from "@/stores/toast";
import { describeError } from "@/lib/error-report";
import { uploadStorefrontImage, type StorefrontVideo } from "@/lib/storefront-studio";
import { VideoField } from "./VideoField";
import {
  type ContentBlock,
  type TextBlock,
  type ImageBlock,
  type YoutubeBlock,
  type InstagramBlock,
  type VideoBlock,
  BLOCK_TYPE_LABEL,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  ASPECT_OPTIONS,
  blankBlock,
  lookupYouTubeAspect,
} from "./content-blocks";

const inputCls =
  "w-full rounded-[10px] border border-line bg-text-primary/[0.04] px-3 py-2 text-[13px] text-text-primary outline-none transition focus:border-accent-deep";
const labelCls = "mb-1 block text-[12px] font-medium text-text-muted";

const ADD_OPTIONS: { type: ContentBlock["type"]; icon: React.ReactNode }[] = [
  { type: "text", icon: <Type className="h-3.5 w-3.5" /> },
  { type: "image", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { type: "youtube", icon: <Youtube className="h-3.5 w-3.5" /> },
  { type: "instagram", icon: <Instagram className="h-3.5 w-3.5" /> },
  { type: "video", icon: <Clapperboard className="h-3.5 w-3.5" /> },
];

export function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const ids = blocks.map((b) => b.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function update(id: string, patch: Partial<ContentBlock>) {
    onChange(
      blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as ContentBlock) : b)),
    );
  }
  function add(type: ContentBlock["type"]) {
    onChange([...blocks, blankBlock(type)]);
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(blocks, from, to));
  }
  function removeConfirmed() {
    if (!confirmRemove) return;
    onChange(blocks.filter((b) => b.id !== confirmRemove));
    setConfirmRemove(null);
  }

  return (
    <div className="space-y-3">
      <span className={cn(labelCls, "text-[13px] text-text-primary")}>
        Article content
      </span>

      {blocks.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line p-4">
          <EmptyState
            icon={<Wand2 className="h-6 w-6" />}
            title="No blocks yet"
            message="Build the article out of text, images, and video/Instagram embeds — add your first block below."
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {blocks.map((b) => (
                <SortableBlockCard
                  key={b.id}
                  block={b}
                  onUpdate={(patch) => update(b.id, patch)}
                  onRemove={() => setConfirmRemove(b.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex flex-wrap gap-1.5">
        {ADD_OPTIONS.map((o) => (
          <Button
            key={o.type}
            variant="secondary"
            size="sm"
            icon={o.icon}
            onClick={() => add(o.type)}
          >
            {BLOCK_TYPE_LABEL[o.type]}
          </Button>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={removeConfirmed}
        title="Remove this block?"
        message="This removes it from the article. You can't undo this — but the rest of the article stays untouched."
        confirmLabel="Remove"
      />
    </div>
  );
}

function SortableBlockCard({
  block,
  onUpdate,
  onRemove,
}: {
  block: ContentBlock;
  onUpdate: (patch: Partial<ContentBlock>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="space-y-2.5 rounded-[10px] border border-line bg-text-primary/[0.03] p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none text-text-muted hover:text-text-primary active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-[12px] font-medium text-text-muted">
            {BLOCK_TYPE_LABEL[block.type]}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>

      {block.type === "text" ? (
        <TextBlockForm block={block} onUpdate={onUpdate} />
      ) : block.type === "image" ? (
        <ImageBlockForm block={block} onUpdate={onUpdate} />
      ) : block.type === "youtube" ? (
        <YoutubeBlockForm block={block} onUpdate={onUpdate} />
      ) : block.type === "instagram" ? (
        <InstagramBlockForm block={block} onUpdate={onUpdate} />
      ) : (
        <VideoBlockForm block={block} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ── Text ─────────────────────────────────────────────────────

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-[6px] border transition",
        active
          ? "border-accent-deep bg-accent-deep/15 text-text-primary"
          : "border-line text-text-muted hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

function TextBlockForm({
  block,
  onUpdate,
}: {
  block: TextBlock;
  onUpdate: (patch: Partial<TextBlock>) => void;
}) {
  return (
    <div className="space-y-2">
      <textarea
        className={cn(inputCls, "resize-y")}
        rows={4}
        value={block.text}
        placeholder="Write this section…"
        onChange={(e) => onUpdate({ text: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(inputCls, "w-auto")}
          value={block.fontFamily || "eb-garamond"}
          onChange={(e) => onUpdate({ fontFamily: e.target.value as TextBlock["fontFamily"] })}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className={cn(inputCls, "w-auto")}
          value={block.fontSize || "base"}
          onChange={(e) => onUpdate({ fontSize: e.target.value as TextBlock["fontSize"] })}
        >
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          type="color"
          value={block.color || "#f4e9d9"}
          onChange={(e) => onUpdate({ color: e.target.value })}
          className="h-8 w-10 cursor-pointer rounded-[6px] border border-line bg-transparent p-0.5"
          aria-label="Text colour"
        />
        <div className="flex gap-1">
          <ToggleBtn label="Bold" active={!!block.bold} onClick={() => onUpdate({ bold: !block.bold })}>
            <Bold className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn label="Italic" active={!!block.italic} onClick={() => onUpdate({ italic: !block.italic })}>
            <Italic className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn label="Underline" active={!!block.underline} onClick={() => onUpdate({ underline: !block.underline })}>
            <Underline className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <ToggleBtn
              key={a}
              label={`Align ${a}`}
              active={(block.align || "left") === a}
              onClick={() => onUpdate({ align: a })}
            >
              {a === "left" ? (
                <AlignLeft className="h-3.5 w-3.5" />
              ) : a === "center" ? (
                <AlignCenter className="h-3.5 w-3.5" />
              ) : (
                <AlignRight className="h-3.5 w-3.5" />
              )}
            </ToggleBtn>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Image ────────────────────────────────────────────────────

function ImageBlockForm({
  block,
  onUpdate,
}: {
  block: ImageBlock;
  onUpdate: (patch: Partial<ImageBlock>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadStorefrontImage(file);
      onUpdate({ url });
    } catch (e) {
      const { message, detail } = describeError(e);
      toast.error("Couldn't upload the image", {
        description: message,
        report: { area: "Storefront Studio → Content", action: "Upload block image", message, detail },
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="grid h-[72px] w-[96px] shrink-0 place-items-center overflow-hidden rounded-[8px] border border-line bg-text-primary/[0.04]">
          {block.url ? (
            <img src={block.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-text-muted">none</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : block.url ? "Replace" : "Upload"}
          </Button>
          {block.url ? (
            <Button variant="ghost" size="sm" onClick={() => onUpdate({ url: "" })}>
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      <input
        className={inputCls}
        value={block.alt || ""}
        placeholder="Alt text (for screen readers & SEO)"
        onChange={(e) => onUpdate({ alt: e.target.value })}
      />
      <input
        className={inputCls}
        value={block.caption || ""}
        placeholder="Caption (optional, shown under the image)"
        onChange={(e) => onUpdate({ caption: e.target.value })}
      />
    </div>
  );
}

// ── YouTube ──────────────────────────────────────────────────

function YoutubeBlockForm({
  block,
  onUpdate,
}: {
  block: YoutubeBlock;
  onUpdate: (patch: Partial<YoutubeBlock>) => void;
}) {
  const [detecting, setDetecting] = useState(false);
  async function detect() {
    if (!block.url.trim()) return;
    setDetecting(true);
    try {
      const r = await lookupYouTubeAspect(block.url);
      if (r.aspect) {
        onUpdate({ aspect: r.aspect });
        toast.success(`Detected ${r.aspect === "9:16" ? "portrait (Shorts)" : r.aspect === "16:9" ? "landscape" : "square"} video.`);
      } else {
        toast.error("Couldn't read this video's shape — pick it manually below.");
      }
    } catch (e) {
      const { message } = describeError(e);
      toast.error("Couldn't look up that link", { description: message });
    } finally {
      setDetecting(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          value={block.url}
          placeholder="https://www.youtube.com/shorts/… or /watch?v=…"
          onChange={(e) => onUpdate({ url: e.target.value })}
        />
        <Button variant="secondary" size="sm" disabled={detecting || !block.url.trim()} onClick={detect}>
          {detecting ? "Detecting…" : "Detect shape"}
        </Button>
      </div>
      <div>
        <span className={labelCls}>Shape</span>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_OPTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => onUpdate({ aspect: a.value })}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition",
                block.aspect === a.value
                  ? "border-accent-deep bg-accent-deep/15 text-text-primary"
                  : "border-line text-text-muted hover:text-text-primary",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <input
        className={inputCls}
        value={block.caption || ""}
        placeholder="Caption (optional, shown under the video)"
        onChange={(e) => onUpdate({ caption: e.target.value })}
      />
    </div>
  );
}

// ── Instagram ────────────────────────────────────────────────

function InstagramBlockForm({
  block,
  onUpdate,
}: {
  block: InstagramBlock;
  onUpdate: (patch: Partial<InstagramBlock>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        className={inputCls}
        value={block.url}
        placeholder="https://www.instagram.com/reel/…"
        onChange={(e) => onUpdate({ url: e.target.value })}
      />
      <div>
        <span className={labelCls}>Shape</span>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_OPTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => onUpdate({ aspect: a.value })}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition",
                block.aspect === a.value
                  ? "border-accent-deep bg-accent-deep/15 text-text-primary"
                  : "border-line text-text-muted hover:text-text-primary",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <input
        className={inputCls}
        value={block.caption || ""}
        placeholder="Caption (optional, shown under the embed)"
        onChange={(e) => onUpdate({ caption: e.target.value })}
      />
    </div>
  );
}

// ── Uploaded video ───────────────────────────────────────────

function VideoBlockForm({
  block,
  onUpdate,
}: {
  block: VideoBlock;
  onUpdate: (patch: Partial<VideoBlock>) => void;
}) {
  return (
    <div className="space-y-2">
      <VideoField
        label="Video"
        value={block.url ? block : ""}
        onChange={(v) => {
          if (!v || typeof v === "string") {
            onUpdate({ url: "", poster_url: null, width: null, height: null });
            return;
          }
          const sv = v as StorefrontVideo;
          onUpdate({
            url: sv.url,
            poster_url: sv.poster_url ?? null,
            width: sv.width ?? null,
            height: sv.height ?? null,
          });
        }}
      />
      <input
        className={inputCls}
        value={block.caption || ""}
        placeholder="Caption (optional, shown under the video)"
        onChange={(e) => onUpdate({ caption: e.target.value })}
      />
    </div>
  );
}
