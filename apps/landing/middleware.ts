import { NextRequest, NextResponse } from "next/server";

const HOST_BRAND_MAP: Record<string, string> = {
  "sales.pixiegirlglobal.com": "pixiegirl",
  "sales.thefaitlynbrand.com": "faitlynhair",
  localhost: "pixiegirl", // dev default
};

function resolveBrand(hostname: string): string | null {
  const host = hostname.split(":")[0].toLowerCase();
  return HOST_BRAND_MAP[host] ?? process.env.DEFAULT_BRAND ?? null;
}

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const brand = resolveBrand(hostname);

  const res = NextResponse.next();

  if (brand) {
    res.headers.set("x-brand", brand);
    res.headers.set("x-brand-context", brand);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
