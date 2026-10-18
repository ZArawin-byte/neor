import { call } from "../../lib/api";
import { getToken } from "../../lib/auth";

const API = import.meta.env.VITE_API_URL ?? "";

/** A real listing from Google Shopping: its own photo, price, shop and link. Nothing here is made up. */
export interface ShopResult {
  id: string;
  title: string;
  seller: string;
  url: string;
  price: string; // as the shop shows it, e.g. "$59.97"
  value: number | null;
  image: string;
}

// Each search costs an API call, so results are kept for the session (and in memory between pages).
const SESSION_KEY = "neor.shop.v1";
const results = new Map<string, Promise<ShopResult[]>>();
function stored(): Record<string, ShopResult[]> {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}"); } catch { return {}; }
}

export function shopFor(query: string, n = 6): Promise<ShopResult[]> {
  const key = `${query.toLowerCase()}|${n}`;
  const hit = stored()[key];
  if (hit) return Promise.resolve(hit);
  if (!results.has(key)) {
    const p = call<{ results: ShopResult[] }>(`/api/souq/shop?q=${encodeURIComponent(query)}&n=${n}`)
      .then((r) => {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored(), [key]: r.results })); } catch { /* full or blocked */ }
        return r.results;
      })
      .catch((e) => { results.delete(key); throw e; });
    results.set(key, p);
  }
  return results.get(key)!;
}

/** "Nordstrom Pleated Midi Skirt in Black at Nordstrom Rack, Size Medium" -> "Nordstrom Pleated Midi Skirt in Black" */
export const shortTitle = (t: string) => {
  const s = t.split(/,| \| | - | at (?=[A-Z])/)[0].trim();
  return s.length > 48 ? `${s.slice(0, 46).trimEnd()}…` : s;
};

// Shop photos are shot on a plain studio backdrop, so the backdrop is removed by flooding in from
// the edges over pixels close to the edge colour. That takes a few milliseconds; the AI model used
// for your own photos would freeze the page for seconds per photo. Photos on a busy background
// (a street, a room) are left as they are. Results are data URLs, so a piece dropped on the table
// keeps its cut-out after a reload.
const cutouts = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const breathe = () => new Promise((ok) => setTimeout(ok, 30)); // let clicks and scrolling through between photos

export function cutoutFor(image: string): Promise<string> {
  if (!cutouts.has(image)) {
    const job = queue.then(async () => {
      await breathe();
      const token = await getToken();
      const res = await fetch(`${API}/api/souq/photo?u=${encodeURIComponent(image)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("photo");
      return removeBackdrop(await res.blob());
    });
    queue = job.catch(() => undefined);
    job.catch(() => cutouts.delete(image));
    cutouts.set(image, job);
  }
  return cutouts.get(image)!;
}

async function removeBackdrop(photo: Blob): Promise<string> {
  const bmp = await createImageBitmap(photo);
  const scale = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), px = img.data;

  // The backdrop colour: the average of the border, if the border is close to one colour.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  let r = 0, g = 0, b = 0;
  for (const i of border) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
  r /= border.length; g /= border.length; b /= border.length;
  const far = (i: number, tol: number) => {
    const dr = px[i * 4] - r, dg = px[i * 4 + 1] - g, db = px[i * 4 + 2] - b;
    return dr * dr + dg * dg + db * db > tol * tol;
  };
  if (border.filter((i) => far(i, 40)).length > border.length * 0.2) throw new Error("busy background");

  // Flood from the border through backdrop-coloured pixels.
  const gone = new Uint8Array(w * h), stack: number[] = [];
  for (const i of border) if (!gone[i] && !far(i, 34)) { gone[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      if (j >= 0 && j < w * h && !gone[j] && !far(j, 34)) { gone[j] = 1; stack.push(j); }
    }
  }
  // Keep the garment (and anything big touching it); drop small leftover specks of shadow or backdrop.
  const part = new Int32Array(w * h), sizes = [0];
  for (let s = 0; s < w * h; s++) {
    if (gone[s] || part[s]) continue;
    const id = sizes.length;
    let n = 0;
    part[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w;
      n++;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < w * h && !gone[j] && !part[j]) { part[j] = id; stack.push(j); }
      }
    }
    sizes.push(n);
  }
  const biggest = Math.max(...sizes);
  for (let i = 0; i < w * h; i++) if (!gone[i] && sizes[part[i]] < biggest * 0.15) gone[i] = 1;

  let top = h, left = w, right = 0, bottom = 0;
  for (let i = 0; i < w * h; i++) {
    if (gone[i]) { px[i * 4 + 3] = 0; continue; }
    const x = i % w, y = (i / w) | 0;
    // soften the cut: a pixel touching the backdrop is half see-through
    if (gone[i - 1] || gone[i + 1] || gone[i - w] || gone[i + w]) px[i * 4 + 3] = 150;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right <= left || bottom <= top) throw new Error("nothing left");
  ctx.putImageData(img, 0, 0);

  // Crop to the garment so stickers are sized by it, not by the photo.
  const pad = 4, cw = right - left + 1 + pad * 2, ch = bottom - top + 1 + pad * 2;
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d")!.drawImage(c, left - pad, top - pad, cw, ch, 0, 0, cw, ch);
  const webp = out.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") ? webp : out.toDataURL("image/png");
}
