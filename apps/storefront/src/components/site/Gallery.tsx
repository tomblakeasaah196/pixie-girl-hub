import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { Instagram } from "lucide-react";
import { motion } from "motion/react";
import {
  DEFAULT_HOME,
  type GalleryItem,
  type GalleryProfile,
} from "@/lib/home-content";

/**
 * Instagram "rotating showcase". The tagged photos (Studio → Pages → Home →
 * Gallery → Items) orbit a central medallion whose featured image cross-fades
 * every 5s; the matching ring tile lights up in sync. Beneath it sits the
 * brand's Instagram identity (Studio → Gallery → Profile): a gradient handle
 * link with the verification seal, tagline and follower count. Any `@handle`
 * typed into the eyebrow/heading is auto-linked to Instagram too.
 *
 * One `--stage` CSS variable scales the whole ring, so it shrinks to fit phones
 * and expands on desktop. The orbit + fades are pure CSS, so the global
 * reduced-motion rule quiets them automatically.
 */

const ROTATE_MS = 5000;
const MAX_TILES = 14;

const normalizeHandle = (h: string) => h.replace(/^@+/, "").trim();
const displayHandle = (h: string) => `@${normalizeHandle(h)}`;
const igUrl = (h: string) => `https://www.instagram.com/${normalizeHandle(h)}/`;

export function Gallery({
  eyebrow = DEFAULT_HOME.gallery.eyebrow,
  heading = DEFAULT_HOME.gallery.heading,
  items = DEFAULT_HOME.gallery.items,
  profile = DEFAULT_HOME.gallery.profile,
}: {
  eyebrow?: string;
  heading?: string;
  items?: GalleryItem[];
  profile?: GalleryProfile;
}) {
  const shots = (items.length ? items : DEFAULT_HOME.gallery.items).slice(0, MAX_TILES);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (shots.length < 2) return;
    const id = setInterval(
      () => setActive((i) => (i + 1) % shots.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [shots.length]);

  const activeIdx = active % shots.length;
  const profileUrl = profile.href || igUrl(profile.handle);

  return (
    <section className="border-t border-taupe/15 py-24 md:py-36 overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-6 text-center">
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">
          {linkifyHandles(eyebrow)}
        </p>
        <h2 className="font-display text-3xl md:text-5xl leading-tight text-balance max-w-3xl mx-auto">
          {linkifyHandles(heading)}
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="mt-14 md:mt-20 flex justify-center"
      >
        <div className="ig-stage">
          <span className="ig-halo" aria-hidden="true" />

          <div className="ig-ring">
            {shots.map((it, i) => (
              <div
                key={i}
                className="ig-tile"
                data-active={i === activeIdx}
                style={{ "--a": `${(360 / shots.length) * i}deg` } as CSSProperties}
              >
                <TileMedia item={it} />
              </div>
            ))}
          </div>

          <div className="ig-center">
            {shots.map((it, i) => (
              <figure
                key={i}
                className="ig-center-media"
                data-active={i === activeIdx}
                aria-hidden={i !== activeIdx}
              >
                <img
                  src={it.image}
                  alt={it.handle ? `Tagged by ${it.handle}` : "Featured Instagram look"}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            ))}
          </div>

          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${displayHandle(profile.handle)} on Instagram`}
            className="ig-logo ig-gradient-bg"
          >
            <Instagram className="w-1/2 h-1/2" strokeWidth={2} />
          </a>
        </div>
      </motion.div>

      <ProfileCard profile={profile} href={profileUrl} />
    </section>
  );
}

/** One orbiting tile — a link when the operator pasted its Instagram URL. */
function TileMedia({ item }: { item: GalleryItem }) {
  const img = (
    <img
      src={item.image}
      alt={item.handle ? `Tagged by ${item.handle}` : ""}
      loading="lazy"
      decoding="async"
    />
  );
  if (!item.href) return <div className="ig-tile-media">{img}</div>;
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.handle ? `View ${item.handle} on Instagram` : "View on Instagram"}
      className="ig-tile-media block"
    >
      {img}
    </a>
  );
}

/** Brand Instagram identity beneath the ring. */
function ProfileCard({ profile, href }: { profile: GalleryProfile; href: string }) {
  return (
    <div className="mt-12 md:mt-16 flex flex-col items-center gap-3 px-6 text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex items-center gap-2.5"
      >
        <span className="ig-gradient-bg grid place-items-center rounded-[0.7rem] p-1.5 text-white shadow-sm">
          <Instagram className="w-5 h-5" strokeWidth={2} />
        </span>
        <span className="ig-gradient-text font-display text-2xl md:text-3xl leading-none group-hover:opacity-80 transition-opacity">
          {displayHandle(profile.handle)}
        </span>
        {profile.verified ? <VerifiedBadge className="w-5 h-5 md:w-6 md:h-6" /> : null}
      </a>

      {profile.bio ? (
        <p className="text-sm md:text-base text-cream/90 max-w-md">{profile.bio}</p>
      ) : null}

      {profile.followers ? (
        <p className="text-[0.7rem] tracking-[0.35em] uppercase text-taupe">
          <span className="font-display text-cream text-base tracking-normal">
            {profile.followers}
          </span>{" "}
          followers
        </p>
      ) : null}
    </div>
  );
}

/** Instagram-style blue verification seal (Material "verified" glyph). */
function VerifiedBadge({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Verified"
    >
      <path
        fill="#3897F0"
        d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 1.45 8.6 1.5 6.71 4.7l-3.61.81.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82 1.89 3.19L12 22.55l3.4-.09 1.89-3.2 3.61-.82-.34-3.69z"
      />
      <path
        fill="#fff"
        d="M10.09 16.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.32-5.34 1.48 1.48z"
      />
    </svg>
  );
}

/**
 * Render text with any `@handle` turned into an Instagram-gradient link with
 * the IG glyph — so a heading like "Tag @faitlynhair on IG" links the handle.
 */
function linkifyHandles(text: string) {
  const parts = text.split(/(@[A-Za-z0-9._]+)/g);
  return parts.map((part, i) => {
    if (!/^@[A-Za-z0-9._]+$/.test(part)) return <Fragment key={i}>{part}</Fragment>;
    return (
      <a
        key={i}
        href={igUrl(part)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 align-baseline font-medium"
      >
        <Instagram className="inline-block w-[0.9em] h-[0.9em] -translate-y-[0.05em]" strokeWidth={2} />
        <span className="ig-gradient-text">{part}</span>
      </a>
    );
  });
}
