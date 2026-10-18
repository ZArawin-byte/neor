/**
 * Turns a phone photo into a sticker: background removed in the browser (no upload of the
 * raw photo needed), then trimmed to the garment. Falls back to the original photo if the
 * model can't load (offline, old browser) - the upload flow must never dead-end.
 *
 * The model (~40MB) downloads from the imgly CDN on first use and is cached by the browser.
 */
export async function cutOut(file: Blob, onProgress?: (pct: number) => void): Promise<{ blob: Blob; removed: boolean }> {
  try {
    const { removeBackground } = await import("@imgly/background-removal");
    const out = await removeBackground(file, {
      output: { format: "image/png" },
      progress: (_key: string, current: number, total: number) => onProgress?.(total ? current / total : 0),
    });
    return { blob: await shrink(await trim(out)), removed: true };
  } catch (err) {
    console.warn("Background removal unavailable, keeping the original photo", err);
    return { blob: await shrink(file).catch(() => file), removed: false };
  }
}

/** Crop transparent edges so every sticker is sized by the garment, not the photo. */
async function trim(png: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  let top = height, left = width, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right <= left || bottom <= top) return png;
  const pad = Math.round(Math.max(width, height) * 0.02);
  const w = Math.min(width, right - left + pad * 2), h = Math.min(height, bottom - top + pad * 2);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(canvas, Math.max(0, left - pad), Math.max(0, top - pad), w, h, 0, 0, w, h);
  return new Promise((resolve) => out.toBlob((b) => resolve(b ?? png), "image/png"));
}

/** Average colour of the opaque pixels - used when the AI tagger is offline and returns no hex. */
export async function dominantHex(img: Blob): Promise<string> {
  const bmp = await createImageBitmap(img);
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, 48, 48);
  const { data } = ctx.getImageData(0, 0, 48, 48);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return "#b9a68a";
  return "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
}

/**
 * Phone photos are 12+ megapixels; as a transparent PNG a cut-out can pass the server's 8MB cap
 * (and Groq vision's own limit), which made tagging fail. Stickers never need more than ~1400px.
 */
export async function shrink(img: Blob, maxSide = 1400): Promise<Blob> {
  const bmp = await createImageBitmap(img);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && img.size < 2_000_000) return img;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const as = (type: string, q?: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));
  // WebP keeps the transparency at a fraction of PNG's size; PNG if the browser can't write WebP.
  const webp = await as("image/webp", 0.9);
  return webp && webp.type === "image/webp" ? webp : (await as("image/png")) ?? img;
}
