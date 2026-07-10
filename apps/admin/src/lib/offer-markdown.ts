/**
 * Client-side markdown → safe HTML for the Offer Studio live preview.
 *
 * Deliberately mirrors the server renderer (recruitment.render.js) subset —
 * headings, bold/italic/code, bullet + ordered lists, pipe tables, rules — so
 * what the CEO sees while editing matches the signed PDF and the candidate page.
 * Everything is HTML-escaped first; only whitelisted forms are re-introduced.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inline = (escaped: string) =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

export function renderOfferMarkdown(md: string): string {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const para: string[] = [];
  let i = 0;

  const flush = () => {
    if (para.length) out.push(`<p>${inline(esc(para.join(" ")))}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      out.push("<hr />");
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(esc(h[2].trim()))}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\|(.+)\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test((lines[i + 1] || "").trim())) {
      flush();
      const cells = (r: string) =>
        r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i].trim())) {
        body.push(cells(lines[i].trim()));
        i++;
      }
      const thead = `<tr>${header.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr>`;
      const tbody = body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\s*[-*]\s+/, "").trim()))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\s*\d+\.\s+/, "").trim()))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}
