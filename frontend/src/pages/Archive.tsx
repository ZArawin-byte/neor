import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { OutfitSketch, SketchDefs } from "../components/OutfitSketch";
import { PageFrame } from "../components/PageFrame";
import { saved } from "../lib/saved";
import type { Look } from "../lib/types";
import "../styles/archive.css";

type Filter = "recent" | "top" | "five" | "four" | "unrated";
const FILTERS: [Filter, string][] = [
  ["recent", "Recently added"],
  ["top", "Highest rated"],
  ["five", "★★★★★ only"],
  ["four", "4 stars and up"],
  ["unrated", "Not rated yet"],
];

/** How many papers fit on the board at this width. */
function usePerPage() {
  const pick = () => (window.innerWidth >= 1180 ? 8 : window.innerWidth >= 860 ? 6 : window.innerWidth >= 560 ? 4 : 2);
  const [n, setN] = useState(pick);
  useEffect(() => {
    const on = () => setN(pick());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return n;
}

/** A stable tilt and pin colour per look, so the board looks hand-pinned but doesn't shuffle. */
function pinFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return {
    tilt: ((h % 9) - 4) * 0.7,
    pin: ["#b8372e", "#2f6b6a", "#c98a2e", "#3b4a7a", "#7a2a5a"][h % 5],
    tape: h % 4 === 0, // some are taped up instead of pinned
  };
}

function Stars({ value, onRate, size = 15 }: { value?: number; onRate?: (n: number) => void; size?: number }) {
  return (
    <span className="stars" role={onRate ? "radiogroup" : undefined} aria-label={value ? `${value} out of 5 stars` : "Not rated"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={`star ${value && n <= value ? "is-on" : ""}`} style={{ fontSize: size }}
          onClick={(e) => { e.stopPropagation(); onRate?.(n === value ? 0 : n); }} disabled={!onRate}>★</button>
      ))}
    </span>
  );
}

export default function Archive() {
  const [looks, setLooks] = useState(saved.looks);
  const [filter, setFilter] = useState<Filter>("recent");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Look | null>(null);
  const perPage = usePerPage();
  const refresh = () => setLooks(saved.looks());

  const shown = useMemo(() => {
    const byDate = [...looks].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    switch (filter) {
      case "top": return byDate.filter((l) => l.rating).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).concat(byDate.filter((l) => !l.rating));
      case "five": return byDate.filter((l) => l.rating === 5);
      case "four": return byDate.filter((l) => (l.rating ?? 0) >= 4);
      case "unrated": return byDate.filter((l) => !l.rating);
      default: return byDate;
    }
  }, [looks, filter]);

  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [pages, page]);
  useEffect(() => setPage(0), [filter]);
  const onBoard = shown.slice(page * perPage, page * perPage + perPage);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) { if (e.key === "Escape") setOpen(null); return; }
      if (e.key === "ArrowRight") setPage((p) => Math.min(pages - 1, p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pages]);

  const rate = (l: Look, n: number) => { saved.rate(l.id, n); refresh(); if (open?.id === l.id) setOpen({ ...l, rating: n }); };

  return (
    <PageFrame
      title="All outfits"
      kicker={`The archive · ${looks.length} look${looks.length === 1 ? "" : "s"} pinned up`}
      className="archive-page"
      actions={
        <label className="board-filter">
          <span className="sr-only">Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      }
    >
      <SketchDefs />
      <div className="board-wrap">
        <button className="board-arrow left" onClick={() => setPage((p) => p - 1)} disabled={page === 0} aria-label="Previous looks">
          <Icon name="back" size={20} />
        </button>

        <section className="board" aria-label="Pinned outfits" style={{ ["--cols" as string]: Math.ceil(perPage / 2) }}>
          {/* the sewing-room odds and ends pinned between the sketches */}
          <span className="trim measure" aria-hidden="true" />
          <span className="trim fabric gingham" aria-hidden="true" />
          <span className="trim fabric stripe" aria-hidden="true" />
          <span className="trim fabric floral" aria-hidden="true" />
          <span className="trim notions" aria-hidden="true"><i /><i /><i /></span>
          {onBoard.length === 0 ? (
            <div className="pinned note" style={{ rotate: "-2deg" }}>
              <span className="pushpin" style={{ background: "#b8372e" }} />
              <p className="note-text">
                {looks.length === 0
                  ? <>Nothing pinned up yet. When a fit works in the <Link to="/mirror">mirror</Link>, save it and it gets sketched here.</>
                  : "No looks match that filter."}
              </p>
            </div>
          ) : onBoard.map((l, i) => {
            const p = pinFor(l.id);
            return (
              <article key={l.id} className="pinned" style={{ rotate: `${p.tilt}deg`, animationDelay: `${i * 40}ms` }}
                onClick={() => setOpen(l)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(l)} aria-label={`${l.name}, open`}>
                {p.tape ? <span className="tape" /> : <span className="pushpin" style={{ background: p.pin }} />}
                <OutfitSketch pieces={l.pieces} tryon={l.tryon} className="sketch" />
                <div className="pinned-foot">
                  <h3>{l.name}</h3>
                  <p>{new Date(l.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{l.occasion ? ` · ${l.occasion === "uni" ? "class" : l.occasion}` : ""}</p>
                  <Stars value={l.rating} onRate={(n) => rate(l, n)} />
                </div>
              </article>
            );
          })}
        </section>

        <button className="board-arrow right" onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1} aria-label="More looks">
          <Icon name="next" size={20} />
        </button>
      </div>
      {pages > 1 && (
        <p className="board-pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className={i === page ? "is-on" : ""} onClick={() => setPage(i)} aria-label={`Page ${i + 1}`} />
          ))}
        </p>
      )}

      {open && (
        <div className="sheet-scrim" onClick={() => setOpen(null)}>
          <div className="look-open" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={open.name}>
            <button className="icon-btn look-close" onClick={() => setOpen(null)} aria-label="Close"><Icon name="x" /></button>
            <div className="pinned big">
              <span className="pushpin" style={{ background: pinFor(open.id).pin }} />
              <OutfitSketch pieces={open.pieces} tryon={open.tryon} className="sketch" />
            </div>
            <div className="look-info">
              <p className="kicker">{new Date(open.savedAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
              <h2>{open.name}</h2>
              <Stars value={open.rating} onRate={(n) => rate(open, n)} size={22} />
              {open.harmony && <p className="facts">{open.harmony}</p>}
              {open.verdict && <p className="look-verdict">“{open.verdict}”</p>}
              <h4>What's in it</h4>
              <ul className="look-pieces-list">
                {open.pieces.map((p) => <li key={p.key}><span className="swatch" style={{ background: p.snap.hex }} />{p.snap.name}{p.snap.price ? <small> · ${p.snap.price}</small> : null}</li>)}
              </ul>
              {open.photo && <img className="look-photo-thumb" src={open.photo} alt="You, wearing it" />}
              <div className="row">
                <Link className="btn sm" to="/mirror">Open the mirror</Link>
                <button className="btn ghost sm danger" onClick={() => { if (confirm(`Take "${open.name}" off the board?`)) { saved.deleteLook(open.id); refresh(); setOpen(null); } }}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
