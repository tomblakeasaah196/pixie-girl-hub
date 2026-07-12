/**
 * Voice input for the Praxis/CoS composer — server-first, browser-fallback.
 *
 * PRIMARY: record a clip with MediaRecorder and transcribe it server-side
 * (Whisper via the groq vendor configured in AI Control → Vendors & Models;
 * .env is the config fallback) — far more accurate for Nigerian-accented
 * English than browser recognition. FALLBACK: the browser's Web Speech API
 * (useSpeechInput) when the server path is unconfigured, errors mid-session
 * (e.g. free tier exhausted → the failure is sticky for the session so we
 * don't hammer a dead endpoint), or MediaRecorder is unavailable.
 *
 * Either path hands the final transcript to `onFinal`; the composer stages it
 * for editing before send.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechInput } from "./useSpeechInput";
import { transcribeAudio, useTranscriptionStatus } from "@/lib/praxis-api";

// After a failed server transcription, stay on the browser path until reload —
// the likely causes (quota exhausted, vendor down) don't fix themselves fast.
let serverPathBroken = false;

const MAX_RECORD_MS = 5 * 60_000;

const recorderSupported =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function extFor(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function useVoiceInput({
  onFinal,
}: {
  /** Called once with the full transcript when a take finishes. */
  onFinal: (transcript: string) => void;
}) {
  const status = useTranscriptionStatus();
  const speech = useSpeechInput({ onFinal });
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(serverPathBroken);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const aliveRef = useRef(true);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const serverMode =
    recorderSupported && !broken && status.data?.available === true;
  const supported = serverMode || speech.supported;

  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const startServer = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (aliveRef.current) setError("Couldn't access the microphone.");
      return;
    }
    const mime = pickMime();
    const rec = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined,
    );
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recRef.current = null;
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (!aliveRef.current) return;
      if (!blob.size) {
        setPhase("idle");
        return;
      }
      setPhase("transcribing");
      try {
        const { text } = await transcribeAudio(blob, `clip.${extFor(type)}`);
        if (aliveRef.current && text.trim()) onFinalRef.current(text.trim());
      } catch {
        serverPathBroken = true;
        if (aliveRef.current) {
          setBroken(true);
          setError(
            "Transcription is unavailable — the mic now uses your browser's recognition. Tap the mic to retry.",
          );
        }
      } finally {
        if (aliveRef.current) setPhase("idle");
      }
    };
    recRef.current = rec;
    setPhase("recording");
    rec.start();
    setTimeout(() => {
      if (recRef.current === rec && rec.state === "recording") rec.stop();
    }, MAX_RECORD_MS);
  }, []);

  const { start: speechStart, stop: speechStop } = speech;
  const start = useCallback(() => {
    setError(null);
    if (serverMode) void startServer();
    else speechStart();
  }, [serverMode, startServer, speechStart]);

  const stop = useCallback(() => {
    if (recRef.current) recRef.current.stop();
    else speechStop();
  }, [speechStop]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const rec = recRef.current;
      if (rec && rec.state === "recording") rec.stop();
    };
  }, []);

  return {
    supported,
    /** Which engine the NEXT take will use. */
    mode: serverMode ? ("server" as const) : ("browser" as const),
    /** Mic is hot (either engine). */
    active: phase === "recording" || speech.listening,
    /** Clip uploaded, awaiting the transcript. */
    transcribing: phase === "transcribing",
    /** Elapsed recording seconds (server mode). */
    seconds,
    /** Live partial text (browser mode only — Whisper has no interim). */
    interim: speech.interim,
    error,
    start,
    stop,
  };
}
