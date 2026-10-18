import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { assetUrl } from "../lib/api";
import { fitPiece, type Body } from "../lib/body";
import { dropPoint } from "../lib/dropPoint";
import { RACK_BY_ID, slotOf } from "../lib/racks";
import type { BoardPiece, WornPiece } from "../lib/types";
import { Icon } from "./Icon";
import { Silhouette } from "./Silhouette";
import { Sticker } from "./Sticker";

type Drag = { kind: "table"; piece: BoardPiece } | { kind: "worn"; key: string };

/** Starting width of a piece on your photo, as % of the mirror's width, by what it is. */
const START_W: Record<string, number> = { top: 46, layer: 54, bottom: 40, onepiece: 52, shoes: 26, extra: 22 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Drop where the pointer is; keyboard drags have no pointer, so fall back to overlap. */
const underPointer: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args));

function Garment({ snap, stretch }: { snap: BoardPiece["snap"]; stretch?: boolean }) {
  const src = assetUrl(snap.image_url);
  return src
    ? <img src={src} alt={snap.name} draggable={false} style={snap.rotation ? { rotate: `${snap.rotation}deg` } : undefined} />
    : <Silhouette shape={RACK_BY_ID[snap.rack].shape} hex={snap.hex} stretch={stretch} />;
}

function Worn({ w, selected, onSelect }: { w: WornPiece; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `worn:${w.key}`, data: { kind: "worn", key: w.key } satisfies Drag,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`worn ${w.h ? "is-fitted" : ""} ${selected ? "is-selected" : ""} ${isDragging ? "is-moving" : ""}`}
      style={{
        left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: w.h ? `${w.h}%` : undefined, zIndex: w.z,
        rotate: `${w.rot}deg`,
        translate: transform ? `calc(-50% + ${transform.x}px) calc(-50% + ${transform.y}px)` : "-50% -50%",
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      aria-label={`${w.snap.name} - select to resize or remove`}
    >
      <Garment snap={w.snap} stretch={!!w.h} />
    </div>
  );
}

function TablePiece({ p, onWear }: { p: BoardPiece; onWear: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `table:${p.key}`, data: { kind: "table", piece: p } satisfies Drag,
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`mini-piece ${isDragging ? "is-lifted" : ""}`}
      style={{ left: `${p.x}%`, top: `${p.y}%`, rotate: `${p.rot}deg` }}
      onClick={onWear}
      title={`Drag ${p.snap.name} onto yourself, or tap to try it on`}
    >
      <Sticker id={p.key} name={p.snap.name} hex={p.snap.hex} rack={p.snap.rack} image={p.snap.image_url} size={84} tilt={false} turn={p.snap.rotation} />
    </button>
  );
}

/** The drop target. It has to be its own component so its hook runs inside the DndContext. */
function Glass({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "glass" });
  return <div ref={setNodeRef} className={`mirror-glass ${isOver ? "is-over" : ""}`} onClick={onClick}>{children}</div>;
}

export function TryOn({ photo, body, onFitPhoto, pieces, worn, setWorn, boardName, emptyMirror, tableFooter }: {
  photo: string | null;
  /** Where the body is in the photo; when known, every piece is sized and placed to it. */
  body: Body | null;
  /** Crop and measure a photo uploaded before fitting existed. */
  onFitPhoto: () => void;
  pieces: BoardPiece[];
  worn: WornPiece[];
  setWorn: (next: WornPiece[]) => void;
  boardName: string;
  emptyMirror: ReactNode;
  tableFooter: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [held, setHeld] = useState<BoardPiece | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const top = () => worn.reduce((m, w) => Math.max(m, w.z), 0) + 1;

  function wear(p: BoardPiece, x = 50, y?: number) {
    const slot = slotOf(p.snap.rack);
    if (body) { // snap to the body, wherever it was dropped
      const key = `${p.key}-${Date.now()}`;
      setWorn([...worn, { key, snap: p.snap, ...fitPiece(p.snap, body), rot: 0, z: zFor(slot) }]);
      setSelected(key);
      return;
    }
    // Rough body positions so a tap lands somewhere sensible: tops at the chest, shoes at the feet.
    const yBySlot: Record<string, number> = { top: 36, layer: 38, onepiece: 48, bottom: 64, shoes: 90, extra: 30 };
    const key = `${p.key}-${Date.now()}`;
    setWorn([...worn, { key, snap: p.snap, x, y: y ?? yBySlot[slot] ?? 50, w: START_W[slot] ?? 30, rot: 0, z: top() }]);
    setSelected(key);
  }

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as Drag | undefined;
    setHeld(d?.kind === "table" ? d.piece : null);
  }

  function onDragEnd(e: DragEndEvent) {
    setHeld(null);
    const d = e.active.data.current as Drag | undefined;
    const pt = dropPoint(e);
    if (!d) return;
    if (e.over?.id === "glass" && pt) {
      const x = clamp(pt.x, 4, 96);
      const y = clamp(pt.y, 3, 97);
      if (d.kind === "table") wear(d.piece, x, y);
      else setWorn(worn.map((w) => (w.key === d.key ? { ...w, x, y } : w)));
    } else if (d.kind === "worn") {
      setWorn(worn.filter((w) => w.key !== d.key)); // dragged off the mirror: take it off
    }
  }

  // Layers stack the way clothes do: trousers under tops under jackets, shoes and extras on top.
  const zFor = (slot: string) => ({ bottom: 1, onepiece: 2, top: 3, layer: 4, shoes: 5, extra: 6 }[slot] ?? 3) * 10 + worn.length;
  const fitAll = () => body && setWorn(worn.map((w) => ({ ...w, ...fitPiece(w.snap, body), rot: 0 })));
  const sel = worn.find((w) => w.key === selected);
  const change = (patch: Partial<WornPiece>) => sel && setWorn(worn.map((w) => (w.key === sel.key ? { ...w, ...patch } : w)));

  return (
    // Auto-scroll only in a thin band at the window edge: the mirror runs close to the bottom of the
    // screen, and the default (20%) scrolled the page away while you were dropping shoes on your feet.
    <DndContext sensors={sensors} collisionDetection={underPointer} autoScroll={{ threshold: { x: 0, y: 0.06 } }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setHeld(null)}>
      <div className="mirror-layout">
        <div className="mirror-col">
          <div className="mirror-frame">
            <Glass onClick={() => setSelected(null)}>
              {photo ? <img className="mirror-photo" src={photo} alt="You, full length" draggable={false} /> : emptyMirror}
              {worn.map((w) => <Worn key={w.key} w={w} selected={w.key === selected} onSelect={() => setSelected(w.key)} />)}
              <span className="sheen" />
            </Glass>
          </div>

          <div className={`tryon-tools ${sel ? "is-on" : ""}`} role="toolbar" aria-label="Adjust the selected piece">
            {sel ? (
              <>
                <span className="tool-name">{sel.snap.name}</span>
                <button className="icon-btn" onClick={() => change({ w: clamp(sel.w / 1.12, 8, 95), h: sel.h && sel.h / 1.12 })} aria-label="Smaller">−</button>
                <button className="icon-btn" onClick={() => change({ w: clamp(sel.w * 1.12, 8, 95), h: sel.h && sel.h * 1.12 })} aria-label="Bigger">+</button>
                <button className="icon-btn" onClick={() => change({ rot: sel.rot - 5 })} aria-label="Rotate left">↺</button>
                <button className="icon-btn" onClick={() => change({ rot: sel.rot + 5 })} aria-label="Rotate right">↻</button>
                <button className="icon-btn" onClick={() => change({ z: top() })} aria-label="Bring to front" title="Bring to front">⇡</button>
                <button className="icon-btn" onClick={() => { setWorn(worn.filter((w) => w.key !== sel.key)); setSelected(null); }} aria-label="Take it off">
                  <Icon name="trash" size={16} />
                </button>
              </>
            ) : (
              <span className="tool-hint">
                {worn.length ? "Tap a piece on you to resize, turn or remove it." : "Drag pieces from your table onto yourself, or tap one to try it on."}
              </span>
            )}
            {photo && !sel && (body
              ? worn.length > 0 && <button className="btn ghost sm" onClick={fitAll}>Fit to me</button>
              : <button className="btn ghost sm" onClick={onFitPhoto}>Crop &amp; fit to my photo</button>)}
            {worn.length > 0 && !sel && <button className="btn ghost sm" onClick={() => setWorn([])}>Take it all off</button>}
          </div>
        </div>

        <aside className="mirror-board">
          <div className="mini-table">
            <p className="mini-title">{boardName}</p>
            {pieces.length === 0 ? (
              <div className="mini-empty">{tableFooter}</div>
            ) : (
              <div className="mini-top">
                {pieces.map((p) => <TablePiece key={p.key} p={p} onWear={() => wear(p)} />)}
              </div>
            )}
          </div>
          {pieces.length > 0 && tableFooter}
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {held && <Sticker id={held.key} name={held.snap.name} hex={held.snap.hex} rack={held.snap.rack} image={held.snap.image_url} size={96} tilt={false} className="is-held" />}
      </DragOverlay>
    </DndContext>
  );
}
