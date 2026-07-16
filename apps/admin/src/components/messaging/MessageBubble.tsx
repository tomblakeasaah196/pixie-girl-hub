import { useState } from "react";
import {
  Reply,
  Pencil,
  Trash2,
  Forward,
  Star,
  Smile,
  CheckCheck,
  Check,
  Clock,
  AlertTriangle,
  LayoutTemplate,
  RotateCcw,
} from "lucide-react";
import {
  fmtClockTime,
  getAvatarColour,
  getInitials,
} from "@/lib/messaging-utils";
import { cn } from "@/lib/cn";
import type { Message } from "@/lib/smartcomm-types";
import { MessageAttachments } from "./MessageAttachments";
import { ProductCarousel } from "./ProductCarousel";
import { InvoiceCard } from "./InvoiceCard";
import { CallCard } from "./CallCard";
import { EmailBody } from "./EmailBody";

interface Actions {
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onForward: (m: Message) => void;
  onStar: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  /** Re-queue a failed outbound send (customer threads only). */
  onRetry?: (m: Message) => void | Promise<void>;
}

// Translate stored delivery_error codes (and common Meta phrases) into a
// sentence the operator can act on. Unknown errors show verbatim — Meta's
// own message is usually the most precise thing we have.
function friendlyDeliveryError(err?: string | null): string | null {
  if (!err) return null;
  const MAP: Record<string, string> = {
    IG_NOT_CONFIGURED:
      "Instagram isn't connected for this brand — connect it in Messaging → Settings.",
    IG_NO_TOKEN:
      "Instagram has no access token on file — rotate it in Messaging → Settings.",
    NO_IG_HANDLE_ON_FILE:
      "This customer has no Instagram ID on file, so Meta can't be told who to send to.",
    NO_WHATSAPP_NUMBER_ON_FILE:
      "This customer has no WhatsApp number on file.",
    WA_NOT_CONFIGURED:
      "WhatsApp isn't connected for this brand — connect it in Messaging → Settings.",
    MEDIA_URL_UNAVAILABLE:
      "The file can't be given a public URL for Meta to fetch — check CDN/ADMIN_BASE_URL configuration.",
    NOTHING_TO_SEND: "The message had no sendable content.",
    IG_SEND_BRAND_REQUIRED: "Internal error: send was queued without a brand.",
    WA_SEND_BRAND_REQUIRED: "Internal error: send was queued without a brand.",
    NO_RECIPIENT: "No recipient on the send job.",
  };
  if (MAP[err]) return MAP[err];
  // Meta's opaque link bounce (code 508 "Invalid message id") — stored
  // verbatim on messages that failed before the button-template fallback
  // shipped. Retry re-sends the link as a tappable button.
  if (/invalid message id/i.test(err) || /code 508/i.test(err)) {
    return (
      "Instagram refused this message (Meta code 508). If it contained a " +
      "link, Instagram blocked the raw URL — hit Retry and the link will go " +
      "out as a tappable button instead. Otherwise the messaging window may " +
      "have closed (the customer needs to message first)."
    );
  }
  return err;
}

const QUICK = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

interface Props {
  message: Message;
  isOwn: boolean;
  /** Render on the business (right) side even when the viewer didn't send
   *  it — e.g. a reply a staffer sent from the Instagram app (via metadata).
   *  Alignment/styling only; Edit/Delete stay gated on isOwn. Defaults to
   *  isOwn. */
  businessSide?: boolean;
  showSenderName: boolean;
  actions: Actions;
  isEmail?: boolean;
}

export function MessageBubble({
  message,
  isOwn,
  businessSide,
  showSenderName,
  actions,
  isEmail,
}: Props) {
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const own = businessSide ?? isOwn;
  const viaInstagramApp = message.metadata?.via === "instagram_app";

  if (message.is_deleted) {
    return (
      <div className={cn("flex", own && "flex-row-reverse")}>
        <div className="text-[12px] italic text-text-faint px-3 py-1.5">
          This message was deleted
        </div>
      </div>
    );
  }

  if (message.message_type === "system") {
    return (
      <div className="flex justify-center py-1.5">
        <div className="text-[11px] text-text-faint italic max-w-[80%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

  // Voice-call timeline entry — centred chip, not a chat bubble.
  if (message.message_type === "call") {
    return <CallCard message={message} />;
  }

  const sender = message.sender_name ?? "Unknown";
  const reactions = aggregate(message.reactions ?? []);
  const customerReaction = message.metadata?.customer_reaction;

  return (
    <div
      className={cn("flex gap-2", own && "flex-row-reverse")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setReactionBarOpen(false);
      }}
    >
      {!own && (
        <div
          className="grid place-items-center w-7 h-7 rounded-full text-[10px] font-semibold text-white shrink-0 mt-1"
          style={{ backgroundColor: getAvatarColour(sender) }}
        >
          {getInitials(sender)}
        </div>
      )}
      <div className={cn("max-w-[78%] min-w-0 group", own && "items-end")}>
        {showSenderName && !own && (
          <div className="text-[11px] text-accent-glow mb-0.5 ml-1">
            {sender}
          </div>
        )}
        <div className="relative">
          <div
            className={cn(
              "rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed shadow-sm break-words",
              own
                ? "bg-accent/15 border border-accent/30 text-text-primary rounded-tr-md"
                : "bg-panel-2 border hairline text-text-primary rounded-tl-md",
            )}
          >
            {message.reply_content && (
              <div
                className={cn(
                  "mb-1.5 -mx-1 px-2 py-1 rounded border-l-2 text-[11.5px] truncate",
                  own
                    ? "border-accent/50 bg-bg/10 text-text-muted"
                    : "border-accent/60 bg-panel/40 text-text-muted",
                )}
              >
                <span className="font-medium">
                  {message.reply_sender_name ?? "Reply"}
                </span>
                : {message.reply_content}
              </div>
            )}
            {message.message_type === "product_share" &&
              message.metadata?.products && (
                <ProductCarousel
                  intro={message.metadata.intro}
                  products={message.metadata.products}
                />
              )}
            {message.message_type === "send_invoice" && (
              <InvoiceCard message={message} />
            )}
            {message.message_type === "template" && (
              <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-accent-glow/90">
                <LayoutTemplate className="w-3 h-3" /> Approved template
              </div>
            )}
            {(message.message_type === "ig_story_mention" ||
              message.message_type === "ig_story_reply") && (
              <div className="mb-1">
                <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-accent-glow/90">
                  {message.message_type === "ig_story_mention"
                    ? "📣 Story mention"
                    : "💬 Story reply"}
                </div>
                {message.metadata?.story_url && (
                  <a
                    href={message.metadata.story_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[11.5px] text-accent-glow underline underline-offset-2 truncate max-w-[240px]"
                    title="Open the story media (Meta links expire after ~24h)"
                  >
                    View story media
                  </a>
                )}
              </div>
            )}
            {message.message_type !== "text" &&
              message.message_type !== "product_share" &&
              message.message_type !== "send_invoice" &&
              message.message_type !== "template" && (
                <MessageAttachments message={message} />
              )}
            {message.is_forwarded && (
              <div
                className={cn(
                  "mb-0.5 flex items-center gap-1 text-[10.5px] italic",
                  "text-text-faint",
                )}
              >
                <Forward className="w-3 h-3" /> Forwarded
              </div>
            )}
            {message.content &&
              (isEmail ? (
                <EmailBody content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ))}
            <div className="mt-1 flex items-center gap-1 justify-end text-[10px] opacity-70">
              {viaInstagramApp && (
                <span
                  className="italic"
                  title="A team member sent this from the Instagram app — it synced here automatically"
                >
                  via Instagram app ·
                </span>
              )}
              {message.edited_at && <span className="italic">edited</span>}
              <span>{fmtClockTime(message.created_at)}</span>
              {own && (
                <DeliveryTick status={message.delivery_status} isEmail={isEmail} />
              )}
            </div>
            {/* Failed sends explain WHY + offer a one-tap retry, instead of
                a bare warning triangle the operator can't act on. */}
            {own && message.delivery_status === "failed" && (
              <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-2 py-1.5 text-[11px] text-danger">
                <AlertTriangle className="w-3 h-3 mt-[1px] shrink-0" />
                <span className="flex-1 min-w-0 break-words">
                  Not delivered
                  {message.delivery_error
                    ? ` — ${friendlyDeliveryError(message.delivery_error)}`
                    : ""}
                </span>
                {actions.onRetry && (
                  <button
                    onClick={() => void actions.onRetry?.(message)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-danger/40 px-1.5 py-0.5 font-semibold hover:bg-danger/10"
                    title="Try sending again"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Reactions (staff) + the customer's own reaction badge */}
          {(reactions.length > 0 || customerReaction) && (
            <div
              className={cn(
                "absolute -bottom-2.5 flex gap-1",
                own ? "left-1" : "right-1",
              )}
            >
              {customerReaction && (
                <span
                  className="px-1.5 py-[1px] rounded-full bg-accent/20 border border-accent/40 text-[10px]"
                  title="Customer reacted"
                >
                  {customerReaction}
                </span>
              )}
              {reactions.map((r) => (
                <span
                  key={r.emoji}
                  className="px-1.5 py-[1px] rounded-full bg-panel border hairline text-[10px]"
                >
                  {r.emoji} {r.count > 1 ? r.count : ""}
                </span>
              ))}
            </div>
          )}

          {/* Action row */}
          {hovered && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-panel border hairline shadow-lg",
                own ? "right-full mr-1.5" : "left-full ml-1.5",
              )}
            >
              <button
                onClick={() => setReactionBarOpen((v) => !v)}
                title="React"
                className="p-1 text-text-muted hover:text-text-primary"
              >
                <Smile className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => actions.onReply(message)}
                title="Reply"
                className="p-1 text-text-muted hover:text-text-primary"
              >
                <Reply className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => actions.onForward(message)}
                title="Forward"
                className="p-1 text-text-muted hover:text-text-primary"
              >
                <Forward className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => actions.onStar(message)}
                title={message.is_starred ? "Unstar" : "Star"}
                className={cn(
                  "p-1 hover:text-text-primary",
                  message.is_starred ? "text-amber-300" : "text-text-muted",
                )}
              >
                <Star className="w-3.5 h-3.5" />
              </button>
              {isOwn && (
                <>
                  <button
                    onClick={() => actions.onEdit(message)}
                    title="Edit"
                    className="p-1 text-text-muted hover:text-text-primary"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => actions.onDelete(message)}
                    title="Delete"
                    className="p-1 text-text-muted hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Reaction quick-bar */}
          {reactionBarOpen && (
            <div
              className={cn(
                "absolute -top-9 flex gap-1 px-2 py-1 rounded-full bg-panel border hairline shadow-lg",
                own ? "right-0" : "left-0",
              )}
            >
              {QUICK.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    actions.onReact(message, emoji);
                    setReactionBarOpen(false);
                  }}
                  className="text-base hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function aggregate(rs: { emoji: string; user_id: string }[]) {
  const m = new Map<string, number>();
  for (const r of rs) m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1);
  return Array.from(m.entries()).map(([emoji, count]) => ({ emoji, count }));
}

function DeliveryTick({
  status,
  isEmail,
}: {
  status?: string;
  isEmail?: boolean;
}) {
  if (status === "queued") return <Clock className="w-3 h-3 opacity-70" />;
  if (status === "failed") return <AlertTriangle className="w-3 h-3 text-danger" />;
  // Plain SMTP has no delivery/read-receipt channel, so "sent" is the most
  // truthful terminal state we can show for email — a stuck double-check
  // would silently promise a delivered/read status we can never confirm.
  if (isEmail) return <Check className="w-3 h-3" />;
  if (status === "delivered") return <CheckCheck className="w-3 h-3" />;
  if (status === "read") return <CheckCheck className="w-3 h-3 text-accent" />;
  return <Check className="w-3 h-3" />;
}
