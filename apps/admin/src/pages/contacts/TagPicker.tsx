import { useState, useRef, useEffect } from "react";
import { Tag, Plus, X, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as contactsApi from "./api";
import type { ContactTag } from "./types";

// ── Inline tag picker ──────────────────────────────────────────────────

const TAG_PRESET_COLOURS = [
  "#A81D1D",
  "#690909",
  "#7f703d",
  "#5aa0a8",
  "#7a8fa8",
  "#8b9d77",
  "#b76e79",
  "#9c7ad9",
  "#d4a853",
  "#3d7a6f",
  "#c27b55",
  "#4a6fa8",
];

function getBestTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.45 ? "#1A0F11" : "#F4E9D9";
}

interface TagPillProps {
  tag: ContactTag;
  onRemove?: () => void;
  removable?: boolean;
}

function TagPill({ tag, onRemove, removable = false }: TagPillProps) {
  const textColor = getBestTextColor(tag.colour);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: tag.colour, color: textColor }}
    >
      {tag.tag_name}
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-70 hover:opacity-100 transition-opacity ml-0.5"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

interface Props {
  contactId: string;
}

/**
 * Inline tag picker for the contact profile's Overview tab.
 * - Shows existing tags as removable pills
 * - '+' button opens a popover with:
 *   - Search/filter existing tags
 *   - Create new tag (name + colour picker)
 * - Changes saved immediately via API
 */
export function TagPicker({ contactId }: Props) {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);

  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColour, setNewColour] = useState(TAG_PRESET_COLOURS[0]);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Current tags on this contact
  const { data: contactTags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ["contacts", biz, "tags", contactId],
    queryFn: () => contactsApi.listContactTags(contactId),
  });

  // All tags across the brand (for the picker suggestions)
  const { data: allTags = [] } = useQuery({
    queryKey: ["contacts", biz, "all-tags"],
    queryFn: () => contactsApi.listAllTags(),
  });

  const addTagMut = useMutation({
    mutationFn: (tag: { tag_name: string; colour?: string }) =>
      contactsApi.addContactTag(contactId, tag),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "tags", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts", biz, "all-tags"] });
      setSearchTerm("");
      setCreatingNew(false);
      setNewName("");
    },
  });

  const removeTagMut = useMutation({
    mutationFn: (tagId: string) =>
      contactsApi.removeContactTag(contactId, tagId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "tags", contactId] });
    },
  });

  // Close popover when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setCreatingNew(false);
        setSearchTerm("");
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const contactTagNames = new Set(contactTags.map((t) => t.tag_name));

  const filteredSuggestions = allTags.filter(
    (t) =>
      !contactTagNames.has(t.tag_name) &&
      t.tag_name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleAddExisting = (tag: ContactTag) => {
    if (contactTagNames.has(tag.tag_name)) return;
    addTagMut.mutate({ tag_name: tag.tag_name, colour: tag.colour });
  };

  const handleCreateNew = () => {
    if (!newName.trim()) return;
    addTagMut.mutate({ tag_name: newName.trim(), colour: newColour });
  };

  return (
    <div>
      <div className="micro mb-2 flex items-center gap-1">
        <Tag className="w-3 h-3" />
        Tags
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {tagsLoading ? (
          <span className="text-[11px] text-text-faint">Loading…</span>
        ) : (
          contactTags.map((tag) => (
            <TagPill
              key={tag.tag_id}
              tag={tag}
              removable
              onRemove={() => removeTagMut.mutate(tag.tag_id)}
            />
          ))
        )}

        {/* Add tag button */}
        <div className="relative" ref={open ? popoverRef : undefined}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[11px] font-semibold border border-dashed border-line text-text-faint hover:border-accent/50 hover:text-accent transition-all"
          >
            <Plus className="w-2.5 h-2.5" />
            Add tag
          </button>

          {/* Popover */}
          {open && (
            <div
              ref={popoverRef}
              className="absolute left-0 top-7 z-50 w-64 dropglass rounded-[14px] shadow-glass overflow-hidden"
            >
              {!creatingNew ? (
                <>
                  {/* Search */}
                  <div className="p-2 border-b hairline">
                    <input
                      autoFocus
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search or create tag…"
                      className="w-full h-[32px] px-3 rounded-[8px] bg-text-primary/[0.06] border border-line text-[12px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors"
                    />
                  </div>

                  {/* Suggestions */}
                  <div className="max-h-[180px] overflow-y-auto p-1.5">
                    {filteredSuggestions.map((tag) => (
                      <button
                        key={tag.tag_id}
                        type="button"
                        onClick={() => handleAddExisting(tag)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] hover:bg-text-primary/[0.06] transition-colors"
                        disabled={addTagMut.isPending}
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.colour }}
                        />
                        <span className="text-[12px] text-text-primary">
                          {tag.tag_name}
                        </span>
                      </button>
                    ))}

                    {filteredSuggestions.length === 0 && (
                      <div className="px-2 py-2 text-[11.5px] text-text-faint">
                        {searchTerm
                          ? `No tag matches "${searchTerm}"`
                          : "No more tags to add"}
                      </div>
                    )}
                  </div>

                  {/* Create new */}
                  <div className="p-2 border-t hairline">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingNew(true);
                        setNewName(searchTerm);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] hover:bg-accent-deep/[0.1] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-accent" />
                      <span className="text-[12px] text-accent font-semibold">
                        {searchTerm
                          ? `Create "${searchTerm}"`
                          : "Create new tag"}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                /* New tag creation */
                <div className="p-3">
                  <div className="text-[12px] font-semibold text-text-primary mb-3">
                    New Tag
                  </div>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateNew()}
                    placeholder="Tag name"
                    maxLength={40}
                    className="w-full h-[34px] px-3 rounded-[9px] bg-text-primary/[0.06] border border-line text-[12px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors mb-3"
                  />

                  {/* Colour swatches */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {TAG_PRESET_COLOURS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColour(c)}
                        className="w-5 h-5 rounded-full transition-all"
                        style={{
                          backgroundColor: c,
                          outline: newColour === c ? "2px solid white" : "none",
                          outlineOffset: 1,
                        }}
                      />
                    ))}
                  </div>

                  {/* Preview */}
                  {newName.trim() && (
                    <div className="mb-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{
                          backgroundColor: newColour,
                          color: getBestTextColor(newColour),
                        }}
                      >
                        {newName}
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreatingNew(false)}
                      className="flex-1 h-[30px] rounded-[8px] text-[12px] text-text-muted hover:text-text-primary border border-line hover:bg-text-primary/[0.06] transition-all"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateNew}
                      disabled={!newName.trim() || addTagMut.isPending}
                      className="flex-1 h-[30px] rounded-[8px] text-[12px] font-semibold bg-accent-deep text-[#F4E9D9] hover:bg-accent transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1"
                    >
                      {addTagMut.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Create"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
