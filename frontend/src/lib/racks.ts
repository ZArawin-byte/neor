/**
 * Racks are what the user sees in the closet. The backend only knows coarse categories,
 * so every rack maps down to one of them for the AI.
 */
export type RackId =
  | "shirts" | "tshirts" | "tanks" | "sweaters" | "jackets"
  | "pants" | "shorts" | "skirts" | "dresses"
  | "shoes" | "scarves" | "bags" | "accessories" | "underthings";

export type Silhouette =
  | "shirt" | "tee" | "tank" | "sweater" | "jacket" | "pants" | "shorts"
  | "skirt" | "dress" | "shoe" | "scarf" | "bag" | "ring" | "sock";

export interface Rack {
  id: RackId;
  label: string;
  category: string; // backend category
  shape: Silhouette;
  words: string[]; // name keywords used to guess the rack
}

export const RACKS: Rack[] = [
  { id: "shirts", label: "Shirts", category: "top", shape: "shirt", words: ["shirt", "blouse", "oxford", "button"] },
  { id: "tshirts", label: "T-shirts", category: "top", shape: "tee", words: ["tee", "t-shirt", "tshirt", "crew"] },
  { id: "tanks", label: "Tank tops", category: "top", shape: "tank", words: ["tank", "cami", "vest top", "singlet"] },
  { id: "sweaters", label: "Sweaters", category: "top", shape: "sweater", words: ["sweater", "knit", "hoodie", "cardigan", "jumper", "sweatshirt", "pullover"] },
  { id: "jackets", label: "Jackets", category: "outerwear", shape: "jacket", words: ["jacket", "coat", "blazer", "trench", "puffer", "parka"] },
  { id: "pants", label: "Pants", category: "bottom", shape: "pants", words: ["pant", "jean", "trouser", "legging", "chino", "cargo"] },
  { id: "shorts", label: "Shorts", category: "bottom", shape: "shorts", words: ["short"] },
  { id: "skirts", label: "Skirts", category: "bottom", shape: "skirt", words: ["skirt"] },
  { id: "dresses", label: "Dresses", category: "dress", shape: "dress", words: ["dress", "gown", "jumpsuit"] },
  { id: "shoes", label: "Shoes", category: "shoes", shape: "shoe", words: ["shoe", "sneaker", "boot", "flat", "heel", "trainer", "loafer", "sandal"] },
  { id: "scarves", label: "Scarves", category: "accessory", shape: "scarf", words: ["scarf", "hijab", "shawl"] },
  { id: "bags", label: "Bags", category: "bag", shape: "bag", words: ["bag", "tote", "purse", "crossbody", "backpack"] },
  { id: "accessories", label: "Accessories", category: "accessory", shape: "ring", words: ["earring", "necklace", "ring", "belt", "hat", "cap", "watch", "bracelet", "sunglass"] },
  { id: "underthings", label: "Socks & underwear", category: "accessory", shape: "sock", words: ["sock", "underwear", "bra", "brief", "boxer", "tights"] },
];

export const RACK_BY_ID = Object.fromEntries(RACKS.map((r) => [r.id, r])) as Record<RackId, Rack>;

const CATEGORY_DEFAULT: Record<string, RackId> = {
  top: "tshirts", bottom: "pants", dress: "dresses", outerwear: "jackets",
  shoes: "shoes", bag: "bags", accessory: "accessories", scent: "accessories",
};

/** Best guess from the item name first (most specific), then the backend category. */
export function guessRack(item: { name?: string; category?: string; rack?: string }): RackId {
  if (item.rack && item.rack in RACK_BY_ID) return item.rack as RackId;
  const name = (item.name ?? "").toLowerCase();
  // shorts before pants/shirts: "gym shorts" contains "short", not "shirt"
  const order: RackId[] = ["shorts", "underthings", "tanks", "tshirts", "sweaters", "jackets", "dresses", "skirts",
    "shirts", "pants", "shoes", "scarves", "bags", "accessories"];
  for (const id of order) {
    if (RACK_BY_ID[id].words.some((w) => name.includes(w))) return id;
  }
  return CATEGORY_DEFAULT[item.category ?? ""] ?? "accessories";
}

/** Outfit slots used by the colour engine when it assembles a look. */
export type Slot = "top" | "bottom" | "onepiece" | "layer" | "shoes" | "extra";

export function slotOf(rack: RackId): Slot {
  switch (rack) {
    case "shirts": case "tshirts": case "tanks": case "sweaters": return "top";
    case "pants": case "shorts": case "skirts": return "bottom";
    case "dresses": return "onepiece";
    case "jackets": return "layer";
    case "shoes": return "shoes";
    default: return "extra";
  }
}
