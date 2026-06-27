"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Meta (Facebook) Pixel — base install for the public sales site.
 *
 * Mounted once in the root layout, so it covers the whole funnel in one place:
 * every sale state (before / live / after / landing) plus checkout and
 * thank-you. The pixel id is resolved per-brand from the published landing
 * config (Landing Studio → seo.metaPixelId), so Pixie Girl and Faitlyn each
 * report to their own pixel — never a shared one.
 *
 * Two things this handles that a raw pasted <script> snippet cannot:
 *   1. It loads through next/script (afterInteractive) instead of a hand-rolled
 *      tag, matching how the rest of the app injects third-party scripts.
 *   2. The site is a client-side-routed SPA, so fbevents only auto-fires
 *      PageView on the very first load. The effect below re-fires PageView on
 *      every client navigation (e.g. before → checkout), while skipping the
 *      first run so the initial view from the inline init isn't double-counted.
 *
 * `pixelId` is the bare numeric id (validated/sanitised upstream), so it is
 * safe to interpolate into the init below.
 */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const firstLoad = useRef(true);

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname]);

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
