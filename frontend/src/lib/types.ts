import type { RackId } from "./racks";

/** A closet item as returned by GET /api/items. `rack` and `laundry` are frontend fields stored in item data. */
export interface Item {
  id: string;
  name: string;
  category: string; // backend's coarse category: top | bottom | dress | outerwear | shoes | bag | accessory | scent
  rack?: RackId; // the fine-grained rack the user sees
  laundry?: boolean; // in the basket: still owned, but AI skips it
  rotation?: number; // degrees the photo is turned, so a sideways shot hangs upright
  color?: string;
  hex?: string;
  material?: string;
  styles?: string[];
  seasons?: string[];
  occasions?: string[];
  image_url?: string | null;
  brand?: string;
  price?: number;
  status?: string;
  starter?: boolean;
}

/** A product from GET /api/catalog. */
export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  color: string;
  hex: string;
  price: number;
  material: string;
  tier: string;
  styles: string[];
  occasions: string[];
  seasons: string[];
  modest: boolean;
}

export interface Profile {
  name?: string;
  mirror_url?: string | null;
  points?: number;
  styles?: string[];
  [k: string]: unknown;
}

/** Everything needed to draw a piece, copied at save time so old boards survive deleted items. */
export interface PieceSnapshot {
  name: string;
  hex: string;
  rack: RackId;
  image_url?: string | null;
  price?: number;
  brand?: string;
  rotation?: number;
}

export interface BoardPiece {
  key: string; // unique per placement - the same shirt can sit on the table twice
  source: "closet" | "market";
  refId: string; // item id or catalog id
  x: number; // 0-100, % of table width (piece centre)
  y: number; // 0-100, % of table height
  rot: number; // degrees, a little tilt so it reads as a pinned sticker
  snap: PieceSnapshot;
}

/** A piece placed on the user's mirror photo. x/y are its centre and w its width, all in % of the photo. */
export interface WornPiece {
  key: string;
  snap: PieceSnapshot;
  x: number;
  y: number;
  w: number;
  /** Height in % of the mirror when a drawn garment is stretched to fit the body; absent = natural shape. */
  h?: number;
  rot: number;
  z: number;
}

export interface Board {
  id: string;
  name: string;
  pieces: BoardPiece[];
  savedAt: string;
}

export interface Look {
  id: string;
  name: string;
  pieces: BoardPiece[];
  photo?: string | null;
  tryon?: WornPiece[];
  verdict: string;
  harmony: string;
  occasion?: string;
  favorite: boolean;
  /** 1-5 stars, set on the archive board. Missing = not rated yet. */
  rating?: number;
  savedAt: string;
}

export interface OutfitResult {
  title: string;
  vibe: string;
  closet_ids: string[];
  why: string;
  styling_tip: string;
  scent?: string;
  missing: { catalog_id: string; why: string }[];
  cultural_note?: string;
  ai: string;
}

export interface WeakSpots {
  summary: string;
  score: number;
  gaps: { gap: string; why: string; priority: "high" | "medium" | "low"; unlocks: number; catalog_ids: string[] }[];
  ai: string;
}

export interface PlacePick {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  why?: string;
  outfit_tip?: string;
  photo_tip?: string;
}

export interface PlacesResult {
  intro: string;
  picks: PlacePick[];
  center: [number, number];
  ai: string;
}
