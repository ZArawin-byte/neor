import { mix } from "../lib/color";
import type { Silhouette as Shape } from "../lib/racks";

/** Flat garment drawings for items without a photo (starter closet, shop items). viewBox 0 0 100 100. */
export const PATHS: Record<Shape, { body: string; detail?: string }> = {
  tee: { body: "M31 14 L42 10 Q50 17 58 10 L69 14 L88 30 L78 41 L70 35 L70 89 L30 89 L30 35 L22 41 L12 30 Z", detail: "M42 10 Q50 20 58 10" },
  shirt: { body: "M32 12 L44 8 L50 17 L56 8 L68 12 L84 26 L92 79 L82 81 L72 41 L72 90 L28 90 L28 41 L18 81 L8 79 L16 26 Z", detail: "M50 17 L50 90 M44 8 L50 20 L56 8" },
  tank: { body: "M36 10 L40 10 Q42 27 50 27 Q58 27 60 10 L64 10 Q66 28 72 35 L72 90 L28 90 L28 35 Q34 28 36 10 Z" },
  sweater: { body: "M30 14 Q50 23 70 14 L84 22 Q90 50 92 80 L82 82 L74 43 L74 86 Q50 91 26 86 L26 43 L18 82 L8 80 Q10 50 16 22 Z", detail: "M27 82 Q50 87 73 82 M30 15 Q50 25 70 15" },
  jacket: { body: "M30 10 L44 8 L50 30 L56 8 L70 10 L86 22 L94 84 L82 86 L74 44 L74 92 L26 92 L26 44 L18 86 L6 84 L14 22 Z", detail: "M44 8 L39 27 L50 45 M56 8 L61 27 L50 45 L50 92" },
  pants: { body: "M28 8 L72 8 L77 94 L57 94 L50 34 L43 94 L23 94 Z", detail: "M28 14 L72 14 M50 14 L50 34" },
  shorts: { body: "M24 22 L76 22 L83 73 L57 77 L50 45 L43 77 L17 73 Z", detail: "M24 28 L76 28" },
  skirt: { body: "M34 12 L66 12 L84 88 Q50 96 16 88 Z", detail: "M34 18 L66 18 M42 18 L36 90 M58 18 L64 90" },
  dress: { body: "M38 6 L42 6 Q44 19 50 19 Q56 19 58 6 L62 6 Q62 22 66 30 L60 41 L82 92 Q50 98 18 92 L40 41 L34 30 Q38 22 38 6 Z", detail: "M40 41 Q50 44 60 41" },
  shoe: { body: "M8 64 Q10 46 22 44 L40 42 Q48 53 62 57 L86 63 Q95 67 93 75 L93 79 L8 79 Z", detail: "M8 73 L93 73 M30 45 L36 52 M36 44 L42 51" },
  scarf: { body: "M30 10 Q50 21 70 10 L74 18 Q60 31 60 51 L66 88 L52 90 L48 53 Q44 33 26 18 Z", detail: "M54 90 L54 96 M58 89 L58 95 M62 89 L62 95" },
  bag: { body: "M17 40 L83 40 L89 90 L11 90 Z", detail: "M33 40 Q33 14 50 14 Q67 14 67 40 M17 52 L83 52" },
  ring: { body: "M50 30 m-24 0 a24 24 0 1 0 48 0 a24 24 0 1 0 -48 0 M50 30 m-16 0 a16 16 0 1 1 32 0 a16 16 0 1 1 -32 0", detail: "M42 54 L50 70 L58 54" },
  sock: { body: "M38 8 L62 8 L62 56 L85 70 Q95 79 86 89 L80 91 L50 85 Q38 81 38 66 Z", detail: "M38 16 L62 16 M38 22 L62 22" },
};

export function Silhouette({ shape, hex, className }: { shape: Shape; hex: string; className?: string }) {
  const { body, detail } = PATHS[shape];
  const edge = mix(hex, "#1b1511", 0.45);
  const id = `sh-${shape}-${hex.replace("#", "")}`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mix(hex, "#ffffff", 0.18)} />
          <stop offset="1" stopColor={mix(hex, "#000000", 0.12)} />
        </linearGradient>
      </defs>
      <path d={body} fill={`url(#${id})`} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" fillRule="evenodd" />
      {detail && <path d={detail} fill="none" stroke={edge} strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />}
    </svg>
  );
}
