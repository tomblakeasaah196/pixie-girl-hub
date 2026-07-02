import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { portalApi, setStylistToken, type ApiError } from "@/lib/api";

/** Partner sign-in (§6.26 section C). Token lives in memory/session only. */
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Partner sign in — Pixie Girl Style" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">("login");

  const login = useMutation({
    mutationFn: () => portalApi.login(email, password),
    onSuccess: (r) => {
      setStylistToken(r.access_token);
      navigate({ to: "/dashboard" });
    },
  });
  const forgot = useMutation({
    mutationFn: () => portalApi.forgotPassword(email),
  });

  return (
    <div className="mx-auto max-w-sm px-5 py-24">
      <div className="glass rounded-xl2 p-8">
        <p className="micro mb-2">Partner portal</p>
        <h1 className="font-display text-[26px] mb-6">
          {mode === "login" ? "Welcome back." : "Reset your password."}
        </h1>

        <div className="space-y-4">
          <div>
            <label className="micro block mb-1.5">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode === "login" && (
            <div>
              <label className="micro block mb-1.5">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login.mutate()}
              />
            </div>
          )}

          {mode === "login" ? (
            <>
              <button
                className="btn-primary w-full"
                disabled={!email || !password || login.isPending}
                onClick={() => login.mutate()}
              >
                {login.isPending ? "Signing in…" : "Sign in"}
              </button>
              {login.isError && (
                <p className="text-danger text-[12.5px] text-center">
                  {(login.error as ApiError).userMessage}
                </p>
              )}
              <button
                className="block mx-auto text-[12px] text-cream-muted hover:text-cream"
                onClick={() => setMode("forgot")}
              >
                Forgot your password?
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-primary w-full"
                disabled={!email || forgot.isPending}
                onClick={() => forgot.mutate()}
              >
                {forgot.isPending ? "Sending…" : "Email me a reset link"}
              </button>
              {forgot.isSuccess && (
                <p className="text-success text-[12.5px] text-center">
                  If that email has a partner account, a reset link is on its
                  way.
                </p>
              )}
              <button
                className="block mx-auto text-[12px] text-cream-muted hover:text-cream"
                onClick={() => setMode("login")}
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-[11.5px] text-cream-faint text-center mt-5">
        Not a partner yet? Applications are reviewed personally —{" "}
        <a href="/apply" className="text-accent-glow no-underline hover:underline">
          apply here
        </a>
        .
      </p>
    </div>
  );
}
