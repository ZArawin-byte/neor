import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLionMenu } from "../components/LionMenu";
import { WardrobeScene, type SpotId } from "../components/WardrobeScene";
import { MASCOT, mascotTitle } from "../lib/mascot";
import "../styles/room.css";

/**
 * Inside the wardrobe. The scene is drawn in a 1600x900 SVG (components/WardrobeScene.tsx);
 * tags are positioned in the same coordinates, as percentages of the stage.
 */
const SPOTS: Record<SpotId, { to: string; title: string; blurb: string; at: [number, number]; side: "left" | "right" | "below" }> = {
  archive: { to: "/archive", title: "Archival looks", blurb: "Every look you have saved, favourites first.", at: [425, 62], side: "right" },
  profile: { to: "/profile", title: "Profile", blurb: "Age, fit, faith and style: what Neor should know about you.", at: [445, 150], side: "right" },
  closet: { to: "/closet", title: "Closet", blurb: "Your creative space: everything you own, ready to mix.", at: [565, 330], side: "right" },
  window: { to: "/window", title: "Window", blurb: "A map of cafes and photo spots, with outfits to match each one.", at: [800, 596], side: "below" },
  lion: { to: "/critique", title: "The lion", blurb: "A closet critique, and the essentials you may be missing. Right-click to see him in action.", at: [728, 470], side: "left" },
  mirror: { to: "/mirror", title: "Mirror", blurb: "Upload a photo and try on whatever is on your table.", at: [1056, 300], side: "left" },
};

export default function Room() {
  const nav = useNavigate();
  const { state } = useLocation();
  const [active, setActive] = useState<SpotId | null>(null);
  const lion = useLionMenu();
  const spot = active && SPOTS[active];

  return (
    <main className={`room ${state?.fromDoors ? "from-doors" : ""}`}>
      <div className="room-stage">
        <WardrobeScene
          active={active}
          onEnter={setActive}
          onLeave={() => setActive(null)}
          onOpen={(id) => nav(SPOTS[id].to)}
          onLionContext={lion.onContextMenu}
        />
        {spot && (
          <span className={`spot-tag tag-${spot.side}`} style={{ left: `${(spot.at[0] / 1600) * 100}%`, top: `${(spot.at[1] / 900) * 100}%` }}>
            {active === "lion" && <img className="tag-photo" src={MASCOT.photo} alt="" />}
            <strong>{active === "lion" ? mascotTitle() : spot.title}</strong>
            <span>{spot.blurb}</span>
          </span>
        )}
      </div>
      <span className="room-sign" aria-hidden="true">Neor</span>
      {lion.menu}
      <p className="room-hint">
        <span className="for-mouse">Everything in here opens. Hover around.</span>
        <span className="for-touch">Swipe to look around. Tap anything.</span>
      </p>
    </main>
  );
}
