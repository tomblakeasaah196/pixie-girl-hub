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

// ── Autoplay unlock ───────────────────────────────────────
// Browsers create an AudioContext in the `suspended` state until the page has
// seen a real user gesture, and resume() outside a gesture never completes.
// That is silent for a chime and *unacceptable* for a ringing phone: an agent
// who loaded the Hub and then didn't click anything would get a visual ring
// with no sound at all.
//
// So: latch onto the first gesture of the session (whatever it is — the
// listeners are passive and self-removing) and resume the context then, long
// before any call arrives. `isAudioBlocked()` reports the state honestly so
// the UI can show a one-tap "enable call sounds" prompt if the ring somehow
// beats the first click.

let unlockBound = false;
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** Resume the shared AudioContext. Safe to call repeatedly. */
export function unlockAudio(): void {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume().catch(() => {});
}

/** True when a ring would currently be silent (context blocked by autoplay). */
export function isAudioBlocked(): boolean {
  const ac = audioCtx;
  if (!ac) return typeof AudioContext !== "undefined" ? false : true;
  return ac.state === "suspended";
}

function bindUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const handler = () => {
    unlockAudio();
    for (const evt of UNLOCK_EVENTS) {
      window.removeEventListener(evt, handler, true);
    }
  };
  for (const evt of UNLOCK_EVENTS) {
    window.addEventListener(evt, handler, { capture: true, passive: true });
  }
}

bindUnlock();

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

// ── Ringtone (WhatsApp calls) ─────────────────────────────
// A ring is not a chime: it has to survive being ignored for 30 seconds and it
// has to be recognisable as a *phone* from across a room. Cadence is a
// double-burst (like a landline) repeated every 2.4 s, with the gain stepping
// up over the first few bursts so a quiet first ring doesn't cost the call.
//
// Still synthesised — no asset files, no extra fetch on a slow connection at
// exactly the moment latency matters most. Honours the same on/off preference
// as the notification chimes.

const RING_PERIOD_MS = 2400;
const RING_GAIN_START = 0.09;
const RING_GAIN_MAX = 0.2;
const RING_GAIN_STEP = 0.025;

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringBurstIndex = 0;

function ringBurst(ac: AudioContext, gain: number) {
  // Two rising pairs per burst — the "brrring… brrring" shape.
  tone(ac, 880, 0, 0.22, gain);
  tone(ac, 1174.7, 0.24, 0.26, gain * 0.9);
  tone(ac, 880, 0.62, 0.22, gain);
  tone(ac, 1174.7, 0.86, 0.26, gain * 0.9);
}

export function startRingtone() {
  if (ringTimer || !isNotifSoundEnabled()) return;
  const ac = ctx();
  if (!ac) return;
  // A ring is the one sound worth fighting the autoplay policy for: try to
  // resume even if no gesture has landed yet. If it stays suspended the UI
  // surfaces a tap-to-enable prompt (see isAudioBlocked).
  unlockAudio();
  ringBurstIndex = 0;
  const burst = () => {
    const gain = Math.min(
      RING_GAIN_MAX,
      RING_GAIN_START + ringBurstIndex * RING_GAIN_STEP,
    );
    ringBurstIndex += 1;
    try {
      ringBurst(ac, gain);
    } catch {}
  };
  burst();
  ringTimer = setInterval(burst, RING_PERIOD_MS);
}

export function stopRingtone() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  ringBurstIndex = 0;
}

// ── Vibration (WhatsApp calls) ────────────────────────────
// Android/Chrome only — iOS Safari has no Vibration API, which is exactly why
// the out-of-app path leans on a push notification (the OS vibrates for that
// one). Re-armed on an interval because `navigator.vibrate` takes a finite
// pattern, and a ring must keep going until it's answered.

const VIBRATE_PATTERN = [500, 220, 500, 220, 500];
const VIBRATE_PERIOD_MS = 2400;

let vibrateTimer: ReturnType<typeof setInterval> | null = null;

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

export function startVibration() {
  if (vibrateTimer || !canVibrate()) return;
  const pulse = () => {
    try {
      navigator.vibrate(VIBRATE_PATTERN);
    } catch {}
  };
  pulse();
  vibrateTimer = setInterval(pulse, VIBRATE_PERIOD_MS);
}

export function stopVibration() {
  if (vibrateTimer) {
    clearInterval(vibrateTimer);
    vibrateTimer = null;
  }
  if (canVibrate()) {
    try {
      navigator.vibrate(0); // cancel any pulse still running
    } catch {}
  }
}

/** One short buzz — confirms an answer/decline on a touch device. */
export function tapFeedback() {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(30);
  } catch {}
}
