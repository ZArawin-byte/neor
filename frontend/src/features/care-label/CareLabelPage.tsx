import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import type { Item } from "../../lib/types";
import { myItems, readLabel, type CareLabel } from "./api";

const ENGINE: Record<string, string> = {
  perceptron: "Read by Perceptron",
  groq: "Read by Groq vision",
  offline: "Reader offline",
};

/** Yes / no / not on the label, in words rather than symbols so nothing is guessed. */
function rule(v: boolean | null, yes: string, no: string) {
  return v === null ? null : v ? yes : no;
}

export default function CareLabelPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [result, setResult] = useState<CareLabel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    myItems().then((all) => setItems(all.filter((i) => !i.starter))).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function read(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      setResult(await readLabel(file, itemId || undefined));
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError && err.status === 401
        ? "Sign in first, then come back to read a label."
        : err instanceof ApiError && err.status === 429
          ? "That's a lot of labels at once. Give it a minute."
          : "We couldn't read that photo. Try a sharper, closer shot of the tag.");
    } finally {
      setLoading(false);
    }
  }

  const c = result?.care;
  const rules = c
    ? [
        c.wash_temp_c !== null ? `Wash at ${c.wash_temp_c}°C or below` : null,
        rule(c.machine_wash, "Machine washable", "Hand wash only"),
        rule(c.bleach, "Bleach allowed", "Do not bleach"),
        rule(c.tumble_dry, "Tumble dry allowed", "Do not tumble dry"),
        rule(c.iron, "Can be ironed", "Do not iron"),
        rule(c.dry_clean, "Dry clean allowed", "Do not dry clean"),
      ].filter(Boolean) as string[]
    : [];

  return (
    <main className="care-label">
      <Link to="/" className="care-label-back">← Back to the hall</Link>
      <header>
        <p className="kicker">Care labels</p>
        <h1>Read a care label</h1>
        <p>Photograph the little tag sewn inside a piece. neor reads what it's made of and how to look after it.</p>
      </header>

      <form className="label-form" onSubmit={read}>
        <label className="label-drop">
          {preview ? <img src={preview} alt="Your care label" /> : <span>Choose a photo of the label</span>}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </label>
        {items.length > 0 && (
          <select className="text-input" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Save to a piece">
            <option value="">Don't save it to a piece</option>
            {items.map((i) => <option key={i.id} value={i.id}>Save to: {i.name}</option>)}
          </select>
        )}
        <button className="btn" disabled={loading || !file}>{loading ? "Reading…" : "Read the label"}</button>
      </form>
      {error && <p className="error">{error}</p>}

      {result && (
        <section className="woven" aria-live="polite">
          <p className="woven-engine">{ENGINE[result.ai] ?? result.ai}</p>
          {result.ai === "offline" ? (
            <p>The label reader is switched off right now, so nothing was sent anywhere. Check the tag by eye for now.</p>
          ) : (
            <>
              <h2>What it's made of</h2>
              {result.fiber_composition.length ? (
                <ul className="fibres">
                  {result.fiber_composition.map((f) => (
                    <li key={f.fiber}>
                      <span className="pct">{f.percent !== null ? `${f.percent}%` : "–"}</span> {f.fiber}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No fibres were legible on this label.</p>}

              {rules.length > 0 && (
                <>
                  <h2>The label says</h2>
                  <ul className="rules">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
                </>
              )}

              {result.care_steps.length > 0 && (
                <>
                  <h2>How to look after it</h2>
                  <ol className="steps">{result.care_steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <p className="why">Steps marked "label" come from the tag itself. The rest is general care for these fibres.</p>
                </>
              )}
              {result.saved_to_item && <p className="saved">Saved to that piece in your closet.</p>}
              <details>
                <summary>What the reader saw</summary>
                <pre>{result.text}</pre>
              </details>
            </>
          )}
        </section>
      )}
    </main>
  );
}
