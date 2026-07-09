import { Link } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { Particles } from "@/components/login/Particles";

/**
 * Password resets now happen inline on the sign-in screen: "Forgot password?"
 * emails a one-time code you enter alongside a new password — no link to a
 * standalone page. This route is kept so any old emailed reset links land
 * somewhere friendly and point people to the current flow.
 */
export function ResetPasswordPage() {
  const { data } = useBranding();
  const productName = data?.platform?.product_name ?? "Pixie Hub";

  return (
    <div className="auth-scroll fixed inset-0 grid place-items-center p-4">
      <div className="fixed inset-0 pointer-events-none">
        <Particles count={28} />
      </div>
      <div className="relative w-full max-w-[420px] dropglass rounded-[24px] p-8 sm:p-9 shadow-glass animate-app-in text-center">
        <div className="micro mb-2">{productName}</div>
        <div className="w-16 h-16 mx-auto my-4 rounded-full grid place-items-center bg-accent/10 text-accent-glow border border-accent/20">
          <KeyRound className="w-8 h-8" />
        </div>
        <h1 className="font-display text-[24px]">Reset your password</h1>
        <p className="text-text-muted text-[13px] mt-2 max-w-[320px] mx-auto">
          Password resets now use a one-time code. On the sign-in screen, choose{" "}
          <span className="text-text-primary font-medium">
            "Forgot password?"
          </span>{" "}
          — we'll email you a code to enter with your new password.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex w-full h-12 items-center justify-center rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
