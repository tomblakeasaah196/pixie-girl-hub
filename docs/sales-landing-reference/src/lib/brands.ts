import pxgLogo from "@/assets/PXG_logo.png.asset.json";
import pxgModel1 from "@/assets/PXG_model_1.png.asset.json";
import pxgModel2 from "@/assets/PXG_main_pixie_model_2.webp.asset.json";
import pxgModel3 from "@/assets/PXG_pixie_3.webp.asset.json";
import flhLogo from "@/assets/FLH_Logo_faitlyn-darkmode.png.asset.json";
import flhModel1 from "@/assets/FLH_faitlyn_model_2.jpg.asset.json";
import flhModel2 from "@/assets/FLH_faitlyn_model_3.jpg.asset.json";
import flhModel3 from "@/assets/FLH_faitlyn_models.jpg.asset.json";

export type BrandId = "pixie" | "faitlyn";

export type SocialPlatform =
  | "instagram" | "facebook" | "twitter" | "tiktok"
  | "youtube" | "pinterest" | "whatsapp";

export interface SocialLink {
  platform: SocialPlatform;
  href: string;
  label: string;
}

export interface BrandTokens {
  id: BrandId;
  name: string;
  legalName: string;
  address: string;
  wordmark: string;
  tagline: string;
  welcomeLine: string;
  campaignFallback: string;
  domain: string;
  storefront: string;
  logo: string;
  hero: string;
  gallery: string[];
  socials: SocialLink[];
  /** CSS variables — injected on the document root when this brand is active */
  cssVars: Record<string, string>;
  /** hex for 3D scene */
  three: {
    primary: string;
    accent: string;
    ink: string;
    metal: string;
  };
}

export const BRANDS: Record<BrandId, BrandTokens> = {
  pixie: {
    id: "pixie",
    name: "Pixie Girl Global",
    legalName: "Pixie Girl Global LLC",
    address: "30 N Gould St Ste R, Sheridan, WY 82801",
    socials: [
      { platform: "instagram", href: "https://www.instagram.com/pixiegirlg", label: "Instagram" },
      { platform: "tiktok", href: "https://www.tiktok.com/@pixiegirlg", label: "TikTok" },
      { platform: "youtube", href: "https://www.youtube.com/@PixieGirlG", label: "YouTube" },
      { platform: "twitter", href: "https://x.com/pixiegirlg", label: "X" },
      { platform: "pinterest", href: "https://www.pinterest.com/pixiegirlg", label: "Pinterest" },
    ],
    wordmark: "PIXIE GIRL",
    tagline: "The House of the Pixie",
    welcomeLine: "Welcome to the House of Pixie",
    campaignFallback: "A new chapter, in waiting.",
    domain: "sales.pixiegirlglobal.com",
    storefront: "https://pixiegirlglobal.com",
    logo: pxgLogo.url,
    hero: pxgModel2.url,
    gallery: [pxgModel2.url, pxgModel1.url, pxgModel3.url],
    cssVars: {
      "--brand-ink": "12 8% 6%",
      "--brand-paper": "20 30% 96%",
      "--brand-primary": "352 78% 20%",      // deep maroon #5C0A14
      "--brand-primary-deep": "352 80% 12%",
      "--brand-accent": "36 55% 70%",        // champagne
      "--brand-muted": "18 12% 70%",
      "--brand-glow": "352 80% 35%",
    },
    three: {
      primary: "#5C0A14",
      accent: "#D4AF7A",
      ink: "#100806",
      metal: "#B8112B",
    },
  },
  faitlyn: {
    id: "faitlyn",
    name: "Faitlyn Hair",
    legalName: "The Faitlyn Brand",
    address: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
    socials: [
      { platform: "instagram", href: "https://www.instagram.com/faitlynhair/", label: "Instagram" },
      { platform: "facebook", href: "https://web.facebook.com/faitlynhair/", label: "Facebook" },
      { platform: "twitter", href: "https://twitter.com/Faitlynhair", label: "X" },
      { platform: "whatsapp", href: "https://wa.me/2348061987874", label: "WhatsApp" },
    ],
    wordmark: "FAITLYN",
    tagline: "Quietly extraordinary.",
    welcomeLine: "Welcome to Faitlyn",
    campaignFallback: "Between chapters. The next is being written.",
    domain: "sales.thefaitlynbrand.com",
    storefront: "https://thefaitlynbrand.com",
    logo: flhLogo.url,
    hero: flhModel1.url,
    gallery: [flhModel1.url, flhModel3.url, flhModel2.url],
    cssVars: {
      "--brand-ink": "24 30% 8%",
      "--brand-paper": "32 35% 96%",
      "--brand-primary": "26 28% 22%",       // cocoa #3A2418
      "--brand-primary-deep": "24 30% 12%",
      "--brand-accent": "28 38% 75%",        // warm taupe #D9BFA8
      "--brand-muted": "30 18% 65%",
      "--brand-glow": "32 45% 60%",
    },
    three: {
      primary: "#3A2418",
      accent: "#D9BFA8",
      ink: "#1A0F08",
      metal: "#E5C9A8",
    },
  },
};
