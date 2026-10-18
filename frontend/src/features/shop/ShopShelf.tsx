import { useEffect, useState } from "react";
import { DraggablePiece } from "../../components/Studio";
import type { Piece } from "../../lib/stylist";
import { cutoutFor, shopFor, shortTitle, type ShopResult } from "./shop";
import "./shop.css";

/** What to shop for: a kind of piece the table is missing ("Camel Wool Coat") and why it fits. */
export interface ShopPick { query: string; base: Piece; reason: string }

/**
 * Real pieces to buy for the table: several live listings per suggestion, each with the shop's
 * own photo (background removed in the browser), its real price, and a link to buy it there.
 * Tells the parent whether live shopping works, so it can fall back to the sample catalog.
 */
export function ShopShelf({ picks, onStatus }: { picks: ShopPick[]; onStatus: (ok: boolean) => void }) {
  const [found, setFound] = useState<Record<string, ShopResult[]>>({});
  const [failed, setFailed] = useState(false);
  const queries = picks.map((p) => p.query).join("|");

  useEffect(() => {
    let live = true;
    picks.forEach((p) =>
      shopFor(p.query)
        .then((rs) => { if (live) { setFound((f) => ({ ...f, [p.query]: rs })); onStatus(true); } })
        .catch(() => { if (live) { setFailed(true); onStatus(false); } }));
    return () => { live = false; };
  }, [queries]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = picks.map((p) => ({ pick: p, rows: found[p.query] ?? [] })).filter((g) => g.rows.length);
  if (!groups.length) return failed ? null : picks.length ? <p className="muted">Looking for real pieces in shops...</p> : null;

  return (
    <div className="shop-shelf">
      {groups.map(({ pick, rows }) => (
        <section key={pick.query} className="shop-group">
          <p className="shop-why"><b>{pick.query}</b> · {pick.reason}</p>
          <div className="shop-row">
            {rows.map((r) => <ShopCard key={r.id} r={r} base={pick.base} />)}
          </div>
        </section>
      ))}
      <p className="shop-fine">Live listings from Google Shopping. Prices and stock are the shop's; check them on its site.</p>
    </div>
  );
}

function ShopCard({ r, base }: { r: ShopResult; base: Piece }) {
  const [cut, setCut] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cutoutFor(r.image).then((u) => live && setCut(u)).catch(() => { /* keep the shop's photo */ });
    return () => { live = false; };
  }, [r.image]);

  const piece: Piece = {
    source: "market", id: `shop:${r.id}`, name: shortTitle(r.title), hex: base.hex, rack: base.rack,
    image_url: cut ?? r.image, price: r.value ?? undefined, brand: r.seller, link: r.url,
  };
  return (
    <div className={`shop-card ${cut ? "" : "is-raw"}`}>
      <DraggablePiece id={`shop:${r.id}`} piece={piece} size={96} caption={piece.name} />
      <span className="shop-meta"><b>{r.price}</b> · {r.seller}</span>
      <a className="btn sm shop-buy" href={r.url} target="_blank" rel="noopener noreferrer">
        Go to site ↗
      </a>
    </div>
  );
}
