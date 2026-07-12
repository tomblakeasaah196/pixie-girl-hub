/**
 * Read-aloud via the browser's SpeechSynthesis API — the output half of Web
 * Speech (§6.29 voice). Free and fully client-side: voices ship with the
 * OS/browser (Chrome bundles the Google voices, Safari the Siri set), so
 * there's no ElevenLabs-style vendor bill and no server config. Unlike the
 * mic (SpeechRecognition), synthesis is supported by every modern browser.
 *
 * Voice, speed (rate) and tone (pitch) are user-tunable in-app and persisted
 * per device in localStorage — voice lists differ per OS/browser, so a chosen
 * voiceURI only means something on the device that picked it and we fall back
 * to the best English voice elsewhere.
 *
 * Long replies are chunked into sentence groups before queueing: Chrome's
 * engine stalls silently partway through long single utterances, and short
 * chunks also make Stop feel immediate.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const ttsSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

export interface TtsSettings {
  /** null → auto-pick the best English voice on this device. */
  voiceURI: string | null;
  /** Speaking speed, 1 = the voice's natural pace. */
  rate: number;
  /** Tone (pitch), 1 = the voice's natural pitch. */
  pitch: number;
}

export const TTS_DEFAULTS: TtsSettings = { voiceURI: null, rate: 1, pitch: 1 };

const STORE_KEY = "praxis.tts.v1";

export function readTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...TTS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TtsSettings>;
    return {
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: clamp(Number(parsed.rate) || 1, 0.5, 2),
      pitch: clamp(Number(parsed.pitch) || 1, 0.5, 2),
    };
  } catch {
    return { ...TTS_DEFAULTS };
  }
}

export function writeTtsSettings(patch: Partial<TtsSettings>): TtsSettings {
  const next = { ...readTtsSettings(), ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* storage full/blocked — settings just won't persist */
  }
  return next;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Voices load asynchronously in Chrome — empty until `voiceschanged` fires. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      // English first (the app's language), then the rest, both A→Z.
      const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
      const rest = all.filter((v) => !v.lang.toLowerCase().startsWith("en"));
      const byName = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
        a.name.localeCompare(b.name);
      setVoices([...en.sort(byName), ...rest.sort(byName)]);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

/** Stored choice if it still exists on this device, else best English voice. */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  voiceURI: string | null,
): SpeechSynthesisVoice | null {
  if (voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return (
    en.find((v) => /google uk english female/i.test(v.name)) ??
    en.find((v) => /google/i.test(v.name)) ??
    en.find((v) => v.default) ??
    en[0] ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

/** Markdown → plain speakable prose (links read as their text, code skipped). */
function speechText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, "$1")
    .replace(/\|/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-grouped chunks ≤ ~maxLen chars (hard-split runaway sentences). */
function chunkForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > maxLen) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
    while (current.length > maxLen * 1.5) {
      chunks.push(current.slice(0, maxLen).trim());
      current = current.slice(maxLen);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function useReadAloud() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Chrome garbage-collects un-referenced utterances mid-speech; hold them.
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  // Monotonic token: a stale queue's callbacks must not clear a newer run.
  const runRef = useRef(0);

  const stop = useCallback(() => {
    if (!ttsSupported) return;
    runRef.current += 1;
    window.speechSynthesis.cancel();
    utterancesRef.current = [];
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, markdown: string) => {
    if (!ttsSupported) return;
    const run = ++runRef.current;
    const synth = window.speechSynthesis;
    synth.cancel();

    const text = speechText(markdown);
    if (!text) return;

    const settings = readTtsSettings();
    const voice = pickVoice(synth.getVoices(), settings.voiceURI);
    const chunks = chunkForSpeech(text);
    const finish = () => {
      if (runRef.current !== run) return;
      utterancesRef.current = [];
      setSpeakingId(null);
    };
    const utterances = chunks.map((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = settings.rate;
      u.pitch = settings.pitch;
      if (i === chunks.length - 1) u.onend = finish;
      u.onerror = finish;
      return u;
    });
    utterancesRef.current = utterances;
    setSpeakingId(id);
    // cancel() immediately followed by speak() drops the first utterance in
    // some Chrome builds — yield a beat before queueing.
    setTimeout(() => {
      if (runRef.current !== run) return;
      for (const u of utterances) synth.speak(u);
    }, 60);
  }, []);

  // Leaving the thread shouldn't leave a voice talking to nobody.
  useEffect(() => {
    return () => {
      if (utterancesRef.current.length) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { supported: ttsSupported, speakingId, speak, stop };
}

export type ReadAloudApi = ReturnType<typeof useReadAloud>;
