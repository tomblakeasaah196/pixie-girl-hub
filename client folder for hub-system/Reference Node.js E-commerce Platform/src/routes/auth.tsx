import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/site/SiteHeader";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Faitlyn Hair" },
      { name: "description", content: "Access your Faitlyn atelier account, wishlist and order history." },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Enter a valid email").max(255);
const passwordSchema = z.string().min(8, "At least 8 characters").max(72);

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/account" });
  }, [user, loading, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const em = emailSchema.safeParse(email);
    if (!em.success) return toast.error(em.error.issues[0].message);
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return toast.error(pw.error.issues[0].message);

    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: em.data,
          password: pw.data,
          options: {
            emailRedirectTo: `${window.location.origin}/account`,
            data: { full_name: name.trim() || null },
          },
        });
        if (error) throw error;
        toast.success("Welcome to Faitlyn. Your atelier awaits.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: em.data,
          password: pw.data,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-cream">
      <SiteHeader />
      <main className="pt-32 pb-24 px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-md"
        >
          <p className="text-[0.62rem] tracking-[0.5em] uppercase text-taupe/80 text-center">The Atelier</p>
          <h1 className="font-display text-5xl md:text-6xl text-center mt-3">
            {mode === "signin" ? "Welcome back" : "Join Faitlyn"}
          </h1>
          <p className="mt-4 text-sm text-cream/60 text-center max-w-sm mx-auto">
            {mode === "signin"
              ? "Sign in to manage your saved pieces, orders and concierge."
              : "Create an account to save pieces, track orders and request bespoke work."}
          </p>

          <form onSubmit={submit} className="mt-10 space-y-5">
            {mode === "signup" && (
              <label className="block">
                <span className="block text-[0.62rem] tracking-[0.4em] uppercase text-taupe/80 mb-2">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full bg-transparent border-b border-taupe/30 focus:border-taupe py-2 text-cream outline-none transition-colors"
                />
              </label>
            )}
            <label className="block">
              <span className="block text-[0.62rem] tracking-[0.4em] uppercase text-taupe/80 mb-2">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-transparent border-b border-taupe/30 focus:border-taupe py-2 text-cream outline-none transition-colors"
              />
            </label>
            <label className="block">
              <span className="block text-[0.62rem] tracking-[0.4em] uppercase text-taupe/80 mb-2">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-transparent border-b border-taupe/30 focus:border-taupe py-2 text-cream outline-none transition-colors"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-taupe text-ink py-4 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors disabled:opacity-50"
            >
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-8 w-full text-center text-[0.7rem] tracking-[0.32em] uppercase text-taupe/70 hover:text-cream transition-colors"
          >
            {mode === "signin" ? "New here? Create an account" : "Already a client? Sign in"}
          </button>

          <div className="mt-10 text-center">
            <Link to="/" className="text-[0.62rem] tracking-[0.4em] uppercase text-cream/40 hover:text-taupe">
              ← Back to home
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
