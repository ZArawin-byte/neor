import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLionMenu } from "../components/LionMenu";
import { WardrobeScene, type SpotId } from "../components/WardrobeScene";
import { FEATURES } from "../features";
import { MASCOT, mascotTitle } from "../lib/mascot";
import "../styles/room.css";

/**
 * Inside the wardrobe. The scene is drawn in a 1600x900 SVG (components/WardrobeScene.tsx);
 * tags are positioned in the same coordinates, as percentages of the stage.
 */
const SPOTS: Record<SpotId, { to: string; title: string; blurb: string; at: [number, number]; side: "left" | "right" | "below" }> = {
  archive: { to: "/archive", title: "The archive", blurb: "Every outfit you have saved, sketched and pinned to the board.", at: [1104, 600], side: "below" },
  profile: { to: "/profile", title: "Profile", blurb: "Age, fit, faith and style: what Neor should know about you.", at: [300, 150], side: "right" },
  lazy: { to: "/lazy", title: "Lazy mode", blurb: "Just input your Google Calendar and your location and you'll receive outfits based off the climate and events.", at: [470, 158], side: "right" },
  closet: { to: "/closet", title: "Closet", blurb: "Your creative space: everything you own, ready to mix.", at: [565, 330], side: "right" },
  window: { to: "/window", title: "Window", blurb: "A map of cafes and photo spots, with outfits to match each one.", at: [800, 596], side: "below" },
  lion: { to: "/critique", title: "The lion", blurb: "A closet critique, and the essentials you may be missing. Right-click to see him in action.", at: [728, 470], side: "left" },
  mirror: { to: "/mirror", title: "Mirror", blurb: "Upload a photo and try on whatever is on your table.", at: [1216, 300], side: "left" },
  market: { to: "/bargains", title: "Bargain market", blurb: "Good clothes going cheap around you this week.", at: [1022, 290], side: "left" },
};

export default function Room() {
  const nav = useNavigate();
  const { state } = useLocation();
  const [active, setActive] = useState<SpotId | null>(null);
  const [explored, setExplored] = useState(false); // the hint stays until they've found something
  const lion = useLionMenu();
  const spot = active && SPOTS[active];
  const roomRef = useRef<HTMLElement>(null);
  const openedAt = useRef(Date.now());

  // On narrow screens the room pans sideways; open it centred on the lion rather than the coats.
  useEffect(() => {
    const el = roomRef.current;
    // only when the room actually pans (portrait phones); on desktop it is cropped, not scrolled
    if (el && getComputedStyle(el).overflowX === "auto" && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth * (886 / 1600) - el.clientWidth / 2;
  }, []);

  return (
    <main ref={roomRef} className={`room ${state?.fromDoors ? "from-doors" : ""}`}>
      <div className="room-stage">
        <WardrobeScene
          active={active}
          onEnter={(id) => {
            setActive(id);
            // Ignore the synthetic hover browsers fire when the page scrolls itself on load.
            if (Date.now() - openedAt.current > 1500) setExplored(true);
          }}
          onLeave={() => setActive(null)}
          onOpen={(id) => nav(SPOTS[id].to)}
          onLionContext={lion.onContextMenu}
          showMarket={FEATURES.some((f) => f.id === "bargains")}
        />
        {spot && (
          <span className={`spot-tag tag-${spot.side}`} style={{ left: `${(spot.at[0] / 1600) * 100}%`, top: `${(spot.at[1] / 900) * 100}%` }}>
            {active === "lion" && <img className="tag-photo" src={MASCOT.photo} alt="" />}
            <strong>{active === "lion" ? mascotTitle() : spot.title}</strong>
            <span>{spot.blurb}</span>
          </span>
        )}
      </div>
      <span className="room-sign" aria-hidden="true"><span>Neor</span></span>
      {lion.menu}
      <p className={`room-hint ${explored ? "is-quiet" : ""}`}>
        <span className="for-mouse">Hover over anything in the room. It all opens.</span>
        <span className="for-touch">Tap anything in the room. Swipe to look around.</span>
      </p>
    </main>
  );
}
