/**
 * Praxis composer (§6.29) — textarea + mic (Web Speech, hidden when the
 * browser can't) + send. Enter sends, Shift+Enter breaks. While listening,
 * the live interim transcript previews in-place; the final transcript sends
 * as a voice-mode turn.
 */

import { useRef, useState } from "react";
import { Mic, MicOff, SendHorizonal } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSpeechInput } from "@/hooks/useSpeechInput";

export function PraxisInput({
  disabled,
  onSend,
  autoFocus,
}: {
  disabled?: boolean;
  onSend: (input: {
    content: string;
    input_mode: "text" | "voice";
    transcribed_text?: string;
  }) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { supported, listening, interim, start, stop } = useSpeechInput({
    onFinal: (transcript) => {
      onSend({
        content: transcript,
        input_mode: "voice",
        transcribed_text: transcript,
      });
    },
  });

  const sendText = () => {
    const content = text.trim();
    if (!content || disabled) return;
    setText("");
    onSend({ content, input_mode: "text" });
    taRef.current?.focus();
  };

  return (
    <div className="rounded-2xl border border-line bg-black/25 focus-within:border-accent/50 transition-colors">
      {listening && (
        <div className="px-3.5 pt-2.5 text-[12.5px] text-accent-glow">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
            Listening… {interim && <em className="text-text-muted">{interim}</em>}
          </span>
        </div>
      )}
      <div className="flex items-end gap-1.5 p-1.5">
        <textarea
          ref={taRef}
          autoFocus={autoFocus}
          rows={1}
          value={text}
          disabled={disabled || listening}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
          placeholder={
            listening ? "Speak your request…" : "Ask Praxis anything…"
          }
          className="flex-1 resize-none bg-transparent outline-none px-2.5 py-2 text-[13.5px] leading-relaxed placeholder:text-text-muted max-h-[132px]"
        />
        {supported && (
          <button
            type="button"
            aria-label={listening ? "Stop listening" : "Speak to Praxis"}
            disabled={disabled}
            onClick={() => (listening ? stop() : start())}
            className={cn(
              "grid place-items-center w-9 h-9 rounded-xl border transition-colors shrink-0",
              listening
                ? "bg-danger/15 border-danger/40 text-danger"
                : "border-transparent text-text-muted hover:text-text-primary hover:bg-text-primary/[0.07]",
            )}
          >
            {listening ? (
              <MicOff className="w-4.5 h-4.5" />
            ) : (
              <Mic className="w-4.5 h-4.5" />
            )}
          </button>
        )}
        <button
          type="button"
          aria-label="Send"
          disabled={disabled || !text.trim()}
          onClick={sendText}
          className={cn(
            "grid place-items-center w-9 h-9 rounded-xl shrink-0 transition-all",
            text.trim() && !disabled
              ? "bg-accent-deep text-[#F4E9D9] hover:bg-accent"
              : "bg-text-primary/[0.05] text-text-muted",
          )}
        >
          <SendHorizonal className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
}
