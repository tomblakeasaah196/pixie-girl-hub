import { useState } from "react";
import { Tag, Pencil, Trash2, GitMerge, Check, X, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useBusinessStore } from "@/stores/business";
import { Button, Pill, Skeleton, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/controls";
import * as contactsApi from "@/pages/contacts/api";
import type { ContactTag } from "@/pages/contacts/types";

// ── Helpers ───────────────────────────────────────────────────────────────

const TAG_PRESET_COLOURS = [
  "#A81D1D", "#690909", "#7f703d", "#5aa0a8",
  "#7a8fa8", "#8b9d77", "#b76e79", "#9c7ad9",
  "#d4a853", "#3d7a6f", "#c27b55", "#4a6fa8",
];

function getBestTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.45 ? "#1A0F11" : "#F4E9D9";
}

function TagPill({ tag }: { tag: ContactTag }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold"
      style={{ backgroundColor: tag.colour, color: getBestTextColor(tag.colour) }}
    >
      {tag.tag_name}
    </span>
  );
}

// ── Inline edit row ───────────────────────────────────────────────────────

interface TagRowProps {
  tag: ContactTag;
  allTags: ContactTag[];
  onDelete: () => void;
  onMergeStart: (tag: ContactTag) => void;
}

function TagRow({ tag, allTags, onDelete, onMergeStart }: TagRowProps) {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.tag_name);
  const [colour, setColour] = useState(tag.colour);
  const [showSwatch, setShowSwatch] = useState(false);

  const updateMut = useMutation({
    mutationFn: (input: { tag_name?: string; colour?: string }) =>
      contactsApi.updateTag(tag.tag_id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "all-tags"] });
      setEditing(false);
      setShowSwatch(false);
    },
  });

  const handleSave = () => {
    const patch: { tag_name?: string; colour?: string } = {};
    if (name.trim() !== tag.tag_name) patch.tag_name = name.trim();
    if (colour !== tag.colour) patch.colour = colour;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    updateMut.mutate(patch);
  };

  const handleCancel = () => {
    setName(tag.tag_name);
    setColour(tag.colour);
    setEditing(false);
    setShowSwatch(false);
  };

  const otherTags = allTags.filter((t) => t.tag_id !== tag.tag_id);

  return (
    <div className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline group">
      {editing ? (
        <>
          {/* Colour dot — click to open swatch */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSwatch((v) => !v)}
              className="w-7 h-7 rounded-full border-2 border-white/20 flex-shrink-0 transition-transform hover:scale-110"
              style={{ backgroundColor: colour }}
            />
            {showSwatch && (
              <div className="absolute left-0 top-9 z-50 p-2 rounded-[12px] dropglass shadow-glass">
                <div className="flex flex-wrap gap-1.5 w-[136px]">
                  {TAG_PRESET_COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setColour(c); setShowSwatch(false); }}
                      className="w-5 h-5 rounded-full transition-all"
                      style={{
                        backgroundColor: c,
                        outline: colour === c ? "2px solid white" : "none",
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Name input */}
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            maxLength={40}
            className="flex-1 h-[32px] px-2 rounded-[8px] bg-text-primary/[0.08] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/40 transition-colors"
          />

          {/* Preview */}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0"
            style={{ backgroundColor: colour, color: getBestTextColor(colour) }}
          >
            {name || "preview"}
          </span>

          {/* Save / Cancel */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || updateMut.isPending}
            className="w-7 h-7 grid place-items-center rounded-[8px] text-success hover:bg-success/10 transition-colors disabled:opacity-50"
          >
            {updateMut.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          {/* Colour dot */}
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: tag.colour }}
          />

          {/* Tag pill */}
          <div className="flex-1 min-w-0">
            <TagPill tag={tag} />
          </div>

          {/* Actions — visible on hover */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {otherTags.length > 0 && (
              <button
                type="button"
                onClick={() => onMergeStart(tag)}
                title="Merge into another tag"
                className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-info hover:bg-info/10 transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Merge dialog ──────────────────────────────────────────────────────────

interface MergeDialogProps {
  sourceTag: ContactTag;
  allTags: ContactTag[];
  onClose: () => void;
}

function MergeDialog({ sourceTag, allTags, onClose }: MergeDialogProps) {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);
  const [targetId, setTargetId] = useState("");

  const mergeMut = useMutation({
    mutationFn: () => contactsApi.mergeTags(sourceTag.tag_id, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "all-tags"] });
      onClose();
    },
  });

  const targetOptions = allTags.filter((t) => t.tag_id !== sourceTag.tag_id);
  const targetTag = targetOptions.find((t) => t.tag_id === targetId);

  return (
    <Modal open onClose={onClose} title="Merge tag">
      <p className="text-[12px] text-text-muted mb-4">
        All contacts tagged{" "}
        <TagPill tag={sourceTag} /> will be re-tagged with the target tag. The source tag is
        permanently removed.
      </p>

      {/* Target picker */}
      <div className="mb-4">
        <label className="micro mb-2 block">Merge into</label>
        <Select
          value={targetId}
          onChange={setTargetId}
          options={[
            { value: "", label: "— choose target tag —" },
            ...targetOptions.map((t) => ({ value: t.tag_id, label: t.tag_name })),
          ]}
        />
      </div>

      {/* Preview */}
      {targetTag && (
        <div className="flex items-center gap-2 mb-4 p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline">
          <TagPill tag={sourceTag} />
          <span className="text-text-faint text-[12px]">→</span>
          <TagPill tag={targetTag} />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={!targetId || mergeMut.isPending}
          onClick={() => mergeMut.mutate()}
          icon={mergeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          Merge
        </Button>
      </div>

      {mergeMut.isError && (
        <p className="text-[11.5px] text-danger mt-2 text-center">
          Merge failed — please try again.
        </p>
      )}
    </Modal>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  tag: ContactTag;
  onClose: () => void;
}

function DeleteConfirm({ tag, onClose }: DeleteConfirmProps) {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);

  const deleteMut = useMutation({
    mutationFn: () => contactsApi.deleteTag(tag.tag_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "all-tags"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Delete tag">
      <p className="text-[12px] text-text-muted mb-4">
        Remove <TagPill tag={tag} /> from all contacts? This cannot be undone.
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="flex-1 bg-danger/90 hover:bg-danger"
          onClick={() => deleteMut.mutate()}
          disabled={deleteMut.isPending}
          icon={deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          Delete
        </Button>
      </div>
      {deleteMut.isError && (
        <p className="text-[11.5px] text-danger mt-2 text-center">
          Delete failed — please try again.
        </p>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ContactTagsPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Contact Tags" },
  ]);

  const biz = useBusinessStore((s) => s.activeKey);
  const [search, setSearch] = useState("");
  const [mergeSource, setMergeSource] = useState<ContactTag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactTag | null>(null);

  const { data: allTags = [], isLoading } = useQuery({
    queryKey: ["contacts", biz, "all-tags"],
    queryFn: () => contactsApi.listAllTags(),
  });

  const filtered = allTags.filter((t) =>
    t.tag_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[800px] mx-auto pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Contact Tags</h1>
          <p className="text-[12px] text-text-faint mt-1">
            Manage all tags used across your contacts — rename, recolour, merge, or delete.
          </p>
        </div>
        <Pill tone="neutral" dot={false}>
          {allTags.length} {allTags.length === 1 ? "tag" : "tags"}
        </Pill>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags…"
            className="w-full h-[38px] pl-8 pr-3 rounded-[11px] bg-text-primary/[0.05] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors"
          />
        </div>
      </div>

      {/* Tag list */}
      {isLoading ? (
        <Card className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[46px] rounded-[12px]" />
          ))}
        </Card>
      ) : allTags.length === 0 ? (
        <Card className="py-12 text-center">
          <Tag className="w-8 h-8 text-text-faint mx-auto mb-3" />
          <div className="text-[14px] font-semibold text-text-primary mb-1">No tags yet</div>
          <p className="text-[12px] text-text-faint">
            Tags are created from contact profiles. Once added, they appear here for management.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-[13px] text-text-faint">No tags match "{search}"</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((tag) => (
            <TagRow
              key={tag.tag_id}
              tag={tag}
              allTags={allTags}
              onDelete={() => setDeleteTarget(tag)}
              onMergeStart={(t) => setMergeSource(t)}
            />
          ))}
        </div>
      )}

      {/* Tip */}
      {allTags.length > 0 && (
        <p className="text-[11px] text-text-faint mt-4 text-center">
          Hover a tag to edit, delete, or merge it into another tag.
        </p>
      )}

      {/* Merge dialog */}
      {mergeSource && (
        <MergeDialog
          sourceTag={mergeSource}
          allTags={allTags}
          onClose={() => setMergeSource(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirm
          tag={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
