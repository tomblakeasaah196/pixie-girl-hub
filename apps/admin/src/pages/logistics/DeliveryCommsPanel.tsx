/**
 * Delivery comms panel — "did the customer actually get told?" on the
 * delivery's own screen.
 *
 * Booking a courier now sends the customer the shipment details (shipper,
 * waybill, pickup/ETA window, rider). This panel is the receipt for that: a
 * Sent → Delivered → Opened stepper over the delivery's outbound ledger, plus
 * every attempt underneath — the same shape (and the same ledger) the invoice
 * and receipt screens use.
 *
 * The stages are deliberately honest. On plain SMTP nobody can confirm inbox
 * delivery, so "Delivered" lights only on a provider receipt (WhatsApp/IG) and
 * "Opened" only when the customer actually loaded her tracking link. A send is
 * never quietly upgraded into a read.
 */

import { Send, MailCheck, Eye, AlertCircle, Clock, Loader2, Mail } from "lucide-react";
import { Button, Pill, type Tone } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import {
  useDeliveryComms,
  useNotifyBooked,
  type CommsStatus,
  type DeliveryComms,
  type DeliveryCommsEntry,
} from "@/lib/logistics-api";

const STATUS_META: Record<CommsStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  opened: { label: "Opened", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  bounced: { label: "Bounced", tone: "danger" },
};

/** What each ledger row was actually about, in the operator's language. */
const EVENT_LABEL: Record<string, string> = {
  delivery_booked: "Booking notice",
  delivery_delivered: "Delivered confirmation",
  "delivery.tracking_opened": "Customer opened tracking",
};

function channelLabel(c: string | null | undefined) {
  if (!c) return "—";
  if (c === "whatsapp") return "WhatsApp";
  if (c === "instagram") return "Instagram";
  if (c === "sms") return "SMS";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function fmt(ts: string | null | undefined) {
  return formatDateTime(ts, "");
}

/** Reduce the ledger into the three stepper stages. */
function deriveStages(comms: DeliveryComms | undefined) {
  const history = comms?.history ?? [];
  const has = (...s: CommsStatus[]) => history.some((h) => s.includes(h.status));
  // A send that never succeeded and was never superseded — the retry case.
  const latestFailed =
    history.length > 0 &&
    ["failed", "bounced"].includes(history[0].status) &&
    !has("sent", "delivered", "opened");

  return {
    sent: Boolean(comms?.sent_at) || has("sent", "queued", "delivered", "opened"),
    delivered: Boolean(comms?.delivered_at) || has("delivered", "opened"),
    opened: Boolean(comms?.first_viewed_at) || has("opened"),
    latestFailed,
  };
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
  const tone = failed ? "text-danger" : done ? "text-success" : "text-text-faint";
  const ring = failed
    ? "border-danger/40 bg-danger/10"
    : done
      ? "border-success/40 bg-success/10"
      : "border-line bg-text-primary/[0.03]";
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-full border shrink-0 ${ring} ${tone}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div
            className={`text-[12px] font-semibold ${done || failed ? "text-text-primary" : "text-text-faint"}`}
          >
            {label}
          </div>
          {sub && <div className="text-[10.5px] text-text-faint truncate">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: DeliveryCommsEntry }) {
  const meta = STATUS_META[entry.status] ?? {
    label: entry.status,
    tone: "neutral" as Tone,
  };
  const what = entry.event_key ? EVENT_LABEL[entry.event_key] : null;
  return (
    <div className="flex items-start justify-between gap-2 text-[12px] p-2 rounded-lg bg-text-primary/[0.02]">
      <div className="min-w-0">
        <div className="font-semibold">
          {what ?? channelLabel(entry.channel)}
          {what && (
            <span className="text-text-faint font-normal">
              {" "}
              · {channelLabel(entry.channel)}
            </span>
          )}
        </div>
        {entry.recipient && (
          <div className="text-[10.5px] text-text-faint truncate">{entry.recipient}</div>
        )}
        {entry.error && (
          <div className="text-[10.5px] text-danger truncate">{entry.error}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <span className="text-[10px] text-text-faint font-mono">
          {fmt(entry.created_at)}
        </span>
      </div>
    </div>
  );
}

export function DeliveryCommsPanel({
  deliveryId,
  canEdit,
  /** Booking is the thing that sends this notice — no point offering it before. */
  canNotify,
}: {
  deliveryId: string;
  canEdit: boolean;
  canNotify: boolean;
}) {
  const commsQ = useDeliveryComms(deliveryId);
  const notifyBooked = useNotifyBooked();
  const comms = commsQ.data;
  const { sent, delivered, opened, latestFailed } = deriveStages(comms);
  const history = comms?.history ?? [];

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="micro">Customer updates</div>
        {canEdit && canNotify && (
          <Button
            size="sm"
            variant="secondary"
            disabled={notifyBooked.isPending}
            icon={
              notifyBooked.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mail className="w-3.5 h-3.5" />
              )
            }
            onClick={() => notifyBooked.mutate(deliveryId)}
          >
            {comms?.booked_notice_sent_at ? "Resend" : "Send now"}
          </Button>
        )}
      </div>

      {commsQ.isLoading ? (
        <div className="h-10 rounded-lg bg-text-primary/[0.04] animate-pulse" />
      ) : commsQ.isError ? (
        <div className="flex items-center justify-between gap-2 text-[12px] text-text-faint">
          <span>Couldn&rsquo;t load the send history.</span>
          <Button size="sm" variant="ghost" onClick={() => commsQ.refetch()}>
            Retry
          </Button>
        </div>
      ) : !sent && !latestFailed ? (
        <div className="text-[12px] text-text-faint">
          Nothing sent to the customer yet. Booking a courier emails her the
          shipper, waybill and expected delivery date automatically.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Step
              icon={
                latestFailed ? (
                  <AlertCircle className="w-3.5 h-3.5" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )
              }
              label={latestFailed ? "Send failed" : "Sent"}
              sub={
                latestFailed
                  ? "Retry above"
                  : comms?.sent_at
                    ? `${channelLabel(comms.sent_via)} · ${fmt(comms.sent_at)}`
                    : undefined
              }
              done={sent}
              failed={latestFailed}
            />
            <div className={`h-px flex-1 ${delivered ? "bg-success/40" : "bg-line"}`} />
            <Step
              icon={<MailCheck className="w-3.5 h-3.5" />}
              label="Delivered"
              sub={comms?.delivered_at ? fmt(comms.delivered_at) : undefined}
              done={delivered}
            />
            <div className={`h-px flex-1 ${opened ? "bg-success/40" : "bg-line"}`} />
            <Step
              icon={<Eye className="w-3.5 h-3.5" />}
              label="Opened"
              sub={comms?.first_viewed_at ? fmt(comms.first_viewed_at) : undefined}
              done={opened}
            />
          </div>

          {/* Say plainly what we can and can't know, rather than leaving two
              grey circles looking like a fault. */}
          {sent && !opened && !latestFailed && (
            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-text-faint">
              <Clock className="w-3 h-3 mt-px shrink-0" />
              <span>
                Sent — &ldquo;Opened&rdquo; lights up when she loads her tracking
                link.
              </span>
            </div>
          )}

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
    </div>
  );
}
