import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Detects low-end devices (low CPU cores, low memory, save-data, slow connection)
 * so we can downgrade animations gracefully without blocking interactions.
 */
export function useLowEndDevice() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    const save = nav.connection?.saveData ?? false;
    const slow = ["slow-2g", "2g", "3g"].includes(nav.connection?.effectiveType ?? "");
    setLow(cores <= 4 || mem <= 4 || save || slow);
  }, []);
  return low;
}

/**
 * Unified motion preferences. `motionOk` is false when the user prefers reduced
 * motion OR when running on a low-end device — use simple opacity fades only.
 */
export function useMotionPrefs() {
  const reduce = useReducedMotion();
  const low = useLowEndDevice();
  const motionOk = !reduce && !low;
  return { motionOk, reduce: !!reduce, low };
}
