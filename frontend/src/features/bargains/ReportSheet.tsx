import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { CURRENCIES, market, toJpegBase64, type Report, type Shop } from "./market";

export interface ReportDraft {
  name?: string;
  brand?: string;
  model?: string;
  photo?: Blob | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * "What did you pay?" Only the item, shop, price and currency are required; brand, model,
 * variant, asking price and notes stay optional, and nothing is guessed for you.
 */
export function ReportSheet({ open, shop, shops, currency, draft, onClose, onSaved }: {
  open: boolean;
  shop: Shop | null;
  shops: Shop[];
  currency: string;
  draft: ReportDraft;
  onClose: () => void;
  onSaved: (r: Report) => void;
}) {
  const [shopId, setShopId] = useState(shop?.id ?? "");
  const [name, setName] = useState("");
  const [paid, setPaid] = useState("");
  const [cur, setCur] = useState(currency);
  const [date, setDate] = useState(today);
  const [more, setMore] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [asking, setAsking] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // One id per opening of the form, so a double tap can't file the same report twice.
  const submissionId = useMemo(() => crypto.randomUUID(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setShopId(shop?.id ?? shops[0]?.id ?? "");
    setName(draft.name ?? "");
    setBrand(draft.brand ?? "");
    setModel(draft.model ?? "");
    setPhoto(draft.photo ?? null);
    setMore(!!(draft.brand || draft.model));
    setPaid(""); setAsking(""); setVariant(""); setNotes(""); setDate(today()); setCur(currency); setError("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = shop && !shops.some((s) => s.id === shop.id) ? [shop, ...shops] : shops;
  const chosen = options.find((s) => s.id === shopId) ?? null;
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!chosen) return setError("Pick the shop you bought it from. Find shops on the map first.");
    const paidN = Number(paid), askingN = asking ? Number(asking) : null;
    if (!(paidN > 0)) return setError("Enter what you paid.");
    if (askingN !== null && askingN < paidN) return setError("The asking price can't be lower than what you paid.");
    setSaving(true);
    try {
      const saved = await market.report({
        submission_id: submissionId,
        shop: { id: chosen.id, name: chosen.name, address: chosen.address ?? "", lat: chosen.lat, lon: chosen.lon },
        product_name: name.trim(), brand: brand.trim(), model: model.trim(), variant: variant.trim(),
        currency: cur, paid: Math.round(paidN * 100) / 100, asking: askingN ? Math.round(askingN * 100) / 100 : null,
        purchase_date: date, notes: notes.trim(),
        photo: photo ? await toJpegBase64(photo) : null,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again?");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <aside className="sheet report-sheet" onClick={(e) => e.stopPropagation()} aria-label="Log what you paid">
        <header className="sheet-head">
          <div>
            <p className="kicker">Pass on a good find</p>
            <h2>What did you pay?</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>

        <form className="report-form" onSubmit={submit}>
          <label className="report-photo">
            {preview ? <img src={preview} alt="" /> : <span><Icon name="upload" size={20} /> Add a photo (optional)</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>

          <label className="mk-field">
            <span>What is it?</span>
            <input className="text-input" required minLength={3} maxLength={140} placeholder="e.g. Wool overcoat" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="mk-field">
            <span>Where did you buy it?</span>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} required>
              {options.length === 0 && <option value="">Find shops on the map first</option>}
              {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? `, ${s.address.split(",")[0]}` : ""}</option>)}
            </select>
          </label>

          <div className="mk-row">
            <label className="mk-field">
              <span>Price paid</span>
              <input className="text-input" required inputMode="decimal" type="number" min="0.01" step="0.01" max="1000000" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </label>
            <label className="mk-field sm">
              <span>Currency</span>
              <select value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="mk-field">
              <span>When</span>
              <input className="text-input" type="date" required min="2000-01-01" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          <button type="button" className="link-back more-toggle" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <Icon name={more ? "x" : "plus"} size={13} /> {more ? "Fewer details" : "More details (all optional)"}
          </button>
          {more && (
            <div className="mk-more">
              <div className="mk-row">
                <label className="mk-field"><span>Brand</span><input className="text-input" maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
                <label className="mk-field"><span>Model or product ID</span><input className="text-input" maxLength={100} value={model} onChange={(e) => setModel(e.target.value)} /></label>
              </div>
              <label className="mk-field"><span>Size, colour, condition</span><input className="text-input" maxLength={180} placeholder="e.g. M, camel, barely worn" value={variant} onChange={(e) => setVariant(e.target.value)} /></label>
              <label className="mk-field"><span>Asking price before you haggled</span><input className="text-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={asking} onChange={(e) => setAsking(e.target.value)} /></label>
              <label className="mk-field"><span>Notes</span><textarea className="text-input" rows={2} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
          )}

          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Add to the ledger"}</button>
          <p className="facts">Everyone using neor can see what you paid and at which shop. Your name isn't shown.</p>
        </form>
      </aside>
    </div>
  );
}
