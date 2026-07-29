import { useCallback, useEffect, useState } from "react";
import { PhoneIncoming, Share, X } from "lucide-react";
import {
  ensurePushSubscription,
  hasCallPushBeenPrompted,
  isIosSafariTab,
  markCallPushPrompted,
  pushSupported,
  requestPushPermission,
} from "@/lib/push";

/**
 * Asks for notification permission on behalf of the PHONE, not the bell.
 *
 * Push is a convenience for approvals and a hard requirement for calls: with
 * no subscription on this device, a ringing customer cannot reach an agent
 * whose app is closed — state 3 simply does not exist. That deserves its own
 * ask, with its own copy and its own dismissal, rather than sharing the
 * generic notifications banner that people wave away on day one.
 *
 * Shown once per device to agents who can take calls, and only while there is
 * something to fix (permission still `default`). On an iOS browser tab there is
 * nothing to grant — web push there requires the PWA to be installed to the
 * home screen first — so the banner says that instead of prompting into a
 * dead end.
 */
export function CallPushGate() {
  const [state, setState] = useState<"hidden" | "ask" | "ios">("hidden");

  useEffect(() => {
    if (hasCallPushBeenPrompted()) return;
    if (!pushSupported()) {
      // iOS Safari has Notification but no PushManager until installed.
      if (isIosSafariTab()) setState("ios");
      return;
    }
    if (isIosSafariTab()) {
      setState("ios");
      return;
    }
    if (Notification.permission === "default") setState("ask");
  }, []);

  const enable = useCallback(async () => {
    markCallPushPrompted();
    const perm = await requestPushPermission();
    if (perm === "granted") await ensurePushSubscription();
    setState("hidden");
  }, []);

  const dismiss = useCallback(() => {
    markCallPushPrompted();
    setState("hidden");
  }, []);

  if (state === "hidden") return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[86px] md:bottom-[74px] z-[70] w-[min(420px,94vw)]">
      <div className="dropglass rounded-[16px] border hairline shadow-2xl px-3.5 py-3 flex items-start gap-2.5">
        <PhoneIncoming className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        {state === "ask" ? (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-text-primary">
                Take calls when the Hub is closed
              </p>
              <p className="text-[11.5px] text-text-muted mt-0.5">
                Allow notifications and your device will ring for customer calls
                even when this tab isn't open.
              </p>
            </div>
            <button
              onClick={() => void enable()}
              className="no-min-h h-8 px-3 rounded-lg bg-accent-deep text-[#F4E9D9] text-[11.5px] font-semibold hover:bg-accent transition-colors shrink-0"
            >
              Allow
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-text-primary">
                Add Pixie Hub to your Home Screen
              </p>
              <p className="text-[11.5px] text-text-muted mt-0.5 inline-flex items-center gap-1 flex-wrap">
                On iPhone, calls can only ring a closed app once the Hub is
                installed. Tap
                <Share className="w-3.5 h-3.5 inline-block align-text-bottom" />
                Share → “Add to Home Screen”, then open it from there.
              </p>
            </div>
          </>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="no-min-h shrink-0 p-1 rounded-md text-text-faint hover:text-text-primary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
