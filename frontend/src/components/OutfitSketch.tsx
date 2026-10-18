import { assetUrl } from "../lib/api";
import { RACK_BY_ID, slotOf } from "../lib/racks";
import type { BoardPiece, WornPiece } from "../lib/types";
import { PATHS } from "./Silhouette";

/**
 * A saved outfit drawn as a designer's sketch: a faint pencil croquis, each garment in
 * graphite with a loose watercolour wash of its real colour. Photo cut-outs become
 * charcoal prints. viewBox 0 0 200 300.
 *
 * Positions come from the mirror try-on if the look has one, else from where each kind of
 * piece sits on a body (tops at the chest, shoes at the feet).
 */
const SLOT_AT: Record<string, { x: number; y: number; w: number }> = {
  top: { x: 100, y: 98, w: 78 },
  layer: { x: 100, y: 104, w: 92 },
  onepiece: { x: 100, y: 138, w: 90 },
  bottom: { x: 100, y: 182, w: 62 },
  shoes: { x: 100, y: 284, w: 44 },
  extra: { x: 152, y: 128, w: 30 },
};
const ORDER = ["bottom", "onepiece", "top", "layer", "shoes", "extra"];

interface Placed { key: string; snap: BoardPiece["snap"]; x: number; y: number; w: number; rot: number }

function layout(pieces: BoardPiece[], tryon?: WornPiece[]): Placed[] {
  if (tryon?.length) {
    return [...tryon].sort((a, b) => a.z - b.z).map((t) => ({
      key: t.key, snap: t.snap, x: (t.x / 100) * 200, y: (t.y / 100) * 300, w: (t.w / 100) * 200, rot: t.rot,
    }));
  }
  const used: Record<string, number> = {};
  return [...pieces]
    .sort((a, b) => ORDER.indexOf(slotOf(a.snap.rack)) - ORDER.indexOf(slotOf(b.snap.rack)))
    .map((p) => {
      const slot = slotOf(p.snap.rack);
      const at = SLOT_AT[slot] ?? SLOT_AT.extra;
      const n = (used[slot] = (used[slot] ?? 0) + 1) - 1; // a second top sits a little to the side
      return { key: p.key, snap: p.snap, x: at.x + n * 26, y: at.y + n * 6, w: at.w, rot: n ? 6 : 0 };
    });
}

export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* wobble every line a little, as if drawn by hand */}
        <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
        {/* watercolour: soft, uneven edges and a slightly blotchy fill */}
        <filter id="wash" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="8" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="7" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.8" />
        </filter>
        {/* photos become charcoal: grey, contrasty, paper showing through */}
        <filter id="charcoal">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="gamma" exponent="1.6" amplitude="1.1" />
            <feFuncG type="gamma" exponent="1.6" amplitude="1.1" />
            <feFuncB type="gamma" exponent="1.6" amplitude="1.05" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export function OutfitSketch({ pieces, tryon, className }: { pieces: BoardPiece[]; tryon?: WornPiece[]; className?: string }) {
  const placed = layout(pieces, tryon);
  return (
    <svg viewBox="0 0 200 300" className={className} role="img" aria-label={`Sketch of ${pieces.map((p) => p.snap.name).join(", ")}`}>
      {/* the croquis: a long fashion figure in faint pencil */}
      <g fill="none" stroke="#9a938a" strokeWidth="0.9" strokeLinecap="round" opacity="0.55" filter="url(#pencil)">
        <ellipse cx="100" cy="34" rx="12" ry="15" />
        <path d="M95 48 L94 58 M105 48 L106 58" />
        <path d="M70 66 Q100 56 130 66" />
        <path d="M70 66 L64 112 L60 156 M130 66 L136 112 L140 156" />
        <path d="M76 70 Q84 120 82 132 Q100 140 118 132 Q116 120 124 70" />
        <path d="M82 132 Q78 160 84 176 L90 270 M118 132 Q122 160 116 176 L110 270" />
        <path d="M100 152 L98 270" opacity="0.5" />
      </g>
      {placed.map((p) => {
        const src = assetUrl(p.snap.image_url);
        const size = p.w;
        if (src) {
          return (
            <g key={p.key} transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`}>
              <image href={src} x={-size / 2} y={-size / 2} width={size} height={size} preserveAspectRatio="xMidYMid meet"
                filter="url(#charcoal)" style={{ mixBlendMode: "multiply" }} opacity="0.92" />
            </g>
          );
        }
        const shape = PATHS[RACK_BY_ID[p.snap.rack].shape];
        const s = size / 100;
        return (
          <g key={p.key} transform={`translate(${p.x - size / 2} ${p.y - size / 2}) rotate(${p.rot} ${size / 2} ${size / 2}) scale(${s})`}>
            <path d={shape.body} fill={p.snap.hex} opacity="0.42" filter="url(#wash)" transform="translate(2 2)" />
            <path d={shape.body} fill="none" stroke="#2f2a25" strokeWidth={1.3 / s} strokeLinejoin="round" filter="url(#pencil)" />
            <path d={shape.body} fill="none" stroke="#2f2a25" strokeWidth={0.6 / s} opacity="0.5" transform="translate(0.8 -0.6)" filter="url(#pencil)" />
            {shape.detail && <path d={shape.detail} fill="none" stroke="#2f2a25" strokeWidth={0.8 / s} opacity="0.7" filter="url(#pencil)" />}
          </g>
        );
      })}
    </svg>
  );
}
