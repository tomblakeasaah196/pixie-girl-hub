import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-[25] flex items-center justify-center gap-2 h-7 bg-warn/15 border-b border-warn/25 text-warn text-[11px] font-medium animate-[slide-down_200ms_ease-out_both]">
      <WifiOff className="w-3 h-3" />
      You're offline — changes will sync when reconnected
    </div>
  );
}
