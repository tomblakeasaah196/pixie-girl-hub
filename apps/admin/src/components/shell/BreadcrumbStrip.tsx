import { Link } from "react-router-dom";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useBreadcrumbStore } from "@/stores/breadcrumbs";
import { useIsDesktop } from "@/hooks/useMediaQuery";

export function BreadcrumbStrip() {
  const crumbs = useBreadcrumbStore((s) => s.crumbs);
  const isDesktop = useIsDesktop();

  if (crumbs.length < 2) return null;

  if (!isDesktop) {
    const parent = crumbs[crumbs.length - 2];
    return (
      <nav className="flex items-center gap-1.5 px-4 py-2 border-b border-[rgb(var(--border-c)/0.5)] bg-[rgb(var(--panel-2)/0.4)] backdrop-blur-md">
        {parent.href ? (
          <Link
            to={parent.href}
            className="flex items-center gap-1 text-[13px] font-medium text-[rgb(var(--accent-glow))] active:opacity-70"
          >
            <ChevronLeft className="w-4 h-4" />
            {parent.label}
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-[13px] font-medium text-[rgb(var(--text-muted))]">
            <ChevronLeft className="w-4 h-4" />
            {parent.label}
          </span>
        )}
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-1.5 px-[30px] py-2 border-b border-[rgb(var(--border-c)/0.5)] bg-[rgb(var(--panel-2)/0.35)] backdrop-blur-md">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[rgb(var(--text-faint))]" />}
            {isLast || !crumb.href ? (
              <span className={isLast ? "text-[12.5px] font-semibold text-[rgb(var(--text))]" : "text-[12.5px] text-[rgb(var(--text-muted))]"}>
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.href}
                className="text-[12.5px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--accent-glow))] transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
