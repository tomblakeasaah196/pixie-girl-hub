/**
 * Invoice Delivery panel — "was it sent, did it land, did she open it?" on the
 * invoice's own detail screen. Shows a Sent → Delivered → Opened stepper plus
 * the per-document send history (every email/WhatsApp attempt, newest first).
 *
 * The honest "received" signal on a plain-SMTP setup is `first_viewed_at`,
 * stamped when the customer opens the secure invoice link — surfaced here as
 * "Opened". Resend lives next to the stepper so a failed send is one click from
 * a retry (with a channel switch).
 */

import { Send, MailCheck, Eye, AlertCircle, Clock } from "lucide-react";
import { Card, Pill } from "@/components/ui/primitives";
import { COMMS_STATUS } from "./constants";
import type { DeliveryView, CommsLogEntry } from "./types";

function fmt(ts: string | null | undefined) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function channelLabel(c: string | null | undefined) {
  if (!c) return "—";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Reduce the send stamps + history into the three stepper stages. */
function deriveStages(delivery: DeliveryView | undefined) {
  const history = delivery?.history ?? [];
  const has = (...s: string[]) => history.some((h) => s.includes(h.status));
  const latestFailed =
    history.length > 0 &&
    ["failed", "bounced"].includes(history[0].status) &&
    !has("sent", "delivered", "opened");

  const sent = !!delivery?.sent_at || has("sent", "delivered", "opened", "queued");
  const delivered = !!delivery?.first_viewed_at || has("delivered", "opened");
  const opened = !!delivery?.first_viewed_at || has("opened");

  return { sent, delivered, opened, latestFailed };
}

function Step({
  icon,
  label,
  sub,
  done,
  failed,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  done: boolean;
  failed?: boolean;
}) {
  const tone = failed
    ? "text-danger"
    : done
      ? "text-success"
      : "text-text-faint";
  const ring = failed
    ? "border-danger/40 bg-danger/10"
    : done
      ? "border-success/40 bg-success/10"
      : "border-line bg-text-primary/[0.03]";
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-full border ${ring} ${tone}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`text-[12px] font-semibold ${done || failed ? "text-text-primary" : "text-text-faint"}`}>
            {label}
          </div>
          {sub && <div className="text-[10.5px] text-text-faint truncate">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: CommsLogEntry }) {
  const meta = COMMS_STATUS[entry.status] ?? { label: entry.status, tone: "neutral" as const };
  return (
    <div className="flex items-center justify-between text-[12px] p-2 rounded-lg bg-text-primary/[0.02]">
      <div className="min-w-0">
        <div className="font-semibold capitalize">
          {channelLabel(entry.channel)}
          {entry.recipient && (
            <span className="text-text-faint font-normal"> · {entry.recipient}</span>
          )}
        </div>
        {entry.error && (
          <div className="text-[10.5px] text-danger truncate">{entry.error}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <span className="text-[10px] text-text-faint">{fmt(entry.created_at)}</span>
      </div>
    </div>
  );
}

export function DeliveryPanel({
  delivery,
  isLoading,
  resendSlot,
}: {
  delivery: DeliveryView | undefined;
  isLoading?: boolean;
  resendSlot?: React.ReactNode;
}) {
  const { sent, delivered, opened, latestFailed } = deriveStages(delivery);
  const history = delivery?.history ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="micro">Delivery</div>
        {resendSlot}
      </div>

      {isLoading ? (
        <div className="h-10 rounded-lg bg-text-primary/[0.04] animate-pulse" />
      ) : !sent && !latestFailed ? (
        <div className="text-[12px] text-text-faint">
          Not sent to the customer yet. Use{" "}
          <span className="text-text-muted">Send</span> to deliver it by email or
          WhatsApp.
        </div>
      ) : (
        <>
          {/* Stepper */}
          <div className="flex items-center gap-1">
            <Step
              icon={latestFailed ? <AlertCircle className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              label={latestFailed ? "Send failed" : "Sent"}
              sub={
                latestFailed
                  ? "Retry below"
                  : delivery?.sent_at
                    ? `${channelLabel(delivery.sent_via)} · ${fmt(delivery.sent_at)}`
                    : undefined
              }
              done={sent}
              failed={latestFailed}
            />
            <div className={`h-px flex-1 ${delivered ? "bg-success/40" : "bg-line"}`} />
            <Step
              icon={<MailCheck className="w-3.5 h-3.5" />}
              label="Delivered"
              done={delivered}
            />
            <div className={`h-px flex-1 ${opened ? "bg-success/40" : "bg-line"}`} />
            <Step
              icon={<Eye className="w-3.5 h-3.5" />}
              label="Opened"
              sub={delivery?.first_viewed_at ? fmt(delivery.first_viewed_at) : undefined}
              done={opened}
            />
          </div>

          {/* Honest caveat: plain SMTP can't confirm delivery; "Opened" is the
              real signal (customer viewed the secure link). */}
          {sent && !opened && !latestFailed && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-faint">
              <Clock className="w-3 h-3" />
              Sent — waiting for the customer to open it.
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-faint">
                History
              </div>
              {history.map((h) => (
                <HistoryRow key={h.log_id} entry={h} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
