import type { ReactNode } from "react";
import { MASCOT } from "../lib/mascot";

/**
 * The inside of the wardrobe, drawn as one SVG in one-point perspective (viewBox 1600x900,
 * vanishing point at 800,410). The only thing outside is what you see through the window:
 * a snowy pine wood and a lamppost.
 *
 * Each clickable object is a <Hot> group; Room.tsx supplies the handlers and the tags.
 */

export type SpotId = "archive" | "profile" | "closet" | "window" | "lion" | "mirror" | "market" | "lazy";

// Back wall rectangle. Everything else is built from these four edges.
const BW = { l: 600, r: 1000, t: 230, b: 590 };

/** A point on the left wall: x across (0 = near edge, 600 = far corner), v down (0 = ceiling, 1 = floor). */
function Lw(x: number, v: number): [number, number] {
  const top = (BW.t / BW.l) * x, bottom = 900 - ((900 - BW.b) / BW.l) * x;
  return [x, top + v * (bottom - top)];
}
/** Same for the right wall, mirrored. */
function Rw(x: number, v: number): [number, number] {
  const d = 1600 - x;
  const top = (BW.t / BW.l) * d, bottom = 900 - ((900 - BW.b) / BW.l) * d;
  return [x, top + v * (bottom - top)];
}
const quad = (...pts: [number, number][]) => `M${pts.map((p) => p.join(" ")).join(" L")} Z`;
/** How big something is at this x on the left wall, relative to the near edge. */
const scaleAt = (x: number) => 1 - (x / BW.l) * (1 - (BW.b - BW.t) / 900);

interface HotProps {
  id: SpotId;
  active: SpotId | null;
  onEnter: (id: SpotId) => void;
  onLeave: () => void;
  onOpen: (id: SpotId) => void;
  onContext?: (e: React.MouseEvent) => void;
  label: string;
  children: ReactNode;
}

function Hot({ id, active, onEnter, onLeave, onOpen, onContext, label, children }: HotProps) {
  return (
    <g
      className={`hot ${active === id ? "is-on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
      onFocus={() => onEnter(id)}
      onBlur={onLeave}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(id))}
      onContextMenu={onContext}
    >
      {children}
    </g>
  );
}

// ---------------------------------------------------------------- pieces of furniture

const COATS = [
  { x: 520, fill: "#6b5a4a", fur: true },
  { x: 470, fill: "#2f3b2f", fur: false },
  { x: 425, fill: "#efe4d0", fur: true },
  { x: 375, fill: "#5c1e1d", fur: false },
  { x: 322, fill: "#8a6a4a", fur: true },
  { x: 268, fill: "#3b3a3f", fur: false },
  { x: 210, fill: "#c9b08a", fur: true },
  { x: 148, fill: "#4a2f22", fur: true },
  { x: 88, fill: "#2a3446", fur: false },
];
const RAIL_V = 0.34;
const COAT = "M30 16 L56 8 L82 16 L102 36 L108 120 L112 338 Q84 348 56 344 Q28 348 0 338 L4 120 L10 36 Z";

function Coat({ x, fill, fur }: { x: number; fill: string; fur: boolean }) {
  const [, ry] = Lw(x, RAIL_V);
  const s = scaleAt(x);
  const w = 112 * s;
  return (
    <g transform={`translate(${x - w / 2} ${ry}) scale(${s})`}>
      <path d="M56 6 Q56 -6 62 -10" fill="none" stroke="#c9a463" strokeWidth="3" />
      <path d="M18 24 L56 6 L94 24" fill="none" stroke="#5a4020" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={COAT} fill={fill} filter={fur ? "url(#fur)" : undefined} />
      <path d={COAT} fill="url(#coatShade)" />
      {/* sleeves, lapels and the front edge, so each one reads as a coat */}
      <path d="M16 46 Q12 160 20 268 M96 46 Q100 160 92 268" fill="none" stroke="#000" strokeOpacity="0.28" strokeWidth="3" />
      <path d="M40 16 L56 96 L72 16" fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="3" strokeLinejoin="round" />
      <path d="M56 96 L57 342" stroke="#000" strokeOpacity="0.25" strokeWidth="2" />
      {!fur && [130, 180, 230].map((y) => <circle key={y} cx="62" cy={y} r="3" fill="#000" opacity="0.35" />)}
    </g>
  );
}

function Pine({ x, y, h, tone = "#1d3529" }: { x: number; y: number; h: number; tone?: string }) {
  const w = h * 0.42;
  return (
    <g>
      {[0, 0.28, 0.52].map((k, i) => {
        const top = y - h + k * h, base = top + h * 0.48, ww = w * (0.55 + k);
        return (
          <g key={i}>
            <path d={`M${x} ${top} L${x + ww / 2} ${base} L${x - ww / 2} ${base} Z`} fill={tone} />
            <path d={`M${x} ${top} L${x + ww * 0.18} ${top + h * 0.12} L${x - ww * 0.12} ${top + h * 0.1} Z`} fill="#eef3f7" opacity="0.9" />
            <path d={`M${x - ww / 2} ${base} Q${x} ${base - h * 0.06} ${x + ww / 2} ${base}`} fill="none" stroke="#eef3f7" strokeWidth={h * 0.025} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

function Window() {
  const arch = "M708 556 V372 A92 92 0 0 1 892 372 V556 Z";
  return (
    <g>
      <defs>
        <clipPath id="glass"><path d={arch} /></clipPath>
        <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f2c48" />
          <stop offset="0.55" stopColor="#6b7fa3" />
          <stop offset="0.85" stopColor="#d9c3b0" />
        </linearGradient>
        <radialGradient id="lampGlow">
          <stop offset="0" stopColor="#fff2c4" stopOpacity="0.95" />
          <stop offset="0.25" stopColor="#ffd27a" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath="url(#glass)">
        <rect x="700" y="270" width="200" height="300" fill="url(#dusk)" />
        <path d="M700 500 Q760 470 820 492 T900 480 V570 H700 Z" fill="#cfd8e3" />
        <Pine x={724} y={520} h={130} tone="#243d33" />
        <Pine x={880} y={515} h={150} tone="#243d33" />
        <Pine x={772} y={540} h={96} />
        {/* the lamppost, lit, in the snow */}
        <circle cx="828" cy="452" r="34" fill="url(#lampGlow)" />
        <rect x="826" y="458" width="4" height="86" fill="#1b1d22" />
        <path d="M819 446 H837 L834 462 H822 Z" fill="#1b1d22" />
        <rect x="822" y="448" width="12" height="11" fill="#ffe7a6" />
        <path d="M700 545 Q800 525 900 545 V570 H700 Z" fill="#eef2f6" />
        <g className="snow">
          {Array.from({ length: 26 }, (_, i) => (
            <circle key={i} cx={705 + ((i * 37) % 190)} cy={270 + ((i * 53) % 280)} r={i % 3 ? 1.4 : 2.2} fill="#fff" opacity="0.85"
              style={{ animationDelay: `${-(i % 9) * 0.9}s`, animationDuration: `${7 + (i % 5)}s` }} />
          ))}
        </g>
      </g>
      {/* leaded lights: a fine diamond lattice over the glass */}
      <g clipPath="url(#glass)" stroke="#1b130c" strokeOpacity="0.55" strokeWidth="1.2">
        {Array.from({ length: 12 }, (_, i) => <path key={`a${i}`} d={`M${640 + i * 30} 570 L${760 + i * 30} 270`} />)}
        {Array.from({ length: 12 }, (_, i) => <path key={`b${i}`} d={`M${640 + i * 30} 270 L${760 + i * 30} 570`} />)}
      </g>
      <path d={arch} fill="none" stroke="#3b2414" strokeWidth="18" />
      <path d={arch} fill="none" stroke="#8a5e38" strokeWidth="5" />
      <path d="M800 282 V556 M708 450 H892" stroke="#3b2414" strokeWidth="8" />
      <rect x="696" y="556" width="208" height="16" fill="#5a3a22" />
      <rect x="696" y="556" width="208" height="4" fill="#9a6e44" />
    </g>
  );
}

function Mirror() {
  const xl = 1222, xr = 1362;
  const [, tl] = Rw(xl, 0.14), [, bl] = Rw(xl, 0.86);
  const [, tr] = Rw(xr, 0.12), [, br] = Rw(xr, 0.88);
  const frame = `M${xl} ${bl} L${xl} ${tl + 40} Q${(xl + xr) / 2} ${tl - 46} ${xr} ${tr + 30} L${xr} ${br} Z`;
  const inset = 12;
  const glass = `M${xl + inset} ${bl - inset} L${xl + inset} ${tl + 44} Q${(xl + xr) / 2} ${tl - 28} ${xr - inset} ${tr + 36} L${xr - inset} ${br - inset} Z`;
  return (
    <g>
      <defs>
        <linearGradient id="glassTone" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#8d8a84" />
          <stop offset="0.45" stopColor="#d9d6cf" />
          <stop offset="1" stopColor="#6e6a63" />
        </linearGradient>
        <clipPath id="mirrorGlass"><path d={glass} /></clipPath>
        <linearGradient id="gilt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0d28a" />
          <stop offset="0.35" stopColor="#a8792e" />
          <stop offset="0.6" stopColor="#e3bd6b" />
          <stop offset="1" stopColor="#7a5418" />
        </linearGradient>
      </defs>
      <path d={frame} fill="#6b4a1c" />
      <path d={frame} fill="url(#gilt)" />
      <path d={frame} fill="none" stroke="#3b2414" strokeWidth="2" />
      <path d={glass} fill="url(#glassTone)" />
      {/* the window, reflected */}
      <g clipPath="url(#mirrorGlass)" opacity="0.5">
        <path d={`M${xl + 30} ${bl - 70} V${tl + 120} A30 30 0 0 1 ${xl + 90} ${tl + 110} V${bl - 80} Z`} fill="#8fa3c0" />
        <path d={`M${xl + 10} ${tl} L${xl + 70} ${tl} L${xr - 30} ${br} L${xr - 90} ${br} Z`} fill="#fff" opacity="0.18" />
      </g>
      <path d={glass} fill="none" stroke="#c9a463" strokeWidth="2" opacity="0.8" />
    </g>
  );
}

/** Slope of a horizontal line on the right wall at height v (for skewing flat labels onto it). */
const slopeR = (v: number) => -(BW.t / BW.l) * (1 - v) + ((900 - BW.b) / BW.l) * v;

/**
 * A small oil painting of a street market, hung on the right wall: the door to the bargain
 * finder. Drawn in the wall's own perspective; (u, v) run 0-1 across the canvas.
 */
function MarketPainting() {
  const P = (u: number, v: number) => Rw(1030 + u * 152, 0.11 + v * 0.29);
  const poly = (pts: [number, number][]) => quad(...pts.map(([u, v]) => P(u, v)));
  const rect = (u0: number, v0: number, u1: number, v1: number) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const ell = (u: number, v: number, ru: number, rv: number) =>
    poly(Array.from({ length: 12 }, (_, i) => [u + ru * Math.cos((i / 12) * Math.PI * 2), v + rv * Math.sin((i / 12) * Math.PI * 2)] as [number, number]));
  const stalls = [
    { u0: 0.05, u1: 0.34, a: "#b8372e" },
    { u0: 0.37, u1: 0.63, a: "#2f6b6a" },
    { u0: 0.66, u1: 0.95, a: "#c98a2e" },
  ];
  const cloth = ["#26324f", "#e9b7bd", "#9caf88", "#f3ede0", "#a4532f", "#6b6b3a", "#c3b1e1", "#1d1d1f"];
  const shoppers: [number, number, string][] = [[0.2, 0.72, "#2f3b2f"], [0.51, 0.75, "#5c1e1d"], [0.83, 0.71, "#26324f"]];
  const [lx, ly] = P(0.12, 1.12);
  const lv = 0.11 + 1.12 * 0.29;
  return (
    <g>
      <path d={rect(-0.08, -0.1, 1.08, 1.1)} fill="#000" opacity="0.35" filter="url(#soft)" />
      <path d={rect(-0.07, -0.09, 1.07, 1.09)} fill="url(#gilt)" />
      <path d={rect(-0.02, -0.025, 1.02, 1.025)} fill="#3b2414" />
      {/* sky, rooftops and bunting */}
      <path d={rect(0, 0, 1, 0.5)} fill="#efd6a2" />
      <path d={ell(0.8, 0.14, 0.09, 0.07)} fill="#fbeac2" />
      <path d={rect(0, 0.17, 0.22, 0.5)} fill="#c48a5c" />
      <path d={poly([[0, 0.17], [0.11, 0.07], [0.22, 0.17]])} fill="#8a4a2c" />
      <path d={rect(0.22, 0.25, 0.46, 0.5)} fill="#d9b383" />
      <path d={rect(0.46, 0.13, 0.7, 0.5)} fill="#a8663f" />
      <path d={poly([[0.46, 0.13], [0.58, 0.04], [0.7, 0.13]])} fill="#6e3a22" />
      <path d={rect(0.7, 0.23, 1, 0.5)} fill="#caa070" />
      {[0.06, 0.14, 0.28, 0.38, 0.52, 0.62, 0.76, 0.88].map((u) => <path key={u} d={rect(u, 0.27, u + 0.035, 0.33)} fill="#5a3a22" opacity="0.7" />)}
      {Array.from({ length: 10 }, (_, i) => {
        const u = 0.05 + i * 0.1;
        return <path key={i} d={poly([[u - 0.035, 0.335], [u + 0.035, 0.335], [u, 0.39]])} fill={["#b8372e", "#f3e6cc", "#2f6b6a", "#c98a2e"][i % 4]} />;
      })}
      {/* cobbles */}
      <path d={rect(0, 0.78, 1, 1)} fill="#8a7357" />
      {[0.84, 0.91, 0.97].map((v) => <path key={v} d={rect(0, v, 1, v + 0.008)} fill="#6e5a43" />)}
      {/* three stalls with striped awnings and clothes on rails */}
      {stalls.map(({ u0, u1, a }) => {
        const w = (u1 - u0) / 5;
        return (
          <g key={u0}>
            <path d={rect(u0, 0.4, u0 + 0.014, 0.8)} fill="#5a3a22" />
            <path d={rect(u1 - 0.014, 0.4, u1, 0.8)} fill="#5a3a22" />
            {Array.from({ length: 5 }, (_, k) => (
              <g key={k}>
                <path d={rect(u0 + k * w, 0.4, u0 + (k + 1) * w, 0.5)} fill={k % 2 ? "#f3e6cc" : a} />
                <path d={poly([[u0 + k * w, 0.5], [u0 + (k + 1) * w, 0.5], [u0 + (k + 0.5) * w, 0.535]])} fill={k % 2 ? "#f3e6cc" : a} />
              </g>
            ))}
            <path d={rect(u0 + 0.01, 0.55, u1 - 0.01, 0.557)} fill="#3b2414" />
            {Array.from({ length: 4 }, (_, k) => {
              const x = u0 + 0.025 + k * ((u1 - u0 - 0.05) / 4);
              return <path key={k} d={poly([[x, 0.56], [x + 0.05, 0.56], [x + 0.056, 0.66], [x - 0.006, 0.66]])} fill={cloth[(k + Math.round(u0 * 10)) % cloth.length]} />;
            })}
            <path d={rect(u0 - 0.008, 0.665, u1 + 0.008, 0.69)} fill="#9a6a3e" />
            <path d={rect(u0, 0.69, u1, 0.8)} fill="#6e4426" />
          </g>
        );
      })}
      {/* a sale card on the middle stall */}
      <path d={rect(0.44, 0.7, 0.56, 0.77)} fill="#f7f1e3" />
      <path d={rect(0.46, 0.72, 0.54, 0.735)} fill="#b8372e" />
      {shoppers.map(([u, v, c]) => (
        <g key={u}>
          <path d={poly([[u - 0.026, v], [u + 0.026, v], [u + 0.036, v + 0.15], [u - 0.036, v + 0.15]])} fill={c} />
          <path d={ell(u, v - 0.035, 0.019, 0.032)} fill="#c99a78" />
        </g>
      ))}
      {/* varnish: warm, darker at the edges, like an old oil painting */}
      <path d={rect(0, 0, 1, 1)} fill="url(#varnish)" />
      <g transform={`translate(${lx} ${ly}) matrix(1 ${slopeR(lv)} 0 1 0 0)`}>
        <rect width="104" height="22" rx="3" fill="url(#brassPlate)" stroke="#6b4c16" strokeWidth="1" />
        <text x="52" y="15" textAnchor="middle" className="plate-text">BARGAINS</text>
      </g>
    </g>
  );
}

/**
 * A small brass candle chandelier: chain, a turned column, six scrolled arms on a ring seen
 * slightly from below (back arms drawn first and dimmer), candles with flickering flames,
 * and crystal drops.
 */
function Chandelier() {
  const cx = 800, ringY = 168, rx = 92, ry = 17;
  const arms = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return { x: cx + rx * Math.cos(a), y: ringY + ry * Math.sin(a), back: Math.sin(a) < 0 };
  }).sort((p, q) => p.y - q.y);
  const candle = (x: number, y: number, back: boolean) => (
    <g key={`${x}-${y}`} opacity={back ? 0.72 : 1}>
      <path d={`M${cx} 176 C ${cx + (x - cx) * 0.3} 196, ${x} ${y + 20}, ${x} ${y}`} fill="none" stroke="url(#brassRod)" strokeWidth={back ? 3 : 4} strokeLinecap="round" />
      <path d={`M${x - 3} ${y + 8} q3 6 6 0`} fill="none" stroke="#b8902f" strokeWidth="2" />
      <ellipse cx={x} cy={y} rx="11" ry="3.5" fill="#c9a050" />
      <ellipse cx={x} cy={y - 1} rx="11" ry="3" fill="#f0d28a" />
      <rect x={x - 3.5} y={y - 19} width="7" height="18" rx="1.5" fill="#f6efe0" />
      <circle cx={x} cy={y - 26} r="16" fill="url(#candleGlow)" />
      <path className="flame" d={`M${x} ${y - 33} C ${x + 4} ${y - 27}, ${x + 3.5} ${y - 21}, ${x} ${y - 20} C ${x - 3.5} ${y - 21}, ${x - 4} ${y - 27}, ${x} ${y - 33} Z`} fill="#ffd98a" />
      <path d={`M${x} ${y + 4} l3 6 -3 7 -3 -7 Z`} fill="#fff6e0" opacity="0.85" />
    </g>
  );
  return (
    <g className="chandelier">
      {/* ceiling rose and chain */}
      <ellipse cx={cx} cy="34" rx="22" ry="6" fill="#6b4c16" />
      <ellipse cx={cx} cy="32" rx="16" ry="4" fill="#c9a050" />
      {Array.from({ length: 9 }, (_, i) => (
        i % 2
          ? <rect key={i} x={cx - 1} y={38 + i * 7} width="2" height="8" rx="1" fill="#8a6a2e" />
          : <ellipse key={i} cx={cx} cy={42 + i * 7} rx="3" ry="4.5" fill="none" stroke="#a8832f" strokeWidth="1.5" />
      ))}
      {arms.filter((a) => a.back).map((a) => candle(a.x, a.y, true))}
      {/* turned column */}
      <path d={`M${cx - 6} 104 h12 l4 14 h-20 Z`} fill="#a8832f" />
      <ellipse cx={cx} cy="128" rx="13" ry="12" fill="url(#brassBall)" />
      <path d={`M${cx - 7} 140 h14 l-2 16 h-10 Z`} fill="#8a6a2e" />
      <ellipse cx={cx} cy="166" rx="22" ry="9" fill="url(#brassBall)" />
      {/* beaded swag between the arms */}
      <ellipse cx={cx} cy={ringY + 14} rx={rx * 0.86} ry={ry * 0.9} fill="none" stroke="#fff3d6" strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="1.5 4.5" strokeLinecap="round" />
      {arms.filter((a) => !a.back).map((a) => candle(a.x, a.y, false))}
      {/* finial */}
      <path d={`M${cx - 9} 176 Q${cx} 172 ${cx + 9} 176 L${cx + 3} 196 Q${cx} 206 ${cx - 3} 196 Z`} fill="url(#brassBall)" />
      <path d={`M${cx} 206 l4 7 -4 9 -4 -9 Z`} fill="#fff6e0" opacity="0.9" />
    </g>
  );
}

/** A brass name plate on a little turned stand, next to the ottoman. */
function NamePlacard({ name }: { name: string }) {
  return (
    <g className="placard">
      <ellipse cx="612" cy="776" rx="26" ry="6" fill="#000" opacity="0.4" filter="url(#soft)" />
      <path d="M598 776 h28 l-4 -8 h-20 Z" fill="#4a2c18" />
      <rect x="609" y="712" width="6" height="58" fill="url(#brassRod)" />
      <g transform="translate(612 690) rotate(-4)">
        <rect x="-62" y="-26" width="124" height="44" rx="4" fill="#000" opacity="0.35" transform="translate(2 3)" />
        <rect x="-62" y="-26" width="124" height="44" rx="4" fill="url(#brassPlate)" stroke="#6b4c16" strokeWidth="1.2" />
        <rect x="-57" y="-21" width="114" height="34" rx="2.5" fill="none" stroke="#6b4c16" strokeOpacity="0.55" />
        <text x="0" y="-2" textAnchor="middle" className="placard-name">{name.split(" ")[0].toUpperCase()}</text>
        <text x="0" y="11" textAnchor="middle" className="placard-sub">{name.split(" ").slice(1).join(" ") || "our mascot"}</text>
      </g>
    </g>
  );
}

/** A silk bowtie, tied just under his chin. */
function Bowtie() {
  return (
    <g className="bowtie" transform="translate(889 606) rotate(-3)">
      <ellipse cx="0" cy="10" rx="34" ry="7" fill="#000" opacity="0.35" filter="url(#soft)" />
      <path d="M-4 -2 C-16 -16 -36 -14 -38 -2 C-40 10 -20 16 -4 4 Z" fill="#7a1220" />
      <path d="M4 -2 C16 -16 36 -14 38 -2 C40 10 20 16 4 4 Z" fill="#7a1220" />
      <path d="M-6 0 C-18 -8 -30 -8 -32 -2 M6 0 C18 -8 30 -8 32 -2" fill="none" stroke="#a8263a" strokeWidth="2" />
      <path d="M-6 3 C-18 9 -28 9 -32 4 M6 3 C18 9 28 9 32 4" fill="none" stroke="#4a0a12" strokeWidth="1.5" />
      {[[-26, -4], [-16, 2], [-22, 6], [26, -4], [16, 2], [22, 6]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" fill="#e8c46a" />)}
      <rect x="-6" y="-7" width="12" height="13" rx="3" fill="#5c0d18" />
      <rect x="-4" y="-6" width="3" height="11" rx="1.5" fill="#a8263a" opacity="0.7" />
    </g>
  );
}

/**
 * The archive: a cork board under the market painting, with outfit sketches and scraps of
 * fabric pinned to it. Drawn in the right wall's perspective; (u, v) run 0-1 across the cork.
 */
function ArchiveBoard() {
  const B = (u: number, v: number) => Rw(1036 + u * 146, 0.53 + v * 0.26);
  const poly = (pts: [number, number][]) => quad(...pts.map(([u, v]) => B(u, v)));
  const rect = (u0: number, v0: number, u1: number, v1: number) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const line = (pts: [number, number][]) => "M" + pts.map(([u, v]) => B(u, v).join(" ")).join(" L");
  const ell = (u: number, v: number, ru: number, rv: number) =>
    poly(Array.from({ length: 10 }, (_, i) => [u + ru * Math.cos((i / 10) * Math.PI * 2), v + rv * Math.sin((i / 10) * Math.PI * 2)] as [number, number]));

  // a sheet with a croquis and two garments on it; [u0, v0, u1, v1] is where it's pinned
  const sheets: { box: [number, number, number, number]; top: string; bottom: string; skirt: boolean; pin: string }[] = [
    { box: [0.05, 0.08, 0.29, 0.66], top: "#a4532f", bottom: "#e8dfcc", skirt: false, pin: "#b8372e" },
    { box: [0.36, 0.16, 0.58, 0.74], top: "#e9b7bd", bottom: "#2f3b2f", skirt: true, pin: "#2f6b6a" },
    { box: [0.65, 0.06, 0.88, 0.6], top: "#7d9cc4", bottom: "#d98fa0", skirt: true, pin: "#c98a2e" },
  ];
  const sketch = ({ box: [u0, v0, u1, v1], top, bottom, skirt, pin }: (typeof sheets)[number], i: number) => {
    const L = (su: number, sv: number): [number, number] => [u0 + su * (u1 - u0), v0 + sv * (v1 - v0)];
    return (
      <g key={i}>
        <path d={rect(u0 + 0.01, v0 + 0.02, u1 + 0.01, v1 + 0.02)} fill="#000" opacity="0.25" />
        <path d={rect(u0, v0, u1, v1)} fill="#f7f2e7" />
        <path d={ell(...L(0.5, 0.13), (u1 - u0) * 0.08, (v1 - v0) * 0.06)} fill="none" stroke="#8a8278" strokeWidth="0.7" />
        <path d={line([L(0.42, 0.62), L(0.4, 0.94)]) + " " + line([L(0.58, 0.62), L(0.6, 0.94)])} fill="none" stroke="#8a8278" strokeWidth="0.7" />
        <path d={poly([L(0.28, 0.24), L(0.72, 0.24), L(0.67, 0.52), L(0.33, 0.52)])} fill={top} opacity="0.85" />
        <path d={skirt ? poly([L(0.37, 0.52), L(0.63, 0.52), L(0.74, 0.78), L(0.26, 0.78)]) : poly([L(0.35, 0.52), L(0.65, 0.52), L(0.62, 0.86), L(0.38, 0.86)])} fill={bottom} opacity="0.85" />
        <path d={line([L(0.28, 0.24), L(0.72, 0.24)])} stroke="#3a3530" strokeWidth="0.8" />
        <path d={ell(...L(0.5, 0.0), 0.012, 0.018)} fill={pin} />
      </g>
    );
  };

  const [lx, ly] = B(0.3, 1.1);
  const lv = 0.53 + 1.1 * 0.26;
  return (
    <g>
      <path d={rect(-0.06, -0.08, 1.06, 1.08)} fill="#000" opacity="0.35" filter="url(#soft)" />
      <path d={rect(-0.05, -0.07, 1.05, 1.07)} fill="#5a3a22" />
      <path d={rect(-0.05, -0.07, 1.05, 1.07)} fill="url(#oakGrad)" opacity="0.5" />
      <path d={rect(0, 0, 1, 1)} fill="#b0814f" />
      <path d={rect(0, 0, 1, 1)} fill="#000" filter="url(#cork)" />
      {/* fabric scraps first, so the sketches overlap them */}
      <path d={rect(0.04, 0.7, 0.2, 0.94)} fill="#f3e6cc" />
      {[0.73, 0.79, 0.85, 0.91].map((v) => <path key={v} d={line([[0.04, v], [0.2, v]])} stroke="#b8372e" strokeWidth="1.6" opacity="0.6" />)}
      {[0.07, 0.11, 0.15, 0.19].map((u) => <path key={u} d={line([[u, 0.7], [u, 0.94]])} stroke="#b8372e" strokeWidth="1.6" opacity="0.6" />)}
      <path d={rect(0.6, 0.7, 0.8, 0.95)} fill="#e8dcc6" />
      {[0.62, 0.68, 0.74].map((u) => <path key={u} d={line([[u, 0.7], [u + 0.06, 0.95]])} stroke="#2f6b6a" strokeWidth="2.4" />)}
      <path d={rect(0.84, 0.62, 0.98, 0.86)} fill="#3b4a7a" />
      {[[0.87, 0.67], [0.93, 0.72], [0.88, 0.8], [0.95, 0.83]].map(([u, v]) => <path key={u + "" + v} d={ell(u, v, 0.012, 0.022)} fill="#e9b7bd" />)}
      {sheets.map(sketch)}
      <path d={ell(0.12, 0.7, 0.012, 0.018)} fill="#7a2a5a" />
      <path d={ell(0.7, 0.7, 0.012, 0.018)} fill="#b8372e" />
      <g transform={`translate(${lx} ${ly}) matrix(1 ${slopeR(lv)} 0 1 0 0)`}>
        <rect width="96" height="20" rx="3" fill="url(#brassPlate)" stroke="#6b4c16" strokeWidth="1" />
        <text x="48" y="14" textAnchor="middle" className="plate-text">ARCHIVE</text>
      </g>
    </g>
  );
}

function SideTable() {
  return (
    <g>
      <ellipse cx="1112" cy="760" rx="58" ry="12" fill="#000" opacity="0.35" filter="url(#soft)" />
      <path d="M1100 652 L1096 756 H1128 L1124 652 Z" fill="#4a2c18" />
      <path d="M1100 652 L1098 756 H1106 L1106 652 Z" fill="#7a5030" />
      <ellipse cx="1112" cy="650" rx="66" ry="16" fill="#5a3620" />
      <ellipse cx="1112" cy="646" rx="66" ry="16" fill="#8a5a34" />
      <ellipse cx="1112" cy="646" rx="66" ry="16" fill="url(#oakGrad)" opacity="0.4" filter="url(#grain)" />
      {/* teapot and cup */}
      <ellipse cx="1092" cy="622" rx="24" ry="20" fill="#f4efe6" />
      <path d="M1070 616 Q1056 606 1058 594" fill="none" stroke="#f4efe6" strokeWidth="5" strokeLinecap="round" />
      <path d="M1114 612 Q1128 612 1126 628" fill="none" stroke="#e6ded0" strokeWidth="4" />
      <ellipse cx="1092" cy="602" rx="10" ry="4" fill="#e6ded0" />
      <circle cx="1092" cy="597" r="3" fill="#e6ded0" />
      <path d="M1074 624 Q1092 636 1110 624" fill="none" stroke="#c9a463" strokeWidth="1.5" />
      <ellipse cx="1142" cy="640" rx="16" ry="4" fill="#e6ded0" />
      <path d="M1132 628 h20 l-3 12 h-14 Z" fill="#f4efe6" />
      <ellipse cx="1142" cy="628" rx="10" ry="3" fill="#7a4a22" />
    </g>
  );
}

// ---------------------------------------------------------------- the scene

export function WardrobeScene({ onLionContext, showMarket = false, ...props }: Omit<HotProps, "id" | "label" | "children" | "onContext"> & {
  onLionContext: (e: React.MouseEvent) => void;
  /** The market painting is the bargain finder's door, so it only hangs when that feature is on. */
  showMarket?: boolean;
}) {
  const shelf = (v: number) => quad(Lw(40, v), Lw(540, v), Lw(540, v + 0.014), Lw(40, v + 0.014));
  const box = (x0: number, x1: number, v: number, hgt: number) => quad(Lw(x0, v - hgt), Lw(x1, v - hgt), Lw(x1, v), Lw(x0, v));
  const railA = Lw(50, RAIL_V), railB = Lw(560, RAIL_V);
  const slopeAt = (v: number) => (BW.t / BW.l) * (1 - v) - ((900 - BW.b) / BW.l) * v;
  // A strip light under each shelf, washing the wall below, so both shelves read as places to click.
  const litShelf = (v: number) => (
    <>
      <path d={quad(Lw(40, v + 0.014), Lw(540, v + 0.014), Lw(540, v + 0.1), Lw(40, v + 0.1))} fill="url(#shelfWash)" />
      <path d={shelf(v)} fill="#3b2414" />
      <path d={quad(Lw(40, v), Lw(540, v), Lw(540, v + 0.004), Lw(40, v + 0.004))} fill="#8a5a34" />
      <path d={`M${Lw(44, v + 0.0135).join(" ")} L${Lw(536, v + 0.0135).join(" ")}`} stroke="#ffe2a2" strokeWidth="2.5" filter="url(#glowLine)" />
    </>
  );
  // plates grow with their label, so "LAZY MODE" fits as well as "PROFILE"
  const plate = (x: number, v: number, label: string) => {
    const w = Math.max(108, Math.round(label.length * 11.5 + 26));
    return (
      <g className="plate" transform={`translate(${Lw(x, v).join(" ")}) matrix(1 ${slopeAt(v)} 0 1 0 0) scale(${(scaleAt(x) * 1.2).toFixed(3)})`}>
        <rect x="-2" y="-1" width={w + 4} height="30" rx="4" fill="#000" opacity="0.35" />
        <rect width={w} height="26" rx="3" fill="url(#brassPlate)" stroke="#6b4c16" strokeWidth="1" />
        <circle cx="7" cy="13" r="1.8" fill="#6b4c16" />
        <circle cx={w - 7} cy="13" r="1.8" fill="#6b4c16" />
        <text x={w / 2} y="17.5" textAnchor="middle" className="plate-text">{label}</text>
      </g>
    );
  };

  return (
    <svg className="wardrobe" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Inside the wardrobe">
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.003 0.06" numOctaves="4" seed="4" />
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 2.4 -1.05" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="grainH" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06 0.004" numOctaves="4" seed="9" />
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 2.4 -1.05" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="fur" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="7" />
        </filter>
        <filter id="soft"><feGaussianBlur stdDeviation="6" /></filter>
        <linearGradient id="shelfWash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffcf86" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffcf86" stopOpacity="0" />
        </linearGradient>
        <filter id="glowLine" x="-5%" y="-200%" width="110%" height="500%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="brassPlate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dc98" />
          <stop offset="0.5" stopColor="#c9a050" />
          <stop offset="1" stopColor="#9a7428" />
        </linearGradient>
        <radialGradient id="varnish" cx="0.5" cy="0.45" r="0.7">
          <stop offset="0.5" stopColor="#5a2e08" stopOpacity="0" />
          <stop offset="1" stopColor="#3a1c04" stopOpacity="0.45" />
        </radialGradient>
        <linearGradient id="brassRod" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a5a1e" />
          <stop offset="0.5" stopColor="#f0d28a" />
          <stop offset="1" stopColor="#7a5a1e" />
        </linearGradient>
        <radialGradient id="brassBall" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.45" stopColor="#c9a050" />
          <stop offset="1" stopColor="#5e4210" />
        </radialGradient>
        <radialGradient id="candleGlow">
          <stop offset="0" stopColor="#fff2c4" stopOpacity="0.9" />
          <stop offset="0.4" stopColor="#ffc56e" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
        <filter id="cork" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" />
          <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.14  0 0 0 0 0.05  0 0 0 1.5 -0.6" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id="hotGlow">
          <stop offset="0" stopColor="#ffd796" stopOpacity="1" />
          <stop offset="0.6" stopColor="#ffd796" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffd796" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="oakGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a8723f" />
          <stop offset="1" stopColor="#6b4223" />
        </linearGradient>
        <linearGradient id="leftWall" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5a3820" />
          <stop offset="0.6" stopColor="#7a4e2b" />
          <stop offset="1" stopColor="#4a2e19" />
        </linearGradient>
        <linearGradient id="rightWall" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#5a3820" />
          <stop offset="0.6" stopColor="#80532e" />
          <stop offset="1" stopColor="#4a2e19" />
        </linearGradient>
        <linearGradient id="floorWood" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#3a2414" />
          <stop offset="1" stopColor="#5e3c22" />
        </linearGradient>
        <linearGradient id="coatShade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="lantern" cx="0.5" cy="0.3" r="0.55">
          <stop offset="0" stopColor="#ffcf86" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#ff9e4a" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ff9e4a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="moon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9c9e6" stopOpacity="0.32" />
          <stop offset="1" stopColor="#b9c9e6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="velvet" cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#9a2f2a" />
          <stop offset="1" stopColor="#4a1210" />
        </radialGradient>
        <linearGradient id="lionFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.86" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id="lionMask"><rect x="738" y="392" width="300" height="309" fill="url(#lionFade)" /></mask>
        {/* warm the photo so it sits in lamplight */}
        <filter id="lamplit">
          <feColorMatrix values="1.06 0.04 0 0 0.02  0.02 0.98 0 0 0  0 0 0.86 0 0  0 0 0 1 0" />
        </filter>
      </defs>

      {/* shell */}
      <path d={quad([0, 0], [1600, 0], [BW.r, BW.t], [BW.l, BW.t])} fill="#2e1c10" />
      <path d={quad([0, 0], [1600, 0], [BW.r, BW.t], [BW.l, BW.t])} fill="#000" filter="url(#grainH)" opacity="0.6" />
      {[0.18, 0.42, 0.64, 0.82].map((t) => (
        <path key={t} d={quad([BW.l * t, BW.t * t], [1600 - BW.l * t, BW.t * t], [1600 - BW.l * (t + 0.035), BW.t * (t + 0.035)], [BW.l * (t + 0.035), BW.t * (t + 0.035)])} fill="#1e1209" />
      ))}

      <path d={quad([0, 0], [BW.l, BW.t], [BW.l, BW.b], [0, 900])} fill="url(#leftWall)" />
      <path d={quad([0, 0], [BW.l, BW.t], [BW.l, BW.b], [0, 900])} fill="#000" filter="url(#grain)" />
      <path d={quad([1600, 0], [BW.r, BW.t], [BW.r, BW.b], [1600, 900])} fill="url(#rightWall)" />
      <path d={quad([1600, 0], [BW.r, BW.t], [BW.r, BW.b], [1600, 900])} fill="#000" filter="url(#grain)" />
      {/* panel seams, converging on the far wall */}
      {[70, 150, 230, 305, 375, 440, 498, 550].map((x) => (
        <g key={x} stroke="#24150a" strokeOpacity="0.6" strokeWidth={2.4 * scaleAt(x)}>
          <path d={`M${Lw(x, 0).join(" ")} L${Lw(x, 1).join(" ")}`} />
          <path d={`M${Rw(1600 - x, 0).join(" ")} L${Rw(1600 - x, 1).join(" ")}`} />
        </g>
      ))}

      <rect x={BW.l} y={BW.t} width={BW.r - BW.l} height={BW.b - BW.t} fill="#5e3b20" />
      <rect x={BW.l} y={BW.t} width={BW.r - BW.l} height={BW.b - BW.t} fill="#000" filter="url(#grain)" />

      <path d={quad([0, 900], [1600, 900], [BW.r, BW.b], [BW.l, BW.b])} fill="url(#floorWood)" />
      <path d={quad([0, 900], [1600, 900], [BW.r, BW.b], [BW.l, BW.b])} fill="#000" filter="url(#grainH)" opacity="0.7" />
      {Array.from({ length: 15 }, (_, i) => {
        const xb = -200 + i * 143;
        return <path key={i} d={`M${xb} 900 L${BW.l + ((xb + 200) / 2000) * (BW.r - BW.l)} ${BW.b}`} stroke="#1f1208" strokeOpacity="0.55" strokeWidth="2" />;
      })}

      {/* cold light from the window, falling across the floor */}
      <path d="M708 590 L892 590 L1060 900 L470 900 Z" fill="url(#moon)" />

      <ellipse cx="800" cy="200" rx="560" ry="440" fill="url(#lantern)" />
      <Chandelier />

      <Hot id="window" label="Window: outfits for the places around you" {...props}>
        <Window />
        <path className="hot-glow" d="M708 556 V372 A92 92 0 0 1 892 372 V556 Z" />
      </Hot>

      {/* shelves: archive on top, profile below */}
      {/* top shelf: hat boxes and folded knits */}
      {litShelf(0.13)}
      <path d={box(70, 190, 0.13, 0.07)} fill="#6e2a20" />
      <path d={box(200, 300, 0.13, 0.055)} fill="#2f3b2f" />
      <path d={box(310, 400, 0.13, 0.065)} fill="#7a5a3a" />

      {/* second shelf: profile on the left, lazy mode on the right */}
      {litShelf(0.25)}
      <Hot id="profile" label="Profile: what neor should know about you" {...props}>
        <path d={box(80, 200, 0.25, 0.06)} fill="#a58a62" />
        <path d={box(215, 320, 0.25, 0.07)} fill="#4a2f22" />
        {plate(205, 0.206, "PROFILE")}
        <path className="hot-glow" d={quad(Lw(60, 0.17), Lw(325, 0.17), Lw(325, 0.27), Lw(60, 0.27))} />
      </Hot>
      <Hot id="lazy" label="Lazy mode: outfits by text, from your calendar and the weather" {...props}>
        <path d={box(335, 480, 0.25, 0.065)} fill="#2f3b4f" />
        {plate(338, 0.205, "LAZY MODE")}
        <path className="hot-glow" d={quad(Lw(330, 0.17), Lw(490, 0.17), Lw(490, 0.27), Lw(330, 0.27))} />
      </Hot>

      <Hot id="closet" label="Closet: everything you own, ready to mix" {...props}>
        <path d={`M${railA.join(" ")} L${railB.join(" ")}`} stroke="#c9a463" strokeWidth="6" strokeLinecap="round" />
        <path d={`M${railA.join(" ")} L${railB.join(" ")}`} stroke="#fff3c4" strokeWidth="1.5" strokeOpacity="0.6" />
        {COATS.map((c) => <Coat key={c.x} {...c} />)}
        <path className="hot-glow" d={quad(Lw(40, 0.3), Lw(560, 0.3), Lw(560, 0.78), Lw(40, 0.8))} />
      </Hot>

      <Hot id="mirror" label="Mirror: try on whatever is on your table" {...props}>
        <Mirror />
        <path className="hot-glow" d={quad(Rw(1220, 0.1), Rw(1364, 0.08), Rw(1364, 0.9), Rw(1220, 0.88))} />
      </Hot>

      {showMarket && (
        <Hot id="market" label="Bargain market: good clothes going cheap near you" {...props}>
          <MarketPainting />
          <path className="hot-glow" d={quad(Rw(1018, 0.07), Rw(1194, 0.05), Rw(1194, 0.47), Rw(1018, 0.46))} />
        </Hot>
      )}

      {/* rug, ottoman and the lion */}
      <ellipse cx="880" cy="772" rx="340" ry="74" fill="#5c1a17" />
      <ellipse cx="880" cy="772" rx="318" ry="64" fill="none" stroke="#c9a463" strokeWidth="3" />
      <ellipse cx="880" cy="772" rx="290" ry="54" fill="none" stroke="#2a0b09" strokeWidth="10" strokeDasharray="6 10" />
      <ellipse cx="880" cy="772" rx="200" ry="34" fill="#7a2420" opacity="0.6" />

      <Hot id="lion" label="The lion: a closet critique. Right-click for more" {...props} onContext={onLionContext}>
        <ellipse cx="886" cy="768" rx="215" ry="34" fill="#000" opacity="0.45" filter="url(#soft)" />
        <path d="M680 700 V748 Q886 800 1092 748 V700 Z" fill="url(#velvet)" />
        <ellipse cx="886" cy="700" rx="206" ry="44" fill="#8a2a25" />
        {[[790, 702], [886, 694], [982, 702], [838, 716], [934, 716]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="3.5" fill="#3a0d0b" />
        ))}
        <ellipse cx="890" cy="704" rx="170" ry="20" fill="#000" opacity="0.4" filter="url(#soft)" />
        <image href={MASCOT.cutout} x="738" y="392" width="300" height="309" mask="url(#lionMask)" filter="url(#lamplit)" />
        <Bowtie />
        {MASCOT.name && <NamePlacard name={MASCOT.name} />}
        <ellipse className="hot-glow" cx="886" cy="600" rx="190" ry="200" />
      </Hot>

      {/* drawn after the lion so its hover area wins where they meet */}
      <Hot id="archive" label="Archive: every outfit you have saved" {...props}>
        <ArchiveBoard />
        <path className="hot-glow" d={quad(Rw(1026, 0.5), Rw(1190, 0.49), Rw(1190, 0.84), Rw(1026, 0.83))} />
      </Hot>

      <SideTable />

      {/* atmosphere: dust in the lamplight */}
      <g className="motes">
        {Array.from({ length: 18 }, (_, i) => (
          <circle key={i} cx={560 + ((i * 71) % 520)} cy={160 + ((i * 97) % 420)} r={i % 4 ? 1.3 : 2} fill="#ffe2a6"
            style={{ animationDelay: `${-i * 0.7}s` }} />
        ))}
      </g>
    </svg>
  );
}
