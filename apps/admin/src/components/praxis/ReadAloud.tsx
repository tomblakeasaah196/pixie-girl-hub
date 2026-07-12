/**
 * Read-aloud controls for assistant messages (§6.29 voice) — a "Listen"/"Stop"
 * action styled like the thread's Copy button, plus a small glass popover
 * where the user tunes playback voice, speed and tone in-app (no browser
 * settings involved) with a live preview. Settings persist per device; the
 * whole affordance hides where SpeechSynthesis is unavailable.
 */

import { useEffect, useRef, useState } from "react";
import { Volume2, Square, SlidersHorizontal, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/controls";
import {
  readTtsSettings,
  writeTtsSettings,
  useVoices,
  type ReadAloudApi,
  type TtsSettings,
} from "@/hooks/useReadAloud";

const PREVIEW_ID = "__tts_preview__";
const PREVIEW_TEXT =
  "Hello! This is how I'll sound when reading replies out loud.";
const AUTO_VOICE = "__auto__";

export function ReadAloudButton({
  id,
  text,
  tts,
}: {
  id: string;
  text: string;
  tts: ReadAloudApi;
}) {
  if (!tts.supported) return null;
  const active = tts.speakingId === id;
  return (
    <button
      type="button"
      onClick={() => (active ? tts.stop() : tts.speak(id, text))}
      title={active ? "Stop reading" : "Read aloud"}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] transition-colors",
        active
          ? "text-accent-glow"
          : "text-text-faint hover:text-text-primary",
      )}
    >
      {active ? (
        <>
          <Square className="w-3 h-3 fill-current" /> Stop
        </>
      ) : (
        <>
          <Volume2 className="w-3 h-3" /> Listen
        </>
      )}
    </button>
  );
}

/** Gear next to Listen — opens the voice/speed/tone popover (opens upward). */
export function VoiceSettingsButton({ tts }: { tts: ReadAloudApi }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  if (!tts.supported) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Voice settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center text-[11px] transition-colors",
          open ? "text-text-primary" : "text-text-faint hover:text-text-primary",
        )}
      >
        <SlidersHorizontal className="w-3 h-3" />
      </button>
      {open && <VoiceSettingsPanel tts={tts} />}
    </div>
  );
}

function VoiceSettingsPanel({ tts }: { tts: ReadAloudApi }) {
  const voices = useVoices();
  const [settings, setSettings] = useState<TtsSettings>(readTtsSettings);

  const update = (patch: Partial<TtsSettings>) =>
    setSettings(writeTtsSettings(patch));

  const voiceOptions = [
    { value: AUTO_VOICE, label: "Auto (best English voice)" },
    ...voices.map((v) => ({
      value: v.voiceURI,
      label: `${v.name} (${v.lang})`,
    })),
  ];
  const previewing = tts.speakingId === PREVIEW_ID;

  return (
    <div className="select-dropdown-list absolute z-50 bottom-[calc(100%+6px)] left-0 w-[272px] rounded-[14px] p-3.5 space-y-3 cursor-default">
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-text-faint font-bold">
        Read-aloud voice
      </p>

      <Select
        ariaLabel="Playback voice"
        value={settings.voiceURI ?? AUTO_VOICE}
        options={voiceOptions}
        onChange={(v) => update({ voiceURI: v === AUTO_VOICE ? null : v })}
      />

      <SliderRow
        label="Speed"
        value={settings.rate}
        onChange={(rate) => update({ rate })}
      />
      <SliderRow
        label="Tone"
        value={settings.pitch}
        onChange={(pitch) => update({ pitch })}
      />

      <button
        type="button"
        onClick={() =>
          previewing ? tts.stop() : tts.speak(PREVIEW_ID, PREVIEW_TEXT)
        }
        className="inline-flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors"
      >
        {previewing ? (
          <>
            <Square className="w-3 h-3 fill-current" /> Stop preview
          </>
        ) : (
          <>
            <Play className="w-3 h-3" /> Preview
          </>
        )}
      </button>

      <p className="text-[10.5px] leading-relaxed text-text-faint">
        Voices come from this device's browser, so the list differs per
        device. Your choice is remembered here.
      </p>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[11.5px] text-text-muted mb-1">
        {label}
        <span className="font-mono text-text-faint">{value.toFixed(2)}×</span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[rgb(var(--accent))]"
      />
    </label>
  );
}
