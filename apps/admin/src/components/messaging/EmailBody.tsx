import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Renders an email message body, collapsing the quoted history (the
 * "On … wrote:" / ">" reply chain) behind a toggle so the thread reads like
 * a chat instead of an ever-growing wall of quotes.
 */
function splitQuoted(body: string): { main: string; quoted: string } {
  const lines = body.split("\n");
  const boundary = lines.findIndex(
    (l) =>
      /^On .+wrote:\s*$/.test(l.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) ||
      /^_{5,}$/.test(l.trim()) ||
      l.trim().startsWith(">"),
  );
  if (boundary === -1) return { main: body, quoted: "" };
  return {
    main: lines.slice(0, boundary).join("\n").trimEnd(),
    quoted: lines.slice(boundary).join("\n").trim(),
  };
}

export function EmailBody({ content }: { content: string }) {
  const { main, quoted } = useMemo(() => splitQuoted(content), [content]);
  const [showQuoted, setShowQuoted] = useState(false);

  return (
    <div>
      {main && <p className="whitespace-pre-wrap">{main}</p>}
      {quoted && (
        <div className="mt-1">
          <button
            onClick={() => setShowQuoted((v) => !v)}
            className="flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100"
            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
          >
            {showQuoted ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuoted && (
            <pre className="mt-1 whitespace-pre-wrap border-l-2 border-current/20 pl-2 text-[12px] opacity-70 font-sans">
              {quoted}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
