/**
 * AI Control › Knowledge & Training. Upload any file (docs, PDFs, images, media)
 * or type a fact to teach Praxis. Text is extracted where possible; the title +
 * note are always embedded, so even an image or video becomes retrievable by its
 * description. CEO-gated end to end (the API enforces it too).
 */

import { useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  File as FileIcon,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";
import { useAuthStore } from "@/stores/auth";
import {
  useTrainingSources,
  useUploadTraining,
  useDeleteTrainingSource,
  useTeachPraxis,
  type TrainingSource,
} from "@/lib/praxis-api";

function iconFor(mime: string | null) {
  const m = mime || "";
  if (m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Film;
  if (m.startsWith("audio/")) return Music;
  if (m.includes("pdf") || m.startsWith("text/")) return FileText;
  return FileIcon;
}

function fmtBytes(n: number) {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function StatusPill({ s }: { s: TrainingSource["status"] }) {
  const map = {
    embedded: "text-green-300 border-green-400/30 bg-green-400/10",
    stored: "text-amber-300 border-amber-400/30 bg-amber-400/10",
    failed: "text-danger border-danger/30 bg-danger/10",
  } as const;
  const label = { embedded: "Learned", stored: "Stored", failed: "Failed" }[s];
  return (
    <span
      className={`text-[10px] uppercase tracking-widest rounded-full px-2 py-[2px] border ${map[s]}`}
    >
      {label}
    </span>
  );
}

export function TrainPraxisPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Training" },
  ]);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const sources = useTrainingSources();
  const upload = useUploadTraining();
  const remove = useDeleteTrainingSource();
  const teach = useTeachPraxis();

  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [fact, setFact] = useState("");
  const [taught, setTaught] = useState(false);

  const send = (file: File) => {
    upload.mutate(
      { file, title: title.trim() || undefined, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setTitle("");
          setNote("");
          if (fileRef.current) fileRef.current.value = "";
        },
      },
    );
  };

  if (!isCeo) {
    return (
      <div className="max-w-[720px] mx-auto">
        <Card className="p-6 text-center text-text-muted text-[13px]">
          Training Praxis is restricted to the CEO account, so the knowledge base
          can't be tampered with.
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[820px] mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Sparkles className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Knowledge &amp; Training
          </h2>
          <p className="text-text-muted text-[13px]">
            Upload files or teach facts. Praxis embeds them and retrieves them in
            future answers.
          </p>
        </div>
      </header>

      {/* Upload */}
      <Card className="p-4 mb-4">
        <div className="grid gap-2.5 sm:grid-cols-2 mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note / context (optional — helps for images & media)"
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
          />
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) send(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
            drag ? "border-accent/60 bg-accent/5" : "hairline hover:border-accent/40"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) send(f);
            }}
          />
          {upload.isPending ? (
            <span className="inline-flex items-center gap-2 text-[13px] text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading &amp; embedding…
            </span>
          ) : (
            <span className="inline-flex flex-col items-center gap-1 text-text-muted">
              <Upload className="w-6 h-6 text-accent-glow" />
              <span className="text-[13px]">
                Drop a file here or click to upload
              </span>
              <span className="text-[11px] text-text-faint">
                Any type · up to 25 MB · text is extracted, media learned by title/note
              </span>
            </span>
          )}
        </div>
        {upload.isError && (
          <p className="mt-2 text-[12px] text-danger inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Upload failed. Try again.
          </p>
        )}
      </Card>

      {/* Teach a fact */}
      <Card className="p-4 mb-5">
        <div className="text-[13px] font-medium mb-2">Teach a fact or rule</div>
        <textarea
          value={fact}
          onChange={(e) => setFact(e.target.value)}
          rows={2}
          placeholder="e.g. Our China supplier lead time is 21 days door-to-door."
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 resize-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!fact.trim() || teach.isPending}
            onClick={() =>
              teach.mutate(
                { content: fact.trim() },
                {
                  onSuccess: () => {
                    setFact("");
                    setTaught(true);
                    setTimeout(() => setTaught(false), 2000);
                  },
                },
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-bg px-3 py-1.5 text-[12px] font-semibold hover:bg-accent-glow disabled:opacity-50"
          >
            {teach.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Teach Praxis
          </button>
          {taught && (
            <span className="text-[12px] text-green-300 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Learned
            </span>
          )}
        </div>
      </Card>

      {/* Library */}
      <div className="text-[12px] uppercase tracking-widest text-text-faint mb-2">
        Uploaded material
      </div>
      {sources.isLoading ? (
        <Card className="p-6 text-center text-text-muted text-[13px]">Loading…</Card>
      ) : !sources.data?.length ? (
        <Card className="p-6 text-center text-text-muted text-[13px]">
          Nothing uploaded yet.
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {sources.data.map((s) => {
            const Icon = iconFor(s.mime_type);
            return (
              <Card key={s.source_id} className="p-3">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-accent-glow shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium truncate">
                        {s.title}
                      </span>
                      <StatusPill s={s.status} />
                    </div>
                    <div className="text-[11.5px] text-text-faint truncate">
                      {s.original_filename || "text"} · {fmtBytes(s.byte_size)} ·{" "}
                      {s.chunk_count} chunk{s.chunk_count === 1 ? "" : "s"}
                      {s.extract_chars > 0
                        ? ` · ${s.extract_chars.toLocaleString()} chars`
                        : " · no text extracted"}
                    </div>
                    {s.error && (
                      <div className="text-[11px] text-danger truncate">{s.error}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove.mutate(s.source_id)}
                    disabled={remove.isPending}
                    title="Remove"
                    className="p-1.5 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
