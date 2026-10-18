import { cutOut } from "./cutout";
import { RACK_BY_ID } from "./racks";
import type { PieceSnapshot } from "./types";

/**
 * The mirror's view of you: a photo cropped to just the person, framed to the mirror's 9:20
 * shape, plus where the body is in it. Every number below is a % of the mirror, x across the
 * width and y down the height, so a worn piece lines up at any screen size.
 */
export interface Body {
  cx: number; // body centre line
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  shoulderW: number; // shoulder to shoulder, outside edges
  hipW: number; // across the hips
  feetW: number; // across both feet
  source: "pose" | "outline";
}

export const MIRROR_W = 900, MIRROR_H = 2000; // the glass is 9:20
const KEY = "neor.mirror-body";

export const savedBody = (): Body | null => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
};
export const saveBody = (b: Body | null) => {
  try { b ? localStorage.setItem(KEY, JSON.stringify(b)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
};

// ---------------------------------------------------------------- 1. crop the person out

/** Cut the background away and stand the person in a 9:20 frame, feet near the bottom. */
async function frame(file: Blob, onProgress?: (p: number) => void): Promise<HTMLCanvasElement> {
  const { blob } = await cutOut(file, onProgress); // trimmed to the person; original photo if removal fails
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = MIRROR_W;
  c.height = MIRROR_H;
  const scale = Math.min((MIRROR_H * 0.95) / bmp.height, (MIRROR_W * 0.96) / bmp.width);
  const w = bmp.width * scale, h = bmp.height * scale;
  c.getContext("2d")!.drawImage(bmp, (MIRROR_W - w) / 2, MIRROR_H * 0.985 - h, w, h);
  return c;
}

// ---------------------------------------------------------------- 2. find the body

type Pt = { x: number; y: number; visibility?: number };

/** MediaPipe pose landmarks: shoulders 11/12, hips 23/24, knees 25/26, ankles 27/28, toes 31/32. */
async function poseBody(c: HTMLCanvasElement): Promise<Body | null> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  const pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" },
    runningMode: "IMAGE",
    numPoses: 1,
  });
  const lm: Pt[] | undefined = pose.detect(c).landmarks[0];
  pose.close();
  if (!lm) return null;
  const P = (i: number) => ({ x: lm[i].x * 100, y: lm[i].y * 100 });
  const [ls, rs, lh, rh, lk, rk, la, ra] = [11, 12, 23, 24, 25, 26, 27, 28].map(P);
  const toes = [31, 32].map(P);
  const mid = (a: { y: number }, b: { y: number }) => (a.y + b.y) / 2;
  const shoulderY = mid(ls, rs), hipY = mid(lh, rh);
  if (!(hipY > shoulderY + 5)) return null; // not a standing, front-on figure
  // Landmarks are joint centres; the body is wider than the joints.
  const jointsW = Math.abs(ls.x - rs.x), hipsW = Math.abs(lh.x - rh.x);
  return {
    cx: (ls.x + rs.x + lh.x + rh.x) / 4,
    shoulderY, hipY,
    kneeY: mid(lk, rk),
    ankleY: Math.min(98, mid(la, ra)),
    shoulderW: jointsW * 1.18,
    hipW: Math.max(hipsW * 1.75, jointsW * 0.9),
    feetW: Math.max(Math.abs(toes[0].x - toes[1].x), Math.abs(la.x - ra.x)) + jointsW * 0.35,
    source: "pose",
  };
}

/** Fallback from the cut-out's outline and average human proportions. */
function outlineBody(c: HTMLCanvasElement): Body {
  const ctx = c.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const solid = (x: number, y: number) => data[(y * c.width + x) * 4 + 3] > 40;
  let top = 0, bottom = c.height - 1;
  const rowHas = (y: number) => { for (let x = 0; x < c.width; x += 3) if (solid(x, y)) return true; return false; };
  while (top < c.height && !rowHas(top)) top++;
  while (bottom > top && !rowHas(bottom)) bottom--;
  const span = (frac: number) => { // left/right edge of the figure at this height
    const y = Math.round(top + (bottom - top) * frac);
    let l = -1, r = -1;
    for (let x = 0; x < c.width; x++) if (solid(x, y)) { if (l < 0) l = x; r = x; }
    return l < 0 ? { cx: 50, w: 30 } : { cx: ((l + r) / 2 / c.width) * 100, w: ((r - l) / c.width) * 100 };
  };
  const H = ((bottom - top) / c.height) * 100, T = (top / c.height) * 100;
  const sh = span(0.2), hip = span(0.52), feet = span(0.97);
  return {
    cx: (sh.cx + hip.cx) / 2,
    shoulderY: T + H * 0.19, hipY: T + H * 0.52, kneeY: T + H * 0.73, ankleY: T + H * 0.95,
    shoulderW: Math.min(sh.w, hip.w * 1.6), hipW: hip.w, feetW: feet.w, source: "outline",
  };
}

/** Upload a full-length photo: get back the cropped mirror image and where the body is in it. */
export async function prepareMirrorPhoto(file: Blob, onProgress?: (p: number) => void): Promise<{ blob: Blob; body: Body }> {
  const c = await frame(file, onProgress);
  let body: Body | null = null;
  try { body = await poseBody(c); } catch (e) { console.warn("Pose model unavailable, using the outline", e); }
  body ??= outlineBody(c);
  const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("encode"))), "image/png"));
  return { blob, body };
}

// ---------------------------------------------------------------- 3. dress it

/**
 * Where each drawn garment's anchors sit inside its 100x100 drawing (see Silhouette.tsx):
 * `span` is the fraction of the width that should match the body (shoulders or waist), and
 * `top`/`bottom` are the rows that should land on the body's start and end points.
 */
const ANCHORS: Record<string, { span: number; top: number; bottom: number }> = {
  tee: { span: 0.38, top: 0.12, bottom: 0.89 },
  shirt: { span: 0.36, top: 0.1, bottom: 0.9 },
  tank: { span: 0.4, top: 0.1, bottom: 0.9 },
  sweater: { span: 0.4, top: 0.14, bottom: 0.86 },
  jacket: { span: 0.4, top: 0.09, bottom: 0.92 },
  pants: { span: 0.44, top: 0.08, bottom: 0.94 },
  shorts: { span: 0.52, top: 0.22, bottom: 0.75 },
  skirt: { span: 0.32, top: 0.12, bottom: 0.9 },
  dress: { span: 0.24, top: 0.06, bottom: 0.94 },
  shoe: { span: 0.85, top: 0.44, bottom: 0.79 },
  scarf: { span: 0.48, top: 0.1, bottom: 0.9 },
};

export interface Fit { x: number; y: number; w: number; h?: number }

export function fitPiece(snap: PieceSnapshot, b: Body): Fit {
  const shape = RACK_BY_ID[snap.rack].shape;
  const torso = b.hipY - b.shoulderY, leg = b.ankleY - b.hipY;
  // [width to match, where it starts, where it ends], from the body
  const target: Record<string, [number, number, number]> = {
    tee: [b.shoulderW, b.shoulderY - torso * 0.04, b.hipY + torso * 0.08],
    shirt: [b.shoulderW, b.shoulderY - torso * 0.05, b.hipY + torso * 0.1],
    tank: [b.shoulderW * 0.95, b.shoulderY - torso * 0.06, b.hipY + torso * 0.05],
    sweater: [b.shoulderW, b.shoulderY - torso * 0.04, b.hipY + torso * 0.04],
    jacket: [b.shoulderW * 1.06, b.shoulderY - torso * 0.06, b.hipY + torso * 0.22],
    pants: [b.hipW, b.hipY - torso * 0.12, b.ankleY + leg * 0.02],
    shorts: [b.hipW * 1.02, b.hipY - torso * 0.12, b.hipY + (b.kneeY - b.hipY) * 0.5],
    skirt: [b.hipW * 0.82, b.hipY - torso * 0.14, b.kneeY + (b.ankleY - b.kneeY) * 0.25],
    dress: [b.shoulderW * 0.62, b.shoulderY - torso * 0.06, b.kneeY + (b.ankleY - b.kneeY) * 0.2],
    shoe: [b.feetW * 1.3, b.ankleY - leg * 0.03, b.ankleY + leg * 0.05],
    scarf: [b.shoulderW * 0.7, b.shoulderY - torso * 0.12, b.shoulderY + torso * 0.65],
  };
  if (snap.image_url) {
    // A photo can't be stretched without looking wrong. Give it the whole zone its garment covers
    // (wide enough for sleeves or a flat-laid leg), and the image grows to fill that box at its own
    // proportions, pinned to the top so the collar/waistband lands on the shoulders/waist.
    const [tw, y0, y1] = target[shape] ?? [b.shoulderW * 0.6, b.hipY - 4, b.hipY + 4];
    const across: Record<string, number> = { tee: 2.3, shirt: 2.2, tank: 1.6, sweater: 2.3, jacket: 2.3, pants: 1.7,
      shorts: 1.6, skirt: 1.6, dress: 2.6, shoe: 1.3, scarf: 1.3 };
    const h = (y1 - y0) * (shape === "shoe" ? 1.6 : 1.04);
    return { x: b.cx, y: y0 + h / 2 - (shape === "shoe" ? (y1 - y0) * 0.6 : 0), w: tw * (across[shape] ?? 1.4), h };
  }
  const a = ANCHORS[shape];
  if (!a) { // bags, jewellery, socks: by the hip, not stretched
    return { x: b.cx + b.shoulderW * 0.75, y: b.hipY, w: b.shoulderW * 0.55 };
  }
  const [tw, y0, y1] = target[shape];
  const w = tw / a.span;
  const h = (y1 - y0) / (a.bottom - a.top);
  const top = y0 - a.top * h;
  return { x: b.cx, y: top + h / 2, w, h };
}
