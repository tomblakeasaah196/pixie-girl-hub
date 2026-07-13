import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Pencil,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  MessageCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { toastReport } from "@/lib/error-report";
import type { Customer360 } from "@/lib/smartcomm-types";
import { PlatformPill } from "./PlatformPill";

type Contact = Customer360["contact"];
type Handle = Customer360["handles"][number];

interface Address {
  address_id: string;
  address_type?: string | null;
  line1?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  landmark?: string | null;
}

interface Props {
  contact: Contact;
  handles: Handle[];
  onSaved: () => void;
}

/** The Instagram @handle for the header caption. Falls back to the
 *  contact's stored instagram_handle when no social-handle row exists. */
function igHandle(contact: Contact, handles: Handle[]): string | null {
  const row = handles.find((h) => h.platform === "instagram");
  const h = row?.handle || contact.instagram_handle || null;
  if (!h) return null;
  return h.startsWith("@") ? h : `@${h}`;
}

interface FormState {
  display_name: string;
  primary_phone: string;
  whatsapp_number: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string;
  instagram_handle: string;
  notes: string;
  addr_line1: string;
  addr_area: string;
  addr_city: string;
  addr_state: string;
  addr_landmark: string;
}

const emptyForm = (): FormState => ({
  display_name: "",
  primary_phone: "",
  whatsapp_number: "",
  first_name: "",
  last_name: "",
  email: "",
  date_of_birth: "",
  instagram_handle: "",
  notes: "",
  addr_line1: "",
  addr_area: "",
  addr_city: "",
  addr_state: "",
  addr_landmark: "",
});

export function ContactInfoEditor({ contact, handles, onSaved }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  // The customer's saved delivery address (for the "More" fields). Only
  // fetched while the panel is open — the address is not on customer360.
  const { data: addresses } = useQuery({
    queryKey: ["contact-addresses", contact.contact_id],
    queryFn: () =>
      api
        .get<{ data: Address[] }>(`/contacts/${contact.contact_id}/addresses`)
        .then((r) => r.data),
    staleTime: 30_000,
  });
  const deliveryAddress = useMemo(
    () =>
      (addresses ?? []).find((a) => a.address_type === "delivery") ??
      (addresses ?? [])[0] ??
      null,
    [addresses],
  );

  // Seed the form from the contact + address whenever we enter edit mode
  // (or the underlying data changes while open).
  useEffect(() => {
    if (!editing) return;
    setForm({
      display_name: contact.display_name ?? "",
      primary_phone: contact.primary_phone ?? "",
      whatsapp_number: contact.whatsapp_number ?? "",
      first_name: contact.first_name ?? "",
      last_name: contact.last_name ?? "",
      email: contact.email ?? "",
      date_of_birth: (contact.date_of_birth ?? "").slice(0, 10),
      instagram_handle: (contact.instagram_handle ?? "").replace(/^@/, ""),
      notes: contact.notes ?? "",
      addr_line1: deliveryAddress?.line1 ?? "",
      addr_area: deliveryAddress?.area ?? "",
      addr_city: deliveryAddress?.city ?? "",
      addr_state: deliveryAddress?.state ?? "",
      addr_landmark: deliveryAddress?.landmark ?? "",
    });
  }, [editing, contact, deliveryAddress]);

  const set = <K extends keyof FormState>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      // 1. Contact identity fields. Only send what changed, and never
      //    blank a required phone (the API rejects <5 chars anyway).
      const patch: Record<string, string> = {};
      const put = (key: string, value: string, original: string) => {
        const v = value.trim();
        if (v !== (original ?? "").trim()) patch[key] = v;
      };
      put("display_name", form.display_name, contact.display_name ?? "");
      put("primary_phone", form.primary_phone, contact.primary_phone ?? "");
      put("whatsapp_number", form.whatsapp_number, contact.whatsapp_number ?? "");
      put("first_name", form.first_name, contact.first_name ?? "");
      put("last_name", form.last_name, contact.last_name ?? "");
      put("email", form.email, contact.email ?? "");
      put("date_of_birth", form.date_of_birth, (contact.date_of_birth ?? "").slice(0, 10));
      put(
        "instagram_handle",
        form.instagram_handle,
        (contact.instagram_handle ?? "").replace(/^@/, ""),
      );
      put("notes", form.notes, contact.notes ?? "");
      // Drop an emptied phone/email rather than sending "" (validator
      // requires a non-trivial value; blanking isn't the intent here).
      if (patch.primary_phone === "") delete patch.primary_phone;
      if (patch.email === "") delete patch.email;
      if (Object.keys(patch).length > 0) {
        await api.patch(`/contacts/${contact.contact_id}`, patch);
      }

      // 2. Delivery address — upsert only when something was entered.
      const addrBody = {
        address_type: "delivery" as const,
        line1: form.addr_line1.trim(),
        area: form.addr_area.trim() || undefined,
        city: form.addr_city.trim() || undefined,
        state: form.addr_state.trim() || undefined,
        landmark: form.addr_landmark.trim() || undefined,
      };
      const addrTouched =
        form.addr_line1.trim() ||
        form.addr_area.trim() ||
        form.addr_city.trim() ||
        form.addr_state.trim() ||
        form.addr_landmark.trim();
      if (addrTouched && addrBody.line1) {
        if (deliveryAddress) {
          await api.patch(
            `/contacts/${contact.contact_id}/addresses/${deliveryAddress.address_id}`,
            addrBody,
          );
        } else {
          await api.post(`/contacts/${contact.contact_id}/addresses`, addrBody);
        }
      }

      qc.invalidateQueries({
        queryKey: ["contact-addresses", contact.contact_id],
      });
      onSaved();
      setEditing(false);
      setExpanded(false);
    } catch (e) {
      toastReport("Messaging → Customer", "Save contact", e);
    } finally {
      setSaving(false);
    }
  }

  const handle = igHandle(contact, handles);

  // ── Read mode ───────────────────────────────────────────
  if (!editing) {
    return (
      <div className="p-4 border-b hairline space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-full bg-panel-2 border hairline text-[13px] font-semibold text-text-primary shrink-0">
            {(contact.display_name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[14.5px] truncate leading-tight">
              {contact.display_name}
            </p>
            {handle && (
              <p className="text-[11px] text-text-faint truncate">
                ({handle})
              </p>
            )}
            {contact.company_name && (
              <p className="text-[11.5px] text-text-muted truncate">
                {contact.company_name}
              </p>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-text-muted hover:text-accent-glow"
            title="Edit contact"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate(`/contacts/${contact.contact_id}`)}
            className="text-text-muted hover:text-accent-glow"
            title="Open full contact"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1.5 text-[12px] text-text-muted">
          {contact.primary_phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-text-faint" />
              {contact.primary_phone}
            </div>
          )}
          {contact.whatsapp_number &&
            contact.whatsapp_number !== contact.primary_phone && (
              <div className="flex items-center gap-2">
                <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                {contact.whatsapp_number}
              </div>
            )}
          {contact.email && (
            <div className="flex items-center gap-2 truncate">
              <Mail className="w-3.5 h-3.5 text-text-faint shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
        </div>
        {handles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {handles.map((h) => (
              <PlatformPill key={h.platform} platform={h.platform} showLabel />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ───────────────────────────────────────────
  return (
    <div className="p-4 border-b hairline space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-widest text-text-faint font-semibold">
          Edit customer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setEditing(false);
              setExpanded(false);
            }}
            disabled={saving}
            className="p-1 text-text-muted hover:text-text-primary disabled:opacity-50"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={save}
            disabled={saving || !form.display_name.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-accent-glow disabled:opacity-50"
            title="Save"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Save
          </button>
        </div>
      </div>

      <EditField label="Name">
        <input
          value={form.display_name}
          onChange={(e) => set("display_name", e.target.value)}
          className={inputCls}
          placeholder="Customer name"
        />
      </EditField>
      <EditField label="Phone">
        <input
          value={form.primary_phone}
          onChange={(e) => set("primary_phone", e.target.value)}
          className={inputCls}
          placeholder="+234…"
          inputMode="tel"
        />
      </EditField>
      <EditField label="WhatsApp number">
        <input
          value={form.whatsapp_number}
          onChange={(e) => set("whatsapp_number", e.target.value)}
          className={inputCls}
          placeholder="+234…"
          inputMode="tel"
        />
      </EditField>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11.5px] text-accent-glow hover:underline"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        {expanded ? "Fewer fields" : "More — fill the online form for them"}
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <EditField label="First name">
              <input
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                className={inputCls}
              />
            </EditField>
            <EditField label="Last name">
              <input
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
                className={inputCls}
              />
            </EditField>
          </div>
          <EditField label="Email">
            <input
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputCls}
              placeholder="name@email.com"
              inputMode="email"
            />
          </EditField>
          <div className="grid grid-cols-2 gap-2">
            <EditField label="Date of birth">
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set("date_of_birth", e.target.value)}
                className={inputCls}
              />
            </EditField>
            <EditField label="Instagram handle">
              <input
                value={form.instagram_handle}
                onChange={(e) => set("instagram_handle", e.target.value)}
                className={inputCls}
                placeholder="username"
              />
            </EditField>
          </div>

          <div className="pt-1 text-[10px] uppercase tracking-widest text-text-faint font-semibold">
            Delivery address
          </div>
          <EditField label="Street / line 1">
            <input
              value={form.addr_line1}
              onChange={(e) => set("addr_line1", e.target.value)}
              className={inputCls}
            />
          </EditField>
          <div className="grid grid-cols-2 gap-2">
            <EditField label="Area">
              <input
                value={form.addr_area}
                onChange={(e) => set("addr_area", e.target.value)}
                className={inputCls}
              />
            </EditField>
            <EditField label="City">
              <input
                value={form.addr_city}
                onChange={(e) => set("addr_city", e.target.value)}
                className={inputCls}
              />
            </EditField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EditField label="State">
              <input
                value={form.addr_state}
                onChange={(e) => set("addr_state", e.target.value)}
                className={inputCls}
              />
            </EditField>
            <EditField label="Landmark">
              <input
                value={form.addr_landmark}
                onChange={(e) => set("addr_landmark", e.target.value)}
                className={inputCls}
              />
            </EditField>
          </div>

          <EditField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </EditField>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border hairline bg-panel-2 px-2.5 py-1.5 text-[12.5px] text-text-primary focus:outline-none focus:border-accent/50 placeholder:text-text-faint";

function EditField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10.5px] text-text-faint">{label}</span>
      {children}
    </label>
  );
}
