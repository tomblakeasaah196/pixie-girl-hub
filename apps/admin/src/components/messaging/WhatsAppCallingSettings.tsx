import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  messagingAccountsApi,
  type MessagingAccount,
} from "@/lib/messaging-accounts-api";
import { useToast } from "@/lib/toast";

/**
 * WhatsApp voice-calling toggle — per-number, read/written straight
 * against Meta's calling settings. Enabling shows the call button in the
 * customer's chat; inbound calls then ring agents in the Hub browser
 * (CallLayer). Inbound (customer→business) calling works for Nigerian
 * numbers; note that business-INITIATED calls are a Meta restriction,
 * not ours.
 *
 * States: loading spinner, error banner (e.g. number not eligible /
 * messaging tier too low — Meta requires a 2k+/day messaging limit),
 * and the live toggle.
 */
export function WhatsAppCallingSettings({
  account,
}: {
  account: MessagingAccount;
}) {
  const qc = useQueryClient();
  const toast = useToast("Messaging → WhatsApp calling");
  const q = useQuery({
    queryKey: ["messaging-accounts", account.account_id, "calling"],
    queryFn: () => messagingAccountsApi.getWhatsAppCalling(account.account_id),
    staleTime: 30_000,
    retry: false,
  });

  const enabled = q.data?.status === "ENABLED";

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      messagingAccountsApi.updateWhatsAppCalling(account.account_id, {
        enabled: next,
        ...(next ? { icon_visibility: "DEFAULT" as const } : {}),
      }),
    onSuccess: (_d, next) => {
      toast.success(next ? "Voice calling enabled" : "Voice calling disabled");
      qc.invalidateQueries({
        queryKey: ["messaging-accounts", account.account_id, "calling"],
      });
    },
    onError: (err: { message?: string }) => {
      toast.error("Couldn't update calling", err?.message || "Meta rejected the change.");
    },
  });

  return (
    <div className="rounded-2xl border hairline bg-panel/60 p-4">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-success/10 text-success shrink-0">
          <Phone className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13.5px] font-semibold text-text-primary">
                Voice calling
              </h3>
              <p className="text-[11.5px] text-text-muted">
                Let customers call this number on WhatsApp — calls ring your
                team right here in the Hub.
              </p>
            </div>
            {q.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-text-faint shrink-0" />
            ) : (
              <button
                role="switch"
                aria-checked={enabled}
                aria-label="Voice calling"
                disabled={mut.isPending || q.isError}
                onClick={() => mut.mutate(!enabled)}
                className={cn(
                  "relative w-11 h-6 rounded-full border transition-colors shrink-0 disabled:opacity-50",
                  enabled
                    ? "bg-success/30 border-success/50"
                    : "bg-text-primary/[0.06] border-line",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all",
                    enabled
                      ? "left-[22px] bg-success"
                      : "left-[2px] bg-text-faint",
                  )}
                />
              </button>
            )}
          </div>
          {q.isError && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-2.5 py-2 text-[11.5px] text-warn">
              <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
              <span>
                {(q.error as { message?: string })?.message ||
                  "Couldn't read calling settings from Meta."}{" "}
                The number needs a 2,000+/day messaging limit before Meta
                allows calling.
              </span>
            </div>
          )}
          {!q.isLoading && !q.isError && (
            <p className="mt-1.5 text-[11px] text-text-faint">
              {enabled
                ? "The call button is visible in the customer's chat. Missed calls auto-reply and create a follow-up task."
                : "Customers can't call this number yet. Flip the toggle once the number has a 2,000+/day messaging limit."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
