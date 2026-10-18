import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { harmonyOf } from "../lib/color";
import { slotOf, type RackId } from "../lib/racks";
import { completeTheTable, fromItem, fromProduct, type Piece } from "../lib/stylist";
import type { BoardPiece, Item, OutfitResult, Product } from "../lib/types";
import { Icon } from "./Icon";
import { Sticker } from "./Sticker";

export type DragData =
  | { kind: "piece"; piece: Piece } // from the closet grid or the recommendations
  | { kind: "placed"; key: string }; // already on the table, being moved

export const toSnap = (p: Piece): BoardPiece["snap"] => ({
  name: p.name, hex: p.hex, rack: p.rack, image_url: p.image_url, price: p.price, brand: p.brand, rotation: p.rotation,
});

// ---------------------------------------------------------------- draggable sticker

export function DraggablePiece({ id, piece, size = 110, dim, caption, onTurn, onDelete }: {
  id: string; piece: Piece; size?: number; dim?: boolean; caption?: string;
  /** shows turn buttons on hover; called with -90 or +90 */
  onTurn?: (by: number) => void;
  /** shows a bin button on hover */
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { kind: "piece", piece } satisfies DragData });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`dragpiece ${isDragging ? "is-lifted" : ""}`}>
      <Sticker id={piece.id} name={piece.name} hex={piece.hex} rack={piece.rack} image={piece.image_url} size={size} dim={dim} turn={piece.rotation} />
      <span className="dragpiece-name">{caption ?? piece.name}</span>
      {(onTurn || onDelete) && (
        // pointer-down is stopped so pressing these never starts a drag
        <span className="turn-btns on-piece" onPointerDown={(e) => e.stopPropagation()}>
          {onTurn && <button className="icon-btn" title="Turn left" aria-label={`Turn ${piece.name} left`} onClick={() => onTurn(-90)}>↺</button>}
          {onTurn && <button className="icon-btn" title="Turn right" aria-label={`Turn ${piece.name} right`} onClick={() => onTurn(90)}>↻</button>}
          {onDelete && <button className="icon-btn is-danger" title="Remove from closet" aria-label={`Remove ${piece.name} from your closet`} onClick={onDelete}><Icon name="trash" size={15} /></button>}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bookmark table

function PlacedPiece({ p, onRemove }: { p: BoardPiece; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `placed:${p.key}`, data: { kind: "placed", key: p.key } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={`placed ${isDragging ? "is-moving" : ""}`}
      style={{
        left: `${p.x}%`, top: `${p.y}%`, rotate: `${p.rot}deg`,
        translate: transform ? `calc(-50% + ${transform.x}px) calc(-50% + ${transform.y}px)` : "-50% -50%",
      }}
    >
      <div {...listeners} {...attributes}>
        <Sticker id={p.key} name={p.snap.name} hex={p.snap.hex} rack={p.snap.rack} image={p.snap.image_url} size={118} tilt={false} turn={p.snap.rotation} />
      </div>
      {p.source === "market" && <span className="price-tag">${p.snap.price}</span>}
      <button className="placed-x" onClick={onRemove} aria-label={`Take ${p.snap.name} off the table`}><Icon name="x" size={12} /></button>
    </div>
  );
}

export function BookmarkTable({ pieces, onRemove, onClear, onSave, boardName, setBoardName }: {
  pieces: BoardPiece[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onSave: () => void;
  boardName: string;
  setBoardName: (s: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "table" });
  const harmony = harmonyOf(pieces.map((p) => p.snap.hex));
  return (
    <section className="table-wrap" aria-label="Bookmark table">
      <div className="table-head">
        <input className="board-name" value={boardName} onChange={(e) => setBoardName(e.target.value)} aria-label="Name this table" />
        {pieces.length > 0 && <span className="harmony-pill">{harmony.name} · {harmony.score}</span>}
        <div className="table-actions">
          <button className="btn ghost sm" onClick={onClear} disabled={!pieces.length}>Clear</button>
          <button className="btn ghost sm" onClick={onSave} disabled={!pieces.length}>Save</button>
          <Link to="/mirror" className={`btn sm ${pieces.length ? "" : "is-disabled"}`} aria-disabled={!pieces.length}>
            <Icon name="mirror" size={15} /> Try it on
          </Link>
        </div>
      </div>
      <div ref={setNodeRef} className={`table-top ${isOver ? "is-over" : ""}`}>
        <span className="ribbon" aria-hidden="true" />
        {pieces.length === 0 && (
          <p className="table-empty">Drag pieces here to plan an outfit. Nothing leaves your closet; this is just the table.</p>
        )}
        {pieces.map((p) => <PlacedPiece key={p.key} p={p} onRemove={() => onRemove(p.key)} />)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- laundry basket

export function LaundryBasket({ items, onReturn }: { items: Item[]; onReturn: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "basket" });
  const [open, setOpen] = useState(false);
  return (
    <div className={`basket ${isOver ? "is-over" : ""}`} ref={setNodeRef}>
      <button className="basket-body" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="basket-weave" />
        <span className="basket-label">
          Laundry basket <b>{items.length}</b>
        </span>
      </button>
      <p className="basket-help">Drop things you're not wearing out. They stay yours; neor just won't suggest them.</p>
      {open && (
        <div className="basket-pop">
          {items.length === 0 ? <p>Empty.</p> : items.map((i) => (
            <div key={i.id} className="basket-row">
              <span className="swatch" style={{ background: i.hex }} />
              <span>{i.name}</span>
              <button className="btn ghost sm" onClick={() => onReturn(i.id)}>Put back</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- AI recommendations

type Source = "both" | "closet" | "market";
type Weather = "" | "hot" | "mild" | "cold" | "rain";

const WEATHER_SKIP: Record<Weather, RackId[]> = {
  "": [], mild: [], hot: ["sweaters", "jackets", "scarves"], cold: ["shorts", "tanks"], rain: ["shorts"],
};

export function Recommendations({ closet, catalog, table, offline }: {
  closet: Item[]; catalog: Product[]; table: BoardPiece[]; offline: boolean;
}) {
  const [source, setSource] = useState<Source>("both");
  const [occasion, setOccasion] = useState("");
  const [season, setSeason] = useState("");
  const [weather, setWeather] = useState<Weather>("");
  const [asked, setAsked] = useState<OutfitResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  const keep = (p: Piece) =>
    (!occasion || !p.occasions?.length || p.occasions.includes(occasion)) &&
    (!season || !p.seasons?.length || p.seasons.includes("all") || p.seasons.includes(season)) &&
    !WEATHER_SKIP[weather].includes(p.rack);

  const candidates = useMemo(() => [
    ...(source !== "market" ? closet.filter((i) => !i.laundry).map(fromItem) : []),
    ...(source !== "closet" ? catalog.map(fromProduct) : []),
  ].filter(keep), [closet, catalog, source, occasion, season, weather]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTable: Piece[] = table.map((t) => ({ source: t.source, id: t.refId, name: t.snap.name, hex: t.snap.hex, rack: t.snap.rack }));
  const local = completeTheTable(onTable, candidates);

  async function ask() {
    setAsking(true);
    setAskError("");
    try {
      setAsked(await api.outfit({ occasion: occasion || "everyday", season, place: weather ? `${weather} weather` : "" }));
    } catch {
      setAskError("neor couldn't be reached. The suggestions below still work offline.");
    } finally {
      setAsking(false);
    }
  }

  const askedPieces: Piece[] = asked ? [
    ...(source !== "market" ? asked.closet_ids.map((id) => closet.find((i) => i.id === id)).filter((i): i is Item => !!i && !i.laundry).map(fromItem) : []),
    ...(source !== "closet" ? asked.missing.map((m) => catalog.find((p) => p.id === m.catalog_id)).filter((p): p is Product => !!p).map(fromProduct) : []),
  ] : [];

  return (
    <section className="recs" aria-label="Recommendations">
      <div className="recs-head">
        <h3>neor suggests</h3>
        <button className="btn sm" onClick={ask} disabled={asking || offline}>
          <Icon name="spark" size={14} /> {asking ? "Thinking..." : "Ask for a full look"}
        </button>
      </div>

      <div className="filters">
        <div className="seg" role="radiogroup" aria-label="Where from">
          {(["both", "closet", "market"] as Source[]).map((s) => (
            <button key={s} role="radio" aria-checked={source === s} className={source === s ? "is-on" : ""} onClick={() => setSource(s)}>
              {s === "both" ? "Everything" : s === "closet" ? "My closet" : "To buy"}
            </button>
          ))}
        </div>
        <select value={occasion} onChange={(e) => setOccasion(e.target.value)} aria-label="Occasion">
          <option value="">Any occasion</option>
          {["everyday", "uni", "birthday", "wedding", "gym"].map((o) => <option key={o} value={o}>{o === "uni" ? "Class" : o[0].toUpperCase() + o.slice(1)}</option>)}
        </select>
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          <option value="">Any season</option>
          {["spring", "summer", "fall", "winter"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={weather} onChange={(e) => setWeather(e.target.value as Weather)} aria-label="Weather">
          <option value="">Any weather</option>
          <option value="hot">Hot</option>
          <option value="mild">Mild</option>
          <option value="cold">Cold</option>
          <option value="rain">Rainy</option>
        </select>
      </div>

      {askError && <p className="error">{askError}</p>}
      {asked && (
        <div className="asked">
          <p className="asked-title">{asked.title}</p>
          <p>{asked.why}</p>
          {asked.styling_tip && <p className="tip">{asked.styling_tip}</p>}
          <div className="rec-row">
            {askedPieces.map((p) => (
              <DraggablePiece key={`ask:${p.source}:${p.id}`} id={`ask:${p.source}:${p.id}`} piece={p} size={84}
                caption={p.source === "market" ? `${p.name} · $${p.price}` : p.name} />
            ))}
          </div>
        </div>
      )}

      <p className="recs-sub">
        {table.length
          ? `To round out the table (${[...new Set(onTable.map((p) => slotOf(p.rack)))].join(", ")} covered):`
          : "Good places to start:"}
      </p>
      <div className="rec-row">
        {local.length === 0 && <p className="muted">Nothing matches these filters. Loosen one?</p>}
        {local.map(({ piece, reason }) => (
          <div key={`${piece.source}:${piece.id}`} className="rec">
            <DraggablePiece id={`rec:${piece.source}:${piece.id}`} piece={piece} size={84}
              caption={piece.source === "market" ? `${piece.name} · $${piece.price}` : piece.name} />
            <span className="rec-why">{piece.source === "market" ? "Shop · " : ""}{reason}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
