import { useState } from "react";
import { StickyNote, Plus, Pin, Trash2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { toastReport } from "@/lib/error-report";
import {
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from "./goals-hooks";
import type { Note } from "./goals-types";

export function NotesTab() {
  const [search, setSearch] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const {
    data: notes = [],
    isLoading,
    isError,
    refetch,
  } = useNotes(search.trim() ? { q: search.trim() } : {});

  if (isError)
    return <ErrorState message="Could not load notes." onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-2xl font-medium">Notes</h2>
          <p className="text-[13px] text-text-muted mt-1">
            Your private scratchpad — thoughts, decisions, reminders.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => {
            setEditNote(null);
            setShowEditor(true);
          }}
        >
          New Note
        </Button>
      </div>

      <div className="max-w-[320px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors"
            autoComplete="off"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-[var(--radius)]" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<StickyNote className="w-7 h-7" />}
            title={search ? "No matching notes" : "No notes yet"}
            message={
              search
                ? "Try a different search."
                : "Capture a thought — it stays private to you."
            }
            action={
              !search ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="w-3 h-3" />}
                  onClick={() => {
                    setEditNote(null);
                    setShowEditor(true);
                  }}
                >
                  New Note
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {notes.map((n) => (
            <NoteCard
              key={n.note_id}
              note={n}
              onEdit={() => {
                setEditNote(n);
                setShowEditor(true);
              }}
            />
          ))}
        </div>
      )}

      <NoteEditor
        open={showEditor}
        note={editNote}
        onClose={() => {
          setShowEditor(false);
          setEditNote(null);
        }}
      />
    </div>
  );
}

function NoteCard({ note, onEdit }: { note: Note; onEdit: () => void }) {
  const update = useUpdateNote(note.note_id);
  const del = useDeleteNote();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="glass rounded-[var(--radius)] shadow-glass p-3.5 flex flex-col group">
      <div className="flex items-start gap-2 mb-1.5">
        <button
          onClick={onEdit}
          className="flex-1 min-w-0 text-left font-display text-[14px] font-medium text-text-primary truncate"
        >
          {note.title || "Untitled note"}
        </button>
        <button
          onClick={() => update.mutate({ pinned: !note.pinned })}
          className={cn(
            "w-7 h-7 grid place-items-center rounded-lg transition-colors shrink-0",
            note.pinned
              ? "text-accent-glow"
              : "text-text-faint hover:text-text-primary opacity-0 group-hover:opacity-100",
          )}
          aria-label={note.pinned ? "Unpin" : "Pin"}
        >
          <Pin className={cn("w-3.5 h-3.5", note.pinned && "fill-current")} />
        </button>
      </div>
      <button
        onClick={onEdit}
        className="text-left text-[12px] text-text-muted whitespace-pre-wrap line-clamp-5 flex-1"
      >
        {note.body || <span className="italic text-text-faint">Empty</span>}
      </button>
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t hairline">
        <span className="text-[10px] font-mono text-text-faint flex-1">
          {new Date(note.updated_at).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </span>
        {confirm ? (
          <>
            <button
              onClick={() => setConfirm(false)}
              className="text-[11px] text-text-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => del.mutate(note.note_id)}
              className="text-[11px] font-semibold text-danger"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="w-6 h-6 grid place-items-center rounded text-text-faint hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Delete note"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function NoteEditor({
  open,
  note,
  onClose,
}: {
  open: boolean;
  note: Note | null;
  onClose: () => void;
}) {
  const isEdit = !!note;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  const create = useCreateNote();
  const update = useUpdateNote(note?.note_id ?? "");
  const busy = create.isPending || update.isPending;

  // Sync fields whenever the editor opens for a (possibly different) note.
  const key = `${open}:${note?.note_id ?? "new"}`;
  const [syncedKey, setSyncedKey] = useState("");
  if (open && key !== syncedKey) {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setError("");
    setSyncedKey(key);
  }

  const submit = async () => {
    setError("");
    if (!title.trim() && !body.trim()) {
      setError("Add a title or some text.");
      return;
    }
    const payload = {
      title: title.trim() || null,
      body: body,
    };
    try {
      if (isEdit) await update.mutateAsync(payload);
      else await create.mutateAsync(payload);
      onClose();
    } catch (err) {
      toastReport("Workspace → Note", "Save note", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Note" : "New Note"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
          {error}
        </div>
      )}
      <FormSection>
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title (optional)"
            autoFocus
          />
        </Field>
      </FormSection>
      <FormSection>
        <Field label="Note">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write anything…"
            rows={8}
            className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 resize-y min-h-[160px]"
          />
        </Field>
      </FormSection>
    </Modal>
  );
}
