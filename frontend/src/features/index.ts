import type { ComponentType, ReactNode } from "react";
import { bag } from "./bag";
import { bargains } from "./bargains";
import { careLabel } from "./care-label";

/**
 * Optional features plug in here and nowhere else. Each one can add routes and a notice
 * pinned in the hallway. To remove a feature: delete its line below and its folder.
 */
export interface Feature {
  id: string;
  enabled: boolean;
  routes: { path: string; element: ReactNode }[];
  HallwayNotice?: ComponentType;
}

export const FEATURES: Feature[] = [
  bargains, // side project: bargain finder. Turn off with VITE_FEATURE_BARGAINS=off
  careLabel, // AI lane: read a care label photo. Turn off with VITE_FEATURE_CARE_LABEL=off
  bag, // the bag + simulated Visa-only checkout. Turn off with VITE_FEATURE_BAG=off
].filter((f) => f.enabled);
