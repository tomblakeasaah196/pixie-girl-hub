/**
 * Voice input via the browser's Web Speech API (§6.29 voice v1).
 *
 * Transcribes locally — free, instant, no server config — and hands the
 * final transcript to the caller, who sends it as `transcribed_text` with
 * input_mode "voice" (the backend accepts either a transcript or an audio
 * URL). Where SpeechRecognition is unavailable (Firefox, some WebViews),
 * `supported` is false and the mic button simply doesn't render; server-side
 * Whisper upload can slot in later without touching callers.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the vendor-prefixed API (not in lib.dom for all targets).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}
interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput({
  onFinal,
  lang = "en-NG",
}: {
  /** Called once with the full transcript when the user stops speaking. */
  onFinal: (transcript: string) => void;
  lang?: string;
}) {
  const supported = !!getRecognitionCtor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
      const text = finalRef.current.trim();
      if (text) onFinalRef.current(text);
    };
    rec.onerror = () => {
      // onend fires after onerror; treat as a normal stop (mic denied etc.).
    };

    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [lang]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, start, stop };
}
