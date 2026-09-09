/**
 * Employee-document viewer — shared by HR's Employee → Documents tab and the
 * employee's own My HR page.
 *
 * These files are HR-gated, so the bytes can't be reached by an <img src> or
 * <iframe src>: the access token lives in memory, not in a cookie the browser
 * would attach. The caller passes a `fetchBlob` that carries the auth headers,
 * and this drawer turns the result into an object URL, revoking it when the
 * document changes or the drawer closes so browsing a long list doesn't leak
 * blobs.
 */

import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
import { Card, Button, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { fileSize, errMsg } from "./hr-shared";
import type { StaffDocument } from "@/lib/hr-api";

function docDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DocumentPreviewDrawer({
  doc,
  fetchBlob,
  onClose,
  onDownload,
}: {
  /** The document to show; null closes the drawer. */
  doc: StaffDocument | null;
  /** Authenticated fetch of the preview bytes for `documentId`. */
  fetchBlob: (documentId: string) => Promise<Blob>;
  onClose: () => void;
  onDownload: (d: StaffDocument) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const documentId = doc?.document_id ?? null;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    fetchBlob(documentId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // fetchBlob is a closure over the caller's ids; keying on documentId is
    // what actually decides when a refetch is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return (
    <Drawer
      open={Boolean(doc)}
      onClose={onClose}
      wide
      title={doc?.title || doc?.type_label || "Document"}
      subtitle={
        doc
          ? `${doc.type_label} · ${fileSize(doc.file_size_bytes)} · ${docDate(doc.created_at)}`
          : undefined
      }
      footer={
        doc ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => onDownload(doc)}
            >
              Download
            </Button>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <Card className="p-4 text-sm text-danger">{error}</Card>
      ) : !url ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : doc?.is_image ? (
        <img
          src={url}
          alt={doc.title || doc.type_label}
          className="mx-auto max-h-[70vh] rounded-xl border border-line object-contain"
        />
      ) : doc?.is_pdf ? (
        <iframe
          src={url}
          title={doc.title || doc.type_label}
          className="h-[70vh] w-full rounded-xl border border-line bg-white"
        />
      ) : (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No preview for this file type"
          message="Download it to open in another app."
        />
      )}
    </Drawer>
  );
}
