import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { findBargains, type Bargain } from "./source";

/** Public page (no sign-in needed to open it), reached from the notice in the hallway. */
export default function BargainsPage() {
  const [city, setCity] = useState(() => localStorage.getItem("neor.bargain-city") ?? "");
  const [results, setResults] = useState<Bargain[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim()) return;
    localStorage.setItem("neor.bargain-city", city);
    setLoading(true);
    setError("");
    try {
      setResults((await findBargains(city)).bargains);
    } catch (err) {
      setResults(null);
      setError(err instanceof ApiError && err.status === 401
        ? "Sign in first, then come back here to search."
        : "We couldn't search there just now. Check the spelling, or try a nearby city.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bargains">
      <Link to="/" className="bargains-back">← Back to the hall</Link>
      <header>
        <p className="kicker">Pinned in the hall</p>
        <h1>Bargains nearby</h1>
        <p>Thrift shops, vintage stores and small boutiques around you, where good clothes cost less.</p>
      </header>

      <form className="bargains-search" onSubmit={search}>
        <input className="text-input" placeholder="Your city or neighbourhood" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
        <button className="btn" disabled={loading || !city.trim()}>{loading ? "Looking…" : "Find bargains"}</button>
      </form>
      {error && <p className="error">{error}</p>}

      {results && (
        results.length === 0
          ? <p className="muted">Nothing turned up there. Try a bigger area.</p>
          : (
            <ol className="bargain-list">
              {results.map((b) => (
                <li key={b.id}>
                  <div>
                    <p className="b-kind">{b.kind}{b.price && ` · ${b.price}`}</p>
                    <h2>{b.name}</h2>
                    {b.note && <p>{b.note}</p>}
                  </div>
                  <a className="btn ghost sm" target="_blank" rel="noreferrer"
                    href={b.url ?? `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lon}#map=18/${b.lat}/${b.lon}`}>
                    {b.url ? "Open" : "Map"} ↗
                  </a>
                </li>
              ))}
            </ol>
          )
      )}
    </main>
  );
}
