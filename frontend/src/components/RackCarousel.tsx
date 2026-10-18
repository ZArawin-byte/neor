import { useRef } from "react";
import { guessRack, RACK_BY_ID, type RackId } from "../lib/racks";
import type { Item } from "../lib/types";
import { Icon } from "./Icon";
import { Sticker } from "./Sticker";

/**
 * A row of round clothing racks, one per category the user actually owns.
 * Each rack is a little 3D carousel: garments hang around a brass ring and turn slowly.
 * Swipe/scroll sideways to browse racks; tap to pick up to two.
 */
export function RackCarousel({ racks, selected, onToggle }: {
  racks: { id: RackId; items: Item[] }[];
  selected: RackId[];
  onToggle: (id: RackId) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: "smooth" });
  const size = racks.length <= 2 ? "lg" : racks.length <= 4 ? "md" : "sm";

  return (
    <div className="racks">
      {racks.length > 3 && (
        <>
          <button className="racks-arrow left" onClick={() => scrollBy(-1)} aria-label="Previous racks"><Icon name="back" /></button>
          <button className="racks-arrow right" onClick={() => scrollBy(1)} aria-label="More racks"><Icon name="next" /></button>
        </>
      )}
      <div className={`racks-strip size-${size}`} ref={strip}>
        {racks.map(({ id, items }) => {
          const order = selected.indexOf(id);
          const shown = items.slice(0, 10);
          return (
            <button key={id} className={`rack ${order >= 0 ? "is-picked" : ""}`} onClick={() => onToggle(id)}
              aria-pressed={order >= 0}>
              <div className="rack-stage">
                <div className="rack-ring">
                  <div className="rack-rail" />
                  <div className="rack-pole" />
                  {shown.map((it, i) => (
                    // Spaced at least 360/7 degrees apart and centred on the front, so a rack
                    // with two pieces shows them side by side instead of one hidden behind the other.
                    <div className="rack-slot" key={it.id}
                      style={{ ["--a" as string]: `${(i - (shown.length - 1) / 2) * (360 / Math.max(shown.length, 7))}deg` }}>
                      <span className="hanger" />
                      <Sticker id={it.id} name={it.name} hex={it.hex ?? "#999"} rack={guessRack(it)} image={it.image_url} turn={it.rotation}
                        size={size === "lg" ? 130 : 96} tilt={false} dim={it.laundry} />
                    </div>
                  ))}
                </div>
                <div className="rack-base" />
              </div>
              <div className="rack-label">
                {order >= 0 && <span className="rack-num">{order + 1}</span>}
                <span className="rack-name">{RACK_BY_ID[id].label}</span>
                <span className="rack-count">{items.length}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
