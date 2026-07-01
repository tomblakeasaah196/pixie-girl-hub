import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { login, register, mergeGuestCart } from "@/lib/auth";
import { notifyCartChanged } from "@/lib/useStore";
import { SITE_IMAGES } from "@/lib/site-assets";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Faitlyn Hair" }] }),
  component: AuthPage,
});

const BENEFITS = [
  "Order history & live tracking",
  "Saved addresses for faster checkout",
  "Wishlist across both maisons",
  "Loyalty points & atelier credit",
  "Referral rewards — up to $50",
];

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: "", password: "", first_name: "", last_name: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        await login({ email: f.email, password: f.password });
      } else {
        await register({
          email: f.email,
          password: f.password,
          first_name: f.first_name,
          last_name: f.last_name,
        });
      }
      await mergeGuestCart();
      notifyCartChanged();
      toast.success(mode === "login" ? "Welcome back" : "Account created");
      navigate({ to: "/account" });
    } catch (err) {
      toast.error(
        (err as { userMessage?: string })?.userMessage ||
          "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  }

  function forgot() {
    if (!f.email) return toast.error("Enter your email first, then tap reset.");
    toast.success("If that email exists, a reset link is on its way.");
  }

  const field = "input-line text-cream placeholder:text-cream/35 focus:border-taupe";

  return (
    <main className="min-h-[100dvh] bg-ink text-cream grid lg:grid-cols-2">
      {/* Editorial panel */}
      <aside className="relative hidden lg:block overflow-hidden">
        <img src={SITE_IMAGES.editorialAtelier} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/30" />
        <div className="relative z-10 flex h-full flex-col justify-end p-14">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">The Inner Circle</p>
          <h2 className="mt-5 font-display text-5xl leading-[0.98] tracking-tight text-balance">
            Join the <em className="font-couture text-taupe">maison</em>.
          </h2>
          <ul className="mt-8 space-y-3">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-center gap-3 text-cream/80">
                <Check size={15} className="text-taupe shrink-0" /> {b}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form */}
      <section className="flex items-center justify-center px-6 pt-36 pb-20 lg:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">
            {mode === "login" ? "Welcome back" : "New here"}
          </p>
          <h1 className="mt-4 font-display text-4xl md:text-5xl tracking-tight">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-3 text-body-sm text-cream/60">
            {mode === "login"
              ? "Access your orders, wishlist and atelier credit."
              : "One account, both maisons — Faitlyn & Pixie Girl."}
          </p>

          <form onSubmit={submit} className="mt-9 space-y-6">
            {mode === "register" ? (
              <div className="grid grid-cols-2 gap-4">
                <input className={field} placeholder="First name" value={f.first_name} onChange={set("first_name")} />
                <input className={field} placeholder="Last name" value={f.last_name} onChange={set("last_name")} />
              </div>
            ) : null}
            <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
            <input className={field} type="password" placeholder="Password" value={f.password} onChange={set("password")} required />

            {mode === "login" ? (
              <div className="flex justify-end -mt-2">
                <button type="button" onClick={forgot} className="text-[0.62rem] tracking-[0.25em] uppercase text-cream/50 hover:text-taupe transition-colors">
                  Forgot password?
                </button>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-taupe text-ink py-4 text-[0.7rem] tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors disabled:opacity-60"
            >
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-7 flex items-center gap-4 text-[0.6rem] tracking-[0.35em] uppercase text-cream/30">
            <span className="h-px flex-1 bg-taupe/20" /> or <span className="h-px flex-1 bg-taupe/20" />
          </div>

          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="mt-6 w-full border border-taupe/30 py-3.5 text-[0.7rem] tracking-[0.3em] uppercase text-cream/85 hover:border-taupe hover:text-cream transition-colors"
          >
            {mode === "login" ? "Create an account" : "I already have an account"}
          </button>

          <p className="mt-8 text-center text-body-sm text-cream/55">
            Prefer not to sign in?{" "}
            <Link to="/cart" className="text-taupe underline-offset-4 hover:underline">
              Check out as a guest
            </Link>
          </p>
          <p className="mt-4 text-center text-[0.58rem] tracking-[0.12em] uppercase text-cream/30 leading-relaxed">
            By continuing you agree to our Terms & Privacy Policy.
          </p>
        </motion.div>
      </section>
    </main>
  );
}
