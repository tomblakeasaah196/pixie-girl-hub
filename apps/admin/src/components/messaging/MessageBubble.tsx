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

interface Actions {
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onForward: (m: Message) => void;
  onStar: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
}

const QUICK = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

interface Props {
  message: Message;
  isOwn: boolean;
  showSenderName: boolean;
  actions: Actions;
}

export function MessageBubble({
  message,
  isOwn,
  showSenderName,
  actions,
}: Props) {
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  if (message.is_deleted) {
    return (
      <div className={cn("flex", isOwn && "flex-row-reverse")}>
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

  const sender = message.sender_name ?? "Unknown";
  const reactions = aggregate(message.reactions ?? []);

  return (
    <div
      className={cn("flex gap-2", isOwn && "flex-row-reverse")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setReactionBarOpen(false);
      }}
    >
      {!isOwn && (
        <div
          className="grid place-items-center w-7 h-7 rounded-full text-[10px] font-semibold text-white shrink-0 mt-1"
          style={{ backgroundColor: getAvatarColour(sender) }}
        >
          {getInitials(sender)}
        </div>
      )}
      <div className={cn("max-w-[78%] min-w-0 group", isOwn && "items-end")}>
        {showSenderName && !isOwn && (
          <div className="text-[11px] text-accent-glow mb-0.5 ml-1">
            {sender}
          </div>
        )}
        <div className="relative">
          <div
            className={cn(
              "rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed shadow-sm break-words",
              isOwn
                ? "bg-accent/85 text-bg rounded-tr-md"
                : "bg-panel-2 border hairline text-text-primary rounded-tl-md",
            )}
          >
            {message.reply_content && (
              <div
                className={cn(
                  "mb-1.5 -mx-1 px-2 py-1 rounded border-l-2 text-[11.5px] truncate",
                  isOwn
                    ? "border-bg/40 bg-bg/10 text-bg/70"
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
                  isOwn={isOwn}
                />
              )}
            {message.message_type === "send_invoice" && (
              <InvoiceCard message={message} isOwn={isOwn} />
            )}
            {message.message_type !== "text" &&
              message.message_type !== "product_share" &&
              message.message_type !== "send_invoice" && (
                <MessageAttachments message={message} isOwn={isOwn} />
              )}
            {message.is_forwarded && (
              <div
                className={cn(
                  "mb-0.5 flex items-center gap-1 text-[10.5px] italic",
                  isOwn ? "text-bg/60" : "text-text-faint",
                )}
              >
                <Forward className="w-3 h-3" /> Forwarded
              </div>
            )}
            {message.content && (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
            <div className="mt-1 flex items-center gap-1 justify-end text-[10px] opacity-70">
              {message.edited_at && <span className="italic">edited</span>}
              <span>{fmtClockTime(message.created_at)}</span>
              {isOwn && <DeliveryTick status={message.delivery_status} />}
            </div>
          </div>

          {/* Reactions */}
          {reactions.length > 0 && (
            <div
              className={cn(
                "absolute -bottom-2.5 flex gap-1",
                isOwn ? "left-1" : "right-1",
              )}
            >
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
                isOwn ? "right-full mr-1.5" : "left-full ml-1.5",
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
                isOwn ? "right-0" : "left-0",
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

function DeliveryTick({ status }: { status?: string }) {
  switch (status) {
    case "queued":
      return <Clock className="w-3 h-3 opacity-70" />;
    case "failed":
      return <AlertTriangle className="w-3 h-3 text-danger" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-accent" />;
    case "sent":
    default:
      return <Check className="w-3 h-3" />;
  }
}
