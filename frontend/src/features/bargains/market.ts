import { call } from "../../lib/api";

/** Client for the bargain market endpoints in app/souq.py. */

export interface Place { name: string; lat: number; lon: number; country?: string }

export interface Shop {
  id: string; // "node/123" (OpenStreetMap) or "google/..." (Google Maps via SerpAPI)
  name: string;
  address: string;
  lat: number;
  lon: number;
  km?: number;
  kind?: string;
  website?: string | null;
}

export interface Offer {
  id: string;
  title: string;
  seller: string;
  url: string;
  price: string;
  image: string | null;
  rating: number | null;
  details: string;
  delivery: string;
  condition: string;
  value?: number | null;
  used?: boolean;
  nearby?: boolean;
  sample?: boolean;
}

export interface Verdict {
  currency: string;
  open_at: number;
  low: number;
  high: number;
  walk_away: number;
  confidence: "good" | "fair" | "rough";
  source: string;
  basis: string[];
}

export interface Estimate {
  currency: string;
  verdict: Verdict | null;
  offers: Offer[];
  paid: Report[];
  online_note: string;
  notice: string;
}

export interface Identified {
  name: string;
  brand: string;
  model: string;
  pages: { title: string; url: string }[];
  similar: string[];
}

export interface Report {
  id: string;
  shop: Shop;
  product_name: string;
  brand: string;
  model: string;
  variant: string;
  currency: string;
  paid: number;
  asking: number | null;
  purchase_date: string;
  notes: string;
  product_key: string;
  created_at: string;
  is_mine: boolean;
  photo_url: string | null;
}

export interface MarketConfig { vision: boolean; shopping: boolean; countries: Record<string, string> }

const post = <T,>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const market = {
  config: () => call<MarketConfig>("/api/souq/config"),
  geocode: (query: string) => post<{ places: Place[] }>("/api/souq/geocode", { query }),
  reverse: (lat: number, lon: number) => post<{ name: string; country: string }>("/api/souq/reverse", { lat, lon }),
  estimate: (query: string, country: string, at: Place | null) =>
    post<Estimate>("/api/souq/estimate", { query, country, city: at?.name.split(",")[0] ?? "", ...(at ? { lat: at.lat, lon: at.lon } : {}) }),
  paid: (query: string, country: string, at: Place | null) =>
    post<{ paid: Report[] }>("/api/souq/paid", { query, country, ...(at ? { lat: at.lat, lon: at.lon } : {}) }),
  nearby: (lat: number, lon: number, category: string) =>
    post<{ stores: Shop[]; notice: string }>("/api/souq/nearby", { lat, lon, category }),
  stores: (query: string, country: string, at?: Place | null) =>
    post<{ stores: Shop[]; notice: string }>("/api/souq/stores", { query, country, ...(at ? { lat: at.lat, lon: at.lon } : {}) }),
  shopping: (query: string, country: string, city: string) =>
    post<{ offers: Offer[]; notice: string }>("/api/souq/shopping", { query, country, city }),
  identify: (file: Blob) => {
    const fd = new FormData();
    fd.append("file", file, "find.jpg");
    return call<Identified>("/api/souq/identify", { method: "POST", body: fd });
  },
  reports: (shopId: string, q = "") =>
    call<{ reports: Report[]; truncated: boolean }>(`/api/souq/reports?shop_id=${encodeURIComponent(shopId)}&q=${encodeURIComponent(q)}`),
  report: (body: Record<string, unknown>) => post<Report>("/api/souq/reports", body),
  removeReport: (id: string) => call<{ ok: true }>(`/api/souq/reports/${id}`, { method: "DELETE" }),
};

export const COUNTRY_NAMES: Record<string, string> = {
  us: "United States", gb: "United Kingdom", ma: "Morocco", fr: "France", de: "Germany", es: "Spain", it: "Italy",
  ca: "Canada", au: "Australia", jp: "Japan", in: "India", th: "Thailand", tr: "Türkiye", mx: "Mexico",
};
export const CURRENCIES = ["USD", "EUR", "GBP", "MAD", "CAD", "AUD", "JPY", "INR", "THB", "TRY", "MXN", "AED", "CNY", "IDR", "VND"];

export const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

/** First number in a listed price like "$1,299.00" or "€24,50 used". null for "See listing". */
export function priceValue(price: string): number | null {
  const m = price.replace(/,(\d{2})\b/, ".$1").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export interface Summary {
  key: string;
  name: string;
  brand: string;
  model: string;
  variant: string;
  currency: string;
  photo: string | null;
  count: number;
  low: number;
  median: number;
  high: number;
  latest: string;
  rows: Report[];
}

/**
 * Groups reports by product + currency (never mixes currencies, and an unknown variant is its
 * own product), newest first, with low / median / high of what people paid.
 */
export function summarize(rows: Report[]): Summary[] {
  const groups = new Map<string, Report[]>();
  for (const r of rows) {
    const key = `${r.product_key}|${r.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    rs.sort((a, b) => b.purchase_date.localeCompare(a.purchase_date) || b.created_at.localeCompare(a.created_at));
    const prices = rs.map((r) => r.paid).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    const first = rs[0];
    return {
      key, name: first.product_name, brand: first.brand, model: first.model, variant: first.variant, currency: first.currency,
      photo: rs.find((r) => r.photo_url)?.photo_url ?? null,
      count: rs.length, low: prices[0], median: Math.round(median * 100) / 100, high: prices[prices.length - 1],
      latest: first.purchase_date, rows: rs,
    };
  }).sort((a, b) => b.latest.localeCompare(a.latest));
}

/** Shrinks a photo to a JPEG the report endpoint accepts (it caps the base64 at ~1MB). */
export async function toJpegBase64(file: Blob, maxSide = 1100): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const data = c.toDataURL("image/jpeg", q).split(",")[1];
    if (data.length < 1_000_000) return data;
  }
  throw new Error("That photo is too large even after shrinking. Try another one.");
}

// Shown when there is no offers key. Always labelled as samples, and named after what you searched.
export const sampleOffers = (q: string): Offer[] => {
  const name = q.trim().replace(/^./, (c) => c.toUpperCase()) || "Your find";
  return [
    { id: "s1", title: `${name}, new`, seller: "Sample shop", url: "#", price: "$18.00", image: null, rating: 4.6, details: "", delivery: "Free delivery", condition: "", sample: true },
    { id: "s2", title: `${name}, vintage`, seller: "Sample secondhand seller", url: "#", price: "$9.00", image: null, rating: 4.3, details: "", delivery: "", condition: "Pre-owned", sample: true },
    { id: "s3", title: `${name}, boutique`, seller: "Sample department store", url: "#", price: "$26.00", image: null, rating: 4.8, details: "", delivery: "Pick up in store", condition: "", sample: true },
  ];
};
