import { assetUrl } from "../lib/api";
import { RACK_BY_ID, type RackId } from "../lib/racks";
import { Silhouette } from "./Silhouette";

/** Stable small tilt per item, so stickers look hand-placed but don't jump around between renders. */
export function tiltFor(id: string, range = 4): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % (range * 20 + 1)) / 10) - range;
}

interface Props {
  id: string;
  name: string;
  hex: string;
  rack: RackId;
  image?: string | null;
  size?: number;
  tilt?: boolean;
  dim?: boolean;
  className?: string;
}

/** A die-cut sticker: the cut-out photo (or a drawn silhouette) with a white border and a soft drop shadow. */
export function Sticker({ id, name, hex, rack, image, size = 120, tilt = true, dim, className = "" }: Props) {
  const src = assetUrl(image);
  return (
    <div
      className={`sticker ${dim ? "is-dim" : ""} ${className}`}
      style={{ width: size, height: size, rotate: tilt ? `${tiltFor(id)}deg` : undefined }}
      title={name}
    >
      {src ? (
        <img src={src} alt={name} draggable={false} loading="lazy" />
      ) : (
        <Silhouette shape={RACK_BY_ID[rack].shape} hex={hex} />
      )}
    </div>
  );
}
