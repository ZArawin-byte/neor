import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useCloset } from "../lib/closet";
import { cutOut, dominantHex } from "../lib/cutout";
import { guessRack, RACK_BY_ID, RACKS, type RackId } from "../lib/racks";
import type { Item } from "../lib/types";
import { Icon } from "./Icon";
import { Sticker } from "./Sticker";

type Step =
  | { kind: "pick" }
  | { kind: "working"; label: string; pct: number }
  | { kind: "confirm"; blob: Blob; preview: string; meta: Partial<Item>; suggested: RackId; chosen: RackId; choosing: boolean; unsure?: boolean };

/**
 * Adding pieces: photos -> background removed in-browser -> backend tags each one ->
 * "This goes on the Sweaters rack" -> user agrees or picks another rack -> saved.
 * Several photos at once go through one after another ("Photo 2 of 5").
 */
const ANALYZE_TIMEOUT = 25_000; // never leave someone staring at a spinner

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, bad) => setTimeout(() => bad(new Error("timeout")), ms))]);
export function UploadSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (item: Item) => void }) {
  const { offline, add } = useCloset();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [queue, setQueue] = useState<File[]>([]); // photos still to go after this one
  const [batch, setBatch] = useState({ done: 0, total: 0 });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setStep({ kind: "pick" }); setError(""); setQueue([]); setBatch({ done: 0, total: 0 }); } }, [open]);

  /** Start a batch: the first photo now, the rest queued. */
  function handleFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (!files.length) return setError("Those need to be JPG, PNG or WebP photos.");
    const skipped = list.length - files.length;
    setBatch({ done: 0, total: files.length });
    setQueue(files.slice(1));
    handle(files[0]);
    if (skipped) setError(`Skipped ${skipped} file${skipped > 1 ? "s" : ""} that weren't photos.`);
  }

  /** After saving or skipping one, move on to the next photo, or back to the start when done. */
  function next() {
    setBatch((b) => ({ ...b, done: b.done + 1 }));
    const [first, ...rest] = queue;
    setQueue(rest);
    if (first) handle(first);
    else setStep({ kind: "pick" });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** A pasted shop link: the server reads the page's photo, then it goes through the same flow as an upload. */
  async function fromLink(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setError("");
    setStep({ kind: "working", label: "Fetching the photo from that page", pct: 1 });
    try {
      const res = await api.importLink(link.trim());
      const blob = await (await fetch(res.image)).blob();
      setLink("");
      // Shop titles look like "Wool Coat | Brand - Shop"; keep the product part.
      const name = res.title.split(/ [|–-] /)[0].trim();
      await handle(new File([blob], "linked", { type: blob.type }), {
        ...(name ? { name } : {}),
        ...(res.price && !Number.isNaN(Number(res.price)) ? { price: Number(res.price) } : {}),
      });
    } catch (err) {
      setStep({ kind: "pick" });
      setError(err instanceof Error ? err.message : "Couldn't use that link.");
    }
  }

  async function handle(file: File, preset: Partial<Item> = {}) {
    setError("");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("That one needs to be a JPG, PNG or WebP photo.");
    setStep({ kind: "working", label: "Cutting it out of the background", pct: 0 });
    const { blob } = await cutOut(file, (pct) => setStep({ kind: "working", label: "Cutting it out of the background", pct }));
    setStep({ kind: "working", label: "Working out what it is", pct: 1 });

    // Phone file names ("WhatsApp Image 2026-...", "IMG_4021") are no use as a piece's name.
    const fileName = file.name.replace(/\.\w+$/, "").replace(/[-_]/g, " ").trim();
    const usefulName = /^(whatsapp|img|image|photo|dsc|pxl|screenshot|linked)\b/i.test(fileName) || /\d{4}/.test(fileName) ? "" : fileName;
    let meta: Partial<Item> = { name: usefulName };
    let recognised = false;
    if (!offline) {
      try {
        const tags = await withTimeout(api.analyze(blob), ANALYZE_TIMEOUT) as Partial<Item> & { ai?: string; confidence?: number };
        recognised = tags.ai !== "rules" && (tags.confidence ?? 1) > 0;
        meta = { ...tags, name: tags.name && tags.name !== "New item" ? tags.name : usefulName };
        delete (meta as { ai?: string }).ai;
      } catch { /* tagger down or too slow: user picks the rack themselves */ }
    }
    meta = { ...meta, ...preset }; // the shop's own title beats the AI's guess
    if (!meta.hex || meta.hex === "#b9a68a") meta.hex = await dominantHex(blob);
    const suggested = guessRack(meta);
    const known = recognised || !!preset.name || !!meta.name;
    // Not recognised: ask, rather than quietly guessing a rack.
    setStep({ kind: "confirm", blob, preview: URL.createObjectURL(blob), meta, suggested, chosen: suggested, choosing: !known, unsure: !known });
  }

  async function save() {
    if (step.kind !== "confirm") return;
    const rack = RACK_BY_ID[step.chosen];
    const meta: Partial<Item> = { ...step.meta, rack: rack.id, category: rack.category };
    setStep({ kind: "working", label: `Hanging it on the ${rack.label.toLowerCase()} rack`, pct: 1 });
    try {
      const item = offline
        ? ({ ...meta, id: `local-${Date.now()}`, image_url: step.preview } as Item)
        : await api.addItem(meta, step.blob);
      add(item);
      onAdded(item);
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that one. Try again?");
      setStep(step);
    }
  }

  if (!open) return null;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()} aria-label="Add a piece to your closet">
        <header className="sheet-head">
          <div>
            <h2>{batch.total > 1 ? "Add pieces" : "Add a piece"}</h2>
            {batch.total > 1 && step.kind !== "pick" && <p className="batch-count">Photo {Math.min(batch.done + 1, batch.total)} of {batch.total}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>

        {step.kind === "pick" && (
          <label
            className={`dropzone ${dragging ? "is-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
          >
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }} />
            <Icon name="upload" size={28} />
            <strong>Drop photos, or tap to choose</strong>
            <span>Pick as many as you like and we'll go through them one by one. Lay each piece flat or hang it against a plain wall, one piece per photo.</span>
          </label>
        )}

        {step.kind === "pick" && (
          <form className="link-form" onSubmit={fromLink}>
            <label htmlFor="item-link">Or paste a link to the piece in a shop</label>
            <div className="row">
              <input id="item-link" className="text-input" type="url" inputMode="url" placeholder="https://…"
                value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="btn sm" disabled={!link.trim() || offline}>Use its photo</button>
            </div>
            <small>{offline ? "This needs the Neor server, which isn't reachable right now." : "We'll grab the product photo and its name."}</small>
          </form>
        )}

        {step.kind === "working" && (
          <div className="working">
            <div className="spool" />
            <p>{step.label}...</p>
            {step.pct > 0 && step.pct < 1 && <progress value={step.pct} max={1} />}
          </div>
        )}

        {step.kind === "confirm" && (
          <div className="confirm">
            <div className="confirm-preview">
              <Sticker id="preview" name={step.meta.name ?? ""} hex={step.meta.hex ?? "#999"} rack={step.chosen} image={step.preview} size={200} tilt={false} turn={step.meta.rotation} />
              <div className="turn-btns" role="group" aria-label="Turn the photo">
                <button className="icon-btn" title="Turn left" onClick={() => setStep({ ...step, meta: { ...step.meta, rotation: ((step.meta.rotation ?? 0) + 270) % 360 } })}>↺</button>
                <button className="icon-btn" title="Turn right" onClick={() => setStep({ ...step, meta: { ...step.meta, rotation: ((step.meta.rotation ?? 0) + 90) % 360 } })}>↻</button>
              </div>
            </div>
            <input
              className="name-input"
              value={step.meta.name ?? ""}
              onChange={(e) => setStep({ ...step, meta: { ...step.meta, name: e.target.value } })}
              aria-label="Name"
              placeholder="Name it, e.g. Wide-leg jeans"
            />

            {!step.choosing ? (
              <>
                <p className="verdict">
                  This item will go on the <em>{RACK_BY_ID[step.chosen].label.toLowerCase()}</em> rack.
                </p>
                <div className="row">
                  <button className="btn" onClick={save}><Icon name="check" /> Okay</button>
                  <button className="btn ghost" onClick={() => setStep({ ...step, choosing: true })}>No, somewhere else</button>
                  {batch.total > 1 && <button className="btn ghost" onClick={next}>Skip this one</button>}
                </div>
              </>
            ) : (
              <>
                <p className="verdict">{step.unsure ? "We couldn't tell what this is. Where should it hang?" : "Where should it hang?"}</p>
                <div className="rack-chips">
                  {RACKS.map((r) => (
                    <button key={r.id} className={`chip ${step.chosen === r.id ? "is-on" : ""}`}
                      onClick={() => setStep({ ...step, chosen: r.id })}>
                      {r.label}
                      {r.id === step.suggested && !step.unsure && <small> (suggested)</small>}
                    </button>
                  ))}
                </div>
                <button className="btn" onClick={save}>Hang it on {RACK_BY_ID[step.chosen].label.toLowerCase()}</button>
              </>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  );
}
