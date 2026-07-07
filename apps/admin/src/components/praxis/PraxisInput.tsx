/**
 * Praxis composer (§6.29) — a floating glass "pill" (the Claude/Gemini
 * composer): rounded, elevated, auto-growing textarea with a mic (Web Speech,
 * hidden when unsupported) and a send affordance. Enter sends, Shift+Enter
 * breaks. While listening, the live interim transcript previews in-place; the
 * final transcript sends as a voice-mode turn.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSpeechInput } from "@/hooks/useSpeechInput";

export function PraxisInput({
  disabled,
  onSend,
  autoFocus,
  placeholder = "Ask Praxis anything…",
  initialText,
}: {
  disabled?: boolean;
  onSend: (input: {
    content: string;
    input_mode: "text" | "voice";
    transcribed_text?: string;
  }) => void;
  autoFocus?: boolean;
  placeholder?: string;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText && taRef.current) {
      const ta = taRef.current;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    }
  }, [initialText]);

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
    if (taRef.current) taRef.current.style.height = "auto";
    onSend({ content, input_mode: "text" });
    taRef.current?.focus();
  };

  const canSend = !!text.trim() && !disabled;

  return (
    <div
      className={cn(
        "rounded-[26px] border bg-text-primary/[0.04] backdrop-blur-xl transition-all duration-300",
        "shadow-[0_10px_30px_rgb(0_0_0/0.28)]",
        focused
          ? "border-accent/45 shadow-[0_12px_38px_rgb(var(--accent-deep)/0.28)]"
          : "border-line",
      )}
    >
      {listening && (
        <div className="px-4 pt-3 text-[12.5px] text-accent-glow">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
            Listening…{" "}
            {interim && <em className="text-text-muted not-italic">{interim}</em>}
          </span>
        </div>
      )}
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={taRef}
          autoFocus={autoFocus}
          rows={1}
          value={text}
          disabled={disabled || listening}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 168)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
          placeholder={listening ? "Speak your request…" : placeholder}
          className="flex-1 resize-none bg-transparent outline-none px-3 py-2.5 text-[14px] leading-relaxed placeholder:text-text-faint max-h-[168px] no-min-h"
        />
        {supported && (
          <button
            type="button"
            aria-label={listening ? "Stop listening" : "Speak to Praxis"}
            disabled={disabled && !listening}
            onClick={() => (listening ? stop() : start())}
            className={cn(
              "grid place-items-center w-10 h-10 rounded-full border transition-all shrink-0 no-min-h",
              listening
                ? "bg-danger/15 border-danger/40 text-danger"
                : "border-transparent text-text-muted hover:text-text-primary hover:bg-text-primary/[0.08]",
            )}
          >
            {listening ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Mic className="w-[18px] h-[18px]" />
            )}
          </button>
        )}
        <button
          type="button"
          aria-label="Send"
          disabled={!canSend}
          onClick={sendText}
          className={cn(
            "grid place-items-center w-10 h-10 rounded-full shrink-0 transition-all duration-300 no-min-h",
            canSend
              ? "bg-accent-deep text-[#F4E9D9] hover:bg-accent hover:scale-105 shadow-[0_6px_18px_rgb(var(--accent-deep)/0.5)]"
              : "bg-text-primary/[0.06] text-text-faint",
          )}
        >
          <ArrowUp className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
