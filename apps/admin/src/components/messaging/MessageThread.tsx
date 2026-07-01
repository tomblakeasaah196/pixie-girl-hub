import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Paperclip,
  Smile,
  Reply,
  Pencil,
  X,
  Info,
  Pin,
  BellOff,
  Archive,
  CheckCircle2,
  ChevronLeft,
  Link2,
  Loader2,
  AlertTriangle,
  Sparkles,
  ShoppingCart,
  Mic,
  Search,
  Users,
  Package,
} from "lucide-react";
import {
  fmtDayLabel,
  getAvatarColour,
  getChannelDisplayName,
  getChannelPlatform,
  getInitials,
  isSameDay,
} from "@/lib/messaging-utils";
import {
  useChannel,
  useChannelRealtime,
  useMessages,
  useQuickReplies,
  useTypingIndicator,
} from "@/hooks/useSmartcomm";
import { useAuthStore } from "@/stores/auth";
import { useActiveBusiness } from "@/stores/business";
import { smartcommApi, onboardingApi } from "@/lib/smartcomm-api";
import { emitTyping } from "@/lib/socket";
import { cn } from "@/lib/cn";
import { useUploadProgress } from "@/lib/use-upload";
import { isHeicFile } from "@/lib/heic";
import { UploadProgress } from "@/components/ui/UploadProgress";
import type { Channel, Message, QuickReply } from "@/lib/smartcomm-types";
import { MessageBubble } from "./MessageBubble";
import { WhatsAppWindowBadge } from "./WhatsAppWindowBadge";
import { PlatformPill } from "./PlatformPill";
import { CostInfoModal } from "./CostInfoModal";
import { OrderCaptureModal } from "./OrderCaptureModal";
import { ForwardModal } from "./ForwardModal";
import { GroupInfoModal } from "./GroupInfoModal";
import { ThreadSearch } from "./ThreadSearch";
import { VoiceRecorder } from "./VoiceRecorder";
import { CataloguePickerModal } from "./CataloguePickerModal";
import { QuickReplyVarsModal } from "./QuickReplyVarsModal";

interface Props {
  channelId: string;
  onBack?: () => void;
  onResolve?: () => void;
}

export function MessageThread({ channelId, onBack, onResolve }: Props) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { key: businessKey } = useActiveBusiness();
  const { data: channel } = useChannel(channelId);
  const { data: messages = [], isLoading } = useMessages(channelId);
  useChannelRealtime(channelId);

  const typingUserIds = useTypingIndicator(channelId, user?.id);

  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [orderCaptureOpen, setOrderCaptureOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [varReply, setVarReply] = useState<QuickReply | null>(null);
  const [praxisDrafted, setPraxisDrafted] = useState(false);
  const [busy, setBusy] = useState<"sending" | "uploading" | "drafting" | null>(
    null,
  );
  const { progress: uploadProgress, run: runUpload } = useUploadProgress();
  const [error, setError] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    end: number;
  } | null>(null);

  const canPraxis = useAuthStore((s) => s.can);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);

  // Quick replies — slash-command trigger.
  const { data: quickReplies = [] } = useQuickReplies();
  const slashOpen = content.startsWith("/") && content.length > 1;
  const slashQuery = content.slice(1).toLowerCase();
  const slashMatches = useMemo(
    () =>
      slashOpen
        ? quickReplies
            .filter(
              (q) =>
                q.slug.toLowerCase().includes(slashQuery) ||
                q.title.toLowerCase().includes(slashQuery),
            )
            .slice(0, 5)
        : [],
    [slashOpen, slashQuery, quickReplies],
  );

  // @mention autocomplete — internal/group channels.
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    return (channel?.members ?? [])
      .filter(
        (m) =>
          m.user_id &&
          m.user_id !== user?.id &&
          m.user_display_name &&
          (m.user_display_name as string).toLowerCase().includes(mention.query),
      )
      .slice(0, 6);
  }, [mention, channel?.members, user?.id]);

  const platform = channel ? getChannelPlatform(channel) : "internal";
  const isWhatsapp = platform === "whatsapp";
  const isInstagram = platform === "instagram";
  const windowOpen = useMemo(() => {
    if (!channel?.wa_window_expires_at) return platform !== "whatsapp";
    return new Date(channel.wa_window_expires_at).getTime() > Date.now();
  }, [channel?.wa_window_expires_at, platform]);

  const composerLocked = isWhatsapp && !windowOpen && !editing;

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mark read when the thread opens / new messages arrive
  useEffect(() => {
    if (!messages.length) return;
    const lastId = messages[messages.length - 1]?.message_id;
    smartcommApi
      .markRead(channelId, lastId)
      .then(() => qc.invalidateQueries({ queryKey: ["smartcomm", "unread"] }))
      .catch(() => {});
  }, [channelId, messages.length, qc]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["smartcomm", "messages", channelId] });
    qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
  }

  function resetTextarea() {
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  async function handleSend() {
    setError(null);
    const text = content.trim();
    if (!text) return;
    try {
      setBusy("sending");
      if (editing) {
        await smartcommApi.editMessage(editing.message_id, text);
        setEditing(null);
      } else {
        await smartcommApi.postMessage(channelId, {
          content: text,
          message_type: "text",
          reply_to_id: replyTo?.message_id,
        });
        setReplyTo(null);
      }
      resetTextarea();
      setPraxisDrafted(false);
      invalidate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
    if (e.key === "Escape" && (replyTo || editing)) {
      setReplyTo(null);
      setEditing(null);
      setContent("");
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
    // @mention detection (internal/group threads only).
    const caret = e.target.selectionStart ?? value.length;
    const mm = /(^|\s)@(\w*)$/.exec(value.slice(0, caret));
    if (mm && channel?.channel_type !== "customer_thread") {
      setMention({
        query: mm[2].toLowerCase(),
        start: caret - mm[2].length - 1,
        end: caret,
      });
    } else if (mention) {
      setMention(null);
    }
    const now = Date.now();
    if (now - lastTyping.current > 1500) {
      lastTyping.current = now;
      emitTyping(channelId);
    }
  }

  function applyMention(name: string) {
    if (!mention) return;
    const next = `${content.slice(0, mention.start)}@${name} ${content.slice(
      mention.end,
    )}`;
    setContent(next);
    setMention(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      void handleFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  }

  async function handleVoiceNote(blob: Blob) {
    setRecording(false);
    const ext = blob.type.includes("ogg")
      ? "ogg"
      : blob.type.includes("mp4")
        ? "m4a"
        : "webm";
    const file = new File([blob], `voice-${Date.now()}.${ext}`, {
      type: blob.type || "audio/webm",
    });
    await handleFiles([file]);
  }

  function jumpToMessage(messageId: string) {
    setSearchOpen(false);
    setHighlightId(messageId);
    requestAnimationFrame(() => {
      document
        .getElementById(`msg-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(() => setHighlightId(null), 2200);
  }

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy("uploading");
    setError(null);
    try {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const form = new FormData();
        form.append("file", file);
        form.append("business", businessKey ?? "shared");
        form.append("document_type", "message_attachment");
        form.append("title", file.name);
        const { document_id } = await runUpload((onProgress) =>
          postFormJson<{ document_id: string }>("/documents", form, (p) =>
            onProgress(Math.round(((i + p / 100) / list.length) * 100)),
          ),
        );
        // HEIC often arrives with an empty mime on desktop; treat it as an
        // image (the server converts it to JPEG) so it renders inline, not as
        // a document link.
        const type = file.type.startsWith("image/") || isHeicFile(file)
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "voice_note"
              : "document";
        await smartcommApi.postMessage(channelId, {
          message_type: type,
          attachments: [{ document_id, display_name: file.name }],
          content: content.trim() || undefined,
        });
      }
      resetTextarea();
      invalidate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  function insertReplyBody(body: string) {
    setContent(body);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        el.focus();
      }
    });
  }

  async function applyQuickReply(slug: string) {
    const r = quickReplies.find((q) => q.slug === slug);
    if (!r) return;
    if (r.variables && r.variables.length > 0) {
      setVarReply(r);
      return;
    }
    insertReplyBody(r.body);
  }

  async function sendOnboardingLink() {
    if (!channel || !businessKey) return;
    try {
      setBusy("sending");
      const { url } = await onboardingApi.createLink({
        business: businessKey,
        channel_id: channel.channel_id,
        source: "online",
      });
      const body = `Welcome 🌹 We'd love to make sure your order reaches you exactly the way you want. Could you fill in this quick form (60 sec) — it covers your delivery address & preferences:\n\n${url}`;
      await smartcommApi.postMessage(channelId, {
        content: body,
        message_type: "text",
      });
      invalidate();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Could not send onboarding link",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDraftWithPraxis() {
    setError(null);
    try {
      setBusy("drafting");
      const draft = await smartcommApi.draftWithPraxis(channelId);
      setContent(draft.content || "");
      setPraxisDrafted(true);
      // Auto-resize the textarea to the new content
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          el.focus();
        }
      });
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Praxis couldn't draft a reply",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendOrderCaptureLink(url: string) {
    const body = `Here's your order link — just confirm your address and pay 🛍️\n\n${url}`;
    await smartcommApi.postMessage(channelId, {
      content: body,
      message_type: "text",
    });
    invalidate();
  }

  if (!channel) {
    return (
      <div className="grid h-full place-items-center text-text-faint text-[13px]">
        Select a conversation
      </div>
    );
  }

  const displayName = getChannelDisplayName(channel, user?.id);
  const isCustomerThread = channel.channel_type === "customer_thread";
  const isResolved = channel.status === "resolved";

  const typingNames = typingUserIds
    .map(
      (uid) =>
        channel.members?.find((m) => m.user_id === uid)?.user_display_name,
    )
    .filter(Boolean) as string[];
  const emailSubject =
    platform === "email"
      ? (channel.metadata?.subject as string | undefined)
      : undefined;
  const subtitle = typingNames.length
    ? `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`
    : emailSubject
      ? `✉ ${emailSubject}`
      : channel.channel_type === "customer_thread"
        ? `Customer · ${platform}`
        : `${(channel.members ?? []).length} members`;

  return (
    <div
      className="relative flex h-full flex-col bg-bg"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/80 backdrop-blur-sm border-2 border-dashed border-accent/50 rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent-glow">
            <Paperclip className="w-7 h-7" />
            <span className="text-[13px]">Drop files to send</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 border-b hairline px-4 py-2.5">
        {onBack && (
          <button
            onClick={onBack}
            className="lg:hidden text-text-muted hover:text-text-primary"
            title="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div
          className="grid place-items-center w-9 h-9 rounded-full text-[12px] font-semibold text-white shrink-0"
          style={{ backgroundColor: getAvatarColour(displayName) }}
        >
          {getInitials(displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
            <span className="truncate">{displayName}</span>
            <PlatformPill platform={platform} />
          </div>
          <p
            className={cn(
              "truncate text-[11.5px]",
              typingNames.length ? "text-accent-glow" : "text-text-muted",
            )}
          >
            {subtitle}
          </p>
        </div>

        <button
          onClick={() => setSearchOpen((v) => !v)}
          title="Search in conversation"
          className={cn(
            "text-text-muted hover:text-text-primary",
            searchOpen && "text-accent-glow",
          )}
        >
          <Search className="w-4 h-4" />
        </button>
        {channel.channel_type === "group" && (
          <button
            onClick={() => setGroupOpen(true)}
            title="Group info"
            className="text-text-muted hover:text-text-primary"
          >
            <Users className="w-4 h-4" />
          </button>
        )}
        {isWhatsapp && channel.wa_window_expires_at && (
          <WhatsAppWindowBadge expiresAt={channel.wa_window_expires_at} />
        )}
        {(isWhatsapp || isInstagram) && (
          <button
            onClick={() => setCostOpen(true)}
            title="Why this matters"
            className="text-text-muted hover:text-text-primary"
          >
            <Info className="w-4 h-4" />
          </button>
        )}

        <ThreadMenu
          channel={channel}
          onResolve={onResolve}
          onChanged={() =>
            qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] })
          }
        />
      </div>

      {/* In-thread search */}
      {searchOpen && (
        <ThreadSearch
          channelId={channelId}
          onJump={jumpToMessage}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-2.5">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={cn("flex gap-2", i % 2 === 0 && "flex-row-reverse")}
              >
                <div className="h-7 w-7 rounded-full bg-panel-2 animate-pulse" />
                <div className="h-12 w-48 rounded-2xl bg-panel-2 animate-pulse" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-text-faint text-[12.5px]">
            No messages yet — say hello 👋
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const isOwn = !!user && m.sender_user_id === user.id;
            const newDay = !prev || !isSameDay(prev.created_at, m.created_at);
            const showName =
              !isOwn &&
              m.message_type !== "system" &&
              m.sender_user_id !== prev?.sender_user_id;
            return (
              <div
                key={m.message_id}
                id={`msg-${m.message_id}`}
                className={cn(
                  "rounded-xl transition-colors",
                  highlightId === m.message_id &&
                    "bg-accent/10 ring-1 ring-accent/40",
                )}
              >
                {newDay && (
                  <div className="flex justify-center py-1.5">
                    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-panel-2 border hairline text-text-faint">
                      {fmtDayLabel(m.created_at)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  isOwn={isOwn}
                  showSenderName={showName}
                  isEmail={platform === "email"}
                  actions={{
                    onReply: setReplyTo,
                    onEdit: (msg) => {
                      setReplyTo(null);
                      setEditing(msg);
                      setContent(msg.content ?? "");
                      textareaRef.current?.focus();
                    },
                    onDelete: async (msg) => {
                      await smartcommApi.deleteMessage(msg.message_id);
                      invalidate();
                    },
                    onForward: (msg) => setForwardMsg(msg),
                    onStar: async (msg) => {
                      await smartcommApi.starMessage(msg.message_id);
                      invalidate();
                    },
                    onReact: async (msg, emoji) => {
                      await smartcommApi.reactToMessage(msg.message_id, emoji);
                      invalidate();
                    },
                  }}
                />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply / edit banner */}
      {(replyTo || editing) && (
        <div className="mx-3 sm:mx-4 mb-1 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
          {editing ? (
            <Pencil className="w-3.5 h-3.5 text-accent-glow shrink-0" />
          ) : (
            <Reply className="w-3.5 h-3.5 text-accent-glow shrink-0" />
          )}
          <p className="flex-1 truncate text-[12px] text-text-muted">
            {editing
              ? "Editing message"
              : `${replyTo?.sender_name ?? "Reply"}: ${replyTo?.content ?? ""}`}
          </p>
          <button
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              if (editing) setContent("");
            }}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Praxis-drafted chip */}
      {praxisDrafted && content && (
        <div className="mx-3 sm:mx-4 mb-1 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11.5px] text-text-muted">
          <Sparkles className="w-3.5 h-3.5 text-accent-glow shrink-0" />
          <span className="flex-1">
            Praxis drafted this — edit before sending, or hit Send if it sounds
            right.
          </span>
          <button
            onClick={() => {
              setPraxisDrafted(false);
              setContent("");
              if (textareaRef.current)
                textareaRef.current.style.height = "auto";
            }}
            className="text-text-faint hover:text-text-primary"
            title="Discard draft"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Slash quick-reply menu */}
      {slashOpen && slashMatches.length > 0 && (
        <div className="mx-3 sm:mx-4 mb-1 rounded-xl border hairline bg-panel-2 max-h-44 overflow-y-auto">
          {slashMatches.map((r) => (
            <button
              key={r.reply_id}
              onClick={() => applyQuickReply(r.slug)}
              className="block w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-accent-glow">/{r.slug}</span>
                <span className="text-text-muted text-[11.5px]">{r.title}</span>
              </div>
              <p className="text-text-faint text-[11px] truncate">{r.body}</p>
            </button>
          ))}
        </div>
      )}

      {/* @mention menu */}
      {mention && mentionMatches.length > 0 && (
        <div className="mx-3 sm:mx-4 mb-1 rounded-xl border hairline bg-panel-2 max-h-44 overflow-y-auto">
          {mentionMatches.map((m) => (
            <button
              key={m.user_id}
              onClick={() => applyMention(m.user_display_name as string)}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel"
            >
              <span
                className="grid place-items-center w-6 h-6 rounded-full text-[9px] font-semibold text-white shrink-0"
                style={{
                  backgroundColor: getAvatarColour(
                    m.user_display_name as string,
                  ),
                }}
              >
                {getInitials(m.user_display_name as string)}
              </span>
              <span className="text-accent-glow">@{m.user_display_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      {!isResolved && (
        <div className="border-t hairline px-3 sm:px-4 py-2.5">
          {composerLocked && (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-[2px] shrink-0" />
              <div>
                WhatsApp 24-hour window has closed. Send an approved template
                from quick-replies, or message the customer via email. Free-form
                replies will be rejected by Meta.
              </div>
            </div>
          )}

          {error && (
            <div className="mb-2 text-[11.5px] text-danger">{error}</div>
          )}

          {recording ? (
            <VoiceRecorder
              onComplete={(b) => handleVoiceNote(b)}
              onCancel={() => setRecording(false)}
            />
          ) : (
            <div className="space-y-2">
              {uploadProgress !== null && (
                <UploadProgress value={uploadProgress} label="Attaching…" />
              )}
              <div className="flex items-end gap-2">
              <div className="relative flex-1 rounded-2xl border hairline bg-panel-2">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={handleChange}
                  onKeyDown={handleKey}
                  onPaste={handlePaste}
                  placeholder={
                    composerLocked
                      ? "Free-form blocked — use a template"
                      : "Type a message… (Enter = send, Shift+Enter = newline, '/' = quick reply)"
                  }
                  rows={1}
                  disabled={composerLocked && !editing}
                  className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[13px] focus:outline-none placeholder:text-text-faint disabled:opacity-50"
                  style={{ maxHeight: 120 }}
                />
                <div className="flex items-center gap-1 border-t hairline px-2 py-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 text-text-faint hover:text-text-primary"
                    disabled={busy === "uploading"}
                    title="Attach file"
                  >
                    {busy === "uploading" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Paperclip className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => setRecording(true)}
                    className="p-1 text-text-faint hover:text-text-primary disabled:opacity-40"
                    disabled={composerLocked}
                    title="Record voice note"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  {isCustomerThread && (
                    <button
                      onClick={sendOnboardingLink}
                      className="p-1 text-text-faint hover:text-text-primary"
                      title="Send Online QR welcome form"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  )}
                  {isCustomerThread && (
                    <button
                      onClick={() => setOrderCaptureOpen(true)}
                      className="p-1 text-text-faint hover:text-text-primary"
                      title="Capture an order"
                    >
                      <ShoppingCart className="w-4 h-4" />
                    </button>
                  )}
                  {isCustomerThread && (
                    <button
                      onClick={() => setCatalogueOpen(true)}
                      className="p-1 text-text-faint hover:text-text-primary"
                      title="Share catalogue"
                    >
                      <Package className="w-4 h-4" />
                    </button>
                  )}
                  {canPraxis("praxis_ai", "view") && (
                    <button
                      onClick={handleDraftWithPraxis}
                      disabled={busy === "drafting"}
                      className="p-1 text-accent-glow hover:text-accent disabled:opacity-50"
                      title="Draft with Praxis"
                    >
                      {busy === "drafting" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const e = "👍";
                      setContent((c) => c + e);
                      textareaRef.current?.focus();
                    }}
                    className="p-1 text-text-faint hover:text-text-primary"
                    title="Emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  <span className="ml-1 text-[10px] text-text-faint">
                    / = quick reply
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      void handleFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              <button
                onClick={handleSend}
                disabled={
                  !content.trim() || busy === "sending" || composerLocked
                }
                className={cn(
                  "grid place-items-center w-10 h-10 rounded-2xl shrink-0 transition-all",
                  "bg-accent text-bg hover:bg-accent-glow disabled:opacity-40",
                )}
                title={editing ? "Save edit" : "Send"}
              >
                {busy === "sending" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Forward picker */}
      <ForwardModal
        open={!!forwardMsg}
        message={forwardMsg}
        currentUserId={user?.id}
        onClose={() => setForwardMsg(null)}
        onDone={invalidate}
      />

      {/* Group info */}
      {channel.channel_type === "group" && (
        <GroupInfoModal
          open={groupOpen}
          channel={channel}
          currentUserId={user?.id}
          onClose={() => setGroupOpen(false)}
          onChanged={() =>
            qc.invalidateQueries({
              queryKey: ["smartcomm", "channel", channelId],
            })
          }
          onLeft={onBack}
        />
      )}

      {/* Order Capture modal */}
      <OrderCaptureModal
        open={orderCaptureOpen}
        onClose={() => setOrderCaptureOpen(false)}
        channel={channel}
        onSentLink={sendOrderCaptureLink}
      />

      {/* Catalogue carousel picker */}
      <CataloguePickerModal
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        channel={channel}
        onSent={invalidate}
      />

      {/* Quick-reply variable fill */}
      <QuickReplyVarsModal
        reply={varReply}
        prefill={{ customer_name: displayName }}
        onCancel={() => setVarReply(null)}
        onApply={(body) => {
          setVarReply(null);
          insertReplyBody(body);
        }}
      />

      {/* Cost-info modal */}
      <CostInfoModal
        open={costOpen}
        onClose={() => setCostOpen(false)}
        platform={platform}
        windowOpen={windowOpen}
        windowExpiresAt={channel.wa_window_expires_at}
      />
    </div>
  );
}

// ── Header dropdown menu ──────────────────────────────────

function ThreadMenu({
  channel,
  onResolve,
  onChanged,
}: {
  channel: Channel;
  onResolve?: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-text-muted hover:text-text-primary"
        title="More"
      >
        <span className="text-[18px] leading-none">⋯</span>
      </button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-xl bg-panel border hairline shadow-xl overflow-hidden text-[12.5px]">
            <button
              onClick={async () => {
                setOpen(false);
                await smartcommApi.pinChannel(
                  channel.channel_id,
                  !channel.is_pinned,
                );
                onChanged();
              }}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary"
            >
              <Pin className="w-3.5 h-3.5" />
              {channel.is_pinned ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={async () => {
                setOpen(false);
                await smartcommApi.muteChannel(
                  channel.channel_id,
                  !channel.muted_until,
                  8,
                );
                onChanged();
              }}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary"
            >
              <BellOff className="w-3.5 h-3.5" />
              {channel.muted_until ? "Unmute" : "Mute for 8h"}
            </button>
            {channel.channel_type === "customer_thread" && (
              <button
                onClick={async () => {
                  setOpen(false);
                  await smartcommApi.resolveThread(channel.channel_id);
                  onChanged();
                  onResolve?.();
                }}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Resolve thread
              </button>
            )}
            <button
              onClick={async () => {
                setOpen(false);
                await smartcommApi.archiveChannel(channel.channel_id, true);
                onChanged();
              }}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-panel-2 text-danger"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Form upload helper (the messaging composer needs raw FormData) ──

async function postFormJson<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  const { api } = await import("@/lib/api");
  return api.postForm<T>(path, form, { onProgress });
}
