import { useEffect, useRef, useState } from "react";
import { Trash2, Send, Loader2 } from "lucide-react";
import { fmtDuration, getAudioContext } from "@/lib/messaging-media";

const VIS_BARS = 32;

/**
 * WhatsApp-style voice recorder. Starts capturing on mount (asks for mic
 * once). Shows a live waveform + timer; the user trashes to cancel or taps
 * send to finish. On finish, hands the recorded Blob back to the composer.
 */
export function VoiceRecorder({
  onComplete,
  onCancel,
}: {
  onComplete: (blob: Blob, seconds: number) => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    function cleanup() {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (ctxRef.current && ctxRef.current.state !== "closed")
        ctxRef.current.close().catch(() => {});
    }

    function tick() {
      const analyser = analyserRef.current;
      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
        setLevels((l) => [...l.slice(-(VIS_BARS - 1)), avg]);
      }
      setSeconds((Date.now() - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = getAudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyserRef.current = analyser;

        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const rec = new MediaRecorder(
          stream,
          mime ? { mimeType: mime } : undefined,
        );
        recorderRef.current = rec;
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || "audio/webm",
          });
          const dur = Math.round((Date.now() - startRef.current) / 1000);
          cleanup();
          if (cancelledRef.current) onCancel();
          else onComplete(blob, dur);
        };
        startRef.current = Date.now();
        rec.start();
        tick();
      } catch {
        setError("Microphone access denied");
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop(send: boolean) {
    cancelledRef.current = !send;
    setFinishing(send);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else onCancel();
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 flex-1 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] text-danger">
        <span className="flex-1">{error}</span>
        <button
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-1 rounded-2xl border border-danger/30 bg-panel-2 px-3 py-2">
      <button
        onClick={() => stop(false)}
        className="grid place-items-center w-8 h-8 rounded-full text-text-muted hover:text-danger shrink-0"
        title="Cancel recording"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <span className="flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
        <span className="font-mono text-[12px] text-text-primary tabular-nums">
          {fmtDuration(seconds)}
        </span>
      </span>

      <div className="flex-1 flex items-center gap-[2px] h-7 overflow-hidden">
        {Array.from({ length: VIS_BARS }).map((_, i) => {
          const v = levels[i] ?? 0;
          return (
            <span
              key={i}
              className="flex-1 rounded-full bg-accent/70"
              style={{ height: `${Math.max(8, v * 100)}%` }}
            />
          );
        })}
      </div>

      <span className="hidden sm:inline text-[10px] text-text-faint shrink-0">
        ‹ trash to cancel
      </span>

      <button
        onClick={() => stop(true)}
        disabled={finishing || seconds < 1}
        className="grid place-items-center w-9 h-9 rounded-full bg-accent text-bg hover:bg-accent-glow disabled:opacity-40 shrink-0"
        title="Send voice note"
      >
        {finishing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
