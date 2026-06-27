import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { PRODUCTS } from "@/lib/products";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Your Atelier — Faitlyn Hair" },
      { name: "description", content: "Manage your Faitlyn profile, saved pieces, orders and concierge requests." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

type Tab = "profile" | "wishlist" | "orders" | "concierge";
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "wishlist", label: "Saved Pieces" },
  { id: "orders", label: "Orders" },
  { id: "concierge", label: "Concierge" },
];

function AccountPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("profile");

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-ink text-cream">
      <SiteHeader />
      <main className="pt-32 pb-24 px-6">
        <div className="mx-auto max-w-[1200px]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap items-end justify-between gap-6 border-b border-taupe/15 pb-10"
          >
            <div>
              <p className="text-[0.62rem] tracking-[0.5em] uppercase text-taupe/80">The Atelier</p>
              <h1 className="font-display text-5xl md:text-6xl mt-3">Your account</h1>
              <p className="mt-3 text-sm text-cream/55">{user?.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <Link
                to="/preferences"
                className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe/80 hover:text-cream border-b border-taupe/40 hover:border-cream pb-1 transition-colors"
              >
                Email preferences
              </Link>
              <button
                onClick={handleSignOut}
                className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe/80 hover:text-cream border-b border-taupe/40 hover:border-cream pb-1 transition-colors"
              >
                Sign out
              </button>
            </div>
          </motion.div>

          <div className="mt-10 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-[0.68rem] tracking-[0.32em] uppercase transition-all ${
                  tab === t.id ? "bg-taupe text-ink" : "border border-taupe/20 text-taupe/70 hover:border-taupe/60 hover:text-cream"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mt-12"
          >
            {tab === "profile" && <ProfilePanel />}
            {tab === "wishlist" && <WishlistPanel />}
            {tab === "orders" && <OrdersPanel />}
            {tab === "concierge" && <ConciergePanel />}
          </motion.div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

// PROFILE
const profileSchema = z.object({
  full_name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
});

function ProfilePanel() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, phone, marketing_opt_in")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullName(data?.full_name ?? "");
        setPhone(data?.phone ?? "");
        setMarketing(!!data?.marketing_opt_in);
        setLoading(false);
      });
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = profileSchema.safeParse({ full_name: fullName, phone });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, full_name: fullName || null, phone: phone || null, marketing_opt_in: marketing });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  }

  if (loading) return <Skeleton />;

  return (
    <div className="grid md:grid-cols-[1fr,1.2fr] gap-12">
      <form onSubmit={save} className="space-y-6 max-w-md">
        <Field label="Full name" value={fullName} onChange={setFullName} maxLength={100} />
        <Field label="Phone" value={phone} onChange={setPhone} maxLength={40} />
        <label className="flex items-center gap-3 text-[0.7rem] tracking-[0.32em] uppercase text-taupe/80">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="accent-taupe w-4 h-4"
          />
          Send me Faitlyn dispatches
        </label>
        <button
          type="submit"
          disabled={saving}
          className="bg-taupe text-ink px-8 py-3 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
      <AddressesPanel />
    </div>
  );
}

function Field({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number }) {
  return (
    <label className="block">
      <span className="block text-[0.62rem] tracking-[0.4em] uppercase text-taupe/80 mb-2">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full bg-transparent border-b border-taupe/30 focus:border-taupe py-2 text-cream outline-none transition-colors"
      />
    </label>
  );
}

// ADDRESSES
type Address = {
  id: string;
  label: string | null;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  is_default: boolean;
};

function AddressesPanel() {
  const { user } = useAuth();
  const [list, setList] = useState<Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ label: "", recipient: "", line1: "", line2: "", city: "", region: "", postal_code: "", country: "", phone: "", is_default: false });
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("addresses").select("*").order("is_default", { ascending: false }).order("created_at", { ascending: false });
    setList((data as Address[]) ?? []);
  }
  useEffect(() => { if (user) load(); }, [user]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!form.recipient || !form.line1 || !form.city || !form.country) return toast.error("Fill recipient, address, city, country");
    setBusy(true);
    const { error } = await supabase.from("addresses").insert({ ...form, user_id: user.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    setShowForm(false);
    setForm({ label: "", recipient: "", line1: "", line2: "", city: "", region: "", postal_code: "", country: "", phone: "", is_default: false });
    load();
    toast.success("Address saved");
  }
  async function remove(id: string) {
    await supabase.from("addresses").delete().eq("id", id);
    load();
  }
  async function makeDefault(id: string) {
    await supabase.from("addresses").update({ is_default: true }).eq("id", id);
    load();
  }

  return (
    <div>
      <div className="flex items-end justify-between">
        <h3 className="font-display text-2xl">Shipping addresses</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe hover:text-cream"
        >
          {showForm ? "Cancel" : "+ Add address"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={add} className="mt-6 grid grid-cols-2 gap-4 p-6 border border-taupe/15">
          <input placeholder="Label (Home, Studio)" className="col-span-2 input-line" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input placeholder="Recipient *" className="col-span-2 input-line" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} />
          <input placeholder="Address line 1 *" className="col-span-2 input-line" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} />
          <input placeholder="Address line 2" className="col-span-2 input-line" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} />
          <input placeholder="City *" className="input-line" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input placeholder="Region" className="input-line" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          <input placeholder="Postal code" className="input-line" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
          <input placeholder="Country *" className="input-line" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input placeholder="Phone" className="col-span-2 input-line" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="col-span-2 flex items-center gap-2 text-[0.7rem] tracking-[0.3em] uppercase text-taupe/80">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-taupe" />
            Set as default
          </label>
          <button disabled={busy} className="col-span-2 bg-taupe text-ink py-3 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream disabled:opacity-50">
            {busy ? "Saving…" : "Save address"}
          </button>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {list.length === 0 && !showForm && <Empty>No saved addresses yet.</Empty>}
        {list.map((a) => (
          <div key={a.id} className="p-5 border border-taupe/15 flex items-start justify-between gap-4">
            <div className="text-sm leading-relaxed">
              <div className="flex items-center gap-3 mb-1">
                <span className="font-display text-lg">{a.label || a.recipient}</span>
                {a.is_default && <span className="text-[0.55rem] tracking-[0.4em] uppercase text-taupe">Default</span>}
              </div>
              <div className="text-cream/70">{a.recipient}</div>
              <div className="text-cream/60">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</div>
              <div className="text-cream/60">{a.city}{a.region ? `, ${a.region}` : ""} {a.postal_code}</div>
              <div className="text-cream/60">{a.country}</div>
            </div>
            <div className="flex flex-col gap-2 text-[0.6rem] tracking-[0.32em] uppercase">
              {!a.is_default && <button onClick={() => makeDefault(a.id)} className="text-taupe hover:text-cream">Default</button>}
              <button onClick={() => remove(a.id)} className="text-burgundy/80 hover:text-burgundy">Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// WISHLIST
function WishlistPanel() {
  const { items, toggle, isLoading } = useWishlist();
  if (isLoading) return <Skeleton />;
  if (items.length === 0)
    return (
      <Empty>
        No saved pieces yet.{" "}
        <Link to="/shop" className="text-taupe underline">Discover the collection →</Link>
      </Empty>
    );

  const products = items
    .map((i) => ({ row: i, product: PRODUCTS.find((p) => p.slug === i.product_slug) }))
    .filter((x) => x.product);

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map(({ row, product }) => (
        <div key={row.id} className="group relative overflow-hidden border border-taupe/15">
          <Link to="/product/$slug" params={{ slug: product!.slug }}>
            <img src={product!.images[0]} alt={product!.name} className="w-full aspect-[3/4] object-cover transition-transform duration-700 group-hover:scale-105" />
          </Link>
          <div className="p-5">
            <h4 className="font-display text-xl">{product!.name}</h4>
            <p className="text-xs text-cream/55 mt-1">{product!.tagline}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-taupe">${product!.price}</span>
              <button
                onClick={() => toggle.mutate({ slug: product!.slug, on: false })}
                className="text-[0.6rem] tracking-[0.32em] uppercase text-burgundy/80 hover:text-burgundy"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ORDERS
function OrdersPanel() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[] | null>(null);
  useEffect(() => {
    if (!user) return;
    supabase.from("orders").select("*").order("created_at", { ascending: false }).then(({ data }) => setOrders(data ?? []));
  }, [user]);

  if (!orders) return <Skeleton />;
  if (orders.length === 0)
    return (
      <Empty>
        No orders yet. <Link to="/shop" className="text-taupe underline">Begin your edit →</Link>
      </Empty>
    );

  return (
    <div className="space-y-4">
      {orders.map((o) => (
        <Link
          key={o.id}
          to="/order/$id"
          params={{ id: o.id }}
          className="border border-taupe/15 p-6 flex flex-wrap items-center justify-between gap-4 hover:border-taupe/40 transition-colors"
        >
          <div>
            <div className="font-display text-xl">{o.order_number}</div>
            <div className="text-xs text-cream/55 mt-1">
              {new Date(o.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
          <div className="text-sm text-cream/70">{Array.isArray(o.items) ? o.items.length : 0} piece(s)</div>
          <div className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe">{o.status}</div>
          <div className="font-display text-2xl">${Number(o.total).toFixed(2)}</div>
        </Link>
      ))}
    </div>
  );
}

// CONCIERGE
function ConciergePanel() {
  const { user } = useAuth();
  const [list, setList] = useState<any[] | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [length, setLength] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("concierge_requests").select("*").order("created_at", { ascending: false });
    setList(data ?? []);
  }
  useEffect(() => { if (user) load(); }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!subject.trim() || !message.trim()) return toast.error("Add subject and message");
    if (subject.length > 200 || message.length > 2000) return toast.error("Too long");
    setBusy(true);
    const { error } = await supabase.from("concierge_requests").insert({
      user_id: user.id,
      subject: subject.trim(),
      message: message.trim(),
      preferred_length: length || null,
      budget: budget || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSubject(""); setMessage(""); setLength(""); setBudget("");
    toast.success("Concierge notified. We'll be in touch within 48 hours.");
    load();
  }

  return (
    <div className="grid md:grid-cols-2 gap-12">
      <form onSubmit={submit} className="space-y-5">
        <h3 className="font-display text-3xl">Request bespoke</h3>
        <p className="text-sm text-cream/55">For custom lengths, colour matching, or private appointments.</p>
        <Field label="Subject" value={subject} onChange={setSubject} maxLength={200} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Preferred length" value={length} onChange={setLength} maxLength={40} />
          <Field label="Budget" value={budget} onChange={setBudget} maxLength={40} />
        </div>
        <label className="block">
          <span className="block text-[0.62rem] tracking-[0.4em] uppercase text-taupe/80 mb-2">Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={6}
            className="w-full bg-transparent border border-taupe/30 focus:border-taupe p-3 text-cream outline-none transition-colors resize-none"
          />
        </label>
        <button disabled={busy} className="bg-taupe text-ink px-8 py-3 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream disabled:opacity-50">
          {busy ? "Sending…" : "Send to concierge"}
        </button>
      </form>

      <div>
        <h3 className="font-display text-3xl mb-6">Your requests</h3>
        {!list && <Skeleton />}
        {list && list.length === 0 && <Empty>No requests yet.</Empty>}
        <div className="space-y-3">
          {list?.map((r) => (
            <div key={r.id} className="border border-taupe/15 p-5">
              <div className="flex items-center justify-between">
                <div className="font-display text-lg">{r.subject}</div>
                <span className="text-[0.55rem] tracking-[0.4em] uppercase text-taupe">{r.status}</span>
              </div>
              <p className="text-sm text-cream/65 mt-2 line-clamp-3">{r.message}</p>
              <div className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/40 mt-3">
                {new Date(r.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-taupe/20 p-12 text-center text-sm text-cream/60">{children}</div>;
}
function Skeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 bg-taupe/5 animate-pulse" />
      ))}
    </div>
  );
}
