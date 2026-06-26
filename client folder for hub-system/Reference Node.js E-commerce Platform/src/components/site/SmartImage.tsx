import { useState, type ImgHTMLAttributes } from "react";
import { useMotionPrefs } from "@/hooks/use-motion-prefs";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  /** wrapper className (positions the skeleton) */
  wrapperClassName?: string;
  /** show a shimmering skeleton while the image decodes */
  skeleton?: boolean;
};

/**
 * Image with a shimmer skeleton and GPU-friendly fade-in once decoded.
 * Falls back to instant display under reduced-motion / low-end devices.
 */
export function SmartImage({
  wrapperClassName = "absolute inset-0",
  skeleton = true,
  className,
  onLoad,
  ...rest
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const { motionOk } = useMotionPrefs();

  return (
    <div className={wrapperClassName}>
      {skeleton && !loaded && (
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(110deg,hsl(var(--card))_25%,hsl(var(--muted))_50%,hsl(var(--card))_75%)] bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite]"
        />
      )}
      <img
        {...rest}
        loading={rest.loading ?? "lazy"}
        decoding={rest.decoding ?? "async"}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        className={className}
        style={{
          ...rest.style,
          opacity: loaded ? 1 : 0,
          transition: `opacity ${motionOk ? 600 : 200}ms cubic-bezier(0.22,1,0.36,1)`,
          willChange: "opacity",
        }}
      />
    </div>
  );
}
