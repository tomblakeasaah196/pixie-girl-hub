import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Sparkles,
  UserX,
  MessageCircle,
  Phone,
  Mail,
  Instagram,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useContact } from "./hooks";
import {
  ContactDetailPanel,
  PRIORITY_TONE,
  TYPE_LABELS,
  AVATAR_COLORS,
  bigInitials,
} from "./ContactDetailPanel";
import { ContactFormModal } from "./ContactFormModal";
import { stakeholderForType } from "./stakeholders";

type MsgChannel = "whatsapp" | "email" | "instagram";

/**
 * Full-page contact profile (canon: rich 360° view, one route per contact).
 * Mirrors the hub-system reference — a header with type-aware badges over a
 * dynamic, stakeholder-driven tab body (the shared ContactDetailPanel).
 */
export function ContactProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: contact, isLoading } = useContact(id ?? null);
  const [showEdit, setShowEdit] = useState(false);
  const [showMsg, setShowMsg] = useState(false);

  useBreadcrumbs([
    { label: "Contacts", href: "/contacts" },
    { label: contact?.display_name ?? "Profile" },
  ]);

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <Skeleton className="h-9 w-40 rounded" />
        <Skeleton className="h-28 rounded-[16px]" />
        <Skeleton className="h-96 rounded-[16px]" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="animate-fade-in rounded-[16px] glass border hairline grid place-items-center text-center px-6 py-20">
        <div>
          <span className="grid place-items-center w-12 h-12 rounded-xl bg-text-primary/[0.06] text-text-faint mb-3 mx-auto">
            <UserX className="w-6 h-6" />
          </span>
          <div className="font-display text-[16px] text-text-primary mb-1">
            Contact not found
          </div>
          <p className="text-[13px] text-text-muted max-w-[320px]">
            They may have been archived or you don&rsquo;t have access to view
            them.
          </p>
          <Link to="/contacts">
            <Button variant="secondary" size="sm" className="mt-4">
              Back to Contacts
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const colorIdx =
    Math.abs(
      contact.display_name
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
    ) % AVATAR_COLORS.length;

  // Reachability drives the action row: which channels the Message sheet
  // offers, and whether Call can dial.
  const callNumber = contact.primary_phone ?? contact.whatsapp_number ?? null;
  const hasWhatsapp = !!(contact.primary_phone || contact.whatsapp_number);
  const hasEmail = !!contact.email;
  const hasInstagram = !!contact.instagram_handle;
  const canMessage = hasWhatsapp || hasEmail || hasInstagram;

  // Call uses the device dialer (tel:) with the contact's number.
  const callContact = () => {
    if (callNumber) window.location.href = `tel:${callNumber}`;
  };

  // Message hands off to the Messaging module on the chosen channel — the
  // conversation (and the actual send) happens there, not via mailto/wa.me.
  const openChannel = (channel: MsgChannel) => {
    setShowMsg(false);
    navigate("/smartcomm", {
      state: {
        messageCustomer: {
          contact_id: contact.contact_id,
          display_name: contact.display_name,
          primary_phone: contact.primary_phone,
          email: contact.email,
        },
        channel,
      },
    });
  };

  return (
    <div className="animate-fade-in">
      {/* Back */}
      <button
        onClick={() => navigate("/contacts")}
        className="flex items-center gap-1.5 text-[12.5px] text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Contacts
      </button>

      {/* Header — on phones the actions drop to their own wrapping row below
          the identity block instead of crowding (and overflowing past) the
          name; on ≥sm they sit inline on the right. */}
      <div className="rounded-[16px] glass border hairline p-5 sm:p-6 mb-5">
        <div className="sm:flex sm:items-start gap-4 space-y-4 sm:space-y-0">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div
              className="w-14 h-14 rounded-full grid place-items-center text-lg font-semibold text-white font-display flex-shrink-0"
              style={{ background: AVATAR_COLORS[colorIdx] }}
            >
              {bigInitials(contact.display_name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl sm:text-3xl text-text-primary leading-tight truncate">
                {contact.display_name}
              </h1>
              {contact.company_name && (
                <p className="text-[13px] text-text-muted mt-0.5 truncate">
                  {contact.company_name}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <Pill tone={PRIORITY_TONE[contact.priority_level]}>
                  {contact.priority_level}
                </Pill>
                {contact.contact_type.map((t) => {
                  const def = stakeholderForType(t);
                  return (
                    <Pill key={t} tone={def?.tone ?? "neutral"} dot={false}>
                      {TYPE_LABELS[t] ?? t}
                    </Pill>
                  );
                })}
                {contact.is_ambassador && (
                  <Pill tone="accent" dot={false}>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      Ambassador
                    </span>
                  </Pill>
                )}
              </div>
            </div>
          </div>
          {/* Message · Call · Edit — three actions on one line */}
          <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
            <Button
              size="sm"
              variant="secondary"
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              disabled={!canMessage}
              onClick={() => setShowMsg(true)}
            >
              Message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Phone className="w-3.5 h-3.5" />}
              disabled={!callNumber}
              onClick={callContact}
            >
              Call
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => setShowEdit(true)}
            >
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Dynamic, type-aware body */}
      <div className="rounded-[16px] glass border hairline p-5 sm:p-6">
        <ContactDetailPanel contactId={contact.contact_id} />
      </div>

      {showEdit && (
        <ContactFormModal
          contact={contact}
          onClose={() => setShowEdit(false)}
        />
      )}

      {/* Message → pick a channel → hand off to the Messaging module */}
      <Modal
        open={showMsg}
        onClose={() => setShowMsg(false)}
        title={`Message ${contact.display_name}`}
      >
        <div className="space-y-2.5">
          <p className="text-[12px] text-text-muted -mt-1 mb-1">
            Opens the conversation in Messaging — reply and send from there.
          </p>
          {hasWhatsapp && (
            <ChannelRow
              icon={<MessageCircle className="w-5 h-5" />}
              accent="#25D366"
              title="WhatsApp"
              desc="Open the WhatsApp channel"
              onClick={() => openChannel("whatsapp")}
            />
          )}
          {hasInstagram && (
            <ChannelRow
              icon={<Instagram className="w-5 h-5" />}
              accent="#C13584"
              title="Instagram"
              desc={`@${contact.instagram_handle}`}
              onClick={() => openChannel("instagram")}
            />
          )}
          {hasEmail && (
            <ChannelRow
              icon={<Mail className="w-5 h-5" />}
              title="Email"
              desc={contact.email ?? "Compose an email"}
              onClick={() => openChannel("email")}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

/** A channel option inside the Message sheet. */
function ChannelRow({
  icon,
  title,
  desc,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 p-4 rounded-[14px] border border-line bg-text-primary/[0.035] hover:bg-text-primary/[0.06] text-left transition-colors"
    >
      <span
        className="grid place-items-center w-11 h-11 rounded-[13px] flex-shrink-0"
        style={{
          color: accent ?? "rgb(var(--accent-glow))",
          background: accent
            ? `${accent}1f`
            : "rgb(var(--accent) / 0.12)",
          border: `1px solid ${accent ? `${accent}47` : "rgb(var(--accent) / 0.25)"}`,
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-text-primary">
          {title}
        </span>
        <span className="block text-[12px] text-text-muted truncate">
          {desc}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-text-faint flex-shrink-0" />
    </button>
  );
}
