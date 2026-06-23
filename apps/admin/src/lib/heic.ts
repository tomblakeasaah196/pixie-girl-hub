/**
 * Client-side HEIC handling.
 *
 * The backend converts HEIC → JPEG for everything that's uploaded, but a few
 * flows render the *raw* picked file in the browser before upload (e.g. the
 * avatar crop preview). Browsers other than Safari can't decode HEIC, so those
 * previews break. This helper converts a HEIC file to a JPEG File on the client
 * first — lazily importing heic2any (which carries a wasm decoder) only when a
 * HEIC is actually picked, so it never weighs down a normal page load.
 */

const HEIC_MIME = /^image\/hei(c|f)(-sequence)?$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

export function isHeicFile(file: File): boolean {
  return HEIC_MIME.test(file.type) || HEIC_EXT.test(file.name);
}

/**
 * Return a browser-viewable image File. HEIC inputs are converted to JPEG;
 * everything else (and any conversion failure) is returned unchanged so the
 * upload still reaches the server, which can convert it too.
 */
export async function toViewableImage(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    const name = file.name.replace(HEIC_EXT, "") || "image";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    // Couldn't decode locally — hand back the original; the server still
    // converts it, only the local preview is unavailable.
    return file;
  }
}
