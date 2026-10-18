import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { guessRack, RACKS, type RackId } from "./racks";
import type { Item, Product, Profile } from "./types";

interface ClosetState {
  items: Item[];
  catalog: Product[];
  profile: Profile;
  loading: boolean;
  offline: boolean; // API unreachable: we're showing sample data and changes won't persist
  reload: () => Promise<void>;
  add: (item: Item) => void;
  patch: (id: string, patch: Partial<Item>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setProfile: (p: Profile) => void;
}

const Ctx = createContext<ClosetState | null>(null);

// Mirrors app/seed.py STARTER_CLOSET so offline mode looks like the real thing.
const SAMPLE: Item[] = [
  { id: "s1", name: "Grey Crew Tee", category: "top", hex: "#a7a9ac", seasons: ["all"], occasions: ["everyday", "uni", "gym"] },
  { id: "s2", name: "Black Skinny Jeans", category: "bottom", hex: "#222226", seasons: ["all"], occasions: ["everyday", "uni"] },
  { id: "s3", name: "Navy Hoodie", category: "top", hex: "#26324f", seasons: ["fall", "winter"], occasions: ["everyday"] },
  { id: "s4", name: "Pink Blouse", category: "top", hex: "#e9b7bd", seasons: ["spring", "summer"], occasions: ["birthday"] },
  { id: "s5", name: "Denim Jacket", category: "outerwear", hex: "#7d9cc4", seasons: ["spring", "fall"], occasions: ["everyday"] },
  { id: "s6", name: "Canvas Sneakers", category: "shoes", hex: "#f4f4f4", seasons: ["all"], occasions: ["everyday"] },
  { id: "s7", name: "Black Midi Skirt", category: "bottom", hex: "#1c1c1e", seasons: ["all"], occasions: ["uni", "birthday"] },
  { id: "s8", name: "Rust Cable Sweater", category: "top", hex: "#a4532f", seasons: ["fall", "winter"], occasions: ["everyday"] },
  { id: "s9", name: "Cream Wide Trousers", category: "bottom", hex: "#e8dfcc", seasons: ["spring", "summer"], occasions: ["everyday"] },
  { id: "s10", name: "Sage Linen Shirt", category: "top", hex: "#9caf88", seasons: ["spring", "summer"], occasions: ["everyday"] },
].map((i) => ({ ...i, rack: guessRack(i) }));

const SAMPLE_CATALOG: Product[] = [
  { id: "p02", name: "Camel Wool Coat", brand: "Cair Tailors", category: "outerwear", color: "camel", hex: "#c19a6b", price: 240, material: "80% wool, 20% cashmere", tier: "S", styles: ["classic"], occasions: ["everyday"], seasons: ["fall", "winter"], modest: true },
  { id: "p09", name: "White Leather Sneakers", brand: "Faun Footwear", category: "shoes", color: "white", hex: "#fafafa", price: 120, material: "Full-grain leather", tier: "A", styles: ["classic"], occasions: ["everyday"], seasons: ["all"], modest: true },
  { id: "p10", name: "Chelsea Boots", brand: "Faun Footwear", category: "shoes", color: "brown", hex: "#5a3a22", price: 165, material: "Suede", tier: "S", styles: ["classic"], occasions: ["everyday"], seasons: ["fall", "winter"], modest: true },
  { id: "p19", name: "Pleated Maxi Skirt", brand: "Lucy's Garden", category: "bottom", color: "forest", hex: "#2f4a3a", price: 76, material: "Recycled chiffon", tier: "B", styles: ["romantic"], occasions: ["everyday"], seasons: ["all"], modest: true },
  { id: "p20", name: "Silk Square Scarf", brand: "Lamplight & Co", category: "accessory", color: "gold", hex: "#c9a227", price: 55, material: "Mulberry silk", tier: "S", styles: ["classic"], occasions: ["everyday"], seasons: ["all"], modest: true },
  { id: "p26", name: "Puffer Jacket", brand: "Lantern Waste", category: "outerwear", color: "ice blue", hex: "#bcd4e6", price: 180, material: "Recycled nylon", tier: "A", styles: ["street"], occasions: ["everyday"], seasons: ["winter"], modest: true },
];

export function ClosetProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [its, cat, prof] = await Promise.all([api.items(), api.catalog(), api.profile()]);
      setItems(its.map((i) => ({ ...i, rack: guessRack(i) })));
      setCatalog(cat);
      setProfile(prof);
      setOffline(false);
    } catch {
      setItems(SAMPLE);
      setCatalog(SAMPLE_CATALOG);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo<ClosetState>(() => ({
    items, catalog, profile, loading, offline, reload, setProfile,
    add: (item) => setItems((xs) => [{ ...item, rack: guessRack(item) }, ...xs]),
    async patch(id, p) {
      setItems((xs) => xs.map((i) => (i.id === id ? { ...i, ...p } : i))); // optimistic
      if (!offline) await api.patchItem(id, p).catch(() => reload());
    },
    async remove(id) {
      setItems((xs) => xs.filter((i) => i.id !== id));
      if (!offline) await api.deleteItem(id).catch(() => reload());
    },
  }), [items, catalog, profile, loading, offline, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloset() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCloset outside ClosetProvider");
  return ctx;
}

/** Racks that exist for this user - a rack only appears once something hangs on it. */
export function useRacks(): { id: RackId; items: Item[] }[] {
  const { items } = useCloset();
  return useMemo(() => {
    const by = new Map<RackId, Item[]>();
    for (const i of items) {
      const r = guessRack(i);
      by.set(r, [...(by.get(r) ?? []), i]);
    }
    return RACKS.filter((r) => by.has(r.id)).map((r) => ({ id: r.id, items: by.get(r.id)! }));
  }, [items]);
}
