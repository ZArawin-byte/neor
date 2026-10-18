import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { Product } from "../../lib/types";
import { addToBag, bagApi, type BagEntry, type Card, type Order } from "./api";

const money = (n: number) => `$${n.toFixed(2)}`;
const newKey = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const SOURCE_LABEL: Record<BagEntry["source"], string> = {
  outfit: "From an outfit", critique: "The lion's pick", chat: "From the shop chat", window: "For a spot", manual: "Added by you",
};

/**
 * The bag and its checkout. Checkout is simulated and Visa-only: the API accepts only Visa test cards,
 * and the page says so up front, so nobody types a real card number into a demo.
 */
export default function BagPage() {
  const [entries, setEntries] = useState<BagEntry[] | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [summary, setSummary] = useState<{ budget: number | null; spent_this_month: number } | null>(null);
  const [card, setCard] = useState<Card>({ number: "", exp: "", cvc: "", name: "" });
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [overBudget, setOverBudget] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const key = useRef(newKey()); // one key per checkout attempt, so a retry can't buy twice

  async function load() {
    try {
      const [bag, cat, sum] = await Promise.all([bagApi.list(), api.catalog(), bagApi.summary()]);
      setEntries(bag);
      setCatalog(cat);
      setSummary(sum);
      setError("");
    } catch (e) {
      setEntries([]);
      setError(e instanceof ApiError && e.status === 401 ? "Sign in first, then come back to your bag." : "We can't reach the bag right now.");
    }
  }
  useEffect(() => { load(); }, []);

  const products = (entries ?? []).filter((e) => e.kind === "product" && e.product);
  const ideas = (entries ?? []).filter((e) => e.kind === "idea");
  const total = products.reduce((sum, e) => sum + (e.product?.price ?? 0), 0);
  const left = summary?.budget != null ? summary.budget - summary.spent_this_month : null;
  const inBag = new Set(products.map((e) => e.catalog_id));

  async function pay(confirm = false) {
    setPaying(true);
    setError("");
    setOverBudget("");
    try {
      setOrder(await bagApi.checkout(products.map((e) => e.id), card, key.current, confirm));
      setCard({ number: "", exp: "", cvc: "", name: "" });
      key.current = newKey();
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setOverBudget(e.message);
      else setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setPaying(false);
    }
  }

  async function remove(id: string) {
    await bagApi.remove(id).catch(() => undefined);
    load();
  }

  async function add(p: Product) {
    await addToBag({ catalog_id: p.id, reason: "Picked from the catalog", source: "manual" }).catch(() => undefined);
    load();
  }

  if (order) {
    return (
      <main className="bag">
        <Link to="/room" className="bag-back">← Back to the room</Link>
        <section className="bag-receipt" aria-live="polite">
          <p className="kicker">Order {order.id.slice(0, 8)} · simulated</p>
          <h1>It's on its way to your closet</h1>
          <ul>{order.items.map((i) => <li key={i.id}><span>{i.name}</span><span>{money(i.price)}</span></li>)}</ul>
          <p className="bag-total"><span>Paid with Visa •••• {order.card.last4}</span><strong>{money(order.total)}</strong></p>
          <p>+{order.points_earned} points. Your new pieces are hanging in the closet, marked <em>arriving</em>.</p>
          <p className="bag-sim">{order.notice}</p>
          <div className="row">
            <Link className="btn" to="/closet">See them in the closet</Link>
            <button className="btn ghost" onClick={() => setOrder(null)}>Back to the bag</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="bag">
      <Link to="/room" className="bag-back">← Back to the room</Link>
      <header>
        <p className="kicker">Your bag</p>
        <h1>Things worth buying</h1>
        <p>Each piece says why it was suggested. Nothing here is bought until you check out.</p>
      </header>

      {error && <p className="error">{error}</p>}
      {entries === null && <p className="muted">Opening the bag…</p>}

      {entries && products.length === 0 && <p className="muted">The bag is empty. Add a piece from the catalog below, or from the lion's critique.</p>}
      {products.length > 0 && (
        <ol className="bag-list">
          {products.map((e) => (
            <li key={e.id}>
              <span className="bag-swatch" style={{ background: e.product!.hex }} aria-hidden="true" />
              <div>
                <p className="b-kind">{SOURCE_LABEL[e.source]}{e.priority === "high" && " · high priority"}</p>
                <h2>{e.product!.name}</h2>
                <p>{e.product!.brand} · {e.product!.material} · quality tier {e.product!.tier}</p>
                {e.reason && <p className="bag-why">{e.reason}</p>}
              </div>
              <div className="bag-price">
                <strong>{money(e.product!.price)}</strong>
                <button className="btn ghost sm" onClick={() => remove(e.id)}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {ideas.length > 0 && (
        <section className="bag-ideas">
          <h2>Ideas, not products</h2>
          <p className="muted">These are notes about what would help. They aren't listings, so there's nothing to buy yet.</p>
          <ul>{ideas.map((e) => <li key={e.id}>{e.title}{e.reason && ` · ${e.reason}`} <button className="link-btn" onClick={() => remove(e.id)}>remove</button></li>)}</ul>
        </section>
      )}

      {products.length > 0 && (
        <form className="bag-checkout" onSubmit={(ev) => { ev.preventDefault(); pay(); }}>
          <div className="bag-sum">
            <p className="bag-total"><span>Total</span><strong>{money(total)}</strong></p>
            {left != null && <p className={left < total ? "error" : "muted"}>Budget left this month: {money(left)}</p>}
          </div>
          <p className="bag-sim"><strong>Simulated checkout: no money moves.</strong> NEor accepts Visa only. Use the Visa test card 4242 4242 4242 4242, any future expiry and any 3-digit CVC.</p>
          <label>Name on card<input id="bag-name" className="text-input" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} autoComplete="off" /></label>
          <label>Visa card number<input id="bag-number" className="text-input" inputMode="numeric" placeholder="4242 4242 4242 4242" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} autoComplete="off" required /></label>
          <div className="row">
            <label>Expiry<input id="bag-exp" className="text-input" placeholder="MM/YY" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} autoComplete="off" required /></label>
            <label>CVC<input id="bag-cvc" className="text-input" inputMode="numeric" placeholder="123" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} autoComplete="off" required /></label>
          </div>
          {overBudget && (
            <div className="bag-over" role="alert">
              <p>{overBudget}</p>
              <button type="button" className="btn ghost sm" onClick={() => pay(true)} disabled={paying}>Buy it anyway</button>
            </div>
          )}
          <button className="btn" disabled={paying}>{paying ? "Paying…" : `Pay ${money(total)} with Visa (simulated)`}</button>
        </form>
      )}

      {catalog.length > 0 && (
        <details className="bag-catalog">
          <summary>Add from the NEor sample catalog</summary>
          <p className="muted">A sample catalog with made-up brands, for the demo. Prices are not real listings.</p>
          <ul>
            {catalog.filter((p) => !inBag.has(p.id)).map((p) => (
              <li key={p.id}>
                <span className="bag-swatch sm" style={{ background: p.hex }} aria-hidden="true" />
                <span>{p.name} <span className="muted">· {p.brand} · {money(p.price)}</span></span>
                <button className="btn ghost sm" onClick={() => add(p)}>Add</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
