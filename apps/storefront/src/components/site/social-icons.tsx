import {
  Instagram,
  Facebook,
  Twitter,
  MessageCircle,
  Youtube,
  Globe,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * One place that maps a social platform key (as stored by Storefront Studio →
 * Navigation → Socials) to its icon, shared by the header and footer so the two
 * never drift. lucide covers most platforms; TikTok and Pinterest have no
 * lucide glyph, so they're drawn as inline brand SVGs. Anything unknown falls
 * back to a neutral globe — never to the Instagram mark (which used to make a
 * TikTok/YouTube link look like Instagram).
 */

type IconProps = { size?: number; className?: string; strokeWidth?: number };

function TikTokIcon({ size = 15, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.5 0h-3.2v13.2a2.9 2.9 0 1 1-2.9-2.9c.2 0 .4 0 .6.1V7.1a6 6 0 0 0-.6 0 6 6 0 1 0 6 6V8.2a7.3 7.3 0 0 0 4.3 1.4V6.4a4.3 4.3 0 0 1-4.2-4.3V0Z" />
    </svg>
  );
}

function PinterestIcon({ size = 15, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.02 0C5.4 0 .03 5.37.03 11.99c0 5.08 3.16 9.42 7.62 11.16-.1-.95-.2-2.4.04-3.44.22-.94 1.4-5.96 1.4-5.96s-.36-.72-.36-1.78c0-1.66.97-2.91 2.17-2.91 1.02 0 1.52.77 1.52 1.69 0 1.03-.65 2.57-.99 4-.29 1.19.6 2.16 1.77 2.16 2.13 0 3.77-2.24 3.77-5.49 0-2.86-2.06-4.87-5-4.87-3.41 0-5.41 2.56-5.41 5.2 0 1.03.39 2.14.89 2.74.1.12.11.22.08.34-.09.38-.29 1.2-.33 1.37-.05.22-.17.27-.4.16-1.5-.69-2.43-2.88-2.43-4.64 0-3.78 2.75-7.25 7.92-7.25 4.16 0 7.39 2.97 7.39 6.92 0 4.14-2.61 7.47-6.23 7.47-1.22 0-2.36-.63-2.75-1.38l-.75 2.85c-.27 1.04-1 2.35-1.5 3.15 1.13.35 2.31.53 3.55.53 6.6 0 11.98-5.36 11.98-11.99C24 5.37 18.63 0 12.02 0Z" />
    </svg>
  );
}

const SOCIAL_ICON: Record<string, ComponentType<IconProps>> = {
  instagram: Instagram,
  tiktok: TikTokIcon,
  facebook: Facebook,
  twitter: Twitter,
  youtube: Youtube,
  whatsapp: MessageCircle,
  pinterest: PinterestIcon,
};

/** The icon component for a platform key, or a neutral globe when unknown. */
export function socialIcon(key: string): ComponentType<IconProps> {
  return SOCIAL_ICON[key.toLowerCase()] ?? Globe;
}
