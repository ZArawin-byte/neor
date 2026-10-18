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

/** Local uploads come back as "/uploads/..." - prefix them when the API lives elsewhere. */
export const assetUrl = (u?: string | null) => (u && u.startsWith("/") ? `${API}${u}` : u ?? null);

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
    fd.append("file", file, "item.png");
    return call<Partial<Item> & { ai: string }>("/api/items/analyze", { method: "POST", body: fd });
  },
  addItem: (meta: Partial<Item>, file?: Blob) => {
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    if (file) fd.append("file", file, "item.png");
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
