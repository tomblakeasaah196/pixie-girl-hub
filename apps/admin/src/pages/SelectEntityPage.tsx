import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import { Particles } from "@/components/login/Particles";

/**
 * /select-entity (canon §1.3). Shown to users with access to more than one
 * business (notably the CEO). Picking a brand sets the global entity scope
 * used on every subsequent request + query key. Single-brand users never
 * see this — the modal routes them straight home.
 */
export function SelectEntityPage() {
  const navigate = useNavigate();
  const { data } = useBranding();
  const user = useAuthStore((s) => s.user);
  const loadPermissions = useAuthStore((s) => s.loadPermissions);
  const setActive = useBusinessStore((s) => s.setActive);

  const all = data?.businesses ?? [];
  // CEO/super-admin sees every active brand; others only their grants.
  const businesses = user?.isCeo
    ? all
    : all.filter((b) => user?.availableBusinesses?.includes(b.business_key));

  // If somehow there's only one, don't make them choose.
  useEffect(() => {
    if (businesses.length === 1) {
      setActive(businesses[0].business_key);
      loadPermissions().catch(() => {});
      navigate("/", { replace: true });
    }
  }, [businesses, setActive, loadPermissions, navigate]);

  const pick = (key: string) => {
    setActive(key);
    loadPermissions().catch(() => {});
    navigate("/", { replace: true });
  };

  return (
    <div className="auth-scroll fixed inset-0 grid place-items-center p-5">
      <div className="fixed inset-0 pointer-events-none">
        <Particles count={30} />
      </div>
      <div className="relative w-full max-w-[680px] text-center animate-app-in">
        <div className="micro mb-3">
          {user?.name ? `Hello, ${user.name}` : "Welcome"}
        </div>
        <h1 className="font-display font-light text-[34px] sm:text-[44px] leading-tight">
          Choose a business
        </h1>
        <p className="text-text-muted text-[14px] mt-3 max-w-[460px] mx-auto">
          You have access to more than one house. Pick where you'd like to work
          — you can switch any time from the sidebar.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-9">
          {businesses.map((b, i) => {
            const accent = b.accent_colour || "#690909";
            const g1 = b.brand_theme?.grad1 || b.secondary_colour || accent;
            const g2 = b.brand_theme?.grad2 || accent;
            return (
              <button
                key={b.business_key}
                onClick={() => pick(b.business_key)}
                className="group glass rounded-2xl p-6 text-left flex items-center gap-4 hover:border-accent/40 transition-all animate-rise-in"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span
                  className="grid place-items-center w-14 h-14 rounded-2xl font-display font-semibold text-[22px] text-[#F4E9D9] shrink-0 overflow-hidden"
                  style={{
                    backgroundImage: `linear-gradient(140deg, ${g1}, ${g2})`,
                  }}
                >
                  {b.logo_path ? (
                    <img
                      src={b.logo_path}
                      alt=""
                      className="w-full h-full object-contain p-1.5"
                    />
                  ) : (
                    b.display_name.charAt(0)
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-[18px] truncate">
                    {b.display_name}
                  </span>
                  <span className="block text-text-faint text-[12px] mt-0.5">
                    Enter workspace
                  </span>
                </span>
                <ArrowRight className="w-5 h-5 text-text-faint group-hover:text-accent-glow group-hover:translate-x-0.5 transition-all" />
              </button>
            );
          })}
        </div>

        {businesses.length === 0 && (
          <p className="text-text-muted text-[13px] mt-8">
            No business has been assigned to your account yet. Contact an
            administrator.
          </p>
        )}
      </div>
    </div>
  );
}
