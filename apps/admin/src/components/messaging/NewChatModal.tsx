import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, MessageSquare, Users, ChevronLeft, Check, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { listStaff, type StaffRow } from "@/lib/hr-api";
import { smartcommApi } from "@/lib/smartcomm-api";
import { useAuthStore } from "@/stores/auth";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";
import { cn } from "@/lib/cn";

type Mode = "chat" | "group";
type Step = "pick" | "name";

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted: (channelId: string) => void;
  /** Which mode to open in — defaults to "chat" so existing HR "Message" buttons
   *  keep launching the 1:1 flow. The Groups tab opens directly into "group". */
  initialMode?: Mode;
}

/**
 * New internal conversation — mirrors WhatsApp's split between "New chat"
 * (single-pick, instant DM via find-or-create) and "New group" (multi-select
 * → name → create). The mode toggle is the header row so the user can move
 * between the two without closing.
 *
 * Group flow is two steps: (1) pick colleagues (multi-select with chips at
 * the top + a "Select whole department" quick-pick), (2) name the group and
 * hit Create. If a caller opens the modal with an initialMode, we honour it.
 */
export function NewChatModal({ open, onClose, onStarted, initialMode = "chat" }: Props) {
  const meId = useAuthStore((s) => s.user?.id);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("pick");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens so a second launch is never stale.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep("pick");
    setQ("");
    setSelected(new Set());
    setGroupName("");
    setError(null);
  }, [open, initialMode]);

  const { data, isLoading } = useQuery({
    queryKey: ["hr", "staff", "new-chat"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });

  const startDm = useMutation({
    mutationFn: (userId: string) => smartcommApi.startDirect(userId),
    onSuccess: (ch) => onStarted(ch.channel_id),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not start the chat"),
  });

  const createGroup = useMutation({
    mutationFn: (input: { name: string; member_user_ids: string[] }) =>
      smartcommApi.createChannel({
        channel_type: "group",
        name: input.name,
        member_user_ids: input.member_user_ids,
      }),
    onSuccess: (ch) => onStarted(ch.channel_id),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not create the group"),
  });

  // Staff with a login, minus the caller (self can't message self).
  const staffWithLogin = useMemo(
    () =>
      (data?.data || []).filter(
        (s): s is StaffRow & { user_id: string } =>
          !!s.user_id && s.user_id !== meId,
      ),
    [data?.data, meId],
  );

  const rows = useMemo(() => {
    if (!q) return staffWithLogin;
    const needle = q.toLowerCase();
    return staffWithLogin.filter(
      (s) =>
        s.display_name?.toLowerCase().includes(needle) ||
        s.job_title?.toLowerCase().includes(needle) ||
        (s.department ?? "").toLowerCase().includes(needle),
    );
  }, [staffWithLogin, q]);

  const selectedRows = useMemo(
    () => staffWithLogin.filter((s) => selected.has(s.user_id)),
    [staffWithLogin, selected],
  );

  // "Select whole department" quick-pick — one chip per unique department in
  // the current search results, added on top of the list.
  const departmentBuckets = useMemo(() => {
    if (mode !== "group") return [];
    const byDept = new Map<string, string[]>();
    for (const s of staffWithLogin) {
      const key = s.department?.trim();
      if (!key) continue;
      const bucket = byDept.get(key) ?? [];
      bucket.push(s.user_id);
      byDept.set(key, bucket);
    }
    return Array.from(byDept.entries())
      .map(([name, ids]) => ({ name, ids }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffWithLogin, mode]);

  function toggle(userId: string) {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function selectDepartment(ids: string[]) {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  const busy = startDm.isPending || createGroup.isPending;

  // ── Header ───────────────────────────────────────────────
  const title = (
    <div className="flex items-center gap-3">
      {mode === "group" && step === "name" ? (
        <button
          onClick={() => setStep("pick")}
          className="grid place-items-center h-8 w-8 rounded-lg text-text-muted hover:bg-panel-2 hover:text-text-primary"
          aria-label="Back to picker"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      <span>
        {mode === "group"
          ? step === "pick"
            ? "New group"
            : "Name your group"
          : "New conversation"}
      </span>
    </div>
  );

  // ── Footer ───────────────────────────────────────────────
  const footer = (() => {
    if (mode === "chat") return null;
    if (step === "pick") {
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-text-muted">
            {selected.size === 0
              ? "Pick at least one colleague"
              : `${selected.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[12.5px] text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep("name")}
              disabled={selected.size === 0}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-bg hover:bg-accent-glow disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setStep("pick")}
          className="rounded-lg px-3 py-1.5 text-[12.5px] text-text-muted hover:text-text-primary"
        >
          Back
        </button>
        <button
          onClick={() =>
            createGroup.mutate({
              name: groupName.trim(),
              member_user_ids: Array.from(selected),
            })
          }
          disabled={!groupName.trim() || busy}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-bg hover:bg-accent-glow disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create group"}
        </button>
      </div>
    );
  })();

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} size="md">
      {/* Mode toggle — hidden on step 2 (naming) */}
      {step === "pick" && (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
          <ModeTab
            active={mode === "chat"}
            onClick={() => {
              setMode("chat");
              setSelected(new Set());
              setError(null);
            }}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Direct message"
          />
          <ModeTab
            active={mode === "group"}
            onClick={() => {
              setMode("group");
              setError(null);
            }}
            icon={<Users className="h-3.5 w-3.5" />}
            label="Group chat"
          />
        </div>
      )}

      {/* ── Step: pick colleagues ─────────────────────── */}
      {step === "pick" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, role, or department…"
              className="w-full rounded-xl border border-line bg-text-primary/[0.04] py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus-visible:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>

          {/* Selected chips (group mode) */}
          {mode === "group" && selectedRows.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-xl bg-panel-2/60 border hairline px-2 py-2">
              {selectedRows.map((s) => (
                <button
                  key={s.user_id}
                  onClick={() => toggle(s.user_id)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 pl-1 pr-2 py-0.5 text-[11.5px] text-text-primary hover:bg-accent/25"
                  title="Remove"
                >
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: getAvatarColour(s.display_name) }}
                  >
                    {getInitials(s.display_name)}
                  </span>
                  <span className="max-w-[140px] truncate">{s.display_name}</span>
                  <X className="h-3 w-3 text-text-muted" />
                </button>
              ))}
              {selectedRows.length > 1 && (
                <button
                  onClick={clearAll}
                  className="ml-auto text-[11px] text-text-muted hover:text-text-primary"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Department quick-picks (group mode only) */}
          {mode === "group" && departmentBuckets.length > 0 && !q && (
            <div className="space-y-1.5">
              <p className="text-[10.5px] uppercase tracking-widest text-text-faint">
                Quick pick — a whole department
              </p>
              <div className="flex flex-wrap gap-1.5">
                {departmentBuckets.map((d) => {
                  const allSelected = d.ids.every((id) => selected.has(id));
                  return (
                    <button
                      key={d.name}
                      onClick={() => selectDepartment(d.ids)}
                      disabled={allSelected}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                        allSelected
                          ? "border-accent/40 bg-accent/10 text-accent-glow"
                          : "hairline text-text-muted hover:bg-panel-2 hover:text-text-primary",
                      )}
                    >
                      <Users className="h-3 w-3" />
                      {d.name}
                      <span className="text-text-faint">· {d.ids.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border hairline bg-panel-2/40">
            {isLoading ? (
              <div className="p-4 text-sm text-text-muted">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-sm text-text-muted">
                No colleagues with a login found.
              </div>
            ) : (
              rows.map((s) => {
                const isSelected = selected.has(s.user_id);
                const onRowClick = () => {
                  if (mode === "chat") startDm.mutate(s.user_id);
                  else toggle(s.user_id);
                };
                return (
                  <button
                    key={s.profile_id}
                    disabled={busy}
                    onClick={onRowClick}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50",
                      isSelected
                        ? "bg-accent/[0.10]"
                        : "hover:bg-accent/[0.06]",
                    )}
                  >
                    {mode === "group" && (
                      <span
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
                          isSelected
                            ? "border-accent bg-accent text-bg"
                            : "border-line",
                        )}
                        aria-hidden
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    )}
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs text-white"
                      style={{ backgroundColor: getAvatarColour(s.display_name) }}
                    >
                      {getInitials(s.display_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">
                        {s.display_name}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {s.job_title || "—"}
                        {s.department ? ` · ${s.department}` : ""}
                      </span>
                    </span>
                    {mode === "chat" && (
                      <MessageSquare className="h-4 w-4 shrink-0 text-text-faint" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {error && (
            <p className="text-[11.5px] text-danger">{error}</p>
          )}
        </div>
      )}

      {/* ── Step: name the group ──────────────────────── */}
      {mode === "group" && step === "name" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-panel-2/60 border hairline px-3 py-2.5">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-glow">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-text-primary">
                {groupName.trim() || "Untitled group"}
              </p>
              <p className="truncate text-[11.5px] text-text-muted">
                {selected.size} member{selected.size === 1 ? "" : "s"} · you'll be
                added as admin
              </p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[11.5px] uppercase tracking-widest text-text-faint">
              Group name
            </span>
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Operations · Faitlyn Hair"
              maxLength={200}
              className="w-full rounded-xl border border-line bg-text-primary/[0.04] px-3 py-2.5 text-sm text-text-primary outline-none focus-visible:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </label>

          {/* Recap of who's in — a soft nudge that Back still edits the list */}
          <div className="space-y-1.5">
            <p className="text-[10.5px] uppercase tracking-widest text-text-faint">
              Members
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedRows.map((s) => (
                <span
                  key={s.user_id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 border hairline pl-1 pr-2.5 py-0.5 text-[11px] text-text-muted"
                >
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: getAvatarColour(s.display_name) }}
                  >
                    {getInitials(s.display_name)}
                  </span>
                  {s.display_name}
                </span>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[11.5px] text-danger">{error}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] transition-colors",
        active
          ? "bg-accent text-bg"
          : "text-text-muted hover:bg-panel hover:text-text-primary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
