import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, MessageSquare } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { listStaff } from "@/lib/hr-api";
import { smartcommApi } from "@/lib/smartcomm-api";

/**
 * New internal conversation: search a colleague and open (or reuse) a 1:1 DM.
 * The "search an employee and message them" entry point the messaging surface
 * was missing — backed by the find-or-create direct endpoint so repeated
 * chats with the same person don't spawn duplicate channels.
 */
export function NewChatModal({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (channelId: string) => void;
}) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "staff", "new-chat"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });

  const start = useMutation({
    mutationFn: (userId: string) => smartcommApi.startDirect(userId),
    onSuccess: (ch) => onStarted(ch.channel_id),
  });

  const rows = (data?.data || []).filter(
    (s) =>
      s.user_id &&
      (!q ||
        s.display_name?.toLowerCase().includes(q.toLowerCase()) ||
        s.job_title?.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <Modal open={open} onClose={onClose} title="New conversation">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a colleague by name or role…"
            className="w-full rounded-xl border border-line bg-text-primary/[0.04] py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus-visible:border-accent/50"
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-text-muted">Loading…</div>
          ) : !rows.length ? (
            <div className="p-4 text-sm text-text-muted">
              No colleagues with a login found.
            </div>
          ) : (
            rows.map((s) => {
              const initials = (s.display_name || "?")
                .split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
              return (
                <button
                  key={s.profile_id}
                  disabled={start.isPending}
                  onClick={() => s.user_id && start.mutate(s.user_id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/[0.06] disabled:opacity-50"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-xs text-accent-glow">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">{s.display_name}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {s.job_title || "—"}{s.department ? ` · ${s.department}` : ""}
                    </span>
                  </span>
                  <MessageSquare className="h-4 w-4 shrink-0 text-text-faint" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
