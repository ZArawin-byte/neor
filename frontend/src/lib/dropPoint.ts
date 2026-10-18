import type { DragEndEvent } from "@dnd-kit/core";

/**
 * Where the pointer (or finger) was released, as % of the drop target. Uses the drag's start
 * point plus how far it moved, which is always known; the dragged element's measured box can
 * still be null if the drop happens on the same frame as the last move.
 */
export function dropPoint(e: DragEndEvent): { x: number; y: number } | null {
  if (!e.over) return null;
  const ev = e.activatorEvent as (PointerEvent & TouchEvent) | null;
  const start = ev && "touches" in ev && ev.touches.length ? ev.touches[0] : ev;
  let cx: number, cy: number;
  if (start && typeof start.clientX === "number") {
    cx = start.clientX + e.delta.x;
    cy = start.clientY + e.delta.y;
  } else {
    const box = e.active.rect.current.translated; // keyboard drags have no pointer
    if (!box) return null;
    cx = box.left + box.width / 2;
    cy = box.top + box.height / 2;
  }
  const r = e.over.rect;
  return { x: ((cx - r.left) / r.width) * 100, y: ((cy - r.top) / r.height) * 100 };
}
