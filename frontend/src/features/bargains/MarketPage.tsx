import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { ApiError } from "../../lib/api";
import { isSignedIn } from "../../lib/auth";
import {
  COUNTRY_NAMES, market, money, sampleOffers,
  type Estimate, type Identified, type MarketConfig, type Offer, type Place, type Report, type Shop, type Verdict,
} from "./market";
import "./market.css";
import { ReportSheet, type ReportDraft } from "./ReportSheet";

const PLACE_KEY = "neor.market-place";
const LIVE_EVERY = 30_000;

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.status === 401 ? "Sign in first, then come back to the market." : e instanceof Error && e.message ? e.message : fallback;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function readPlace(): Place | null {
  try { return JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null"); } catch { return null; }
}

const storePin = (on: boolean) => L.divIcon({ className: "", html: `<span class="mk-pin ${on ? "is-on" : ""}"></span>`, iconSize: [24, 24], iconAnchor: [12, 22] });
const pricePin = (label: string) => L.divIcon({ className: "", html: `<span class="mk-price-pin">${label}</span>`, iconSize: [10, 10], iconAnchor: [5, 30] });
const herePin = L.divIcon({ className: "", html: `<span class="mk-here"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join()).join("|");
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
    else if (points.length === 1) map.setView(points[0], 14);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ---------------------------------------------------------------- where are you?

function PlacePicker({ place, onPick, onClose }: { place: Place | null; onPick: (p: Place) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const { places } = await market.geocode(q);
      setFound(places);
      if (!places.length) setMsg("Nothing by that name. Try a city or neighbourhood.");
    } catch (err) { setMsg(errorText(err, "City search isn't answering. Try your location instead.")); }
    finally { setBusy(false); }
  }

  function here() {
    if (!navigator.geolocation) return setMsg("This browser can't share its location. Search for a city instead.");
    setBusy(true); setMsg("");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const lat = Math.round(p.coords.latitude * 1000) / 1000, lon = Math.round(p.coords.longitude * 1000) / 1000;
      try {
        const where = await market.reverse(lat, lon);
        onPick({ name: where.name, lat, lon, country: where.country });
      } catch { onPick({ name: "Near you", lat, lon }); }
      setBusy(false);
    }, () => { setBusy(false); setMsg("Location was blocked. Search for a city instead."); }, { timeout: 10000, maximumAge: 300000 });
  }

  return (
    <div className="mk-place" role="dialog" aria-label="Where are you shopping?">
      <div className="mk-place-head">
        <strong>Where are you shopping?</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
      </div>
      <button className="btn sm" onClick={here} disabled={busy}><Icon name="pin" size={15} /> Use my location</button>
      <form className="mk-inline" onSubmit={search}>
        <input className="text-input" placeholder="or a city, e.g. Marrakech" value={q} onChange={(e) => setQ(e.target.value)} aria-label="City or neighbourhood" />
        <button className="btn ghost sm" disabled={busy || q.trim().length < 2}>Search</button>
      </form>
      {found.length > 0 && (
        <ul className="mk-place-list">
          {found.map((p) => <li key={`${p.lat},${p.lon}`}><button onClick={() => onPick({ ...p, name: p.name.split(",").slice(0, 2).join(",") })}>{p.name}</button></li>)}
        </ul>
      )}
      {msg && <p className="mk-note">{msg}</p>}
      <p className="mk-fine">Prices use the local currency. Your location is rounded and only used to find shops and nearby prices{place ? ` (now: ${place.name})` : ""}.</p>
    </div>
  );
}

// ---------------------------------------------------------------- the price scale

/**
 * One line from "open the haggling here" to "walk away", with every online listing (grey)
 * and every local purchase (red) dotted along it, so the range is visibly earned.
 */
function PriceScale({ v, online, paid }: { v: Verdict; online: number[]; paid: number[] }) {
  const all = [v.open_at, v.walk_away, ...online, ...paid];
  const lo = Math.min(...all) * 0.92, hi = Math.max(...all) * 1.04;
  const at = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
  const c = v.currency;
  return (
    <div className="mk-scale" aria-hidden="true">
      <div className="mk-scale-track">
        <span className="zone haggle" style={{ left: at(v.open_at), right: `calc(100% - ${at(v.low)})` }} />
        <span className="zone fair" style={{ left: at(v.low), right: `calc(100% - ${at(v.high)})` }} />
        <span className="zone pricey" style={{ left: at(v.high), right: `calc(100% - ${at(v.walk_away)})` }} />
        <span className="zone over" style={{ left: at(v.walk_away), right: 0 }} />
        {online.map((x, i) => <i key={`o${i}`} className="dot online" style={{ left: at(x) }} />)}
        {paid.map((x, i) => <i key={`p${i}`} className="dot paid" style={{ left: at(x) }} />)}
      </div>
      <div className="mk-scale-marks">
        <span style={{ left: at(v.open_at) }}><b>{money(v.open_at, c)}</b>open</span>
        <span style={{ left: at((v.low + v.high) / 2) }} className="is-key"><b>{money(v.low, c)}–{money(v.high, c)}</b>aim for</span>
        <span style={{ left: at(v.walk_away) }}><b>{money(v.walk_away, c)}</b>walk away</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function MarketPage() {
  const [cfg, setCfg] = useState<MarketConfig | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [place, setPlaceState] = useState<Place | null>(readPlace);
  const [picking, setPicking] = useState(false);
  const [country, setCountry] = useState(() => readPlace()?.country || "us");
  const [sheet, setSheet] = useState<ReportDraft | null>(null);
  const [toast, setToast] = useState("");

  const [photo, setPhoto] = useState<Blob | null>(null);
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  const [found, setFound] = useState<Identified | null>(null);
  const [name, setName] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookNote, setLookNote] = useState("");

  const [checked, setChecked] = useState(""); // the name the current results are for
  const [est, setEst] = useState<Estimate | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [estError, setEstError] = useState("");
  const [paid, setPaid] = useState<Report[]>([]);
  const [liveAt, setLiveAt] = useState(0);
  const [stores, setStores] = useState<Shop[]>([]);
  const [storesNote, setStoresNote] = useState("");
  const [storesBusy, setStoresBusy] = useState(false);
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [, tick] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isSignedIn().then(setSignedIn);
    market.config().then(setCfg).catch(() => setCfg({ vision: false, shopping: false, countries: {} }));
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3800); return () => clearTimeout(t); }, [toast]);

  const currency = cfg?.countries[country] ?? "USD";
  const setPlace = (p: Place) => {
    setPlaceState(p);
    setPicking(false);
    if (p.country && cfg?.countries[p.country]) setCountry(p.country); // local currency follows the place
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  };

  // ---------- 1. photo -> what is it?
  async function onPhoto(file: File) {
    setPhoto(file); setFound(null); setLookNote(""); setEst(null); setChecked("");
    if (!cfg?.vision) {
      setLookNote("Photo recognition isn't switched on for this server yet, so type what it is.");
      return;
    }
    setLooking(true);
    try {
      const id = await market.identify(file);
      setFound(id);
      const guess = [id.brand, id.name].filter(Boolean).join(" ");
      setName(guess);
      if (guess.trim().length >= 2) check(guess);
      else setLookNote("We couldn't tell what that is. Type a name and we'll price it.");
    } catch (e) { setLookNote(errorText(e, "We couldn't identify that photo. Type what it is instead.")); }
    finally { setLooking(false); }
  }

  // ---------- 2. what's it worth here?
  async function check(q = name) {
    const query = q.trim();
    if (query.length < 2) return;
    setChecked(query); setEstBusy(true); setEstError(""); setOpenStore(null);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    findStores(query);
    try {
      const res = await market.estimate(query, country, place);
      setEst(res); setPaid(res.paid); setLiveAt(Date.now());
    } catch (e) { setEst(null); setEstError(errorText(e, "Pricing isn't answering right now. Try again in a moment.")); }
    finally { setEstBusy(false); }
  }

  // ---------- 3. where can you get one?
  async function findStores(query: string) {
    if (!place) return;
    setStoresBusy(true); setStoresNote("");
    try {
      const res = cfg?.shopping ? await market.stores(query, country, place) : await market.nearby(place.lat, place.lon, "general");
      setStores(res.stores);
      setStoresNote(cfg?.shopping ? res.notice : "Shops that usually stock everyday things, from OpenStreetMap. With the SerpAPI key, this searches for the item itself.");
    } catch (e) { setStores([]); setStoresNote(errorText(e, "The shop search is busy. Try again in a moment.")); }
    finally { setStoresBusy(false); }
  }

  // ---------- live: refresh what people paid every 30s while results are open
  useEffect(() => {
    if (!checked) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try { setPaid((await market.paid(checked, country, place)).paid); setLiveAt(Date.now()); } catch { /* keep the last good list */ }
    }, LIVE_EVERY);
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => { clearInterval(id); clearInterval(t); };
  }, [checked, country, place]);

  // ---------- joins: which online sellers have a branch near you
  const storeNames = useMemo(() => new Map(stores.map((s) => [norm(s.name), s])), [stores]);
  const sellerNearby = (o: Offer) => {
    const n = norm(o.seller);
    if (n.length < 3) return null;
    for (const [k, s] of storeNames) if (k.includes(n) || n.includes(k)) return s;
    return null;
  };
  const offers = est?.offers.length ? est.offers : est && cfg && !cfg.shopping ? sampleOffers(checked) : est?.offers ?? [];
  const paidByShop = useMemo(() => {
    const m = new Map<string, Report[]>();
    for (const r of paid) m.set(r.shop.id, [...(m.get(r.shop.id) ?? []), r]);
    return m;
  }, [paid]);
  const points: [number, number][] = useMemo(() => [
    ...(place ? [[place.lat, place.lon] as [number, number]] : []),
    ...stores.slice(0, 12).map((s) => [s.lat, s.lon] as [number, number]),
    ...[...paidByShop.values()].map((rs) => [rs[0].shop.lat, rs[0].shop.lon] as [number, number]),
  ], [place, stores, paidByShop]);
  const v = est?.verdict ?? null;
  const ago = liveAt ? Math.max(0, Math.round((Date.now() - liveAt) / 1000)) : 0;

  return (
    <main className="market">
      <div className="awning" aria-hidden="true" />
      <header className="mk-head">
        <Link to={signedIn ? "/room" : "/"} className="plaque"><Icon name="back" size={15} /><span>{signedIn ? "The room" : "The hall"}</span></Link>
        <div className="mk-head-right">
          <button className="mk-chip" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
            <Icon name="pin" size={15} /> {place ? place.name : "Where are you shopping?"}
          </button>
          <label className="mk-country">
            <span className="sr-only">Currency</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              {Object.keys(cfg?.countries ?? COUNTRY_NAMES).map((c) => <option key={c} value={c}>{cfg?.countries[c] ?? ""} · {COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>)}
            </select>
          </label>
        </div>
        {picking && <PlacePicker place={place} onPick={setPlace} onClose={() => setPicking(false)} />}
      </header>

      {/* ------------------------------------------------ upload */}
      <section className={`mk-start ${photo || checked ? "is-compact" : ""}`}>
        <div className="mk-start-copy">
          <p className="kicker">Neor · the bargain market</p>
          <h1>What should you<br /><em>pay for that?</em></h1>
          <p>Snap the thing in front of you, a snow globe, a scarf, a brush. Neor works out what it's worth where you are, the range to accept, and where else nearby sells the same or similar.</p>
          {!place && <button className="link-back" onClick={() => setPicking(true)}><Icon name="pin" size={14} /> First, tell us where you're shopping</button>}
        </div>

        <div className="mk-start-card">
          <label className={`mk-drop ${photo ? "has-photo" : ""}`}>
            {photoUrl ? <img src={photoUrl} alt="Your find" /> : (
              <span className="mk-drop-empty">
                <span className="mk-drop-tag"><Icon name="tag" size={28} /></span>
                <strong>Upload what you're looking at</strong>
                <span>or take a photo · JPG, PNG or WebP</span>
              </span>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
          </label>
          <form className="mk-name" onSubmit={(e) => { e.preventDefault(); check(); }}>
            <label className="mk-field grow">
              <span>{looking ? "Looking closely…" : found ? "We think it's" : "What is it?"}</span>
              <input className="text-input" value={name} placeholder="e.g. glass snow globe" onChange={(e) => setName(e.target.value)} disabled={looking} />
            </label>
            <button className="btn" disabled={looking || estBusy || name.trim().length < 2}>{estBusy ? "Pricing…" : "Check the price"}</button>
          </form>
          {lookNote && <p className="mk-note">{lookNote}</p>}
          {!photo && !checked && (
            <button className="link-back mk-try" onClick={() => { setName("snow globe"); check("snow globe"); }}>No photo handy? Try a snow globe <Icon name="next" size={13} /></button>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ results */}
      {checked && (
        <div className="mk-results" ref={resultRef}>
          <section className="mk-verdict-card">
            <p className="kicker">{checked} · {place ? place.name : "anywhere"} · {currency}</p>
            {estBusy ? <p className="mk-note"><span className="spool sm" /> Checking listings and the ledger…</p>
              : estError ? <p className="mk-note">{estError}</p>
              : v ? (
                <>
                  <h2 className="mk-verdict">Pay between <b>{money(v.low, v.currency)}</b> and <b>{money(v.high, v.currency)}</b></h2>
                  <p className="mk-verdict-sub">Open at {money(v.open_at, v.currency)}. Walk away above {money(v.walk_away, v.currency)}.</p>
                  <PriceScale v={v} online={offers.filter((o) => o.value && !o.used && !o.sample).map((o) => o.value as number)} paid={paid.filter((r) => r.currency === v.currency).map((r) => r.paid)} />
                  <div className="mk-why">
                    <span className={`mk-conf conf-${v.confidence}`}>{v.confidence === "good" ? "Solid estimate" : v.confidence === "fair" ? "Fair estimate" : "Rough estimate"}</span>
                    <span>Based on {v.source}.</span>
                  </div>
                  <ul className="mk-basis">{v.basis.map((b) => <li key={b}>{b}</li>)}</ul>
                </>
              ) : (
                <>
                  <h2 className="mk-verdict">No price to go on yet</h2>
                  <p className="mk-verdict-sub">{est?.online_note || "We couldn't find listings for that."} Nobody has logged buying one near you either. Be the first, and the next person gets a price.</p>
                </>
              )}
            {est?.online_note && v && <p className="mk-fine">{est.online_note}</p>}
            <div className="row mk-verdict-actions">
              <button className="btn" onClick={() => setSheet({ name: checked, brand: found?.brand, model: found?.model, photo })}>I bought it: log what I paid</button>
              {found && found.pages.length > 0 && <a className="link-back" href={found.pages[0].url} target="_blank" rel="noreferrer">Where this photo appears ↗</a>}
            </div>
            <p className="mk-fine">{est?.notice}</p>
          </section>

          <section className="mk-map-card">
            <div className="mk-map-head">
              <h2>Around {place ? place.name.split(",")[0] : "you"}</h2>
              <span className="mk-live"><i />{liveAt ? `Live · updated ${ago < 5 ? "just now" : `${ago}s ago`}` : "Live"}</span>
            </div>
            {!place ? (
              <div className="mk-empty">
                <p>Choose where you are to see shops and what people paid nearby.</p>
                <button className="btn sm" onClick={() => setPicking(true)}><Icon name="pin" size={14} /> Choose a place</button>
              </div>
            ) : (
              <>
                <div className="mk-map-frame">
                  <MapContainer center={[place.lat, place.lon]} zoom={14} scrollWheelZoom={false} className="mk-map">
                    <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                    <FitTo points={points} />
                    <Marker position={[place.lat, place.lon]} icon={herePin} />
                    {stores.map((s) => (
                      <Marker key={s.id} position={[s.lat, s.lon]} icon={storePin(openStore === s.id)} eventHandlers={{ click: () => setOpenStore(s.id) }}>
                        <Popup>
                          <strong>{s.name}</strong><br />{s.address}
                          {paidByShop.get(s.id) && <><br />{paidByShop.get(s.id)!.length} price{paidByShop.get(s.id)!.length > 1 ? "s" : ""} logged here</>}
                          <br /><a href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=18/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">Directions ↗</a>
                        </Popup>
                      </Marker>
                    ))}
                    {[...paidByShop.values()].map((rs) => {
                      const prices = rs.map((r) => r.paid).sort((a, b) => a - b);
                      const label = prices.length > 1 ? `${money(prices[0], rs[0].currency)}–${money(prices[prices.length - 1], rs[0].currency)}` : money(prices[0], rs[0].currency);
                      return (
                        <Marker key={`paid-${rs[0].shop.id}`} position={[rs[0].shop.lat, rs[0].shop.lon]} icon={pricePin(label)}>
                          <Popup><strong>{rs[0].shop.name}</strong><br />{rs.length} paid {label}<br />latest {rs[0].purchase_date}</Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>
                <div className="mk-legend">
                  <span><i className="lg-paid" /> what people paid</span>
                  <span><i className="lg-store" /> {cfg?.shopping ? "sells this or similar" : "shops that usually stock it"}</span>
                  <span><i className="lg-here" /> you</span>
                </div>
                {storesBusy && <p className="mk-note"><span className="spool sm" /> Looking around the neighbourhood… the free map service can take half a minute.</p>}
                <ol className="mk-store-list">
                  {stores.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <button className={openStore === s.id ? "is-on" : ""} onClick={() => setOpenStore(s.id)}>
                        <strong>{s.name}</strong>
                        <span>{[s.kind, s.km !== undefined ? `${s.km} km` : "", s.address?.split(",")[0]].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {storesNote && <p className="mk-fine">{storesNote}</p>}
              </>
            )}
          </section>

          <section className="mk-similar-card">
            <h2>The same, or close to it</h2>
            {offers.length === 0 && !estBusy && <p className="mk-fine">{est?.online_note || "No listings came back for that name. Try a simpler one, like “snow globe”."}</p>}
            <div className="mk-offers">
              {offers.map((o) => {
                const near = sellerNearby(o);
                return (
                  <article key={o.id} className={`mk-offer ${o.sample ? "is-sample" : ""}`}>
                    <div className="mk-offer-img">
                      {o.image ? <img src={o.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="tag" size={34} />}
                      {o.sample && <span className="mk-sample">Sample</span>}
                      {!o.sample && (near || o.nearby) && <span className="mk-near-badge"><Icon name="pin" size={11} /> {near ? `${near.name} nearby` : "In a shop nearby"}</span>}
                    </div>
                    <div className="mk-tag"><span className="mk-tag-hole" aria-hidden="true" /><strong>{o.price}</strong></div>
                    <h3>{o.title}</h3>
                    <p className="mk-seller">{o.seller}{o.rating ? ` · ★ ${o.rating}` : ""}{o.used ? " · secondhand" : ""}</p>
                    {!o.sample && <a className="link-back" href={o.url} target="_blank" rel="noreferrer">See it <Icon name="next" size={13} /></a>}
                  </article>
                );
              })}
            </div>
            {offers.length > 0 && <p className="mk-fine">{offers[0].sample ? "Samples, so you can see the layout. Live listings need the SerpAPI key." : "Advertised online prices. They don't confirm a nearby branch has it in stock."}</p>}
          </section>

          {paid.length > 0 && (
            <section className="mk-paid-card">
              <h2>What people paid near you</h2>
              <ul className="mk-book mk-lines-book">
                {paid.slice(0, 20).map((r) => (
                  <li key={r.id}>
                    <span className="mk-paid">{money(r.paid, r.currency)}</span>
                    <span>{r.product_name}{r.variant ? ` · ${r.variant}` : ""}</span>
                    <span className="mk-fine">{r.shop.name} · {new Date(r.purchase_date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    {r.asking && <span className="mk-haggle">{Math.round((1 - r.paid / r.asking) * 100)}% off asking</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ReportSheet
        open={sheet !== null}
        shop={null}
        shops={stores}
        currency={currency}
        draft={sheet ?? {}}
        onClose={() => setSheet(null)}
        onSaved={async (r) => {
          setSheet(null);
          setToast(`Logged at ${r.shop.name}. It's on the map for the next person.`);
          try { setPaid((await market.paid(checked || r.product_name, country, place)).paid); setLiveAt(Date.now()); } catch { /* next refresh */ }
        }}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
