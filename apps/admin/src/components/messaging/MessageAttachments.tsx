import { useState } from "react";
import {
  FileText,
  Download,
  Image as ImageIcon,
  Mic,
  Film,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes, mediaKind } from "@/lib/messaging-media";
import type { Message, MessageAttachment } from "@/lib/smartcomm-types";
import { Lightbox } from "./Lightbox";
import { VoiceNotePlayer } from "./VoiceNotePlayer";

/** Renders a message's media attachments (image / video / voice / file). */
export function MessageAttachments({
  message,
  isOwn,
}: {
  message: Message;
  isOwn: boolean;
}) {
  const [lightbox, setLightbox] = useState<MessageAttachment | null>(null);
  const atts = message.attachments ?? [];

  // Older rows (pre-enrichment) or pending uploads carry no attachment array
  // but the type tells us what it is — show a tasteful label as a fallback.
  if (atts.length === 0) {
    if (message.message_type === "text" || message.message_type === "system")
      return null;
    return <FallbackLabel type={message.message_type} />;
  }

  return (
    <div className="space-y-1.5 mb-1">
      {atts.map((a, i) => {
        const kind = mediaKind(message.message_type, a.mime_type);
        const key = a.document_id || a.attachment_id || String(i);

        if (!a.url)
          return <FallbackLabel key={key} type={message.message_type} />;

        if (kind === "image") {
          return (
            <button
              key={key}
              onClick={() => setLightbox(a)}
              className="block overflow-hidden rounded-lg"
              title={a.display_name ?? "Photo"}
            >
              <img
                src={a.url}
                alt={a.display_name ?? "Photo"}
                loading="lazy"
                className="max-h-64 max-w-full rounded-lg object-cover hover:opacity-95"
              />
            </button>
          );
        }

        if (kind === "video") {
          return (
            <video
              key={key}
              src={a.url}
              controls
              preload="metadata"
              className="max-h-72 max-w-full rounded-lg bg-black/40"
            />
          );
        }

        if (kind === "audio") {
          return <VoiceNotePlayer key={key} url={a.url} isOwn={isOwn} />;
        }

        return (
          <a
            key={key}
            href={a.url}
            download={a.display_name ?? true}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 min-w-[180px] max-w-[260px] transition-colors",
              isOwn
                ? "border-bg/20 bg-bg/10 hover:bg-bg/15"
                : "hairline bg-panel hover:bg-panel-2",
            )}
          >
            <span
              className={cn(
                "grid place-items-center w-8 h-8 rounded-md shrink-0",
                isOwn ? "bg-bg/15 text-bg" : "bg-accent/15 text-accent-glow",
              )}
            >
              <FileText className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {a.display_name ?? "Document"}
              </span>
              {a.file_size_bytes ? (
                <span
                  className={cn(
                    "block text-[10.5px]",
                    isOwn ? "text-bg/60" : "text-text-faint",
                  )}
                >
                  {formatBytes(a.file_size_bytes)}
                </span>
              ) : null}
            </span>
            <Download
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                isOwn ? "text-bg/70" : "text-text-faint",
              )}
            />
          </a>
        );
      })}

      {lightbox?.url && (
        <Lightbox
          url={lightbox.url}
          name={lightbox.display_name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function FallbackLabel({ type }: { type: Message["message_type"] }) {
  const map: Partial<
    Record<Message["message_type"], [typeof ImageIcon, string]>
  > = {
    image: [ImageIcon, "Photo"],
    video: [Film, "Video"],
    voice_note: [Mic, "Voice note"],
    document: [FileText, "Document"],
  };
  const entry = map[type];
  if (!entry) return null;
  const [Icon, label] = entry;
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[11px] opacity-80">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}
