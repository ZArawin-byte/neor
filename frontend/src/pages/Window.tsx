import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageFrame, useToast } from "../components/PageFrame";
import { Sticker } from "../components/Sticker";
import { toSnap } from "../components/Studio";
import { api } from "../lib/api";
import { useCloset } from "../lib/closet";
import { lch, lightNote, litBackdrop, type Light, type Mode } from "../lib/color";
import { backdropFor, DEMO_CENTER, DEMO_CITY, DEMO_SPOTS, KIND_LABEL, type Spot } from "../lib/places";
import { saved } from "../lib/saved";
import { dressForPlace, fromItem, fromProduct } from "../lib/stylist";
import "../styles/window.css";

function pinFor(spot: Spot, on: boolean) {
  const dominant = [...backdropFor(spot).colors].sort((a, b) => b.weight - a.weight)[0].hex;
  return L.divIcon({
    className: "",
    html: `<span class="pin ${on ? "is-on" : ""}" style="--c:${dominant}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function FlyTo({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, map.getZoom(), { duration: 0.6 }); }, [center, map]);
  return null;
}

const LIGHTS: { id: Light; label: string }[] = [
  { id: "morning", label: "Morning" }, { id: "midday", label: "Midday" }, { id: "golden", label: "Golden hour" }, { id: "night", label: "Evening" },
];

function currentLight(): Light {
  const h = new Date().getHours();
  return h < 10 ? "morning" : h < 16 ? "midday" : h < 19 ? "golden" : "night";
}
function currentSeason(): string {
  const m = new Date().getMonth();
  return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "fall";
}

export default function Window() {
  const { items, catalog } = useCloset();
  const [city, setCity] = useState(DEMO_CITY);
  const [spots, setSpots] = useState<Spot[]>(DEMO_SPOTS);
  const [center, setCenter] = useState<[number, number]>(DEMO_CENTER);
  const [live, setLive] = useState(false);
  const [intro, setIntro] = useState("A few places worth dressing for.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(DEMO_SPOTS[0].id);
  const [mode, setMode] = useState<Mode>("pop");
  const [light, setLight] = useState<Light>(currentLight);
  const [season, setSeason] = useState(currentSeason);
  const [toast, say] = useToast();

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.places(city, "cafes and pretty photo spots");
      if (!res.picks.length) throw new Error("none");
      setSpots(res.picks);
      setCenter(res.center);
      setIntro(res.intro);
      setSelectedId(res.picks[0].id);
      setLive(true);
    } catch {
      setError(`Couldn't look around ${city} right now, so here are the Seattle sample spots.`);
    } finally {
      setLoading(false);
    }
  }

  const spot = spots.find((s) => s.id === selectedId) ?? spots[0];
  const backdrop = useMemo(() => litBackdrop(backdropFor(spot), light), [spot, light]);
  const look = useMemo(() => dressForPlace(
    items.filter((i) => !i.laundry).map(fromItem),
    catalog.map(fromProduct),
    backdrop, mode, season,
  ), [items, catalog, backdrop, mode, season]);

  const bgL = backdrop.colors.reduce((s, c) => s + lch(c.hex).L * c.weight, 0) / backdrop.colors.reduce((s, c) => s + c.weight, 0);

  function toTable() {
    const now = Date.now();
    const placed = look.pieces.map(({ piece }, i) => ({
      key: `${piece.id}-${now}-${i}`, source: piece.source, refId: piece.id,
      x: 22 + (i % 3) * 28, y: 30 + Math.floor(i / 3) * 40, rot: (i % 2 ? 3 : -3), snap: toSnap(piece),
    }));
    saved.saveDraft([...saved.draft(), ...placed]);
    say(<>On your table. <Link to="/mirror">Try it in the mirror</Link></>);
  }

  return (
    <PageFrame title="The window" kicker="Dress for where you're going" className="window-page">
      <div className="window-layout">
        <section className="map-col">
          <form className="city" onSubmit={search}>
            <Icon name="pin" />
            <input className="text-input" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City or neighbourhood" />
            <button className="btn sm" disabled={loading}>{loading ? "Looking..." : "Look around"}</button>
          </form>
          {error && <p className="error">{error}</p>}

          <div className="map-frame">
            <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="map">
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <FlyTo center={center} />
              {spots.map((s) => (
                <Marker key={s.id} position={[s.lat, s.lon]} icon={pinFor(s, s.id === spot.id)}
                  eventHandlers={{ click: () => setSelectedId(s.id) }} />
              ))}
            </MapContainer>
          </div>
          <p className="map-note">{live ? `Live from OpenStreetMap. ${intro}` : `Sample spots. Search a city for live ones.`}</p>

          <ul className="spot-list">
            {spots.map((s) => (
              <li key={s.id}>
                <button className={s.id === spot.id ? "is-on" : ""} onClick={() => { setSelectedId(s.id); setCenter([s.lat, s.lon]); }}>
                  <span className="spot-swatches">
                    {backdropFor(s).colors.map((c) => <i key={c.hex} style={{ background: c.hex, flex: c.weight }} />)}
                  </span>
                  <span className="spot-name">{s.name}</span>
                  <span className="spot-kind">{KIND_LABEL[s.kind] ?? s.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="look-col">
          <header className="spot-head">
            <p className="kicker">{KIND_LABEL[spot.kind] ?? spot.kind}</p>
            <h2>{spot.name}</h2>
            {spot.why && <p>{spot.why}</p>}
            {spot.photo_tip && <p className="tip">{spot.photo_tip}</p>}
          </header>

          <div className="backdrop">
            <div className="backdrop-strip">
              {backdrop.colors.map((c) => <span key={c.hex} style={{ background: c.hex, flex: c.weight }} />)}
            </div>
            <p className="facts">
              {backdropFor(spot).label}, as the camera sees it in {lightNote(light)}.
            </p>
          </div>

          <div className="controls">
            <div className="seg" role="radiogroup" aria-label="Stand out or blend in">
              <button role="radio" aria-checked={mode === "pop"} className={mode === "pop" ? "is-on" : ""} onClick={() => setMode("pop")}>Stand out</button>
              <button role="radio" aria-checked={mode === "blend"} className={mode === "blend" ? "is-on" : ""} onClick={() => setMode("blend")}>Blend in</button>
            </div>
            <select value={light} onChange={(e) => setLight(e.target.value as Light)} aria-label="Time of day">
              {LIGHTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
              {["spring", "summer", "fall", "winter"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          <div className="look">
            <div className="look-head">
              <h3>From your closet</h3>
              <span className="harmony-pill">{look.harmony.name} · {look.harmony.score}</span>
            </div>
            {look.pieces.length === 0 ? (
              <p className="muted">Nothing in season for this one. Try another season or add pieces to your closet.</p>
            ) : (
              <ol className="look-pieces">
                {look.pieces.map(({ piece, score, reason }) => (
                  <li key={piece.id}>
                    <Sticker id={piece.id} name={piece.name} hex={piece.hex} rack={piece.rack} image={piece.image_url} size={86} />
                    <div>
                      <p className="piece-name">{piece.name} <span>{Math.round(score * 100)}</span></p>
                      <p className="piece-why">{reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {look.upgrades.length > 0 && (
              <>
                <h4>Worth buying for this spot</h4>
                <ul className="upgrades">
                  {look.upgrades.map(({ replaces, with: w }) => (
                    <li key={w.piece.id}>
                      <Sticker id={w.piece.id} name={w.piece.name} hex={w.piece.hex} rack={w.piece.rack} size={64} />
                      <div>
                        <p className="piece-name">{w.piece.name} <small>{w.piece.brand} · ${w.piece.price}</small></p>
                        <p className="piece-why">
                          {replaces ? `Scores ${Math.round(w.score * 100)} here vs ${Math.round((look.pieces.find((p) => p.piece.id === replaces.id)?.score ?? 0) * 100)} for your ${replaces.name.toLowerCase()}. ` : "Fills a gap in your closet. "}
                          {w.reason}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="row look-actions">
              <button className="btn" onClick={toTable} disabled={!look.pieces.length}>Put it on the table</button>
            </div>
          </div>

          <details className="logic">
            <summary>How Neor picked this</summary>
            <ol>
              <li>The backdrop's colours are tinted for {lightNote(light)}. Its average brightness comes out at {Math.round(bgL * 100)}/100.</li>
              <li>{mode === "pop"
                ? "Stand out: pieces score higher the further their hue sits from the backdrop's main colour (complementary is best) and the bigger the light/dark gap, so you separate from the background in photos."
                : "Blend in: pieces score higher when their hue is a neighbour of the backdrop's main colour and their brightness is close but not identical, so you look like part of the scene."}</li>
              <li>The best-scoring top or dress becomes the hero. Each following piece is scored 45% on the backdrop and 55% on how it pairs with what's already picked, so the outfit agrees with itself as well as with the place.</li>
              <li>A layer is added only if it raises the outfit's colour-harmony score. Shop pieces appear only when one beats your own best option by more than 10 points.</li>
            </ol>
          </details>
        </section>
      </div>
      {toast}
    </PageFrame>
  );
}
