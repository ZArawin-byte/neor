import { api } from "../../lib/api";

export interface Bargain {
  id: string;
  name: string; // shop or listing name
  kind: string; // "Thrift", "Vintage", "Boutique", "Deal"...
  lat: number;
  lon: number;
  note?: string; // why it's worth a look
  price?: string; // e.g. "$12", "40% off" - for real deal listings
  url?: string;
}

/**
 * Where bargains come from. Right now: real clothing shops near the city, from the Neor
 * API's OpenStreetMap search. Plug your bargain service in here; the page only depends
 * on this function and the Bargain shape above.
 */
export async function findBargains(city: string): Promise<{ center: [number, number]; bargains: Bargain[] }> {
  const res = await api.places(city, "thrift stores, vintage shops and affordable clothing boutiques");
  const shops = res.picks.filter((p) => ["clothes", "boutique", "second_hand"].includes(p.kind));
  return {
    center: res.center,
    bargains: (shops.length ? shops : res.picks).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind === "boutique" ? "Boutique" : p.kind === "clothes" ? "Clothing shop" : p.kind,
      lat: p.lat,
      lon: p.lon,
      note: p.why,
    })),
  };
}
