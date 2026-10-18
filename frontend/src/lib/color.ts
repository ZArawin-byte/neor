/**
 * Colour theory, done in OKLCH so "lightness" and "hue distance" match what eyes see
 * (plain HSL thinks yellow and navy are equally light; they are not).
 *
 * Everything here is deterministic so the reasons we print are the actual reasons.
 */

export interface LCH { L: number; C: number; h: number } // L 0-1, C ~0-0.37, h degrees

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "#999999").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.6, 0.6, 0.6];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

export function lch(hex: string): LCH {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), h: (h + 360) % 360 };
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("");
}

/** Mix two colours in OKLab (perceptually even). t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a)), B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]));
}

export const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const bell = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

/**
 * Fashion neutrals are wider than colour-science neutrals: denim, navy, camel, olive and
 * brown all behave like neutrals in an outfit because they sit quietly next to anything.
 */
export function isNeutral(hex: string): boolean {
  const { L, C, h } = lch(hex);
  if (C < 0.045) return true; // white, grey, black, ecru
  if (C < 0.095 && h >= 40 && h <= 95) return true; // camel, tan, khaki, brown, beige (rust/terracotta are more saturated)
  if (L < 0.45 && h >= 230 && h <= 280) return true; // navy, indigo denim
  if (C < 0.09 && h >= 95 && h <= 135 && L < 0.55) return true; // olive
  return false;
}

export function temperature(hex: string): "warm" | "cool" | "neutral" {
  if (isNeutral(hex)) return "neutral";
  const { h } = lch(hex);
  return h < 100 || h > 330 ? "warm" : h > 140 && h < 300 ? "cool" : "neutral";
}

export function hueName(h: number): string {
  const names: [number, string][] = [
    [15, "pink-red"], [40, "red"], [70, "orange"], [100, "yellow-gold"], [130, "yellow-green"],
    [165, "green"], [200, "teal"], [240, "sky blue"], [275, "blue"], [310, "violet"], [345, "magenta"], [360, "pink-red"],
  ];
  return names.find(([max]) => h < max)?.[1] ?? "red";
}

// ---------------------------------------------------------------- outfit harmony

export interface Harmony {
  name: string; // "Complementary", "Tonal neutrals"...
  score: number; // 0-100
  lines: string[]; // plain-English reasons, each one checkable against the swatches
  temperature: "warm" | "cool" | "mixed" | "neutral";
  contrast: "low" | "medium" | "high";
}

/** Score how well a set of garment colours works together, and say why. */
export function harmonyOf(hexes: string[]): Harmony {
  const colours = hexes.filter(Boolean);
  if (colours.length === 0) return { name: "Empty table", score: 0, lines: [], temperature: "neutral", contrast: "low" };

  const chroma = colours.filter((h) => !isNeutral(h));
  const Ls = colours.map((h) => lch(h).L);
  const spread = Math.max(...Ls) - Math.min(...Ls);
  const contrast = spread > 0.45 ? "high" : spread > 0.2 ? "medium" : "low";
  const temps = new Set(chroma.map(temperature).filter((t) => t !== "neutral"));
  const temp = temps.size === 0 ? "neutral" : temps.size === 1 ? ([...temps][0] as "warm" | "cool") : "mixed";

  let name: string;
  let score: number;
  const lines: string[] = [];

  if (chroma.length === 0) {
    name = "Tonal neutrals";
    score = contrast === "low" ? 68 : 84;
    lines.push("Every piece is a neutral, so nothing fights for attention.");
    lines.push(contrast === "low"
      ? "Light and dark values are very close. Add one darker or lighter piece so the outfit has a shape."
      : "There's a clear light-to-dark step between pieces, which keeps an all-neutral look from going flat.");
  } else if (chroma.length === 1) {
    name = "Single accent";
    score = 90;
    lines.push(`One ${hueName(lch(chroma[0]).h)} piece carries all the colour; the neutrals around it frame it.`);
    lines.push("The easiest harmony to wear well: the eye knows exactly where to land.");
  } else {
    const hs = chroma.map((h) => lch(h).h);
    const gaps: number[] = [];
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) gaps.push(hueGap(hs[i], hs[j]));
    const widest = Math.max(...gaps);

    if (widest <= 40) {
      name = "Analogous";
      score = 86;
      lines.push(`Your colours sit within ${Math.round(widest)}° of each other on the wheel. Neighbours blend.`);
    } else if (chroma.length === 2 && widest >= 150) {
      name = "Complementary";
      score = 82;
      lines.push(`The two colours are ${Math.round(widest)}° apart, near-opposites, so each makes the other look brighter.`);
      lines.push("Let one of them dominate (about 70/30) so they don't compete.");
    } else if (chroma.length === 3 && gaps.every((g) => g >= 95 && g <= 145)) {
      name = "Triadic";
      score = 74;
      lines.push("Three colours spaced roughly evenly round the wheel. Bold. Keep two of them small.");
    } else if (chroma.length === 2 && widest >= 100) {
      name = "Split contrast";
      score = 76;
      lines.push(`${Math.round(widest)}° apart: high energy without being a straight clash.`);
    } else {
      name = "Competing colours";
      score = 52 - Math.max(0, chroma.length - 2) * 8;
      lines.push(`${chroma.length} colours up to ${Math.round(widest)}° apart don't share an obvious relationship, so they pull the eye in different directions.`);
      lines.push("Swap one coloured piece for a neutral, or pick colours that sit closer together.");
    }
  }

  if (temp === "mixed" && chroma.length > 1) {
    score -= 4;
    lines.push("You're mixing warm and cool colours. Fine on purpose, but a neutral in between bridges them.");
  }
  if (contrast === "high" && chroma.length > 0) lines.push("Strong light/dark contrast gives a crisp, graphic read from a distance.");

  return { name, score: Math.round(clamp(score, 0, 100)), lines, temperature: temp, contrast };
}

/** How well two single pieces pair. Used when assembling looks piece by piece. */
export function pairScore(a: string, b: string): number {
  if (isNeutral(a) || isNeutral(b)) {
    const dL = Math.abs(lch(a).L - lch(b).L);
    return 0.75 + 0.2 * clamp(dL / 0.4);
  }
  const g = hueGap(lch(a).h, lch(b).h);
  return clamp(Math.max(0.88 * bell(g, 15, 22), 0.8 * bell(g, 180, 25), 0.68 * bell(g, 135, 18), 0.3));
}

// ---------------------------------------------------------------- dressing for a backdrop

export interface Backdrop {
  label: string;
  colors: { hex: string; weight: number }[];
}

export type Mode = "pop" | "blend";
export type Light = "morning" | "midday" | "golden" | "night";

const LIGHT_TINT: Record<Light, { hex: string; t: number; note: string }> = {
  morning: { hex: "#dfe6f0", t: 0.12, note: "soft, slightly cool morning light" },
  midday: { hex: "#ffffff", t: 0.1, note: "flat midday light that bleaches pale colours" },
  golden: { hex: "#f0a24a", t: 0.28, note: "warm golden-hour light that pushes everything amber" },
  night: { hex: "#141a2b", t: 0.35, note: "low evening light where only light or saturated colours register" },
};

export const lightNote = (l: Light) => LIGHT_TINT[l].note;

/** The backdrop as the camera will actually see it at this time of day. */
export function litBackdrop(b: Backdrop, light: Light): Backdrop {
  const { hex, t } = LIGHT_TINT[light];
  return { ...b, colors: b.colors.map((c) => ({ ...c, hex: mix(c.hex, hex, t) })) };
}

function backdropStats(b: Backdrop) {
  const total = b.colors.reduce((s, c) => s + c.weight, 0) || 1;
  const L = b.colors.reduce((s, c) => s + lch(c.hex).L * c.weight, 0) / total;
  // Low bar on purpose: evening light greys colours out, but a dusky blue sky is still blue.
  const chromatic = b.colors.filter((c) => lch(c.hex).C > 0.03).sort((x, y) => y.weight - x.weight)[0];
  return { L, dominant: chromatic ? lch(chromatic.hex) : null };
}

export interface BackdropFit { score: number; reason: string }

/**
 * Pop: stand out from the background (hue opposite + strong value contrast).
 * Blend: look like you belong in the scene (neighbouring hue + gentle contrast).
 */
export function fitOnBackdrop(hex: string, b: Backdrop, mode: Mode): BackdropFit {
  const item = lch(hex);
  const { L: bgL, dominant } = backdropStats(b);
  const dL = Math.abs(item.L - bgL);
  const lighter = item.L > bgL ? "lighter" : "darker";
  const neutral = isNeutral(hex);

  let hueFit: number;
  let hueReason: string;
  if (neutral) {
    hueFit = mode === "pop" ? 0.45 : 0.78;
    hueReason = mode === "pop" ? "A neutral, so it won't clash, but it won't pop either" : "A neutral, so it settles into the scene";
  } else if (!dominant) {
    hueFit = mode === "pop" ? clamp(0.5 + item.C * 3) : 0.55;
    hueReason = mode === "pop"
      ? "Colour against a colourless background: it'll be the brightest thing in frame"
      : "Colour against a colourless background stands out more than it blends";
  } else {
    const gap = hueGap(item.h, dominant.h);
    const bgName = hueName(dominant.h);
    if (mode === "pop") {
      hueFit = Math.max(bell(gap, 180, 40), 0.8 * bell(gap, 145, 22));
      hueReason = gap > 130
        ? `Sits ${Math.round(gap)}° from the ${bgName} backdrop, close to its complement, so it pops on camera`
        : `Only ${Math.round(gap)}° from the ${bgName} backdrop, so it won't separate from it much`;
    } else {
      hueFit = bell(gap, 22, 28);
      hueReason = gap < 50
        ? `${Math.round(gap)}° from the ${bgName} backdrop, a neighbouring hue, so it looks like it belongs there`
        : `${Math.round(gap)}° from the ${bgName} backdrop, so it reads as contrast rather than a blend`;
    }
  }

  const valueFit = mode === "pop" ? clamp(dL / 0.35) : clamp(1 - Math.abs(dL - 0.15) / 0.3);
  const valueReason = dL > 0.3 ? `much ${lighter} than the background, so your outline reads clearly`
    : dL > 0.12 ? `a little ${lighter} than the background` : "about the same brightness as the background";
  const chromaFit = mode === "pop" ? clamp(item.C / 0.15) : clamp(1 - item.C / 0.25);

  const score = clamp(0.55 * hueFit + 0.35 * valueFit + 0.1 * chromaFit);
  return { score, reason: `${hueReason}; ${valueReason}.` };
}
