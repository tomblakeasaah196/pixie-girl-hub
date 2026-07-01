import { useCallback, useState } from "react";

/**
 * Drives the upload progress bars. Wrap an upload call in `run`; it sets
 * `progress` to 0, feeds the `onProgress` callback through to the request, and
 * clears back to null when the promise settles.
 *
 *   const { progress, run } = useUploadProgress();
 *   await run((onProgress) => uploadBrandingImage(file, onProgress));
 *   // …render <UploadProgress value={progress} />
 */
export function useUploadProgress() {
  const [progress, setProgress] = useState<number | null>(null);

  const run = useCallback(
    async <T,>(
      fn: (onProgress: (percent: number) => void) => Promise<T>,
    ): Promise<T> => {
      setProgress(0);
      try {
        return await fn((percent) => setProgress(percent));
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  return { progress, uploading: progress !== null, run, setProgress };
}
