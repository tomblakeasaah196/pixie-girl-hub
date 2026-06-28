"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fbTrack } from "@/lib/fbpixel";
import { useConsentStore } from "@/lib/consent-store";

export function MetaPixel({
  pixelId,
  isEu,
}: {
  pixelId: string;
  isEu: boolean;
}) {
  const consent = useConsentStore((s) => s.status);
  const pathname = usePathname();
  const firstLoad = useRef(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const allowed = !isEu || consent === "accepted";

  useEffect(() => {
    if (!allowed) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    fbTrack("PageView");
  }, [pathname, allowed]);

  if (isEu && (!mounted || consent !== "accepted")) return null;

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
