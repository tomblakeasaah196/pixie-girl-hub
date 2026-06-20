import { useMemo, useState } from "react";
import { Users, UserPlus, X, LogOut, Search, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useIamUsers } from "@/lib/iam";
import { smartcommApi } from "@/lib/smartcomm-api";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";
import { cn } from "@/lib/cn";
import type { Channel } from "@/lib/smartcomm-types";

/** Group members: view, add, remove, and leave. */
export function GroupInfoModal({
  open,
  channel,
  currentUserId,
  onClose,
  onChanged,
  onLeft,
}: {
  open: boolean;
  channel: Channel;
  currentUserId?: string;
  onClose: () => void;
  onChanged: () => void;
  onLeft?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = channel.members ?? [];
  const isAdmin = channel.my_role === "admin";
  const memberUserIds = useMemo(
    () => new Set(members.map((m) => m.user_id).filter(Boolean) as string[]),
    [members],
  );

  const { data: usersResp } = useIamUsers(
    adding && search.trim().length >= 2 ? { search: search.trim() } : {},
  );
  const candidates = (usersResp?.rows ?? []).filter(
    (u) => !memberUserIds.has(u.user_id),
  );

  async function addUser(userId: string) {
    setBusyId(userId);
    try {
      await smartcommApi.addMember(channel.channel_id, {
        user_id: userId,
        role: "member",
      });
      setSearch("");
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(memberId: string) {
    setBusyId(memberId);
    try {
      await smartcommApi.removeMember(channel.channel_id, memberId);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function leave() {
    const mine = members.find((m) => m.user_id === currentUserId);
    if (!mine?.member_id) return;
    setBusyId(mine.member_id);
    try {
      await smartcommApi.removeMember(channel.channel_id, mine.member_id);
      onChanged();
      onLeft?.();
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          {channel.name || "Group"} · {members.length}
        </span>
      }
      footer={
        <Button
          variant="ghost"
          size="sm"
          onClick={leave}
          icon={<LogOut className="w-3.5 h-3.5" />}
        >
          Leave group
        </Button>
      }
    >
      {/* Add people */}
      {isAdmin && (
        <div className="mb-3">
          {adding ? (
            <div>
              <div className="mb-2 flex items-center gap-2 rounded-lg border hairline bg-panel-2 px-2.5">
                <Search className="w-3.5 h-3.5 text-text-faint" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people to add…"
                  className="w-full bg-transparent py-2 text-[12.5px] focus:outline-none placeholder:text-text-faint"
                />
                <button
                  onClick={() => {
                    setAdding(false);
                    setSearch("");
                  }}
                  className="text-text-faint hover:text-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {search.trim().length >= 2 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border hairline">
                  {candidates.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-text-faint">
                      No matches
                    </div>
                  ) : (
                    candidates.map((u) => (
                      <button
                        key={u.user_id}
                        onClick={() => addUser(u.user_id)}
                        disabled={busyId === u.user_id}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-2"
                      >
                        <span
                          className="grid place-items-center w-7 h-7 rounded-full text-[10px] font-semibold text-white"
                          style={{
                            backgroundColor: getAvatarColour(u.display_name),
                          }}
                        >
                          {getInitials(u.display_name)}
                        </span>
                        <span className="flex-1 truncate text-[12.5px]">
                          {u.display_name}
                        </span>
                        {busyId === u.user_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-text-faint" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5 text-accent-glow" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(true)}
              icon={<UserPlus className="w-3.5 h-3.5" />}
            >
              Add people
            </Button>
          )}
        </div>
      )}

      {/* Members */}
      <div className="space-y-0.5 max-h-[44vh] overflow-y-auto -mx-1 px-1">
        {members.map((m) => {
          const name =
            m.user_display_name || m.contact_display_name || "Member";
          const isMe = m.user_id === currentUserId;
          return (
            <div
              key={m.member_id ?? m.user_id ?? name}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
            >
              <span
                className="grid place-items-center w-8 h-8 rounded-full text-[11px] font-semibold text-white shrink-0"
                style={{ backgroundColor: getAvatarColour(name) }}
              >
                {getInitials(name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">
                  {name}{" "}
                  {isMe && <span className="text-text-faint">(you)</span>}
                </span>
              </span>
              {m.role === "admin" && (
                <span className="text-[10px] uppercase tracking-wide text-accent-glow">
                  admin
                </span>
              )}
              {isAdmin && !isMe && m.member_id && (
                <button
                  onClick={() => removeMember(m.member_id as string)}
                  disabled={busyId === m.member_id}
                  className={cn(
                    "p-1 text-text-faint hover:text-danger",
                    busyId === m.member_id && "opacity-50",
                  )}
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
