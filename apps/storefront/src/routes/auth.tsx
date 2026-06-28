import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { login, register, mergeGuestCart } from "@/lib/auth";
import { notifyCartChanged } from "@/lib/useStore";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
  });
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

  const field = "input-line text-body placeholder:text-muted-foreground";

  return (
    <Section className="max-w-md">
      <h1 className="text-h3 font-display">
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {mode === "register" ? (
          <div className="grid grid-cols-2 gap-4">
            <input className={field} placeholder="First name" value={f.first_name} onChange={set("first_name")} />
            <input className={field} placeholder="Last name" value={f.last_name} onChange={set("last_name")} />
          </div>
        ) : null}
        <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
        <input className={field} type="password" placeholder="Password" value={f.password} onChange={set("password")} required />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-primary py-3 text-body text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        onClick={() => setMode(mode === "login" ? "register" : "login")}
        className="mt-6 text-body-sm text-muted-foreground hover:text-foreground"
      >
        {mode === "login"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>
      <p className="mt-4 text-body-sm text-muted-foreground">
        Prefer not to sign in? You can{" "}
        <Link to="/cart" className="underline">
          check out as a guest
        </Link>
        .
      </p>
    </Section>
  );
}
