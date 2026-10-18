import { call } from "../../lib/api";
import type { Item } from "../../lib/types";

/** POST /api/items/care-label. Shapes mirror app/ai_schemas.py CareLabelResult. */
export interface CareLabel {
  text: string;
  fiber_composition: { fiber: string; percent: number | null }[];
  care: {
    wash_temp_c: number | null;
    machine_wash: boolean | null;
    bleach: boolean | null;
    tumble_dry: boolean | null;
    iron: boolean | null;
    dry_clean: boolean | null;
  };
  care_steps: string[];
  source: "label";
  ai: string; // "perceptron" | "groq" | "offline"
  fallback_reason?: string;
  saved_to_item?: boolean;
}

export function readLabel(file: Blob, itemId?: string) {
  const fd = new FormData();
  fd.append("file", file, "label.jpg");
  if (itemId) fd.append("item_id", itemId);
  return call<CareLabel>("/api/items/care-label", { method: "POST", body: fd });
}

export const myItems = () => call<Item[]>("/api/items");
