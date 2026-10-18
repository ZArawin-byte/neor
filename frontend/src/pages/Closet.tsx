import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageFrame, useToast } from "../components/PageFrame";
import { RackCarousel } from "../components/RackCarousel";
import { Sticker, tiltFor } from "../components/Sticker";
import { BookmarkTable, DraggablePiece, LaundryBasket, Recommendations, toSnap, type DragData } from "../components/Studio";
import { UploadSheet } from "../components/UploadSheet";
import { api } from "../lib/api";
import { dropPoint } from "../lib/dropPoint";
import { useCloset, useRacks } from "../lib/closet";
import { guessRack, RACK_BY_ID, type RackId } from "../lib/racks";
import { saved } from "../lib/saved";
import { fromItem, type Piece } from "../lib/stylist";
import type { BoardPiece } from "../lib/types";
import "../styles/closet.css";

const clampPct = (v: number) => Math.min(92, Math.max(8, v));

export default function Closet() {
  const { items, catalog, loading, offline, patch, remove, reload } = useCloset();
  const racks = useRacks();
  const [params, setParams] = useSearchParams();
  const [uploading, setUploading] = useState(false);
  const [toast, say] = useToast();

  // ?racks=sweaters,pants keeps the open view shareable and survives refresh.
  const open = (params.get("racks")?.split(",").filter((r) => r in RACK_BY_ID) ?? []) as RackId[];
  const [picked, setPicked] = useState<RackId[]>(open);
  const studio = open.length > 0;

  const [table, setTable] = useState<BoardPiece[]>(() => saved.draft());
  const [boardName, setBoardName] = useState(() => `Table no. ${saved.boards().length + 1}`);
  const [dragging, setDragging] = useState<Piece | null>(null);
  useEffect(() => saved.saveDraft(table), [table]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const toggle = (id: RackId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as DragData | undefined;
    setDragging(d?.kind === "piece" ? d.piece : null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const d = e.active.data.current as DragData | undefined;
    const pt = dropPoint(e);
    if (!d) return;

    if (e.over?.id === "basket" && d.kind === "piece" && d.piece.source === "closet") {
      patch(d.piece.id, { laundry: true });
      say(<>{d.piece.name} is in the laundry basket. Neor won't suggest it until you put it back.</>);
      return;
    }
    if (e.over?.id === "table" && pt) {
      const x = clampPct(pt.x);
      const y = clampPct(pt.y);
      if (d.kind === "piece") {
        const key = `${d.piece.id}-${Date.now()}`;
        setTable((ps) => [...ps, { key, source: d.piece.source, refId: d.piece.id, x, y, rot: tiltFor(key, 6), snap: toSnap(d.piece) }]);
      } else {
        setTable((ps) => ps.map((p) => (p.key === d.key ? { ...p, x, y } : p)));
      }
      return;
    }
    // A table piece dragged off the table is taken off it.
    if (d.kind === "placed" && e.over?.id !== "table") setTable((ps) => ps.filter((p) => p.key !== d.key));
  }

  function saveTable() {
    saved.saveBoard({ name: boardName, pieces: table });
    say(<>Saved "{boardName}". <Link to="/mirror">Try it on in the mirror</Link></>);
    setBoardName(`Table no. ${saved.boards().length + 1}`);
  }

  const laundry = items.filter((i) => i.laundry);
  const addButton = (
    <button className="btn" onClick={() => setUploading(true)}><Icon name="plus" /> Add a piece</button>
  );

  return (
    <PageFrame title="The closet" kicker={studio ? `${open.map((r) => RACK_BY_ID[r].label).join(" + ")} · drag pieces onto the table` : "Choose up to two racks to work with"} actions={addButton} className="closet-page">
      {loading ? (
        <p className="muted center">Opening the closet...</p>
      ) : racks.length === 0 ? (
        <div className="empty-closet">
          <p className="display">Nothing hanging yet.</p>
          <p>Add your first piece and its rack appears. Or start with a sample closet to see how it works.</p>
          <div className="row">
            {addButton}
            {!offline && (
              <button className="btn ghost" onClick={async () => { await api.starterCloset(); reload(); }}>
                Use a sample closet
              </button>
            )}
          </div>
        </div>
      ) : !studio ? (
        <>
          <RackCarousel racks={racks} selected={picked} onToggle={toggle} />
          <div className={`pick-bar ${picked.length ? "is-up" : ""}`}>
            <span>
              {picked.length === 0 ? "Tap a rack" : picked.map((r) => RACK_BY_ID[r].label).join(" + ")}
              {picked.length === 1 && <small> · pick one more to build a combo, or open just this one</small>}
            </span>
            <button className="btn" disabled={!picked.length} onClick={() => setParams({ racks: picked.join(",") })}>
              Open {picked.length === 2 ? "both racks" : "rack"} <Icon name="next" size={16} />
            </button>
          </div>
        </>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="studio">
            <section className="studio-left">
              <div className="studio-left-head">
                <button className="link-back" onClick={() => { setPicked(open); setParams({}); }}>
                  <Icon name="back" size={14} /> All racks
                </button>
                <LaundryBasket items={laundry} onReturn={(id) => patch(id, { laundry: false })} />
              </div>
              {open.map((r) => {
                const its = items.filter((i) => guessRack(i) === r);
                return (
                  <div key={r} className="rack-section">
                    <h2>{RACK_BY_ID[r].label} <span>{its.length}</span></h2>
                    <div className="sticker-grid">
                      {its.map((i) => (
                        <DraggablePiece key={i.id} id={`closet:${i.id}`} piece={fromItem(i)} dim={i.laundry}
                          onTurn={(by) => patch(i.id, { rotation: (((i.rotation ?? 0) + by) % 360 + 360) % 360 })}
                          onDelete={() => { if (confirm(`Remove "${i.name}" from your closet? Its photo is deleted too.`)) { remove(i.id); say(<>{i.name} is gone from your closet.</>); } }}
                          caption={i.laundry ? `${i.name} (in laundry)` : i.name} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="studio-right">
              <BookmarkTable pieces={table} boardName={boardName} setBoardName={setBoardName}
                onRemove={(k) => setTable((ps) => ps.filter((p) => p.key !== k))}
                onClear={() => setTable([])} onSave={saveTable} />
              <Recommendations closet={items} catalog={catalog} table={table} offline={offline} />
            </section>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && <Sticker id={dragging.id} name={dragging.name} hex={dragging.hex} rack={dragging.rack} image={dragging.image_url} size={118} className="is-held" />}
          </DragOverlay>
        </DndContext>
      )}

      <UploadSheet open={uploading} onClose={() => setUploading(false)}
        onAdded={(item) => say(<>{item.name} is on the {RACK_BY_ID[guessRack(item)].label.toLowerCase()} rack.</>)} />
      {toast}
    </PageFrame>
  );
}
