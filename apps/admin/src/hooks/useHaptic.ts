type HapticStyle = "light" | "medium" | "success" | "error";

const PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 25,
  success: 25,
  error: [15, 30, 15],
};

export function useHaptic() {
  return (style: HapticStyle = "light") => {
    try {
      navigator.vibrate?.(PATTERNS[style]);
    } catch {
      // Vibration API not available
    }
  };
}

export function haptic(style: HapticStyle = "light") {
  try {
    navigator.vibrate?.(PATTERNS[style]);
  } catch {
    // Vibration API not available
  }
}
