import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { portalApi, type ApiError } from "@/lib/api";

/**
 * Invite + reset landing (§6.26): the emailed link carries ?token=…; both
 * the approval invite and forgot-password use this same rail.
 */
export const Route = createFileRoute("/set-password")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  head: () => ({
    meta: [
      { title: "Set your password — Pixie Girl Style" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetPassword,
});

function SetPassword() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const reset = useMutation({
    mutationFn: () => portalApi.resetPassword(token, password),
    onSuccess: () => setTimeout(() => navigate({ to: "/login" }), 1600),
  });

  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="mx-auto max-w-sm px-5 py-24">
      <div className="glass rounded-xl2 p-8">
        <p className="micro mb-2">Partner portal</p>
        <h1 className="font-display text-[26px] mb-6">Set your password.</h1>
        {!token ? (
          <p className="text-[13px] text-cream-muted">
            This link is missing its token. Open the link from your email
            again, or request a fresh one from the sign-in page.
          </p>
        ) : reset.isSuccess ? (
          <p className="text-success text-[13.5px]">
            Password set — taking you to sign in…
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="micro block mb-1.5">New password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-[11px] text-cream-faint mt-1">
                At least 8 characters.
              </p>
            </div>
            <div>
              <label className="micro block mb-1.5">Confirm password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="text-danger text-[11.5px] mt-1">
                  Passwords don't match.
                </p>
              )}
            </div>
            <button
              className="btn-primary w-full"
              disabled={password.length < 8 || mismatch || reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "Saving…" : "Set password"}
            </button>
            {reset.isError && (
              <p className="text-danger text-[12.5px] text-center">
                {(reset.error as ApiError).userMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
