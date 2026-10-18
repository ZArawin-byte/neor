import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageFrame, useToast } from "../components/PageFrame";
import { Sticker } from "../components/Sticker";
import { toSnap } from "../components/Studio";
import { TryOn } from "../components/TryOn";
import { api, assetUrl } from "../lib/api";
import { fitPiece, prepareMirrorPhoto, saveBody, savedBody, type Body } from "../lib/body";
import { useCloset } from "../lib/closet";
import { harmonyOf, pairScore } from "../lib/color";
import { slotOf } from "../lib/racks";
import { saved } from "../lib/saved";
import { fromProduct } from "../lib/stylist";
import type { BoardPiece, OutfitResult, WornPiece } from "../lib/types";
import "../styles/mirror.css";

const ROOMY = ["wide", "oversized", "baggy", "puffer", "maxi", "flare", "cargo", "parachute", "chunky", "cable", "hoodie", "relaxed", "boyfriend", "a-line"];
const FITTED = ["skinny", "slim", "fitted", "bodycon", "legging", "tank", "cami", "cropped", "tailored", "pencil", "straight"];

function cutOf(name: string): "roomy" | "fitted" | null {
  const n = name.toLowerCase();
  if (ROOMY.some((w) => n.includes(w))) return "roomy";
  if (FITTED.some((w) => n.includes(w))) return "fitted";
  return null;
}

/** Proportion read from the clothes themselves (cut words in item names), never from the body. */
function proportionNotes(pieces: BoardPiece[]): string[] {
  const top = pieces.find((p) => slotOf(p.snap.rack) === "top");
  const bottom = pieces.find((p) => slotOf(p.snap.rack) === "bottom");
  const dress = pieces.find((p) => slotOf(p.snap.rack) === "onepiece");
  const notes: string[] = [];

  if (top && bottom) {
    const t = cutOf(top.snap.name), b = cutOf(bottom.snap.name);
    if (t === "roomy" && b === "roomy") notes.push("Both halves are roomy. Mark the waist (a half-tuck, a belt, or a cropped layer) so the shape doesn't get lost.");
    else if (t === "roomy" && b === "fitted") notes.push("Relaxed on top, fitted below: the classic balanced silhouette.");
    else if (t === "fitted" && b === "roomy") notes.push("Fitted on top, fuller below. That draws a clear waistline.");
    else if (t === "fitted" && b === "fitted") notes.push("Sleek head to toe. A structured layer or a louder shoe gives it a focal point.");
    else notes.push(`neor can't tell the cut of "${t ? bottom.snap.name : top.snap.name}" from its name. Words like "wide" or "slim" in item names sharpen these notes.`);
  } else if (dress) {
    notes.push(cutOf(dress.snap.name) === "roomy"
      ? "A fuller dress: balance it with a neater shoe and keep layers cropped."
      : "A one-piece does the proportion work for you. Let the shoes and a layer set the mood.");
  } else if (top || bottom) {
    notes.push(`There's a ${top ? "top" : "bottom"} but no ${top ? "bottom" : "top"} on the table yet.`);
  }

  const slots = new Set(pieces.map((p) => slotOf(p.snap.rack)));
  if (!slots.has("shoes")) notes.push("No shoes yet. They decide whether this reads casual or dressed up.");
  return notes;
}

export default function Mirror() {
  const { profile, setProfile, catalog, offline } = useCloset();
  const board = saved.lastBoard();
  const draft = saved.draft();
  // The table as it is right now wins; fall back to the last saved board if the table is empty.
  const pieces: BoardPiece[] = draft.length ? draft : board?.pieces ?? [];
  const matchesSaved = !!board && JSON.stringify(board.pieces) === JSON.stringify(pieces);
  const boardName = matchesSaved ? board!.name : draft.length ? "On your table now" : "Unsaved table";

  const [photo, setPhoto] = useState<string | null>(assetUrl(profile.mirror_url ?? null));
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [body, setBody] = useState<Body | null>(savedBody);
  const [occasion, setOccasion] = useState("everyday");
  const [read, setRead] = useState<OutfitResult | null>(null);
  const [reading, setReading] = useState(false);
  const [toast, say] = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [worn, setWornState] = useState<WornPiece[]>(() => saved.tryon());
  const setWorn = (next: WornPiece[]) => { setWornState(next); saved.saveTryon(next); };
  useEffect(() => { if (profile.mirror_url) setPhoto(assetUrl(profile.mirror_url)); }, [profile.mirror_url]);

  const hexes = pieces.map((p) => p.snap.hex);
  const harmony = harmonyOf(hexes);
  const proportion = proportionNotes(pieces);

  // Finishing pieces from the shop: accessories, bags, scarves (and shoes if missing), ranked by colour fit.
  const finishers = useMemo(() => {
    const haveShoes = pieces.some((p) => slotOf(p.snap.rack) === "shoes");
    return catalog.map(fromProduct)
      .filter((p) => slotOf(p.rack) === "extra" || (!haveShoes && slotOf(p.rack) === "shoes"))
      .map((p) => ({ p, s: hexes.length ? hexes.reduce((a, h) => a + pairScore(p.hex, h), 0) / hexes.length : 0.5 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map(({ p }) => p);
  }, [catalog, pieces]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Crop the person out, find their body, then upload the cropped photo. */
  async function onPhoto(f: Blob) {
    setUploading(true);
    try {
      setUploadStep("Cutting you out of the background…");
      const { blob, body: found } = await prepareMirrorPhoto(f);
      setUploadStep("Uploading…");
      if (offline) setPhoto(URL.createObjectURL(blob));
      else {
        const prof = await api.uploadMirror(blob);
        setProfile(prof);
        setPhoto(assetUrl(prof.mirror_url ?? null));
      }
      saveBody(found);
      setBody(found);
      // anything already on you is refitted to the new photo
      setWorn(worn.map((w) => ({ ...w, ...fitPiece(w.snap, found), rot: 0 })));
      if (found.source === "outline") say("Couldn't see your shoulders and hips clearly, so clothes are fitted to your outline. A straight-on photo works best.");
    } catch {
      say("That photo didn't work. Try a full-length JPG or PNG under 8MB.");
    } finally {
      setUploading(false);
      setUploadStep("");
    }
  }

  /** For a photo uploaded before cropping existed: run it through the same steps. */
  async function fitExisting() {
    if (!photo) return;
    try { onPhoto(await (await fetch(photo)).blob()); }
    catch { say("Couldn't read the current photo. Upload it again instead."); }
  }

  async function askNeor() {
    setReading(true);
    try {
      setRead(await api.outfit({ occasion, place: `wearing: ${pieces.map((p) => p.snap.name).join(", ")}` }));
    } catch {
      say("neor couldn't be reached just now. The colour and fit notes still stand.");
    } finally {
      setReading(false);
    }
  }

  function addToTable(p: ReturnType<typeof fromProduct>) {
    const key = `${p.id}-${Date.now()}`;
    saved.saveDraft([...saved.draft(), { key, source: "market", refId: p.id, x: 50 + Math.random() * 30 - 15, y: 50, rot: 3, snap: toSnap(p) }]);
    say(<>{p.name} is on your table. <Link to="/closet">Open the closet</Link></>);
  }

  function saveLook() {
    saved.saveLook({
      name: matchesSaved ? boardName : `Look of ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}`,
      pieces, photo, occasion, tryon: worn,
      verdict: read?.why ?? harmony.lines[0] ?? "",
      harmony: `${harmony.name} · ${harmony.score}`,
    });
    say(<>Saved to your archive. <Link to="/archive">See it</Link></>);
  }

  return (
    <PageFrame title="The mirror" kicker="Put what is on your table onto yourself" className="mirror-page"
      actions={<button className="btn" onClick={saveLook} disabled={!pieces.length}><Icon name="star" size={16} /> Save this fit</button>}>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
      <TryOn
        photo={photo}
        body={body}
        onFitPhoto={fitExisting}
        pieces={pieces}
        worn={worn}
        setWorn={setWorn}
        boardName={boardName}
        emptyMirror={
          <div className="mirror-empty">
            <p>Stand back and take one full-length photo, facing the camera. It stays private to you.</p>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); file.current?.click(); }} disabled={uploading}>
              <Icon name="upload" size={14} /> {uploading ? uploadStep || "Working…" : "Upload a photo of yourself"}
            </button>
          </div>
        }
        tableFooter={
          pieces.length === 0
            ? <p className="muted">Nothing on the table yet. <Link to="/closet">Build a combo in the closet</Link>, then come back to try it on.</p>
            : (
              <div className="row mirror-links">
                <Link to="/closet" className="link-back">Edit on the table <Icon name="next" size={14} /></Link>
                {photo && (
                  <button className="link-back" onClick={() => file.current?.click()} disabled={uploading}>
                    <Icon name="upload" size={14} /> {uploading ? uploadStep || "Working…" : "Change my photo"}
                  </button>
                )}
              </div>
            )
        }
      />

      {pieces.length > 0 && (
        <section className="analysis">
          <article className="card">
            <h3>Colour</h3>
            <div className="palette">
              {pieces.map((p) => <span key={p.key} style={{ background: p.snap.hex }} title={p.snap.name} />)}
            </div>
            <p className="score-line"><b>{harmony.name}</b> <span>{harmony.score}/100</span></p>
            <ul>{harmony.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="facts">
              Temperature: {harmony.temperature} · Contrast: {harmony.contrast}
            </p>
          </article>

          <article className="card">
            <h3>Fit &amp; proportion</h3>
            <ul>{proportion.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="facts">Read from the cut of the clothes, not from your body.</p>
          </article>

          <article className="card wide">
            <div className="card-head">
              <h3>neor's read</h3>
              <div className="row">
                <select value={occasion} onChange={(e) => setOccasion(e.target.value)} aria-label="Occasion">
                  {["everyday", "uni", "birthday", "wedding", "gym"].map((o) => <option key={o} value={o}>{o === "uni" ? "Class" : o[0].toUpperCase() + o.slice(1)}</option>)}
                </select>
                <button className="btn sm" onClick={askNeor} disabled={reading || offline}>{reading ? "Looking..." : "Ask"}</button>
              </div>
            </div>
            {read ? (
              <>
                <p>{read.why}</p>
                {read.styling_tip && <p className="tip">{read.styling_tip}</p>}
                {read.scent && <p className="facts">Scent to match: {read.scent}</p>}
              </>
            ) : (
              <p className="muted">Pick the occasion and neor will tell you what's working and what to change, in light of your style profile.</p>
            )}

            <h4>Finish it with</h4>
            <div className="finishers">
              {[...(read?.missing.map((m) => catalog.find((c) => c.id === m.catalog_id)).filter(Boolean).map((p) => fromProduct(p!)) ?? []), ...finishers]
                .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
                .slice(0, 5)
                .map((p) => (
                  <div key={p.id} className="finisher">
                    <Sticker id={p.id} name={p.name} hex={p.hex} rack={p.rack} size={76} />
                    <span>{p.name}</span>
                    <small>{p.brand} · ${p.price}</small>
                    <button className="btn ghost sm" onClick={() => addToTable(p)}>Add to table</button>
                  </div>
                ))}
            </div>
          </article>
        </section>
      )}
      {toast}
    </PageFrame>
  );
}
