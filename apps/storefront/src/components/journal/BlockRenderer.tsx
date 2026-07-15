/**
 * Renders a journal article's `content_blocks` array — the magazine-style
 * body composed in Storefront Studio → Content. Every block type is handled
 * explicitly with real React elements; nothing here ever uses
 * dangerouslySetInnerHTML, so operator-authored copy can never inject markup.
 *
 * Mixed aspect ratios (9:16 Shorts/Reels next to 16:9 landscape clips) are
 * handled per-block: landscape/square embeds run full measure, portrait
 * embeds are capped at 450px and centered so a Short never stretches edge to
 * edge or gets clipped.
 */

import {
  type ContentBlock,
  FONT_CSS,
  FONT_SIZE_REM,
  ASPECT_RATIO_CSS,
  youTubeEmbedSrc,
  instagramEmbedSrc,
} from "@/lib/content-blocks";

const PORTRAIT_MAX = 450;

function EmbedFrame({
  aspect,
  children,
}: {
  aspect: "16:9" | "9:16" | "1:1";
  children: React.ReactNode;
}) {
  return (
    <div
      className={aspect === "9:16" ? "mx-auto" : "w-full"}
      style={aspect === "9:16" ? { maxWidth: PORTRAIT_MAX } : undefined}
    >
      <div
        className="overflow-hidden rounded-md bg-secondary"
        style={{ aspectRatio: ASPECT_RATIO_CSS[aspect] }}
      >
        {children}
      </div>
    </div>
  );
}

function TextBlockView({ block }: { block: Extract<ContentBlock, { type: "text" }> }) {
  if (!block.text?.trim()) return null;
  return (
    <p
      className="whitespace-pre-wrap text-foreground"
      style={{
        fontFamily: block.fontFamily ? FONT_CSS[block.fontFamily] : undefined,
        fontSize: block.fontSize ? FONT_SIZE_REM[block.fontSize] : undefined,
        color: block.color || undefined,
        fontWeight: block.bold ? 700 : undefined,
        fontStyle: block.italic ? "italic" : undefined,
        textDecoration: block.underline ? "underline" : undefined,
        textAlign: block.align || "left",
        lineHeight: 1.65,
      }}
    >
      {block.text}
    </p>
  );
}

function ImageBlockView({ block }: { block: Extract<ContentBlock, { type: "image" }> }) {
  if (!block.url) return null;
  return (
    <figure>
      <div className="overflow-hidden rounded-md bg-secondary">
        <img
          src={block.url}
          alt={block.alt || ""}
          loading="lazy"
          className="h-auto w-full object-cover"
        />
      </div>
      {block.caption ? (
        <figcaption className="mt-2 text-body-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function YoutubeBlockView({ block }: { block: Extract<ContentBlock, { type: "youtube" }> }) {
  const src = youTubeEmbedSrc(block.url);
  if (!src) return null;
  return (
    <figure>
      <EmbedFrame aspect={block.aspect}>
        <iframe
          src={src}
          title="YouTube video"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </EmbedFrame>
      {block.caption ? (
        <figcaption className="mt-2 text-body-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function InstagramBlockView({
  block,
}: {
  block: Extract<ContentBlock, { type: "instagram" }>;
}) {
  const src = instagramEmbedSrc(block.url);
  if (!src) return null;
  return (
    <figure>
      <EmbedFrame aspect={block.aspect}>
        <iframe
          src={src}
          title="Instagram post"
          loading="lazy"
          allow="clipboard-write; encrypted-media"
          className="h-full w-full border-0"
        />
      </EmbedFrame>
      {block.caption ? (
        <figcaption className="mt-2 text-body-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function VideoBlockView({ block }: { block: Extract<ContentBlock, { type: "video" }> }) {
  if (!block.url) return null;
  // Real dimensions from our own transcode pipeline — read straight off them
  // rather than guessing, so a portrait upload gets the same 450px treatment
  // as a portrait embed and a landscape upload runs full width.
  const isPortrait = !!(block.width && block.height && block.height > block.width);
  return (
    <figure className={isPortrait ? "mx-auto" : undefined} style={isPortrait ? { maxWidth: PORTRAIT_MAX } : undefined}>
      <div className="overflow-hidden rounded-md bg-secondary">
        <video
          src={block.url}
          poster={block.poster_url || undefined}
          controls
          playsInline
          className="h-auto w-full"
        />
      </div>
      {block.caption ? (
        <figcaption className="mt-2 text-body-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function BlockRenderer({ blocks }: { blocks: ContentBlock[] }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return (
    <div className="space-y-8">
      {blocks.map((block) => {
        switch (block.type) {
          case "text":
            return <TextBlockView key={block.id} block={block} />;
          case "image":
            return <ImageBlockView key={block.id} block={block} />;
          case "youtube":
            return <YoutubeBlockView key={block.id} block={block} />;
          case "instagram":
            return <InstagramBlockView key={block.id} block={block} />;
          case "video":
            return <VideoBlockView key={block.id} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
