import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronLeft, Pencil, Sparkles, UserX, Briefcase } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { useContact } from "./hooks";
import {
  ContactDetailPanel,
  MessageButton,
  PRIORITY_TONE,
  TYPE_LABELS,
  AVATAR_COLORS,
  bigInitials,
} from "./ContactDetailPanel";
import { ContactFormModal } from "./ContactFormModal";
import { stakeholderForType } from "./stakeholders";

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

      {/* Header */}
      <div className="rounded-[16px] glass border hairline p-5 sm:p-6 mb-5">
        <div className="flex items-start gap-4">
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
          <div className="flex gap-2 flex-shrink-0">
            <MessageButton contact={contact} />
            {!contact.contact_type.includes("staff") && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Briefcase className="w-3.5 h-3.5" />}
                onClick={() =>
                  navigate(
                    `/contacts/staff/new?contact_id=${contact.contact_id}`,
                  )
                }
              >
                Onboard as employee
              </Button>
            )}
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
    </div>
  );
}
