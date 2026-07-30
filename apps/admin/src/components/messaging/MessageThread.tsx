import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type Ref,
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
  Mic,
  Search,
  Users,
  Package,
  Phone,
  MessageCircle,
  LayoutTemplate,
  MapPin,
  Clock,
  Camera,
  FileText,
  Zap,
  Image as ImageIcon,
  type LucideIcon,
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
  useComposerSettings,
  useMessages,
  useQuickReplies,
  useTypingIndicator,
} from "@/hooks/useSmartcomm";
import { useAuthStore } from "@/stores/auth";
import { useActiveBusiness } from "@/stores/business";
import { useIsPhone } from "@/hooks/useMediaQuery";
import { smartcommApi, onboardingApi } from "@/lib/smartcomm-api";
import { emitTyping } from "@/lib/socket";
import { cn } from "@/lib/cn";
import { toastReport } from "@/lib/error-report";
import { useUploadProgress } from "@/lib/use-upload";
import { isHeicFile } from "@/lib/heic";
import {
  htmlToPlainText,
  isRichHtmlEmpty,
  textToMailHtml,
} from "@/lib/html-mail";
import { InThreadCallBanner } from "@/components/calls/InThreadCallBanner";
import { RichMailEditor } from "@/components/marketing/RichMailEditor";
import { UploadProgress } from "@/components/ui/UploadProgress";
import type {
  Channel,
  ComposerSettingsInput,
  Message,
  MessageType,
  QuickReply,
} from "@/lib/smartcomm-types";
import { MessageBubble } from "./MessageBubble";
import { WhatsAppWindowBadge } from "./WhatsAppWindowBadge";
import { PlatformPill } from "./PlatformPill";
import { CostInfoModal } from "./CostInfoModal";
import { ForwardModal } from "./ForwardModal";
import { GroupInfoModal } from "./GroupInfoModal";
import { ThreadSearch } from "./ThreadSearch";
import { VoiceRecorder } from "./VoiceRecorder";
import { CataloguePickerModal } from "./CataloguePickerModal";
import { QuickReplyVarsModal } from "./QuickReplyVarsModal";
import { EmojiPicker } from "./EmojiPicker";
import {
  ComposerActionSheet,
  type ComposerAction,
} from "./ComposerActionSheet";
import {
  TemplatePickerModal,
  type TemplateSendPayload,
} from "./TemplatePickerModal";

interface Props {
  channelId: string;
  onBack?: () => void;
  onResolve?: () => void;
}

/**
 * The composer's editable stock messages. Each one inserts brand copy the
 * operator can edit before sending, then optionally save back as this
 * brand's new default (the "save as default" chip).
 */
type StockKind = "onboarding" | "whatsapp" | "address" | "hours";

/** Which composer-settings field each stock message persists to. */
const STOCK_FIELD: Record<StockKind, keyof ComposerSettingsInput> = {
  onboarding: "onboarding_template",
  whatsapp: "whatsapp_handoff_template",
  address: "address_template",
  hours: "hours_template",
};

/** Chip copy — what was just dropped into the composer. */
const STOCK_CHIP_LABEL: Record<StockKind, string> = {
  onboarding: "Welcome-form message ready",
  whatsapp: "WhatsApp follow-up ready",
  address: "Our address ready",
  hours: "Our working hours ready",
};

/**
 * Fill a saved stock template with its live value.
 *
 * Note the deliberate difference from the {link} / {number} inserts: those
 * append the value when the placeholder has been edited away, because a
 * welcome link is minted per-chat and a message without it is useless.
 * The address and hours are static text, so an operator who saved wording
 * with the value typed straight into the sentence ("we close at 7 on
 * Saturdays") must NOT get the old value appended underneath it.
 */
function fillStock(
  template: string | undefined,
  token: string,
  value: string,
): string {
  if (!template) return value;
  return template.includes(token)
    ? template.split(token).join(value)
    : template;
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
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [varReply, setVarReply] = useState<QuickReply | null>(null);
  const [praxisDrafted, setPraxisDrafted] = useState(false);
  const [praxisMode, setPraxisMode] = useState<"reply" | "followup">("reply");
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  // The attachment sheet — one paperclip behind which every "put something
  // in this message" action lives (files, catalogue, stock answers).
  const [attachOpen, setAttachOpen] = useState(false);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  // Quick replies opened deliberately (from the sheet) rather than by
  // typing "/" — same panel, both surfaces.
  const [qrOpen, setQrOpen] = useState(false);
  // After a stock message (Online form link / WhatsApp handoff / our
  // address / our working hours) is inserted into the composer, this chip
  // lets the operator persist any edits as the new brand default.
  // `token`/`value` let us swap the live URL/number/address/hours back to
  // its {placeholder} before saving.
  const [templateChip, setTemplateChip] = useState<{
    kind: StockKind;
    token: string;
    value: string;
    saving?: boolean;
    saved?: boolean;
  } | null>(null);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    end: number;
  } | null>(null);
  // Email composer extras (customer email threads only): a subject line, an
  // optional Cc, and files STAGED to send together with the next message —
  // an email is one letter (body + subject + Cc + all attachments), unlike
  // WhatsApp/IG where each file is its own immediate bubble.
  const [subjectDraft, setSubjectDraft] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [showCc, setShowCc] = useState(false);
  // Gmail-style rich email body (HTML). Email threads compose here instead of
  // the plain textarea; the plain-text shadow is derived on send.
  const [emailHtml, setEmailHtml] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { document_id: string; display_name: string; kind: MessageType }[]
  >([]);
  // Seed the subject from the thread's stored subject once per channel (only
  // when the operator hasn't started typing their own).
  const subjectSeededRef = useRef<string | null>(null);

  const canPraxis = useAuthStore((s) => s.can);
  const { data: composerSettings } = useComposerSettings();
  // Phones get the WhatsApp treatment: a bottom sheet for attachments and a
  // Camera entry (a desktop "camera" tile would just re-open the file dialog).
  const isPhone = useIsPhone();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  // Tracks which channel we've already jumped to the bottom for. On a
  // channel switch (or the first render with messages) we do an INSTANT
  // jump; subsequent new messages get the smooth animation. Storing the
  // channelId (not a boolean) so switching to a different channel and
  // back still triggers the initial jump.
  const initialJumpedRef = useRef<string | null>(null);
  const lastLenRef = useRef(0);

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
  const isEmail = platform === "email";
  // Whether the rich email editor is the active composer (vs the plain
  // textarea). Editing an existing message always uses the textarea.
  const emailRich = isEmail && !editing;
  // The composer's text regardless of which surface it lives on — used by the
  // Praxis / stock-message chips and the "save as default" flow.
  const composerText = useMemo(
    () => (emailRich ? htmlToPlainText(emailHtml) : content),
    [emailRich, emailHtml, content],
  );
  const windowOpen = useMemo(() => {
    if (!channel?.wa_window_expires_at) return platform !== "whatsapp";
    return new Date(channel.wa_window_expires_at).getTime() > Date.now();
  }, [channel?.wa_window_expires_at, platform]);

  // Instagram's 24h window closing doesn't lock the composer the way
  // WhatsApp's does — Meta still accepts replies tagged HUMAN_AGENT
  // (requires app approval), so sends just carry that tag + a banner
  // tells the operator what's happening.
  const igWindowClosed = useMemo(() => {
    if (!isInstagram || !channel?.ig_window_expires_at) return false;
    return new Date(channel.ig_window_expires_at).getTime() <= Date.now();
  }, [isInstagram, channel?.ig_window_expires_at]);

  const composerLocked = isWhatsapp && !windowOpen && !editing;

  // The right-hand key is a mic until there's something to send, then the
  // send key — WhatsApp's single most-copied interaction. Email never shows
  // the mic (no voice notes in a letter), and neither does a closed
  // WhatsApp window (nothing free-form can leave it — the banner above
  // carries the template CTA instead).
  const hasBody = emailRich
    ? !isRichHtmlEmpty(emailHtml) || pendingFiles.length > 0
    : !!content.trim();
  const canSend = hasBody || emailRich || composerLocked;
  const sendBlocked =
    !hasBody || busy === "sending" || busy === "uploading" || composerLocked;

  // Opening a thread should land on the newest message — the customer
  // just wrote it. The old effect scrolled smoothly on messages.length
  // changes only, so (a) switching between two channels that both hold
  // N messages left the pane pinned to the top, and (b) even on the 0→N
  // transition the smooth animation raced image lazy-loading and the
  // newest bubble stayed below the fold. Reset the "have we jumped"
  // tracker on every channelId change so the transition below always
  // fires an instant jump.
  useLayoutEffect(() => {
    initialJumpedRef.current = null;
    lastLenRef.current = 0;
  }, [channelId]);

  // Reset the email composer extras when switching threads so a staged
  // attachment or Cc never leaks from one customer to the next. Any open
  // composer surface (attachment sheet, quick replies) closes too — a sheet
  // left hanging over a different customer's thread invites a misfire.
  useEffect(() => {
    setPendingFiles([]);
    setCcInput("");
    setShowCc(false);
    setSubjectDraft("");
    setEmailHtml("");
    setAttachOpen(false);
    setQrOpen(false);
    setEmojiOpen(false);
    subjectSeededRef.current = null;
  }, [channelId]);

  // Seed the subject from the thread's stored subject once the channel has
  // loaded (guarded so re-renders / the operator clearing it don't re-seed).
  useEffect(() => {
    if (platform !== "email" || !channel) return;
    if (subjectSeededRef.current === channelId) return;
    subjectSeededRef.current = channelId;
    setSubjectDraft(String(channel.metadata?.subject ?? ""));
  }, [channelId, channel, platform]);

  // Then, in a useLayoutEffect (so it runs BEFORE paint), pin the
  // scroll container to its bottom on the first render carrying any
  // messages for this channel, and smooth-scroll on any further
  // append. A rAF nudge follows the instant jump so late-arriving
  // image heights don't leave the operator scrolled above the bottom.
  useLayoutEffect(() => {
    if (!messages.length) return;
    const container = scrollRef.current;
    if (initialJumpedRef.current !== channelId) {
      if (container) container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      initialJumpedRef.current = channelId;
      lastLenRef.current = messages.length;
      return;
    }
    // Only smooth-scroll when a NEW message was appended so an unrelated
    // re-render (edit, reaction, read-receipt) doesn't yank the operator
    // away from a message they scrolled up to read.
    if (messages.length > lastLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    lastLenRef.current = messages.length;
  }, [channelId, messages.length]);

  // Mark read when the thread opens / new messages arrive. Invalidate both
  // the global unread counter AND the channel list — the list is what
  // actually feeds each row's own badge/bold state, and it was being left
  // stale here (only the socket round-trip via useInboxRealtime cleared it,
  // which is silently skipped when the Redis broadcaster is unavailable —
  // see smartcomm.realtime.js). Without this the conversation you're
  // actively reading kept showing as unread until the next 60s poll.
  useEffect(() => {
    if (!messages.length) return;
    const lastId = messages[messages.length - 1]?.message_id;
    smartcommApi
      .markRead(channelId, lastId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["smartcomm", "unread"] });
        qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
      })
      .catch(() => {});
  }, [channelId, messages.length, qc]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["smartcomm", "messages", channelId] });
    qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
  }

  function resetTextarea() {
    setContent("");
    setTemplateChip(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  /** Parse a raw Cc field into a clean, de-duplicated list of addresses. */
  function parseCc(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[,;\s]+/)) {
      const e = part.trim().toLowerCase();
      if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
    return out;
  }

  // Email threads send the rich body + subject + Cc + all staged files as ONE
  // branded letter, so they take a dedicated path.
  async function handleSendEmail() {
    setError(null);
    if (editing) {
      // Edits are plain content updates via the textarea — no envelope.
      const text = content.trim();
      if (!text) return;
      try {
        setBusy("sending");
        await smartcommApi.editMessage(editing.message_id, text);
        setEditing(null);
        resetTextarea();
        invalidate();
      } catch (e: unknown) {
        toastReport("Messaging → Thread", "Send message", e);
        setError(e instanceof Error ? e.message : "Could not send");
      } finally {
        setBusy(null);
      }
      return;
    }
    // Compose comes from the Gmail-style rich editor: HTML is what goes out,
    // with a plain-text shadow for the thread / search / preheader.
    const html = emailHtml;
    const hasBody = !isRichHtmlEmpty(html);
    const plain = htmlToPlainText(html).trim();
    if (!hasBody && pendingFiles.length === 0) return;
    const cc = showCc ? parseCc(ccInput) : [];
    const attachments = pendingFiles.map((f) => ({
      document_id: f.document_id,
      display_name: f.display_name,
    }));
    // One file → its natural type (renders inline in the thread); several,
    // or none, → "document" so mixed staged files still render per-mime.
    const message_type: MessageType =
      attachments.length === 0
        ? "text"
        : pendingFiles.length === 1
          ? pendingFiles[0].kind
          : "document";
    try {
      setBusy("sending");
      await smartcommApi.postMessage(channelId, {
        content: plain || undefined,
        body_html: hasBody ? html : undefined,
        message_type,
        reply_to_id: replyTo?.message_id,
        subject: subjectDraft.trim() || undefined,
        cc: cc.length ? cc : undefined,
        attachments: attachments.length ? attachments : undefined,
      });
      setReplyTo(null);
      resetTextarea();
      setEmailHtml("");
      setPendingFiles([]);
      // Clear the Cc after each send so a later reply doesn't silently keep
      // copying third parties. Subject stays (it's the thread's subject).
      setCcInput("");
      setShowCc(false);
      setPraxisDrafted(false);
      invalidate();
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Send message", e);
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    if (isEmail) return handleSendEmail();
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
          is_human_agent: igWindowClosed || undefined,
        });
        setReplyTo(null);
      }
      resetTextarea();
      setPraxisDrafted(false);
      invalidate();
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Send message", e);
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  async function sendTemplate(payload: TemplateSendPayload) {
    setError(null);
    setSendingTemplate(true);
    try {
      await smartcommApi.postMessage(channelId, {
        message_type: "template",
        content: payload.rendered_body,
        is_template: true,
        metadata: {
          template_name: payload.template_name,
          language: payload.language,
          category: payload.category,
          template_id: payload.template_id,
          components: payload.components,
        },
      });
      setTemplatePickerOpen(false);
      invalidate();
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Send template", e);
      setError(e instanceof Error ? e.message : "Could not send template");
    } finally {
      setSendingTemplate(false);
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

  /** Map a File to the smartcomm message_type used for rendering. HEIC often
   *  arrives with an empty mime on desktop; treat it as an image (the server
   *  converts it to JPEG) so it renders inline, not as a document link. */
  function fileKind(file: File): MessageType {
    if (file.type.startsWith("image/") || isHeicFile(file)) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "voice_note";
    return "document";
  }

  /** Upload one file to the documents store, returning its id. `mapPct`
   *  turns this file's 0-100 progress into the aggregate bar percentage. */
  async function uploadFile(
    file: File,
    mapPct?: (p: number) => number,
  ): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    form.append("document_type", "message_attachment");
    form.append("title", file.name);
    const { document_id } = await runUpload((report) =>
      postFormJson<{ document_id: string }>("/documents", form, (p) =>
        report(mapPct ? mapPct(p) : p),
      ),
    );
    return document_id;
  }

  /**
   * Open the OS picker in the mode the operator chose in the attachment
   * sheet. One hidden input, retargeted imperatively — setting `accept` via
   * React state then calling `.click()` in the same tick would open the
   * picker with the PREVIOUS filter (the attribute lands a render later).
   */
  function openFilePicker(kind: "media" | "document" | "camera") {
    const el = fileInputRef.current;
    if (!el) return;
    if (kind === "media") {
      el.accept = "image/*,video/*";
      el.removeAttribute("capture");
    } else if (kind === "camera") {
      el.accept = "image/*";
      el.setAttribute("capture", "environment");
    } else {
      el.accept = "";
      el.removeAttribute("capture");
    }
    el.click();
  }

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    // Email: STAGE the files (upload now, send with the next message) so the
    // body + subject + Cc + every attachment go out as one branded letter.
    if (isEmail) return stageEmailFiles(files);
    setBusy("uploading");
    setError(null);
    try {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const document_id = await uploadFile(file, (p) =>
          Math.round(((i + p / 100) / list.length) * 100),
        );
        await smartcommApi.postMessage(channelId, {
          message_type: fileKind(file),
          attachments: [{ document_id, display_name: file.name }],
          content: content.trim() || undefined,
          is_human_agent: igWindowClosed || undefined,
        });
      }
      resetTextarea();
      invalidate();
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Upload attachment", e);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  /** Upload dropped/selected files and stage them on the email composer. */
  async function stageEmailFiles(files: FileList | File[]) {
    setBusy("uploading");
    setError(null);
    try {
      const list = Array.from(files);
      const staged: {
        document_id: string;
        display_name: string;
        kind: MessageType;
      }[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const document_id = await uploadFile(file, (p) =>
          Math.round(((i + p / 100) / list.length) * 100),
        );
        staged.push({
          document_id,
          display_name: file.name,
          kind: fileKind(file),
        });
      }
      setPendingFiles((prev) => [...prev, ...staged]);
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Upload attachment", e);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  function insertReplyBody(body: string) {
    // Email composes in the rich editor — drop the text in as simple HTML
    // (paragraphs + auto-linked URLs). Everything else uses the textarea.
    if (isEmail && !editing) {
      setEmailHtml(textToMailHtml(body));
      return;
    }
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

  // Insert the Online welcome-form link into the composer (NOT send it) so
  // the operator can soften/edit the wording before sending. The template
  // body is the CEO-editable one (with a {link} placeholder); we swap in
  // the freshly-minted URL and stage a "save as default" chip.
  async function insertOnboardingLink() {
    if (!channel || !businessKey) return;
    try {
      setBusy("sending");
      const { url } = await onboardingApi.createLink({
        business: businessKey,
        channel_id: channel.channel_id,
        source: "online",
      });
      const template =
        composerSettings?.onboarding_template ||
        "Welcome 🌹 We'd love to make sure your order reaches you exactly the way you want. Could you fill in this quick form (60 sec) — it covers your delivery address & preferences:\n\n{link}";
      const body = template.includes("{link}")
        ? template.replace("{link}", url)
        : `${template}\n\n${url}`;
      insertReplyBody(body);
      setTemplateChip({ kind: "onboarding", token: "{link}", value: url });
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Prepare onboarding link", e);
      setError(
        e instanceof Error ? e.message : "Could not prepare onboarding link",
      );
    } finally {
      setBusy(null);
    }
  }

  // Insert a "follow up on WhatsApp" handoff into the composer, sharing the
  // brand's WhatsApp number (from Messaging/Business settings). Editable
  // before sending, and the wording is savable as the new default.
  function insertWhatsAppHandoff() {
    const number = composerSettings?.whatsapp_share_number;
    if (!number) {
      setError(
        "No WhatsApp number is set for this brand yet — add it in Settings → Business Setup (phone).",
      );
      return;
    }
    const template =
      composerSettings?.whatsapp_handoff_template ||
      "Lovely! You can follow up with us on WhatsApp here:\n{number}";
    const body = template.includes("{number}")
      ? template.replace("{number}", number)
      : `${template}\n${number}`;
    insertReplyBody(body);
    setTemplateChip({ kind: "whatsapp", token: "{number}", value: number });
  }

  // "Where are you?" — the single most-asked question in the inbox. Inserts
  // the brand's address (Settings → Business Setup, or the saved override)
  // wrapped in editable copy.
  function insertBusinessAddress() {
    const address = composerSettings?.address_share_text;
    if (!address) {
      setError(
        "No address is set for this brand yet — add it in Settings → Business Setup (address).",
      );
      return;
    }
    insertReplyBody(
      fillStock(composerSettings?.address_template, "{address}", address),
    );
    setTemplateChip({ kind: "address", token: "{address}", value: address });
  }

  // "What time do you close?" — the other one. Seeded Monday–Saturday,
  // 9:00 AM – 8:00 PM until the CEO saves their own wording.
  function insertWorkingHours() {
    const hours = composerSettings?.hours_share_text;
    if (!hours) return;
    insertReplyBody(
      fillStock(composerSettings?.hours_template, "{hours}", hours),
    );
    setTemplateChip({ kind: "hours", token: "{hours}", value: hours });
  }

  // Persist the current composer text as this brand's new default for the
  // staged template. The live URL/number/address/hours is swapped back to
  // its {placeholder} so the saved template stays reusable.
  async function saveTemplateAsDefault() {
    if (!templateChip) return;
    const withToken = composerText
      .split(templateChip.value)
      .join(templateChip.token);
    setTemplateChip((c) => (c ? { ...c, saving: true } : c));
    try {
      const field = STOCK_FIELD[templateChip.kind];
      const saved = await smartcommApi.updateComposerSettings({
        [field]: withToken,
      });
      qc.setQueryData(["smartcomm", "composer-settings"], saved);
      setTemplateChip((c) => (c ? { ...c, saving: false, saved: true } : c));
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Save default message", e);
      setError(e instanceof Error ? e.message : "Could not save default");
      setTemplateChip((c) => (c ? { ...c, saving: false } : c));
    }
  }

  // Insert an emoji at the caret (falling back to append), then restore
  // focus + caret so the operator can keep typing.
  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setContent((c) => c + emoji);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + emoji + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });
  }

  async function handleDraftWithPraxis() {
    setError(null);
    try {
      setBusy("drafting");
      const draft = await smartcommApi.draftWithPraxis(channelId);
      setPraxisMode(draft.draft_mode === "followup" ? "followup" : "reply");
      setPraxisDrafted(true);
      if (isEmail && !editing) {
        // Email drafts land in the rich editor as simple HTML.
        setEmailHtml(textToMailHtml(draft.content || ""));
      } else {
        setContent(draft.content || "");
        // Auto-resize the textarea to the new content
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            el.focus();
          }
        });
      }
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Draft reply with Praxis", e);
      setError(
        e instanceof Error ? e.message : "Praxis couldn't draft a reply",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen() {
    setBusy("sending");
    try {
      await smartcommApi.reopenThread(channelId);
      qc.invalidateQueries({ queryKey: ["smartcomm", "channel", channelId] });
      qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
    } catch (e: unknown) {
      toastReport("Messaging → Thread", "Reopen thread", e);
      setError(e instanceof Error ? e.message : "Could not reopen");
    } finally {
      setBusy(null);
    }
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
  // Peer info powers avatar + the call menu. For direct chats it's the
  // other user; for customer threads it's the customer contact.
  const peer =
    channel.channel_type === "direct"
      ? (channel.members ?? []).find((m) => m.user_id && m.user_id !== user?.id)
      : channel.channel_type === "customer_thread"
        ? (channel.members ?? []).find((m) => m.contact_id)
        : undefined;
  const peerAvatarUrl =
    peer?.user_avatar_url ??
    peer?.contact_avatar_url ??
    channel.peer_avatar_url ??
    null;
  const peerPhoneRaw =
    peer?.primary_phone ?? peer?.user_phone ?? channel.peer_phone ?? null;
  const peerWhatsAppRaw =
    peer?.whatsapp_number ??
    peer?.primary_phone ??
    peer?.user_phone ??
    channel.peer_whatsapp_number ??
    channel.peer_phone ??
    null;

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

  // ── The attachment sheet's contents ──────────────────────
  // Everything the operator can put INTO a message lives behind the one
  // paperclip, ordered by how often it's reached for. Entries the thread
  // can't use (catalogue on an internal chat, templates off WhatsApp)
  // aren't rendered at all — a sheet of dead tiles is worse than a short
  // sheet. Files first (universal), then the two most-asked questions,
  // then the rest.
  const attachActions: ComposerAction[] = [
    {
      key: "media",
      label: "Photos",
      hint: "& videos",
      icon: ImageIcon,
      tone: "info",
      onSelect: () => openFilePicker("media"),
    },
    ...(isPhone
      ? [
          {
            key: "camera",
            label: "Camera",
            hint: "take a photo",
            icon: Camera,
            tone: "info" as const,
            onSelect: () => openFilePicker("camera"),
          },
        ]
      : []),
    {
      key: "document",
      label: "Document",
      hint: "any file",
      icon: FileText,
      tone: "muted",
      onSelect: () => openFilePicker("document"),
    },
    ...(isCustomerThread
      ? [
          {
            key: "address",
            label: "Our address",
            hint: "where to find us",
            icon: MapPin,
            tone: "sage" as const,
            onSelect: insertBusinessAddress,
          },
          {
            key: "hours",
            label: "Opening hours",
            hint: "when we're open",
            icon: Clock,
            tone: "gold" as const,
            onSelect: insertWorkingHours,
          },
          {
            key: "catalogue",
            label: "Catalogue",
            hint: "products & order link",
            icon: Package,
            tone: "accent" as const,
            onSelect: () => setCatalogueOpen(true),
          },
          {
            key: "onboarding",
            label: "Welcome form",
            hint: "delivery details",
            icon: Link2,
            tone: "accent" as const,
            busy: busy === "sending",
            onSelect: insertOnboardingLink,
          },
        ]
      : []),
    ...(isCustomerThread && !isWhatsapp
      ? [
          {
            key: "wa-handoff",
            label: "WhatsApp us",
            hint: "share our number",
            icon: MessageCircle,
            tone: "whatsapp" as const,
            onSelect: insertWhatsAppHandoff,
          },
        ]
      : []),
    ...(isCustomerThread && isWhatsapp
      ? [
          {
            key: "template",
            label: "Template",
            hint: "Meta-approved",
            icon: LayoutTemplate,
            tone: "accent" as const,
            onSelect: () => setTemplatePickerOpen(true),
          },
        ]
      : []),
    ...(quickReplies.length > 0
      ? [
          {
            key: "quick-reply",
            label: "Quick reply",
            hint: "or type /",
            icon: Zap,
            tone: "accent" as const,
            onSelect: () => setQrOpen(true),
          },
        ]
      : []),
  ];

  // The quick-reply panel serves both triggers: "/" typed in the box
  // (filtered as you type) and the sheet's Quick reply tile (the full list).
  const qrPanelReplies = slashOpen ? slashMatches : qrOpen ? quickReplies : [];

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
        {peerAvatarUrl ? (
          <img
            src={peerAvatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="grid place-items-center w-9 h-9 rounded-full text-[12px] font-semibold text-white shrink-0"
            style={{ backgroundColor: getAvatarColour(displayName) }}
          >
            {getInitials(displayName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
            <span className="truncate">{displayName}</span>
            <PlatformPill platform={platform} />
          </div>
          {/* Subtitle line — the WhatsApp window pill rides here, never on
              the name's own line, so it can never crowd out the name. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <p
              className={cn(
                "truncate min-w-0 flex-1 text-[11.5px]",
                typingNames.length ? "text-accent-glow" : "text-text-muted",
              )}
            >
              {subtitle}
            </p>
            {isWhatsapp && channel.wa_window_expires_at && (
              <WhatsAppWindowBadge expiresAt={channel.wa_window_expires_at} />
            )}
            {isInstagram && channel.ig_window_expires_at && (
              <WhatsAppWindowBadge
                expiresAt={channel.ig_window_expires_at}
                label="Instagram"
              />
            )}
          </div>
        </div>

        {(peerPhoneRaw || peerWhatsAppRaw) && (
          <CallMenu
            phone={peerPhoneRaw}
            whatsapp={peerWhatsAppRaw}
            name={displayName}
          />
        )}
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

      {/* Incoming / live WhatsApp call for THIS customer — rings right here
          rather than as a corner toast the agent has to look away for, and
          becomes the live-call strip once answered. Mounting this also tells
          CallLayer to suppress its own toast for this conversation. */}
      <InThreadCallBanner channelId={channelId} />

      {/* In-thread search */}
      {searchOpen && (
        <ThreadSearch
          channelId={channelId}
          onJump={jumpToMessage}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-2.5"
      >
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
            // A reply a staffer sent from the Instagram app itself (message
            // echo, stamped via='instagram_app') is the business speaking —
            // render it on our side of the thread, but keep isOwn false so
            // it never grows Edit/Delete (there's no Hub message to edit —
            // it lives on Instagram).
            const isBusinessSide = isOwn || m.metadata?.via === "instagram_app";
            const newDay = !prev || !isSameDay(prev.created_at, m.created_at);
            const showName =
              !isBusinessSide &&
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
                  businessSide={isBusinessSide}
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
                    onRetry: async (msg) => {
                      try {
                        const r = await smartcommApi.retryMessage(
                          msg.message_id,
                        );
                        if (!r.requeued && r.delivery_error) {
                          setError(r.delivery_error);
                        }
                      } catch (e: unknown) {
                        toastReport("Messaging → Thread", "Retry send", e);
                        setError(
                          e instanceof Error ? e.message : "Retry failed",
                        );
                      }
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
      {praxisDrafted && composerText.trim() && (
        <div className="mx-3 sm:mx-4 mb-1 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11.5px] text-text-muted">
          <Sparkles className="w-3.5 h-3.5 text-accent-glow shrink-0" />
          <span className="flex-1">
            {praxisMode === "followup"
              ? "Praxis drafted a follow-up nudge (the customer hasn't replied yet) — edit before sending."
              : "Praxis drafted this reply — edit before sending, or hit Send if it sounds right."}
          </span>
          <button
            onClick={() => {
              setPraxisDrafted(false);
              setContent("");
              setEmailHtml("");
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

      {/* Stock-message chip — insert a form/WhatsApp template, edit it in
          the composer, then optionally make the edit the new default. */}
      {templateChip && composerText.trim() && (
        <div className="mx-3 sm:mx-4 mb-1 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11.5px] text-text-muted">
          <MessageCircle className="w-3.5 h-3.5 text-accent-glow shrink-0" />
          <span className="flex-1 min-w-0">
            {STOCK_CHIP_LABEL[templateChip.kind]} — edit &amp; send, or save
            your wording as the default.
          </span>
          {templateChip.saved ? (
            <span className="shrink-0 inline-flex items-center gap-1 text-accent-glow">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          ) : (
            <button
              onClick={saveTemplateAsDefault}
              disabled={templateChip.saving || !composerText.trim()}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-0.5 font-semibold text-accent-glow hover:bg-accent/10 disabled:opacity-50"
              title="Replace the automated text with this wording next time"
            >
              {templateChip.saving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              Save as default
            </button>
          )}
          <button
            onClick={() => setTemplateChip(null)}
            className="shrink-0 text-text-faint hover:text-text-primary"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick replies — typed "/" filters the list; the attachment sheet's
          Quick reply tile opens all of them. Same panel either way. */}
      {qrPanelReplies.length > 0 && (
        <div className="mx-3 sm:mx-4 mb-1 overflow-hidden rounded-xl border hairline bg-panel-2">
          {qrOpen && !slashOpen && (
            <div className="flex items-center gap-2 border-b hairline px-3 py-1.5">
              <Zap className="h-3 w-3 shrink-0 text-accent-glow" />
              <span className="flex-1 text-[10px] uppercase tracking-widest text-text-faint">
                Quick replies
              </span>
              <button
                onClick={() => setQrOpen(false)}
                className="text-text-faint hover:text-text-primary"
                title="Close quick replies"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="max-h-44 overflow-y-auto">
            {qrPanelReplies.map((r) => (
              <button
                key={r.reply_id}
                onClick={() => {
                  setQrOpen(false);
                  void applyQuickReply(r.slug);
                }}
                className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-panel"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-accent-glow">/{r.slug}</span>
                  <span className="text-[11.5px] text-text-muted">
                    {r.title}
                  </span>
                </div>
                <p className="truncate text-[11px] text-text-faint">{r.body}</p>
              </button>
            ))}
          </div>
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
      {isResolved ? (
        <div className="border-t hairline px-3 sm:px-4 py-3 pb-safe">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-[12px] text-text-muted">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-glow shrink-0" />
              This conversation is marked resolved.
            </span>
            <button
              onClick={handleReopen}
              disabled={busy === "sending"}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-accent-glow disabled:opacity-50"
            >
              Reopen
            </button>
          </div>
          {error && (
            <div className="mt-2 text-[11.5px] text-danger">{error}</div>
          )}
        </div>
      ) : (
        <div className="border-t hairline px-3 sm:px-4 pt-2.5 pb-safe">
          {igWindowClosed && !editing && (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-[12px] text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-[2px] shrink-0" />
              <div>
                Instagram's 24-hour window has closed. Replies will be sent with
                Meta's <strong>HUMAN_AGENT</strong> tag (allowed up to 7 days
                after the customer's last message; requires the tag to be
                approved on the Meta app).
              </div>
            </div>
          )}
          {composerLocked && (
            <div className="mb-2 flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-[12px] text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-[2px] shrink-0" />
                <div>
                  WhatsApp 24-hour window has closed. Free-form replies will be
                  rejected by Meta — reach the customer with an approved
                  template instead.
                </div>
              </div>
              <button
                onClick={() => setTemplatePickerOpen(true)}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-400/20 border border-amber-400/40 px-3 py-1.5 text-[12px] font-semibold text-amber-100 hover:bg-amber-400/30"
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                Send approved template
              </button>
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
              {isEmail && !editing && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-xl border hairline bg-panel-2 px-3">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint shrink-0">
                      Subject
                    </span>
                    <input
                      value={subjectDraft}
                      onChange={(e) => setSubjectDraft(e.target.value)}
                      placeholder="What's this email about?"
                      className="flex-1 bg-transparent py-2 text-[13px] focus:outline-none placeholder:text-text-faint"
                    />
                    {!showCc && (
                      <button
                        type="button"
                        onClick={() => setShowCc(true)}
                        className="shrink-0 text-[11.5px] text-text-faint hover:text-text-primary"
                        title="Add Cc copy recipients"
                      >
                        + Cc
                      </button>
                    )}
                  </div>
                  {showCc && (
                    <div className="flex items-center gap-2 rounded-xl border hairline bg-panel-2 px-3">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint shrink-0">
                        Cc
                      </span>
                      <input
                        value={ccInput}
                        onChange={(e) => setCcInput(e.target.value)}
                        placeholder="Copy others — comma-separated emails"
                        className="flex-1 bg-transparent py-2 text-[13px] focus:outline-none placeholder:text-text-faint"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowCc(false);
                          setCcInput("");
                        }}
                        className="shrink-0 text-text-faint hover:text-danger"
                        title="Remove Cc"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingFiles.map((f, i) => (
                        <span
                          key={f.document_id}
                          className="inline-flex items-center gap-1.5 rounded-lg border hairline bg-panel px-2 py-1 text-[11.5px]"
                        >
                          <Paperclip className="w-3 h-3 text-text-faint" />
                          <span className="max-w-[160px] truncate">
                            {f.display_name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingFiles((prev) =>
                                prev.filter((_, j) => j !== i),
                              )
                            }
                            className="text-text-faint hover:text-danger"
                            title="Remove attachment"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-end gap-1.5 sm:gap-2">
                {emailRich ? (
                  /* Email composes in the Gmail-style rich editor. Its own
                   toolbar carries formatting / colour / link / image / emoji;
                   the row below adds the mail-specific actions. */
                  <div className="min-w-0 flex-1">
                    <RichMailEditor
                      value={emailHtml}
                      onChange={setEmailHtml}
                      personalise={false}
                      compact
                      uploadEndpoint="/smartcomm/upload-image"
                      placeholder="Write your email…"
                      onSubmit={() => void handleSend()}
                    />
                    {/* Two keys, same as the chat pill: one door to everything
                      attachable, and Praxis. Formatting lives in the
                      editor's own toolbar above. */}
                    <div className="mt-1.5 flex items-center gap-0.5 px-0.5">
                      <ComposerIconButton
                        buttonRef={attachButtonRef}
                        icon={Paperclip}
                        label="Attach a file or send a quick answer"
                        active={attachOpen}
                        busy={busy === "uploading"}
                        onClick={() => setAttachOpen((v) => !v)}
                      />
                      {canPraxis("praxis_ai", "view") && (
                        <ComposerIconButton
                          icon={Sparkles}
                          label="Draft with Praxis"
                          tone="accent"
                          busy={busy === "drafting"}
                          onClick={handleDraftWithPraxis}
                        />
                      )}
                      <span className="ml-auto text-[10px] text-text-faint">
                        ⌘↵ to send
                      </span>
                    </div>
                  </div>
                ) : (
                  /* WhatsApp's composer ergonomics, our materials: emoji on
                   the left, the growing message box in the middle, Praxis +
                   the attachment door on the right — and outside the pill,
                   one button that is the mic until you type and the send
                   key from the first character. */
                  <div
                    className={cn(
                      "relative flex min-w-0 flex-1 items-end gap-0.5 rounded-[22px]",
                      "border hairline bg-panel-2 px-1 py-1 transition-colors",
                      "focus-within:border-accent/40",
                    )}
                  >
                    <div className="relative shrink-0">
                      <ComposerIconButton
                        buttonRef={emojiButtonRef}
                        icon={Smile}
                        label="Emoji"
                        active={emojiOpen}
                        onClick={() => setEmojiOpen((v) => !v)}
                      />
                      {emojiOpen && (
                        <EmojiPicker
                          anchorRef={emojiButtonRef}
                          align="start"
                          onPick={insertEmoji}
                          onClose={() => setEmojiOpen(false)}
                        />
                      )}
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={handleChange}
                      onKeyDown={handleKey}
                      onPaste={handlePaste}
                      placeholder={
                        composerLocked
                          ? "Free-form blocked — use a template"
                          : editing
                            ? "Edit message"
                            : "Message"
                      }
                      aria-label={editing ? "Edit message" : "Message"}
                      /* The shortcut crib used to live in the placeholder,
                         which made the resting composer read like a manual.
                         Hover/focus surfaces it instead. */
                      title="Enter sends · Shift+Enter for a new line · / for quick replies"
                      rows={1}
                      disabled={composerLocked && !editing}
                      className={cn(
                        "min-w-0 flex-1 resize-none bg-transparent",
                        "px-1.5 py-2 text-[13.5px] leading-[1.4]",
                        "placeholder:text-text-faint focus:outline-none disabled:opacity-50",
                      )}
                      style={{ maxHeight: 120 }}
                    />
                    {canPraxis("praxis_ai", "view") && (
                      <ComposerIconButton
                        icon={Sparkles}
                        label="Draft with Praxis"
                        tone="accent"
                        busy={busy === "drafting"}
                        onClick={handleDraftWithPraxis}
                      />
                    )}
                    <ComposerIconButton
                      buttonRef={attachButtonRef}
                      icon={Paperclip}
                      label="Attach a file or send a quick answer"
                      active={attachOpen}
                      busy={busy === "uploading"}
                      onClick={() => setAttachOpen((v) => !v)}
                    />
                  </div>
                )}
                {/* Mic ↔ Send — ONE key in ONE cell. Same size, same fill,
                  only the glyph swaps, so the row never twitches when the
                  first character lands (WhatsApp's exact behaviour, and the
                  canon's sanctioned accent fill: this is the composer's
                  primary action). Voice notes are chat-only. */}
                <button
                  onClick={() =>
                    canSend ? void handleSend() : setRecording(true)
                  }
                  disabled={canSend ? sendBlocked : composerLocked}
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                    "bg-accent-deep text-text-primary transition-all duration-200",
                    "ease-brand hover:bg-accent disabled:opacity-40",
                    canSend && "shadow-glow",
                  )}
                  title={
                    canSend
                      ? editing
                        ? "Save edit"
                        : "Send  ·  Enter"
                      : "Record a voice note"
                  }
                  aria-label={
                    canSend
                      ? editing
                        ? "Save edit"
                        : "Send message"
                      : "Record a voice note"
                  }
                >
                  {busy === "sending" ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  ) : canSend ? (
                    <Send className="h-[18px] w-[18px] animate-fade-in" />
                  ) : (
                    <Mic className="h-[19px] w-[19px] animate-fade-in" />
                  )}
                </button>
              </div>
              {/* One hidden picker for every attach route; `accept`/`capture`
                  are retargeted per route in openFilePicker(). */}
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
              {attachOpen && (
                <ComposerActionSheet
                  anchorRef={attachButtonRef}
                  actions={attachActions}
                  onClose={() => setAttachOpen(false)}
                />
              )}
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

      {/* Catalogue carousel picker */}
      <CataloguePickerModal
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        channel={channel}
        onSent={invalidate}
      />

      {/* Approved-template picker + send confirmation */}
      <TemplatePickerModal
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onSend={sendTemplate}
        sending={sendingTemplate}
        toName={displayName}
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

// ── Composer keys ─────────────────────────────────────────

/**
 * One composer key. Every icon inside the message pill is this component,
 * so they share a hit area (36px — thumb-sized), a hover surface and a
 * single busy treatment. Labels ride on `title` + `aria-label`: at rest
 * the row must read as three quiet glyphs, not a toolbar.
 */
function ComposerIconButton({
  icon: Icon,
  label,
  onClick,
  buttonRef,
  active,
  busy,
  disabled,
  tone = "muted",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  tone?: "muted" | "accent";
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full",
        "transition-colors hover:bg-panel",
        "disabled:opacity-40 disabled:hover:bg-transparent",
        active
          ? "bg-accent/10 text-accent-glow"
          : tone === "accent"
            ? "text-accent-glow hover:text-accent"
            : "text-text-muted hover:text-text-primary",
      )}
    >
      {busy ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin" />
      ) : (
        <Icon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}

// ── Header dropdown menu ──────────────────────────────────

/** Popover next to the search icon: reach the peer on WhatsApp or the
 *  phone dialer. Since /calls was cut from scope, this is the parachute:
 *  we hand off to WhatsApp (wa.me — which opens the chat, not a call) or
 *  tel: (device dialer). */
function CallMenu({
  phone,
  whatsapp,
  name,
}: {
  phone?: string | null;
  whatsapp?: string | null;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const cleanWa = digitsOnly(whatsapp);
  const telHref = phone ? `tel:${phone}` : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-text-muted hover:text-text-primary"
        title={`Reach ${name}`}
      >
        <Phone className="w-4 h-4" />
      </button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl bg-panel border hairline shadow-xl overflow-hidden text-[12.5px]">
            {cleanWa ? (
              <a
                href={`https://wa.me/${cleanWa}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary"
              >
                <MessageCircle className="w-3.5 h-3.5 mt-0.5 text-[#25D366] shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block">Message on WhatsApp</span>
                  <span className="block text-[10.5px] text-text-faint">
                    wa.me opens the chat — not a call.
                  </span>
                </span>
              </a>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 text-text-faint">
                <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="flex-1">No WhatsApp number on file</span>
              </div>
            )}
            {telHref ? (
              <a
                href={telHref}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary border-t hairline"
              >
                <Phone className="w-3.5 h-3.5 mt-0.5 text-accent-glow shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block">Call {phone}</span>
                  <span className="block text-[10.5px] text-text-faint">
                    Opens your device dialer.
                  </span>
                </span>
              </a>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 text-text-faint border-t hairline">
                <Phone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="flex-1">No phone number on file</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// wa.me expects digits only, no +, spaces, or dashes.
function digitsOnly(v?: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D+/g, "");
  return d.length >= 6 ? d : null;
}

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
            {channel.channel_type === "customer_thread" &&
              (channel.status === "resolved" ? (
                <button
                  onClick={async () => {
                    setOpen(false);
                    await smartcommApi.reopenThread(channel.channel_id);
                    onChanged();
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-panel-2 text-text-primary"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Reopen thread
                </button>
              ) : (
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
              ))}
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
