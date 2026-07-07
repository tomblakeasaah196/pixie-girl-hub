/**
 * Markdown export of a filtered error set. This is the artifact we paste into a
 * fix ticket, feed to Claude to fix the bug, or send the client as evidence.
 * See guide §7.3 (Markdown export).
 */

"use strict";

function fmt(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  } catch {
    return String(ts);
  }
}

function severityTag(s) {
  return `[${String(s || "error").toUpperCase()}]`;
}

/**
 * @param {object} p
 * @param {Array}  p.groups  rows from errors.repo.listGroupsForExport
 * @param {object} p.filter  { status, severity, source, q }
 * @returns {string} markdown
 */
function buildMarkdown({ groups, filter = {} }) {
  const now = fmt(new Date().toISOString());
  const filterBits = Object.entries(filter)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const lines = [];
  lines.push(`# Kaizen Error Report — ${now}`);
  lines.push("");
  lines.push(
    `Filter: ${filterBits || "none"}   •   ${groups.length} group${groups.length === 1 ? "" : "s"}`,
  );
  lines.push("");

  groups.forEach((g, idx) => {
    lines.push(`## ${idx + 1}. ${severityTag(g.severity)} ${g.title}`);
    lines.push(`- **Fingerprint:** ${g.fingerprint}`);
    lines.push(
      `- **Route:** ${g.route_pattern || "—"}   •   **Status code:** ${g.http_status ?? "—"}   •   **State:** ${g.status}`,
    );
    lines.push(
      `- **Occurrences:** ${g.occurrence_count}   •   **First seen:** ${fmt(g.first_seen_at)}   •   **Last seen:** ${fmt(g.last_seen_at)}`,
    );
    lines.push(
      `- **Source:** ${g.source}${g.error_code ? `   •   **Code:** ${g.error_code}` : ""}${g.reopen_count ? `   •   **Reopened:** ${g.reopen_count}×` : ""}`,
    );
    const stack = g.sample?.context?.stack || g.sample?.stack;
    if (stack) {
      lines.push(`- **Sample stack:**`);
      lines.push("  ```");
      String(stack)
        .split("\n")
        .slice(0, 12)
        .forEach((l) => lines.push("  " + l));
      lines.push("  ```");
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

module.exports = { buildMarkdown };
