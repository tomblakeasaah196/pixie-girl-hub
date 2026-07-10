import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth";
import { startIdleWatch, stopIdleWatch } from "@/lib/idle-session";

/**
 * Headless: runs the idle-session heartbeat/probe loop (lib/idle-session.ts)
 * whenever a session is authed, so an open tab locks promptly once the
 * 45-minute idle window lapses. Renders nothing.
 */
export function IdleSessionGuard() {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== "authed") return;
    startIdleWatch();
    return stopIdleWatch;
  }, [status]);

  return null;
}
