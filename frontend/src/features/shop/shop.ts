import { call } from "../../lib/api";
import { getToken } from "../../lib/auth";
import { cutOut } from "../../lib/cutout";

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

// Background removal runs one photo at a time (it's heavy) and each result is kept as a data URL,
// so a piece dropped on the table still shows its cut-out after a reload.
const cutouts = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

export function cutoutFor(image: string): Promise<string> {
  if (!cutouts.has(image)) {
    const job = queue.then(async () => {
      const token = await getToken();
      const res = await fetch(`${API}/api/souq/photo?u=${encodeURIComponent(image)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("photo");
      const { blob, removed } = await cutOut(await res.blob());
      if (!removed) throw new Error("not cut");
      return new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = bad;
        r.readAsDataURL(blob);
      });
    });
    queue = job.catch(() => undefined);
    job.catch(() => cutouts.delete(image));
    cutouts.set(image, job);
  }
  return cutouts.get(image)!;
}
