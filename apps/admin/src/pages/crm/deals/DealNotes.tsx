import { useState } from "react";
import { Pin, Loader2, Send } from "lucide-react";
import { Button, Skeleton } from "@/components/ui/primitives";
import { useAddDealNote } from "../hooks";
import type { CrmNote } from "@/pages/contacts/types";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

interface DealNotesProps {
  dealId: string;
  notes: CrmNote[];
  isLoading: boolean;
}

export function DealNotes({ dealId, notes, isLoading }: DealNotesProps) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"team" | "managers_only" | "author_only">("team");
  const addNote = useAddDealNote(dealId);

  const sorted = [...notes].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const handleAdd = () => {
    if (!body.trim()) return;
    addNote.mutate(
      { body: body.trim(), visibility },
      { onSuccess: () => setBody("") },
    );
  };

  return (
    <div>
      {/* Compose */}
      <div className="mb-4 p-3 rounded-[13px] bg-text-primary/[0.03] border hairline">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
          }}
        />
        <div className="flex items-center justify-between mt-2 pt-2 border-t hairline">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className="h-[28px] px-2 rounded-[7px] bg-text-primary/[0.06] border border-line text-[11px] text-text-muted appearance-none focus:outline-none"
          >
            <option value="team">Visible to team</option>
            <option value="managers_only">Managers only</option>
            <option value="author_only">Only me</option>
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAdd}
            disabled={!body.trim() || addNote.isPending}
            icon={
              addNote.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )
            }
          >
            Add
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[70px] rounded-[11px]" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-6 text-center text-text-faint text-[13px]">No notes yet</div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((note) => (
            <div
              key={note.note_id}
              className={[
                "p-3 rounded-[11px] border",
                note.is_pinned
                  ? "border-accent/25 bg-accent/[0.04]"
                  : "border-line bg-text-primary/[0.02]",
              ].join(" ")}
            >
              <div className="flex items-start gap-2">
                {note.is_pinned && <Pin className="w-3 h-3 text-accent mt-0.5 flex-shrink-0" />}
                <p className="text-[12.5px] text-text-primary leading-relaxed whitespace-pre-wrap flex-1">
                  {note.body}
                </p>
              </div>
              <div className="text-[10.5px] text-text-faint mt-2">
                {note.created_by_name ?? "Unknown"} · {relTime(note.created_at)}
                {note.visibility !== "team" && (
                  <span className="ml-1 capitalize">· {note.visibility.replace(/_/g, " ")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
