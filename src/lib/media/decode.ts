"use client";

/**
 * Decodes an image Blob/File to something drawable, upright (EXIF honoured).
 *
 * `createImageBitmap(blob, { imageOrientation })` is the fast path, but older
 * WebKit rejects the "from-image" value and some builds can't decode HEIC
 * through it; an <img> element always applies EXIF orientation and uses the
 * platform decoders, so it is the fallback.
 */
export async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    /* fall through */
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
