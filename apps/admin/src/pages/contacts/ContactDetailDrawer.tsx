import { useState } from "react";
import { Pencil } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { useContact } from "./hooks";
import { ContactFormModal } from "./ContactFormModal";
import {
  ContactDetailPanel,
  MessageButton,
  TYPE_LABELS,
  PRIORITY_TONE,
  AVATAR_COLORS,
  bigInitials,
} from "./ContactDetailPanel";

// ── Phone/tablet overlay drawer ────────────────────────────────────────────
// Thin wrapper: header + footer chrome around the shared `ContactDetailPanel`.
// On desktop the page renders <ContactDetailPanel/> inline instead (no scrim).

interface Props {
  contactId: string | null;
  onClose: () => void;
}

export function ContactDetailDrawer({ contactId, onClose }: Props) {
  const [showEdit, setShowEdit] = useState(false);
  const { data: contact, isLoading } = useContact(contactId);

  const colorIdx = contact
    ? Math.abs(
        contact.display_name
          .split("")
          .reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
      ) % AVATAR_COLORS.length
    : 0;

  const headerLeading = contact ? (
    <div
      className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white font-display flex-shrink-0"
      style={{ background: AVATAR_COLORS[colorIdx] }}
    >
      {bigInitials(contact.display_name)}
    </div>
  ) : undefined;

  return (
    <Drawer
      open={!!contactId}
      onClose={onClose}
      wide
      leading={headerLeading}
      title={
        isLoading ? (
          <Skeleton className="w-32 h-5 rounded-md" />
        ) : (
          <span className="flex items-center gap-2">
            {contact?.display_name ?? ""}
            {contact && (
              <Pill tone={PRIORITY_TONE[contact.priority_level]} dot={false}>
                {contact.priority_level}
              </Pill>
            )}
          </span>
        )
      }
      subtitle={
        contact ? (
          <span className="flex items-center gap-1.5">
            {contact.contact_type.map((t) => TYPE_LABELS[t] ?? t).join(" · ")}
            {contact.source && (
              <>
                <span className="text-text-faint">·</span>
                <span className="capitalize">
                  {contact.source.replace(/_/g, " ")}
                </span>
              </>
            )}
          </span>
        ) : undefined
      }
      footer={
        contact ? (
          <>
            <MessageButton contact={contact} />
            <Button
              size="sm"
              variant="primary"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => setShowEdit(true)}
            >
              Edit
            </Button>
          </>
        ) : undefined
      }
    >
      <ContactDetailPanel contactId={contactId} />

      {showEdit && contact && (
        <ContactFormModal
          contact={contact}
          onClose={() => setShowEdit(false)}
        />
      )}
    </Drawer>
  );
}
