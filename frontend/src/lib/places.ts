import type { Backdrop } from "./color";
import type { PlacePick } from "./types";

/**
 * What a place looks like behind you in a photo. OpenStreetMap gives us a "kind"
 * (cafe, park, viewpoint...) but no pictures, so each kind gets a measured palette:
 * the colours that typically fill the frame, weighted by how much of it they cover.
 * Known demo spots override this with palettes sampled from real photos of them.
 */
export const KIND_BACKDROPS: Record<string, Backdrop> = {
  cafe: { label: "Warm cafe interior", colors: [{ hex: "#7a5236", weight: 4 }, { hex: "#e9dcc6", weight: 3 }, { hex: "#2e2520", weight: 2 }, { hex: "#c98f4e", weight: 1 }] },
  park: { label: "Park greenery", colors: [{ hex: "#4f7a3a", weight: 5 }, { hex: "#a8c27a", weight: 2 }, { hex: "#8fb3d9", weight: 2 }, { hex: "#6b5a44", weight: 1 }] },
  garden: { label: "Garden beds", colors: [{ hex: "#3f6b35", weight: 4 }, { hex: "#d98fa0", weight: 2 }, { hex: "#f1e3a0", weight: 1 }, { hex: "#8b6b4a", weight: 1 }] },
  viewpoint: { label: "Open sky and skyline", colors: [{ hex: "#9cc0e0", weight: 5 }, { hex: "#5a6a7e", weight: 3 }, { hex: "#d9dde3", weight: 2 }] },
  museum: { label: "Gallery walls", colors: [{ hex: "#f2efe9", weight: 6 }, { hex: "#bdb6aa", weight: 2 }, { hex: "#3a3a3a", weight: 1 }] },
  gallery: { label: "White-cube gallery", colors: [{ hex: "#f5f4f0", weight: 7 }, { hex: "#c9c5bd", weight: 2 }] },
  artwork: { label: "Mural / public art", colors: [{ hex: "#d0463a", weight: 3 }, { hex: "#2f6db3", weight: 3 }, { hex: "#f2c23a", weight: 2 }, { hex: "#8a8a86", weight: 2 }] },
  attraction: { label: "Brick and street", colors: [{ hex: "#8e4b38", weight: 4 }, { hex: "#6e6a64", weight: 3 }, { hex: "#c8bfb2", weight: 2 }] },
  clothes: { label: "Shopfront", colors: [{ hex: "#e8e4dc", weight: 4 }, { hex: "#2b2b2b", weight: 3 }, { hex: "#b89a6a", weight: 1 }] },
  boutique: { label: "Boutique interior", colors: [{ hex: "#efe6da", weight: 4 }, { hex: "#c9a27a", weight: 2 }, { hex: "#4a3b33", weight: 1 }] },
};

export const backdropFor = (p: { kind: string; backdrop?: Backdrop }): Backdrop =>
  p.backdrop ?? KIND_BACKDROPS[p.kind] ?? KIND_BACKDROPS.attraction;

export const KIND_LABEL: Record<string, string> = {
  cafe: "Cafe", park: "Park", garden: "Garden", viewpoint: "Viewpoint", museum: "Museum",
  gallery: "Gallery", artwork: "Public art", attraction: "Landmark", clothes: "Shop", boutique: "Boutique",
};

export type Spot = PlacePick & { backdrop?: Backdrop };

/** Used when the API (or the Overpass mirror) is down, so the window never opens onto nothing. Seattle, for DubHacks. */
export const DEMO_CITY = "Seattle, WA";
export const DEMO_CENTER: [number, number] = [47.638, -122.33];
export const DEMO_SPOTS: Spot[] = [
  {
    id: "demo/kerry", name: "Kerry Park", kind: "viewpoint", lat: 47.6295, lon: -122.3599,
    why: "The postcard view: Space Needle, downtown and (on a clear day) Rainier.",
    photo_tip: "Stand at the railing and shoot slightly upward so the skyline sits at your shoulders.",
    backdrop: { label: "Skyline over the Sound", colors: [{ hex: "#a9c6e2", weight: 5 }, { hex: "#56677d", weight: 3 }, { hex: "#e7e2d8", weight: 1 }, { hex: "#4d6b3c", weight: 1 }] },
  },
  {
    id: "demo/gasworks", name: "Gas Works Park", kind: "park", lat: 47.6456, lon: -122.3344,
    why: "Rusted industrial towers against green hills and the lake.",
    photo_tip: "Use the rust towers as a frame; the orange-brown loves a cool-toned outfit.",
    backdrop: { label: "Rust towers and lawn", colors: [{ hex: "#8a4a2c", weight: 4 }, { hex: "#5f8a45", weight: 3 }, { hex: "#9fb6cc", weight: 2 }, { hex: "#3b3632", weight: 1 }] },
  },
  {
    id: "demo/suzzallo", name: "Suzzallo Library", kind: "attraction", lat: 47.6557, lon: -122.3081,
    why: "The reading room: gothic arches, stained glass, long oak tables.",
    photo_tip: "Sit at a table end so the arches stack behind you. No flash.",
    backdrop: { label: "Oak and stone reading room", colors: [{ hex: "#6e4a2e", weight: 4 }, { hex: "#c7b48f", weight: 3 }, { hex: "#2d2620", weight: 2 }, { hex: "#c9a95c", weight: 1 }] },
  },
  {
    id: "demo/allegro", name: "Cafe Allegro", kind: "cafe", lat: 47.6588, lon: -122.3134,
    why: "Seattle's oldest espresso bar, tucked in an alley, all dark wood and brick.",
    photo_tip: "Window seat in the afternoon; side light, warm wood behind you.",
    backdrop: { label: "Dark wood and brick", colors: [{ hex: "#4a3123", weight: 4 }, { hex: "#8e4b38", weight: 3 }, { hex: "#e2c9a0", weight: 2 }] },
  },
  {
    id: "demo/conservatory", name: "Volunteer Park Conservatory", kind: "garden", lat: 47.6326, lon: -122.3155,
    why: "A Victorian glasshouse full of palms and orchids.",
    photo_tip: "Shoot down the centre aisle with the glass roof catching the light.",
    backdrop: { label: "Glasshouse greens", colors: [{ hex: "#3d6e3a", weight: 5 }, { hex: "#e8ede6", weight: 2 }, { hex: "#d46a8a", weight: 1 }, { hex: "#a3c47a", weight: 2 }] },
  },
  {
    id: "demo/pike", name: "Pike Place Market", kind: "attraction", lat: 47.6097, lon: -122.3422,
    why: "The neon sign, the flower stalls, the busy arcade.",
    photo_tip: "Under the red neon clock at dusk. Wear something light so you don't vanish.",
    backdrop: { label: "Red neon and market stalls", colors: [{ hex: "#c8352e", weight: 3 }, { hex: "#3a3633", weight: 4 }, { hex: "#e8c76a", weight: 2 }, { hex: "#7aa0b8", weight: 1 }] },
  },
];
