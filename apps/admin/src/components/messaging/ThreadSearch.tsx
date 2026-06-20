import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { smartcommApi } from "@/lib/smartcomm-api";
import { fmtClockTime } from "@/lib/messaging-utils";
import type { Message } from "@/lib/smartcomm-types";

/** Search within a single conversation; clicking a hit jumps to it. */
export function ThreadSearch({
  channelId,
  onJump,
  onClose,
}: {
  channelId: string;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const hits = await smartcommApi.search({
          q: term,
          channel_id: channelId,
          limit: 30,
        });
        if (!cancelled) setResults(hits as Message[]);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, channelId]);

  return (
    <div className="border-b hairline bg-bg">
      <div className="flex items-center gap-2 px-4 py-2">
        <Search className="w-4 h-4 text-text-faint shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Search in this conversation…"
          className="w-full bg-transparent py-1 text-[13px] focus:outline-none placeholder:text-text-faint"
        />
        {loading && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-text-faint" />
        )}
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary shrink-0"
          title="Close search"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {q.trim().length >= 2 && (
        <div className="max-h-60 overflow-y-auto border-t hairline">
          {results.length === 0 && !loading ? (
            <div className="px-4 py-4 text-[12px] text-text-faint">
              No matches
            </div>
          ) : (
            results.map((m) => (
              <button
                key={m.message_id}
                onClick={() => onJump(m.message_id)}
                className="block w-full px-4 py-2 text-left hover:bg-panel-2 border-b hairline last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium text-text-muted truncate">
                    {m.sender_name ?? "Unknown"}
                  </span>
                  <span className="text-[10px] text-text-faint shrink-0">
                    {fmtClockTime(m.created_at)}
                  </span>
                </div>
                <p className="text-[12.5px] text-text-primary line-clamp-2">
                  {m.content || `[${m.message_type}]`}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
