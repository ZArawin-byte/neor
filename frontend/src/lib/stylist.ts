import { fitOnBackdrop, harmonyOf, pairScore, type Backdrop, type Mode } from "./color";
import { guessRack, slotOf, type RackId, type Slot } from "./racks";
import type { Item, Product } from "./types";

/** One wearable thing, from the closet or the shop, flattened so the stylist can treat both the same. */
export interface Piece {
  source: "closet" | "market";
  id: string;
  name: string;
  hex: string;
  rack: RackId;
  image_url?: string | null;
  price?: number;
  brand?: string;
  seasons?: string[];
  occasions?: string[];
  rotation?: number;
}

export const fromItem = (i: Item): Piece => ({
  source: "closet", id: i.id, name: i.name, hex: i.hex || "#b9a68a", rack: guessRack(i),
  image_url: i.image_url, seasons: i.seasons, occasions: i.occasions, rotation: i.rotation,
});

export const fromProduct = (p: Product): Piece => ({
  source: "market", id: p.id, name: p.name, hex: p.hex, rack: guessRack(p), price: p.price, brand: p.brand,
  seasons: p.seasons, occasions: p.occasions,
});

export interface ScoredPiece { piece: Piece; score: number; reason: string }

export interface PlaceLook {
  pieces: ScoredPiece[];
  harmony: ReturnType<typeof harmonyOf>;
  upgrades: { replaces: Piece | null; with: ScoredPiece }[];
}

const WEARABLE_SLOTS: Slot[] = ["top", "bottom", "onepiece", "layer", "shoes"];

/**
 * Builds a look for a backdrop:
 *  1. The hero piece (a top or dress) is whatever scores best against the backdrop.
 *  2. Every following slot is scored 45% on the backdrop and 55% on how it pairs with
 *     what's already chosen, so the outfit agrees with itself, not just with the wall.
 *  3. A layer is only added if it improves the overall harmony score.
 *  4. Shop pieces are suggested only where one beats your own best option by 10+ points.
 */
export function dressForPlace(closet: Piece[], market: Piece[], backdrop: Backdrop, mode: Mode, season?: string): PlaceLook {
  const inSeason = (p: Piece) => !season || !p.seasons?.length || p.seasons.includes("all") || p.seasons.includes(season);
  const pool = (src: Piece[], slots: Slot[]) => src.filter((p) => slots.includes(slotOf(p.rack)) && inSeason(p));

  const scoreWith = (p: Piece, chosen: Piece[]): ScoredPiece => {
    const fit = fitOnBackdrop(p.hex, backdrop, mode);
    if (!chosen.length) return { piece: p, score: fit.score, reason: fit.reason };
    const pair = chosen.reduce((s, c) => s + pairScore(p.hex, c.hex), 0) / chosen.length;
    return { piece: p, score: 0.45 * fit.score + 0.55 * pair, reason: fit.reason };
  };
  const best = (cands: Piece[], chosen: Piece[]) =>
    cands.map((p) => scoreWith(p, chosen)).sort((a, b) => b.score - a.score)[0];

  const chosen: ScoredPiece[] = [];
  const upgrades: PlaceLook["upgrades"] = [];

  const fill = (slots: Slot[], optional = false) => {
    const mine = best(pool(closet, slots), chosen.map((c) => c.piece));
    const shop = best(pool(market, slots), chosen.map((c) => c.piece));
    if (mine) {
      if (optional) {
        const before = harmonyOf(chosen.map((c) => c.piece.hex)).score;
        const after = harmonyOf([...chosen.map((c) => c.piece.hex), mine.piece.hex]).score;
        if (after < before) return;
      }
      chosen.push(mine);
      if (shop && shop.score - mine.score > 0.1) upgrades.push({ replaces: mine.piece, with: shop });
    } else if (shop && !optional) {
      upgrades.push({ replaces: null, with: shop });
    }
  };

  fill(["top", "onepiece"]);
  if (chosen[0] && slotOf(chosen[0].piece.rack) !== "onepiece") fill(["bottom"]);
  fill(["shoes"]);
  fill(["layer"], true);

  return { pieces: chosen, harmony: harmonyOf(chosen.map((c) => c.piece.hex)), upgrades };
}

/**
 * Suggestions for the bookmark table: pieces that harmonise with what's already on it,
 * in slots the table doesn't cover yet. Rule-based, runs instantly, and complements the
 * backend's /api/ai/outfit (which knows occasion and style but not the table).
 */
export function completeTheTable(onTable: Piece[], candidates: Piece[], limit = 6): ScoredPiece[] {
  const filled = new Set(onTable.map((p) => slotOf(p.rack)));
  const tableIds = new Set(onTable.map((p) => p.id));
  const want = WEARABLE_SLOTS.filter((s) => !filled.has(s) && !(s === "onepiece" && (filled.has("top") || filled.has("bottom"))));
  const slots = new Set<Slot>([...want, "extra"]);
  return candidates
    .filter((p) => !tableIds.has(p.id) && slots.has(slotOf(p.rack)))
    .map((p) => {
      const before = harmonyOf(onTable.map((t) => t.hex)).score;
      const after = harmonyOf([...onTable.map((t) => t.hex), p.hex]);
      const gain = onTable.length ? after.score - before : 0;
      const pair = onTable.length ? onTable.reduce((s, t) => s + pairScore(p.hex, t.hex), 0) / onTable.length : 0.6;
      const slotBonus = want.includes(slotOf(p.rack)) ? 0.15 : 0;
      return {
        piece: p,
        score: pair + slotBonus + gain / 100,
        reason: onTable.length ? `Keeps the table ${after.name.toLowerCase()} (${after.score}/100).` : "A good starting piece.",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const NEEDS: Record<Slot, Slot[]> = {
  top: ["bottom", "shoes"],
  bottom: ["top", "shoes"],
  onepiece: ["shoes", "layer"],
  layer: ["top", "bottom", "shoes"],
  shoes: ["top", "bottom"],
  extra: ["top", "bottom", "shoes"],
};

/**
 * Outfits built around one piece from what you already own: each missing slot gets the closet
 * piece that pairs best with everything chosen so far. Later outfits avoid repeating pieces when
 * there's an alternative, so the looks actually differ.
 */
export function outfitsWith(anchor: Piece, closet: Piece[], count = 2): { pieces: Piece[]; harmony: ReturnType<typeof harmonyOf> }[] {
  const used = new Map<string, number>();
  const looks: { pieces: Piece[]; harmony: ReturnType<typeof harmonyOf> }[] = [];
  for (let n = 0; n < count; n++) {
    const chosen: Piece[] = [anchor];
    for (const slot of NEEDS[slotOf(anchor.rack)]) {
      const options = closet.filter((p) => slotOf(p.rack) === slot && !chosen.some((c) => c.id === p.id));
      if (!options.length) continue;
      const score = (p: Piece) =>
        chosen.reduce((s, c) => s + pairScore(p.hex, c.hex), 0) / chosen.length - 0.35 * (used.get(p.id) ?? 0);
      chosen.push(options.reduce((a, b) => (score(b) > score(a) ? b : a)));
    }
    if (chosen.length === 1) break; // nothing in the closet to pair it with
    chosen.slice(1).forEach((p) => used.set(p.id, (used.get(p.id) ?? 0) + 1));
    const key = chosen.map((p) => p.id).sort().join();
    if (looks.some((l) => l.pieces.map((p) => p.id).sort().join() === key)) break; // no new combination left
    looks.push({ pieces: chosen, harmony: harmonyOf(chosen.map((p) => p.hex)) });
  }
  return looks;
}
