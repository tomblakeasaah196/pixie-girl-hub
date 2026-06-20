import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import type { QuickReply } from "@/lib/smartcomm-types";

/** Fill {{variables}} in a quick reply before inserting it into the composer. */
export function QuickReplyVarsModal({
  reply,
  prefill,
  onCancel,
  onApply,
}: {
  reply: QuickReply | null;
  prefill?: Record<string, string>;
  onCancel: () => void;
  onApply: (filledBody: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!reply) return;
    const seed: Record<string, string> = {};
    for (const v of reply.variables) seed[v] = prefill?.[v] ?? "";
    setValues(seed);
  }, [reply, prefill]);

  if (!reply) return null;

  const preview = reply.variables.reduce(
    (body, v) =>
      body.replaceAll(`{{${v}}}`, values[v]?.trim() ? values[v] : `{{${v}}}`),
    reply.body,
  );

  function apply() {
    onApply(preview);
  }

  return (
    <Modal
      open={!!reply}
      onClose={onCancel}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-accent" />
          {reply.title}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={apply}>
            Insert
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {reply.variables.map((v) => (
          <div key={v}>
            <label className="block text-[11px] uppercase tracking-wide text-text-faint mb-1">
              {v.replace(/_/g, " ")}
            </label>
            <input
              value={values[v] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [v]: e.target.value }))
              }
              placeholder={`{{${v}}}`}
              className="w-full rounded-lg border hairline bg-panel-2 px-2.5 py-2 text-[13px] focus:outline-none placeholder:text-text-faint"
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-text-faint mb-1">
          Preview
        </div>
        <div className="rounded-lg bg-panel-2 border hairline px-3 py-2 text-[12.5px] text-text-muted whitespace-pre-wrap">
          {preview}
        </div>
      </div>
    </Modal>
  );
}
