import type { Metadata, Viewport } from "next";
import { Playfair_Display, Montserrat, JetBrains_Mono, Italiana } from "next/font/google";
import { headers } from "next/headers";
import { getBrand } from "@/lib/brand";
import "@/styles/globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});
// Reserved for the intro overlay headline only — deliberately distinct from
// the site's regular display/body faces so the welcome reads as cinematic.
const italiana = Italiana({
  subsets: ["latin"],
  variable: "--font-cinematic",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Sales",
  description: "A time-bound sale, designed end-to-end.",
  formatDetection: { telephone: false, email: false, address: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F0809",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = getBrand();

  return (
    <html
      lang="en"
      data-business={brand}
      className={`${playfair.variable} ${montserrat.variable} ${jetbrains.variable} ${italiana.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
