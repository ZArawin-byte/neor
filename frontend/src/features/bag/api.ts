import { call, json } from "../../lib/api";
import type { Product } from "../../lib/types";

/** A bag entry. kind "product" can be checked out; kind "idea" is just a note ("black ankle boots"). */
export interface BagEntry {
  id: string;
  catalog_id?: string | null;
  title: string;
  reason: string;
  source: "outfit" | "critique" | "chat" | "window" | "manual";
  source_ref?: string | null;
  priority: "low" | "medium" | "high";
  status: "wanted" | "bought" | "dropped";
  kind: "product" | "idea";
  product: Product | null;
}

export interface Order {
  id: string;
  created: string;
  items: { id: string; name: string; price: number; brand: string }[];
  total: number;
  card: { network: string; last4: string; token: string };
  payment_mode: "simulated";
  notice: string;
  points_earned: number;
}

export interface Card { number: string; exp: string; cvc: string; name: string }

export const bagApi = {
  list: () => call<BagEntry[]>("/api/bag?status=wanted"),
  remove: (id: string) => call<{ ok: true }>(`/api/bag/${id}`, { method: "DELETE" }),
  summary: () => call<{ budget: number | null; spent_this_month: number; points: number }>("/api/orders"),
  checkout: (bagIds: string[], card: Card, idempotencyKey: string, confirmOverBudget = false) =>
    call<Order>("/api/checkout", {
      ...json("POST", { bag_ids: bagIds, card, confirm_over_budget: confirmOverBudget }),
      headers: { "Idempotency-Key": idempotencyKey },
    }),
};

/**
 * For other pages: put a catalog product (or a plain idea) in the bag, with the reason it was suggested.
 * Adding the same product twice returns the existing entry.
 */
export function addToBag(entry: {
  catalog_id?: string;
  title?: string;
  reason?: string;
  source?: BagEntry["source"];
  source_ref?: string;
  priority?: BagEntry["priority"];
}) {
  return call<BagEntry>("/api/bag", json("POST", entry));
}
