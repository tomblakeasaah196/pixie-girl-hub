/**
 * Priority-aware notification sounds using the Web Audio API.
 * No asset files required — pure synthesised tones.
 *
 * urgent  → 3-note chime (descending minor: 1047 Hz, 880 Hz, 698 Hz)
 * high    → 2-tone pop  (880 Hz, 1318 Hz)
 * normal  → 1 soft blip (880 Hz)
 * low     → silent
 */

let audioCtx: AudioContext | null = null;

const SOUND_KEY = "pgh_notif_sound";

export function isNotifSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNotifSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
}

function ctx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    type Ctor = typeof AudioContext;
    const C: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
  } catch {
    return null;
  }
  return audioCtx;
}

function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gain = 0.12,
) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = ac.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playNotifSound(priority: "low" | "normal" | "high" | "urgent") {
  if (!isNotifSoundEnabled() || priority === "low") return;
  const ac = ctx();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  try {
    if (priority === "urgent") {
      tone(ac, 1047, 0, 0.14, 0.14);
      tone(ac, 880, 0.15, 0.14, 0.12);
      tone(ac, 698, 0.3, 0.2, 0.1);
    } else if (priority === "high") {
      tone(ac, 880, 0, 0.09, 0.12);
      tone(ac, 1318.5, 0.09, 0.16, 0.1);
    } else {
      tone(ac, 880, 0, 0.1, 0.08);
    }
  } catch {}
}

// Throttle: at most one alert per notification_id ever, global 1s cooldown.
const played = new Set<string>();
let lastGlobal = 0;

export function playOnce(
  priority: "low" | "normal" | "high" | "urgent",
  id: string,
) {
  if (played.has(id)) return;
  const now = Date.now();
  if (now - lastGlobal < 1000) return;
  lastGlobal = now;
  played.add(id);
  playNotifSound(priority);
}
