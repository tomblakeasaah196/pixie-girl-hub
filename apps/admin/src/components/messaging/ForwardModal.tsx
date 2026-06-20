import { useMemo, useState } from "react";
import { Search, Check, Loader2, Forward } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useChannels } from "@/hooks/useSmartcomm";
import { smartcommApi } from "@/lib/smartcomm-api";
import {
  getChannelDisplayName,
  getChannelPlatform,
  getAvatarColour,
  getInitials,
} from "@/lib/messaging-utils";
import { cn } from "@/lib/cn";
import type { Message } from "@/lib/smartcomm-types";
import { PlatformPill } from "./PlatformPill";

/** Pick one or more conversations to forward a message into. */
export function ForwardModal({
  open,
  message,
  currentUserId,
  onClose,
  onDone,
}: {
  open: boolean;
  message: Message | null;
  currentUserId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: channels = [] } = useChannels({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return channels.filter((c) =>
      term
        ? getChannelDisplayName(c, currentUserId).toLowerCase().includes(term)
        : true,
    );
  }, [channels, q, currentUserId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!message || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await smartcommApi.forwardMessage(message.message_id, [...selected]);
      setSelected(new Set());
      setQ("");
      onDone();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not forward");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Forward className="w-4 h-4 text-accent" />
          Forward message
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={busy || selected.size === 0}
            icon={
              busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : undefined
            }
          >
            Forward{selected.size ? ` (${selected.size})` : ""}
          </Button>
        </>
      }
    >
      {message && (
        <div className="mb-3 rounded-lg bg-panel-2 border hairline px-3 py-2 text-[12px] text-text-muted">
          <span className="line-clamp-2">
            {message.content || `[${message.message_type}]`}
          </span>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 rounded-lg border hairline bg-panel-2 px-2.5">
        <Search className="w-3.5 h-3.5 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="w-full bg-transparent py-2 text-[12.5px] focus:outline-none placeholder:text-text-faint"
        />
      </div>

      {error && <div className="mb-2 text-[11.5px] text-danger">{error}</div>}

      <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-text-faint">
            No conversations found
          </div>
        ) : (
          filtered.map((c) => {
            const name = getChannelDisplayName(c, currentUserId);
            const on = selected.has(c.channel_id);
            return (
              <button
                key={c.channel_id}
                onClick={() => toggle(c.channel_id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-panel-2",
                  on && "bg-accent/5",
                )}
              >
                <span
                  className="grid place-items-center w-8 h-8 rounded-full text-[11px] font-semibold text-white shrink-0"
                  style={{ backgroundColor: getAvatarColour(name) }}
                >
                  {getInitials(name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium">
                      {name}
                    </span>
                    <PlatformPill platform={getChannelPlatform(c)} />
                  </span>
                </span>
                <span
                  className={cn(
                    "grid place-items-center w-5 h-5 rounded-full border shrink-0",
                    on
                      ? "bg-accent border-accent text-bg"
                      : "hairline text-transparent",
                  )}
                >
                  <Check className="w-3 h-3" />
                </span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
