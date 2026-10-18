import { getToken } from "./auth";
import type { Item, OutfitResult, PlacesResult, Product, Profile, WeakSpots } from "./types";

const API = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Exported so feature modules (src/features/*) can add their own endpoints without editing this file. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  return res.json();
}

export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/**
 * Closet photos are private: Supabase hands out signed links that expire after an hour. Boards,
 * the mirror and the archive keep a copy of the link they were given, so once it expires the photo
 * breaks. The file path inside the link never changes, so remember the newest link per path and
 * swap stale ones for it.
 */
const freshLinks = new Map<string, string>();
const signedPath = (u: string) => u.match(/\/storage\/v1\/object\/sign\/([^?]+)/)?.[1];
export function rememberFreshLinks(urls: (string | null | undefined)[]) {
  for (const u of urls) { const p = u && signedPath(u); if (p) freshLinks.set(p, u!); }
}

/** Local uploads come back as "/uploads/..." - prefix them when the API lives elsewhere. */
export const assetUrl = (u?: string | null) => {
  if (!u) return null;
  if (u.startsWith("/")) return `${API}${u}`;
  const p = signedPath(u);
  return (p && freshLinks.get(p)) || u;
};

export const api = {
  profile: () => call<Profile>("/api/profile"),
  saveProfile: (patch: Partial<Profile>) => call<Profile>("/api/profile", json("PUT", patch)),
  uploadMirror: (file: Blob) => {
    const fd = new FormData();
    fd.append("file", file, "mirror.png");
    return call<Profile>("/api/profile/mirror", { method: "POST", body: fd });
  },

  items: () => call<Item[]>("/api/items"),
  analyze: (file: Blob) => {
    const fd = new FormData();
    fd.append("file", file, `item.${file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : "png"}`);
    return call<Partial<Item> & { ai: string }>("/api/items/analyze", { method: "POST", body: fd });
  },
  addItem: (meta: Partial<Item>, file?: Blob) => {
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    if (file) fd.append("file", file, `item.${file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : "png"}`);
    return call<Item>("/api/items", { method: "POST", body: fd });
  },
  /** Reads a product page (or image link) server-side and returns its photo as a data URL. */
  importLink: (url: string) => call<{ title: string; price: string | null; source: string; image: string }>("/api/items/import", json("POST", { url })),
  patchItem: (id: string, patch: Partial<Item>) => call<{ ok: true }>(`/api/items/${id}`, json("PATCH", patch)),
  deleteItem: (id: string) => call<{ ok: true }>(`/api/items/${id}`, { method: "DELETE" }),
  starterCloset: () => call<Item[]>("/api/items/starter", { method: "POST" }),

  catalog: () => call<Product[]>("/api/catalog"),
  outfit: (req: { occasion: string; place?: string; season?: string }) => call<OutfitResult>("/api/ai/outfit", json("POST", req)),
  weakSpots: () => call<WeakSpots>("/api/ai/weak-spots", { method: "POST" }),
  places: (city: string, vibe?: string) => call<PlacesResult>("/api/ai/places", json("POST", { city, vibe })),
  forgetMe: () => call<{ ok: true }>("/api/me", { method: "DELETE" }),
};
