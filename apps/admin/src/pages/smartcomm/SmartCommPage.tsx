import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { useChannel, useInboxRealtime } from "@/hooks/useSmartcomm";
import { ChannelList } from "@/components/messaging/ChannelList";
import { MessageThread } from "@/components/messaging/MessageThread";
import { CustomerSidebar } from "@/components/messaging/CustomerSidebar";

/**
 * Full Messaging page — three-pane workstation (list / thread /
 * customer-360) on desktop, single-pane stack on mobile.
 *
 * The selected channel rides in the URL query (?channel=…) so reps can
 * share a link to a conversation.
 */
export function SmartCommPage() {
  useBreadcrumbs([{ label: "Messaging" }]);
  const user = useAuthStore((s) => s.user);
  const [params, setParams] = useSearchParams();
  const channelId = params.get("channel");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  useInboxRealtime(user?.id);

  const { data: channel } = useChannel(channelId);

  // Keep mobile view in sync with selection
  useEffect(() => {
    if (channelId) setMobileShowThread(true);
  }, [channelId]);

  function select(id: string) {
    const next = new URLSearchParams(params);
    next.set("channel", id);
    setParams(next, { replace: false });
  }

  return (
    <div className="h-[calc(100vh-180px)] min-h-[520px] -mx-[34px] -my-[26px] max-md:-mx-4 max-md:-my-5 rounded-none border-y hairline">
      <div className="grid h-full grid-cols-1 md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_320px]">
        {/* List */}
        <div
          className={
            mobileShowThread
              ? "hidden md:block h-full overflow-hidden"
              : "h-full overflow-hidden"
          }
        >
          <ChannelList
            activeChannelId={channelId}
            onSelect={(c) => {
              select(c.channel_id);
              setMobileShowThread(true);
            }}
          />
        </div>

        {/* Thread */}
        <div
          className={
            mobileShowThread ? "h-full" : "hidden md:block h-full"
          }
        >
          {channelId ? (
            <MessageThread
              channelId={channelId}
              onBack={() => setMobileShowThread(false)}
            />
          ) : (
            <div className="grid h-full place-items-center text-text-faint text-[13px]">
              Pick a conversation to start.
            </div>
          )}
        </div>

        {/* Customer-360 */}
        <div className="hidden xl:block h-full">
          {channel && <CustomerSidebar channel={channel} />}
        </div>
      </div>
    </div>
  );
}
