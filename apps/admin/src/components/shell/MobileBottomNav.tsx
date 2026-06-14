import { NavLink, useNavigate } from "react-router-dom";
import { Home, Search, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";

/** Mobile bottom nav (canon §3.4): Home · Search · Apps · Praxis. */
export function MobileBottomNav() {
  const navigate = useNavigate();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn("flex flex-col items-center gap-[3px] text-[9.5px] font-semibold p-[4px_10px] rounded-[10px] cursor-pointer", isActive ? "text-accent-glow" : "text-text-faint");

  return (
    <nav className="hidden max-md:flex fixed bottom-0 inset-x-0 z-[60] justify-around px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom,0px))] glass border-t">
      <NavLink to="/" className={linkCls} end>
        <Home className="w-[21px] h-[21px]" />
        Home
      </NavLink>
      <button className="flex flex-col items-center gap-[3px] text-[9.5px] font-semibold text-text-faint p-[4px_10px]" onClick={() => setPaletteOpen(true)}>
        <Search className="w-[21px] h-[21px]" />
        Search
      </button>
      <button className="flex flex-col items-center gap-[3px] text-[9.5px] font-semibold text-text-faint p-[4px_10px]" onClick={() => navigate("/")}>
        <LayoutGrid className="w-[21px] h-[21px]" />
        Apps
      </button>
      <NavLink to="/praxis" className={linkCls}>
        <Sparkles className="w-[21px] h-[21px]" />
        Praxis
      </NavLink>
    </nav>
  );
}
