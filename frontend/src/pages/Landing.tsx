import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { WardrobeScene } from "../components/WardrobeScene";
import { FEATURES } from "../features";
import { isSignedIn, signInWithGoogle } from "../lib/auth";
import "../styles/landing.css";

type Phase = "idle" | "orient" | "open" | "enter";

/**
 * One oak door leaf, drawn as SVG with procedural grain. If /doors/oak-left.jpg (or -right)
 * exists in public/, that photo is laid over the drawing instead - see FRONTEND_SPEC.md §2.
 */
function Door({ side }: { side: "left" | "right" }) {
  const [photo, setPhoto] = useState(true);
  const seed = side === "left" ? 7 : 19;
  const id = (k: string) => `${k}-${side}`;
  return (
    <div className={`door door-${side}`}>
      <div className="door-face">
        <svg viewBox="0 0 300 720" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={id("oak")} x1="0" y1="0" x2="1" y2="0.1">
              <stop offset="0" stopColor="#b9864d" />
              <stop offset="0.5" stopColor="#a77440" />
              <stop offset="1" stopColor="#8f5f33" />
            </linearGradient>
            <filter id={id("grain")} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.045 0.0018" numOctaves="5" seed={seed} />
              <feColorMatrix values="0 0 0 0 0.22  0 0 0 0 0.11  0 0 0 0 0.04  0 0 0 3.2 -1.4" />
              <feComposite in2="SourceGraphic" operator="in" />
            </filter>
            <filter id={id("pores")} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9 0.02" numOctaves="1" seed={seed + 3} />
              <feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0 0.03  0 0 0 2.2 -1.25" />
              <feComposite in2="SourceGraphic" operator="in" />
            </filter>
            {/* Lamplight from the sconce on this door's side, falling off across the leaf. */}
            <radialGradient id={id("lamp")} cx={side === "left" ? "0" : "1"} cy="0.38" r="0.9">
              <stop offset="0" stopColor="#ffc56e" stopOpacity="0.38" />
              <stop offset="1" stopColor="#ffc56e" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id("floor-dark")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.55" stopColor="#140a03" stopOpacity="0" />
              <stop offset="1" stopColor="#140a03" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          <rect width="300" height="720" fill={`url(#${id("oak")})`} />
          <rect width="300" height="720" fill="#000" filter={`url(#${id("grain")})`} />
          <rect width="300" height="720" fill="#000" filter={`url(#${id("pores")})`} />

          {/* Three raised-and-fielded panels: tall, small lock rail, tall. */}
          {[[38, 48, 224, 300], [38, 372, 224, 54], [38, 450, 224, 228]].map(([x, y, w, h], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill="#000" opacity="0.1" />
              <path d={`M${x} ${y + h} V${y} H${x + w}`} fill="none" stroke="#2b1607" strokeWidth="5" opacity="0.6" />
              <path d={`M${x + w} ${y} V${y + h} H${x}`} fill="none" stroke="#f0c48a" strokeWidth="2.5" opacity="0.4" />
              <rect x={x + 16} y={y + 16} width={w - 32} height={h - 32} fill="none" stroke="#f0c48a" strokeWidth="1" opacity="0.18" />
              <rect x={x + 17} y={y + 17} width={w - 34} height={h - 34} fill="none" stroke="#2b1607" strokeWidth="1" opacity="0.35" />
            </g>
          ))}
          <rect width="300" height="720" fill={`url(#${id("lamp")})`} />
          <rect width="300" height="720" fill={`url(#${id("floor-dark")})`} />
        </svg>
        {photo && <img className="door-photo" src={`/doors/oak-${side}.jpg`} alt="" onError={() => setPhoto(false)} />}
        <span className="handle" />
        <span className="escutcheon" />
      </div>
    </div>
  );
}

function Sconce({ side }: { side: "left" | "right" }) {
  return (
    <span className={`sconce sconce-${side}`} aria-hidden="true">
      <span className="sconce-wash" />
      <span className="sconce-plate" />
      <span className="sconce-arm" />
      <span className="sconce-shade" />
    </span>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const walkIn = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return nav("/room");
    setPhase("orient");
    setTimeout(() => setPhase("open"), 700);
    setTimeout(() => setPhase("enter"), 2000);
    setTimeout(() => nav("/room", { state: { fromDoors: true } }), 2800);
  };

  useEffect(() => {
    isSignedIn().then((yes) => {
      setSignedIn(yes);
      if (yes && params.get("entering")) walkIn(); // just came back from Google
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGoogle = async () => {
    setBusy(true);
    if (await signInWithGoogle()) walkIn(); // demo mode signs in on the spot; real OAuth redirects
    else setBusy(false);
  };

  return (
    <main className={`hall phase-${phase}`}>
      <div className="hall-scene">
        <div className="hall-floor">
          <div className="parquet">
            <span className="runner" />
            <span className="pool" />
          </div>
        </div>

        <div className="hall-wall">
          <div className="paper" />
          <div className="dado">
            {Array.from({ length: 16 }, (_, i) => <span key={i} className="panel" />)}
          </div>
          <div className="skirting" />

          <div className="casing">
            <Sconce side="left" />
            <Sconce side="right" />
            <div className="transom">
              <span className="gilt">Neor</span>
            </div>
            <div className="doorway">
              <div className="beyond" aria-hidden="true">
                {/* The real wardrobe, so the doors open onto the same room you walk into. */}
                <WardrobeScene active={null} onEnter={() => {}} onLeave={() => {}} onOpen={() => {}} onLionContext={() => {}} showMarket={FEATURES.some((f) => f.id === "bargains")} />
              </div>
              <div className="seam" />
              <Door side="left" />
              <Door side="right" />
            </div>
          </div>
        </div>
      </div>
      <div className="hall-vignette" aria-hidden="true" />
      <div className="hall-grain" aria-hidden="true" />

      <aside className="hall-side">
        <div className="entry-card">
          <span className="card-pin" aria-hidden="true" />
          <p className="card-kicker">Neor · a Narnia-style wardrobe</p>
          <h1>Come in. The lamps are on.</h1>
          <p className="card-copy">Step through the wardrobe, like the children in Narnia. Inside: your clothes, a mirror that tells the truth, and a lion with opinions.</p>
          {signedIn ? (
            <button className="btn-enter" onClick={walkIn} disabled={phase !== "idle"}>Step inside</button>
          ) : (
            <button className="btn-google" onClick={onGoogle} disabled={busy || phase !== "idle"}>
              <GoogleG />
              <span>{busy ? "Opening…" : "Sign in with Google"}</span>
            </button>
          )}
          <p className="card-fine">Private by default. Your photos are only ever shown to you.</p>
        </div>
        {/* feature notices sit side by side under the card, so adding one never pushes the card off screen */}
        <div className="hall-notices">
          {FEATURES.map((f) => f.HallwayNotice && <f.HallwayNotice key={f.id} />)}
        </div>
      </aside>
    </main>
  );
}
