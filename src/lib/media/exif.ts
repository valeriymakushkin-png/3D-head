/**
 * Just enough EXIF to know how a photo was taken: the 35 mm-equivalent focal
 * length. Perspective matters for reconstruction — a selfie at arm's length
 * and a telephoto portrait of the same face have visibly different outlines.
 */
export async function readFocal35(blob: Blob): Promise<number | null> {
  try {
    const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let o = 2;
    while (o + 4 < buf.byteLength) {
      const marker = buf.getUint16(o);
      const len = buf.getUint16(o + 2);
      if (marker === 0xffe1 && buf.getUint32(o + 4) === 0x45786966) return parseTiff(buf, o + 10);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of scan: no EXIF ahead
      o += 2 + len;
    }
  } catch {
    /* unreadable: treat as unknown */
  }
  return null;
}

function parseTiff(v: DataView, t: number): number | null {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p: number) => v.getUint16(t + p, le);
  const u32 = (p: number) => v.getUint32(t + p, le);
  const ifd = (p: number, want: number): { type: number; value: number } | null => {
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      if (u16(e) === want) return { type: u16(e + 2), value: u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8) };
    }
    return null;
  };
  const exifPtr = ifd(u32(4), 0x8769);
  if (!exifPtr) return null;
  const f35 = ifd(exifPtr.value, 0xa405); // FocalLengthIn35mmFilm
  return f35 && f35.value > 5 && f35.value < 600 ? f35.value : null;
}

/** Focal length in units of the image's long side, from a 35 mm-equivalent focal (defined on the 43.3 mm diagonal). */
export function focalFraction(f35: number, width: number, height: number): number {
  const long = Math.max(width, height);
  return (f35 / 43.27) * (Math.hypot(width, height) / long);
}
