/**
 * Tiny markdown renderer for the Help Center.
 *
 * Why hand-rolled rather than a library:
 *   - We control the article corpus and the syntax it uses.
 *   - Avoids a new dependency at this stage of the build.
 *   - Easier to style with our Maroon Noir tokens.
 *
 * Supported syntax:
 *   # H1 · ## H2 · ### H3
 *   paragraphs (blank-line separated)
 *   - / * unordered lists ·  1. ordered lists
 *   **bold** · _italic_ · `inline code`
 *   > blockquotes
 *   pipe tables (with header separator row)
 *   ```fenced code```
 *
 * Anything we don't know we render as a paragraph (degraded but safe).
 */

import { Fragment, type ReactNode } from "react";

interface Props {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: Props) {
  const blocks = parseBlocks(source);
  return (
    <div
      className={
        className ??
        "prose-help text-[14.5px] text-text-primary leading-relaxed space-y-4"
      }
    >
      {blocks.map((b, i) => (
        <Fragment key={i}>{renderBlock(b)}</Fragment>
      ))}
    </div>
  );
}

// ── Parser ────────────────────────────────────────────────

type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }
    // Headings
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({
        kind: `h${h[1].length}` as "h1" | "h2" | "h3",
        text: h[2].trim(),
      });
      i++;
      continue;
    }
    // Blockquote
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    // Table — needs at least header + separator row.
    if (
      line.startsWith("|") &&
      i + 1 < lines.length &&
      /^\|[\s|:-]+\|$/.test(lines[i + 1])
    ) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    // Lists
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph (consume until blank line).
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s|^[-*]\s|^\d+\.\s|^>\s|^\|/.test(lines[i]) &&
      !lines[i].startsWith("```")
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());
}

// ── Inline renderer ───────────────────────────────────────

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order: code → bold → italic. Each pass walks remaining segments.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={m.index}
          className="rounded px-1.5 py-[1px] bg-panel-2 text-accent-glow text-[12.5px]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={m.index} className="font-semibold text-text-primary">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("_")) {
      out.push(
        <em key={m.index} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    } else if (tok.startsWith("[")) {
      const ml = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (ml) {
        out.push(
          <a
            key={m.index}
            href={ml[2]}
            className="text-accent-glow underline underline-offset-2 hover:opacity-80"
            target={ml[2].startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
          >
            {ml[1]}
          </a>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlock(b: Block): ReactNode {
  switch (b.kind) {
    case "h1":
      return (
        <h1 className="font-display text-[26px] font-medium tracking-tight mt-2">
          {inline(b.text)}
        </h1>
      );
    case "h2":
      return (
        <h2 className="font-display text-[20px] font-medium tracking-tight mt-6 mb-1 text-text-primary">
          {inline(b.text)}
        </h2>
      );
    case "h3":
      return (
        <h3 className="font-display text-[16px] font-medium tracking-tight mt-5 mb-1 text-text-primary">
          {inline(b.text)}
        </h3>
      );
    case "p":
      return <p>{inline(b.text)}</p>;
    case "quote":
      return (
        <blockquote className="border-l-2 border-accent/40 pl-3 italic text-text-muted">
          {inline(b.text)}
        </blockquote>
      );
    case "ul":
      return (
        <ul className="list-disc pl-5 space-y-1.5 marker:text-accent/70">
          {b.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal pl-5 space-y-1.5 marker:text-accent/70 marker:font-semibold">
          {b.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="rounded-lg bg-panel-2 border hairline p-3 overflow-x-auto text-[12.5px] font-mono text-text-primary">
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border hairline">
          <table className="min-w-full text-[13px]">
            <thead className="bg-panel-2 text-text-muted">
              <tr>
                {b.head.map((h, i) => (
                  <th
                    key={i}
                    className="text-left font-semibold px-3 py-2 border-b hairline"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="odd:bg-transparent even:bg-panel/40">
                  {row.map((c, i) => (
                    <td
                      key={i}
                      className="px-3 py-2 border-t hairline align-top"
                    >
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
