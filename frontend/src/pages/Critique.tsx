import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useLionMenu } from "../components/LionMenu";
import { MASCOT, mascotTitle, mascotWhere } from "../lib/mascot";
import { PageFrame, useToast } from "../components/PageFrame";
import { Sticker } from "../components/Sticker";
import { toSnap } from "../components/Studio";
import { api } from "../lib/api";
import { useCloset } from "../lib/closet";
import { isNeutral, lch } from "../lib/color";
import { guessRack, slotOf } from "../lib/racks";
import { saved } from "../lib/saved";
import { fromProduct } from "../lib/stylist";
import type { Item, WeakSpots } from "../lib/types";
import "../styles/critique.css";

/** The handful of pieces most wardrobes lean on. Checked locally, so this works even when the AI is down. */
const ESSENTIALS: { label: string; has: (items: Item[]) => boolean }[] = [
  { label: "A plain light top", has: (xs) => xs.some((i) => slotOf(guessRack(i)) === "top" && lch(i.hex ?? "#888").L > 0.82) },
  { label: "Dark, simple bottoms", has: (xs) => xs.some((i) => slotOf(guessRack(i)) === "bottom" && lch(i.hex ?? "#888").L < 0.4) },
  { label: "A neutral layer that goes over anything", has: (xs) => xs.some((i) => guessRack(i) === "jackets" && isNeutral(i.hex ?? "#888")) },
  { label: "Shoes you can walk all day in", has: (xs) => xs.some((i) => guessRack(i) === "shoes") },
  { label: "Something warm", has: (xs) => xs.some((i) => guessRack(i) === "sweaters") },
  { label: "One dressed-up piece", has: (xs) => xs.some((i) => guessRack(i) === "dresses" || i.occasions?.includes("wedding")) },
  { label: "A bag", has: (xs) => xs.some((i) => guessRack(i) === "bags") },
];

export default function Critique() {
  const { items, catalog, offline } = useCloset();
  const [audit, setAudit] = useState<WeakSpots | null>(null);
  const [loading, setLoading] = useState(!offline);
  const [toast, say] = useToast();
  const active = items.filter((i) => !i.laundry);
  const lion = useLionMenu();

  useEffect(() => {
    if (offline) return setLoading(false);
    api.weakSpots().then(setAudit).catch(() => setAudit(null)).finally(() => setLoading(false));
  }, [offline, items.length]);

  const checks = ESSENTIALS.map((e) => ({ ...e, ok: e.has(active) }));
  const missingCount = checks.filter((c) => !c.ok).length;

  function addToTable(id: string) {
    const p = catalog.find((c) => c.id === id);
    if (!p) return;
    const piece = fromProduct(p);
    saved.saveDraft([...saved.draft(), { key: `${id}-${Date.now()}`, source: "market", refId: id, x: 50, y: 50, rot: -2, snap: toSnap(piece) }]);
    say(<>{p.name} is on your table. <Link to="/closet">See how it pairs</Link></>);
  }

  return (
    <PageFrame title="The lion's verdict" kicker="Honest, never pushy" className="critique-page">
      <div className="critique-layout">
        <aside className="lion-col">
          <figure className="lion-portrait" onContextMenu={lion.onContextMenu}>
            <img src={MASCOT.photo} alt={`${mascotTitle()}, the Neor mascot`} />
            <figcaption>
              <strong>{mascotTitle()}</strong>, the Neor mascot{mascotWhere()}.{" "}
              <a href={MASCOT.montage} target="_blank" rel="noreferrer">Watch a montage ↗</a>
              {MASCOT.credit && (
                <small>
                  Photo: <a href={MASCOT.credit.source} target="_blank" rel="noreferrer">{MASCOT.credit.author}</a>,{" "}
                  <a href={MASCOT.credit.licenseUrl} target="_blank" rel="noreferrer">{MASCOT.credit.license}</a>
                </small>
              )}
            </figcaption>
          </figure>
          {lion.menu}
          <blockquote className="lion-says">
            {loading ? "Hmm. Let me look properly..." : audit?.summary
              ?? (missingCount === 0
                ? "A sound closet. I'd mostly tell you to wear what you have."
                : `A good start. ${missingCount === 1 ? "One staple is" : `${missingCount} staples are`} missing, and they'd unlock more outfits than anything trendy would.`)}
          </blockquote>
          {audit && (
            <div className="versatility">
              <span className="big">{audit.score}</span>
              <span>/100 versatility</span>
            </div>
          )}
        </aside>

        <section className="critique-body">
          <h2>Essentials</h2>
          <ul className="essentials">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "ok" : "missing"}>
                <span className="mark">{c.ok ? <Icon name="check" size={14} /> : null}</span>
                {c.label}
                {!c.ok && <span className="tag">missing</span>}
              </li>
            ))}
          </ul>
          <p className="facts">Laundry-basket pieces don't count. They're resting.</p>

          {audit && audit.gaps.length > 0 && (
            <>
              <h2>Where your closet is thin</h2>
              <ol className="gaps">
                {audit.gaps.map((g) => (
                  <li key={g.gap}>
                    <div className="gap-head">
                      <strong>{g.gap}</strong>
                      <span className={`prio prio-${g.priority}`}>{g.priority}</span>
                      <span className="unlocks">unlocks ~{g.unlocks} outfits</span>
                    </div>
                    <p>{g.why}</p>
                    <div className="gap-buys">
                      {g.catalog_ids.map((id) => catalog.find((c) => c.id === id)).filter(Boolean).map((p) => {
                        const piece = fromProduct(p!);
                        return (
                          <div key={p!.id} className="buy">
                            <Sticker id={piece.id} name={piece.name} hex={piece.hex} rack={piece.rack} size={70} />
                            <div>
                              <p>{p!.name}</p>
                              <small>{p!.brand} · ${p!.price} · tier {p!.tier}</small>
                              <button className="btn ghost sm" onClick={() => addToTable(p!.id)}>Try it on the table</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {!loading && !audit && !offline && <p className="muted">The lion's full audit isn't available right now. The essentials above are still accurate.</p>}
        </section>
      </div>
      {toast}
    </PageFrame>
  );
}
