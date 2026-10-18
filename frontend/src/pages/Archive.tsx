import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageFrame } from "../components/PageFrame";
import { Sticker } from "../components/Sticker";
import { Silhouette } from "../components/Silhouette";
import { assetUrl } from "../lib/api";
import { RACK_BY_ID } from "../lib/racks";
import { saved } from "../lib/saved";
import "../styles/archive.css";

export default function Archive() {
  const [looks, setLooks] = useState(saved.looks);
  const [filter, setFilter] = useState<"all" | "fav">("all");
  const shown = filter === "fav" ? looks.filter((l) => l.favorite) : looks;

  const refresh = () => setLooks(saved.looks());

  return (
    <PageFrame title="The archive" kicker="Looks you decided to keep" className="archive-page"
      actions={
        <div className="seg">
          <button className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All {looks.length}</button>
          <button className={filter === "fav" ? "is-on" : ""} onClick={() => setFilter("fav")}>Favourites {looks.filter((l) => l.favorite).length}</button>
        </div>
      }>
      {shown.length === 0 ? (
        <div className="empty-closet">
          <p className="display">{filter === "fav" ? "No favourites yet." : "Nothing archived yet."}</p>
          <p>When a fit works in the <Link to="/mirror">mirror</Link>, save it and it lands here.</p>
        </div>
      ) : (
        <div className="looks">
          {shown.map((l) => (
            <article key={l.id} className="look-card">
              <div className={`look-visual ${l.photo && l.tryon?.length ? "has-tryon" : ""}`}>
                {l.photo && <img className="look-photo" src={l.photo} alt="" />}
                {l.photo && l.tryon?.map((w) => (
                  <div key={w.key} className="worn" style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, zIndex: w.z, rotate: `${w.rot}deg`, translate: "-50% -50%" }}>
                    {w.snap.image_url ? <img src={assetUrl(w.snap.image_url)!} alt={w.snap.name} /> : <Silhouette shape={RACK_BY_ID[w.snap.rack].shape} hex={w.snap.hex} />}
                  </div>
                ))}
                <div className="look-stickers">
                  {l.pieces.slice(0, 5).map((p) => (
                    <Sticker key={p.key} id={p.key} name={p.snap.name} hex={p.snap.hex} rack={p.snap.rack} image={p.snap.image_url} size={l.photo ? 58 : 82} />
                  ))}
                </div>
              </div>
              <div className="look-meta">
                <div>
                  <h3>{l.name}</h3>
                  <p className="facts">
                    {new Date(l.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {l.occasion && ` · ${l.occasion === "uni" ? "class" : l.occasion}`} · {l.harmony}
                  </p>
                </div>
                <button className={`icon-btn fav ${l.favorite ? "is-on" : ""}`} aria-pressed={l.favorite}
                  aria-label={l.favorite ? "Remove from favourites" : "Add to favourites"}
                  onClick={() => { saved.toggleFavorite(l.id); refresh(); }}>
                  <Icon name="star" filled={l.favorite} />
                </button>
              </div>
              {l.verdict && <p className="verdict-line">{l.verdict}</p>}
              <button className="link-back del" onClick={() => { if (confirm(`Delete "${l.name}"?`)) { saved.deleteLook(l.id); refresh(); } }}>
                <Icon name="trash" size={13} /> Delete
              </button>
            </article>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
