/**
 * Vite-side stand-in for `next/image`, used only when the admin renders the
 * shared @landing-kit Atelier components (which import next/image for the live
 * Next.js site). Aliased in vite.config.ts. Renders a plain <img>; the live
 * site still uses the real optimized next/image — this is preview-only.
 */
import type { CSSProperties, ImgHTMLAttributes } from "react";

type NextImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> & {
  src: string | { src: string };
  alt?: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
  style?: CSSProperties;
};

export default function Image({
  src,
  alt = "",
  fill,
  width,
  height,
  sizes,
  // next-only props — discarded so they don't leak onto the DOM node
  priority: _priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  loader: _loader,
  style,
  ...rest
}: NextImageProps) {
  const resolved = typeof src === "string" ? src : src?.src;
  const fillStyle: CSSProperties = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }
    : {};
  return (
    <img
      src={resolved}
      alt={alt}
      width={fill ? undefined : (width as number | undefined)}
      height={fill ? undefined : (height as number | undefined)}
      sizes={sizes}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
