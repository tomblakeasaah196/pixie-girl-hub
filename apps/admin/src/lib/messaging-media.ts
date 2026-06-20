/**
 * Small helpers for rendering message media (images, video, voice notes,
 * documents) in the chat. No external deps — waveform peaks are computed
 * with the Web Audio API in the player/recorder components.
 */
import type { MessageType } from "./smartcomm-types";

export type MediaKind = "image" | "video" | "audio" | "file";

/** Decide how to render an attachment from the message type + mime. */
export function mediaKind(
  messageType: MessageType,
  mime?: string | null,
): MediaKind {
  if (messageType === "image") return "image";
  if (messageType === "video") return "video";
  if (messageType === "voice_note") return "audio";
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  return "file";
}

/** Human-readable byte size, e.g. "1.4 MB". */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 0 && n < 10 ? 1 : 0)} ${units[i]}`;
}

/** m:ss clock, guarding against NaN/Infinity from undecoded blobs. */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Cross-browser AudioContext constructor (Safari prefix), no `any`. */
export function getAudioContext(): AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio not supported");
  return new Ctor();
}

/**
 * Downsample a decoded mono channel into `bars` normalised peaks (0..1).
 * Used by the voice-note player to draw a static waveform.
 */
export function computePeaks(data: Float32Array, bars: number): number[] {
  const block = Math.floor(data.length / bars) || 1;
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    let sum = 0;
    for (let j = 0; j < block; j += 1)
      sum += Math.abs(data[i * block + j] || 0);
    out.push(sum / block);
  }
  const max = Math.max(...out, 0.0001);
  return out.map((v) => v / max);
}
