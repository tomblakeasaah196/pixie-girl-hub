import { useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";

interface ImportRow {
  row?: number;
  sheet?: string;
  status: string;
  name?: string;
  reason?: string;
}
interface ImportResult {
  created?: number;
  updated?: number;
  total?: number;
  results?: ImportRow[];
}

/**
 * Template / Export / Import controls for a catalogue entity. Downloads are
 * authenticated blobs; import posts the .xlsx and shows a per-row summary.
 * One component, dropped into Styled / Collections / Bundles / Services.
 */
export function ImportExportControls({
  label,
  templatePath,
  exportPath,
  importPath,
  onImported,
}: {
  label: string;
  templatePath: string;
  exportPath: string;
  importPath: string;
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "template" | "export" | "import">(
    null,
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dl = async (path: string, which: "template" | "export") => {
    setBusy(which);
    setError(null);
    try {
      await api.download(path);
    } catch {
      setError("Download failed — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("import");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postForm<ImportResult>(importPath, form);
      setResult(res);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const problems = (result?.results ?? []).filter(
    (r) =>
      r.status !== "created" &&
      r.status !== "updated" &&
      r.status !== "info",
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
          disabled={busy !== null}
          onClick={() => dl(templatePath, "template")}
        >
          {busy === "template" ? "…" : "Template"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download className="w-3.5 h-3.5" />}
          disabled={busy !== null}
          onClick={() => dl(exportPath, "export")}
        >
          {busy === "export" ? "…" : "Export"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload className="w-3.5 h-3.5" />}
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "import" ? "Importing…" : "Import"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={onPick}
        />
      </div>

      {error && <p className="text-[11.5px] text-danger mt-1">{error}</p>}

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={`${label} import`}
      >
        {result && (
          <div className="space-y-3">
            <div className="flex gap-4 text-[13px]">
              <span className="text-success font-semibold">
                {result.created ?? 0} created
              </span>
              {result.updated != null && (
                <span className="text-accent-glow font-semibold">
                  {result.updated} updated
                </span>
              )}
              {problems.length > 0 && (
                <span className="text-warn font-semibold">
                  {problems.length} skipped / failed
                </span>
              )}
            </div>
            {problems.length > 0 && (
              <div className="max-h-[260px] overflow-y-auto rounded-[10px] border border-line divide-y divide-line/60">
                {problems.map((p, i) => (
                  <div key={i} className="px-3 py-2 text-[12px]">
                    <span className="text-text-faint">
                      {p.sheet ? `${p.sheet} · ` : ""}row {p.row ?? "?"}
                    </span>{" "}
                    <span className="text-warn">{p.status}</span>
                    {p.name ? ` — ${p.name}` : ""}
                    {p.reason ? `: ${p.reason}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
