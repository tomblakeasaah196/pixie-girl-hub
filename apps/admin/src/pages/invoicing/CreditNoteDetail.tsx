import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { FormGrid } from "@/components/ui/Form";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { useCreditNote, useIssueCreditNote } from "./hooks";
import { CREDIT_NOTE_STATUS, CREDIT_NOTE_REASON_OPTIONS } from "./constants";

export function CreditNoteDetail({ creditNoteId, onClose }: { creditNoteId: string | null; onClose: () => void }) {
  const { data: note, isLoading, isError, refetch } = useCreditNote(creditNoteId);
  const issueCreditNote = useIssueCreditNote();
  const [confirmIssue, setConfirmIssue] = useState(false);

  const toast = useToastStore();
  const fireToast = (title: string, body: string, priority: "normal" | "high" = "normal") => {
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "invoicing",
      priority,
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };

  const handleIssue = async () => {
    if (!creditNoteId) return;
    try {
      await issueCreditNote.mutateAsync(creditNoteId);
      setConfirmIssue(false);
      fireToast("Credit Note Issued", "The credit note has been issued and posted to the ledger.");
    } catch {
      setConfirmIssue(false);
      fireToast("Issue Failed", "Failed to issue the credit note.", "high");
    }
  };

  const statusMeta = note ? CREDIT_NOTE_STATUS[note.status] : null;
  const reasonLabel = note?.reason_category
    ? CREDIT_NOTE_REASON_OPTIONS.find((o) => o.value === note.reason_category)?.label
    : null;

  return (
    <>
      <Drawer
        open={!!creditNoteId}
        onClose={onClose}
        title={note?.credit_note_number ?? "Credit Note"}
        subtitle={statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>}
        wide
      >
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-text-primary/[0.04] animate-pulse" />
            ))}
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {note && (
          <div className="space-y-5">
            <Card className="p-4">
              <FormGrid>
                <div>
                  <div className="micro">Invoice</div>
                  <div className="text-[14px] font-semibold mt-1">{note.invoice_number ?? note.invoice_id.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="micro">Customer</div>
                  <div className="text-[13px] mt-1">{note.contact_name ?? "—"}</div>
                </div>
                <div>
                  <div className="micro">Issue Date</div>
                  <div className="text-[13px] mt-1">{new Date(note.issue_date).toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="micro">Reason Category</div>
                  <div className="text-[13px] mt-1">{reasonLabel ?? "—"}</div>
                </div>
              </FormGrid>
              <div className="mt-3">
                <div className="micro">Reason</div>
                <div className="text-[13px] mt-1 text-text-muted">{note.reason}</div>
              </div>
            </Card>

            {note.lines && note.lines.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Items</div>
                <div className="space-y-2">
                  {note.lines.map((l) => (
                    <div key={l.credit_note_line_id} className="flex items-center justify-between text-[13px]">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{l.description}</div>
                      </div>
                      <div className="text-text-muted mx-3">×{Number(l.quantity)}</div>
                      <MoneyText ngn={Number(l.line_total_ngn)} />
                    </div>
                  ))}
                  <div className="h-px bg-line my-2" />
                  <div className="flex justify-between text-[13px]"><span className="text-text-muted">Subtotal</span><MoneyText ngn={Number(note.subtotal_ngn)} /></div>
                  {Number(note.tax_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Tax</span><MoneyText ngn={Number(note.tax_amount_ngn)} /></div>}
                  <div className="flex justify-between text-[15px] font-semibold pt-1"><span>Total Credit</span><MoneyText ngn={Number(note.total_ngn)} /></div>
                </div>
              </Card>
            )}

            {note.status === "refunded" && note.refund_method && (
              <Card className="p-4">
                <div className="micro mb-3">Refund</div>
                <FormGrid>
                  <div>
                    <div className="micro">Method</div>
                    <div className="text-[13px] mt-1 capitalize">{note.refund_method.replace(/_/g, " ")}</div>
                  </div>
                  {note.refund_reference && (
                    <div>
                      <div className="micro">Reference</div>
                      <div className="text-[13px] mt-1">{note.refund_reference}</div>
                    </div>
                  )}
                </FormGrid>
              </Card>
            )}

            {note.status === "draft" && (
              <div className="flex gap-2">
                <Button variant="primary" size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />} onClick={() => setConfirmIssue(true)}>
                  Issue Credit Note
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmIssue}
        onClose={() => setConfirmIssue(false)}
        onConfirm={handleIssue}
        title="Issue Credit Note"
        message="This will post the credit note to the ledger and reduce the related invoice's balance. Continue?"
        confirmLabel="Issue"
        tone="accent"
        busy={issueCreditNote.isPending}
      />
    </>
  );
}
