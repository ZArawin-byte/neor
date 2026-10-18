import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageFrame, useToast } from "../components/PageFrame";
import { api, assetUrl } from "../lib/api";
import { displayName, signOut } from "../lib/auth";
import { useCloset } from "../lib/closet";
import type { Profile as ProfileData } from "../lib/types";
import "../styles/profile.css";

/** Everything here is optional. Field names match what PUT /api/profile accepts. */
interface Form {
  name: string;
  age: string;
  gender: string;
  pronouns: string;
  tradition: string;
  modesty: "" | "modest" | "very modest";
  dress_rules: string[];
  modesty_notes: string;
  styles: string[];
  colors_love: string[];
  colors_avoid: string[];
  height_cm: string;
  top_size: string;
  bottom_size: string;
  shoe_size: string;
  fit: string;
  budget: string;
  climate: string;
  ai_consent: boolean;
}

const GENDERS = ["Woman", "Man", "Non-binary"];
const TRADITIONS = ["Muslim", "Christian", "Jewish", "Hindu", "Sikh", "Buddhist", "Jain", "Latter-day Saint"];
const DRESS_RULES = [
  "Arms covered", "Knees covered", "Legs covered to the ankle", "Loose, non-clingy fits", "Head covering",
  "No sheer fabrics", "No low necklines", "No leather or animal products", "No silk or wool",
];
const STYLES: [string, string][] = [["classic", "Classic"], ["romantic", "Romantic"], ["modern", "Minimal & modern"], ["street", "Streetwear"]];
const COLOURS: [string, string][] = [
  ["black", "#1d1d1f"], ["white", "#f7f5f0"], ["cream", "#efe6d2"], ["grey", "#a7a9ac"], ["navy", "#26324f"],
  ["camel", "#c19a6b"], ["brown", "#5a3a22"], ["olive", "#6b6b3a"], ["sage", "#9caf88"], ["forest", "#2f4a3a"],
  ["burgundy", "#6e1f2e"], ["red", "#c8352e"], ["rust", "#a4532f"], ["mustard", "#c9a227"], ["blush", "#e9b7bd"],
  ["lilac", "#c3b1e1"], ["sky", "#9cc0e0"],
];
const LOCAL = "neor.profile-local"; // offline fallback only

function toForm(p: ProfileData): Form {
  const m = (p.measurements ?? {}) as Record<string, string>;
  const s = (k: string) => (typeof p[k] === "string" || typeof p[k] === "number" ? String(p[k]) : "");
  const a = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
  return {
    name: s("name"), age: s("age"), gender: s("gender"), pronouns: s("pronouns"), tradition: s("tradition"),
    modesty: (["modest", "very modest"].includes(s("modesty")) ? s("modesty") : "") as Form["modesty"],
    dress_rules: a("dress_rules"), modesty_notes: s("modesty_notes"),
    styles: a("styles"), colors_love: a("colors_love"), colors_avoid: a("colors_avoid"),
    height_cm: m.height_cm ?? "", top_size: m.top_size ?? "", bottom_size: m.bottom_size ?? "", shoe_size: m.shoe_size ?? "", fit: m.fit ?? "",
    budget: s("budget"), climate: s("climate"), ai_consent: p.ai_consent !== false,
  };
}

function toPatch(f: Form): Partial<ProfileData> {
  return {
    name: f.name.trim(), age: f.age ? Number(f.age) : null, gender: f.gender.trim(), pronouns: f.pronouns.trim(),
    tradition: f.tradition.trim(), modesty: f.modesty || "none", dress_rules: f.dress_rules, modesty_notes: f.modesty_notes.trim(),
    styles: f.styles, colors_love: f.colors_love, colors_avoid: f.colors_avoid,
    measurements: { height_cm: f.height_cm, top_size: f.top_size, bottom_size: f.bottom_size, shoe_size: f.shoe_size, fit: f.fit },
    budget: f.budget ? Number(f.budget) : null, climate: f.climate.trim(), ai_consent: f.ai_consent,
  };
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="pf-section">
      <legend>{title}</legend>
      {note && <p className="pf-note">{note}</p>}
      {children}
    </fieldset>
  );
}

export default function Profile() {
  const nav = useNavigate();
  const { profile, setProfile, items, offline } = useCloset();
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, say] = useToast();

  // The profile arrives after first render; fill the form once it does (unless they've started typing).
  useEffect(() => {
    if (dirty) return;
    const base = offline ? { ...profile, ...JSON.parse(localStorage.getItem(LOCAL) ?? "{}") } : profile;
    const f = toForm(base);
    if (!f.name) displayName().then((n) => n && setForm((x) => ({ ...x, name: x.name || n })));
    setForm(f);
  }, [profile, offline]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const customGender = form.gender !== "" && !GENDERS.includes(form.gender) && form.gender !== "Prefer not to say";
  const customTradition = form.tradition !== "" && !TRADITIONS.includes(form.tradition) && form.tradition !== "Prefer not to say";

  async function save() {
    setSaving(true);
    try {
      if (offline) localStorage.setItem(LOCAL, JSON.stringify(toPatch(form)));
      else setProfile(await api.saveProfile(toPatch(form)));
      setDirty(false);
      say(offline ? "Saved on this device. It will sync once the server is back." : "Saved. neor will dress you with this in mind.");
    } catch {
      say("That didn't save. Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  async function forget() {
    if (!confirm("This permanently deletes your closet, photos, saved looks and orders. Continue?")) return;
    if (!offline) await api.forgetMe();
    localStorage.clear();
    await signOut();
    nav("/");
  }

  const colourRow = (key: "colors_love" | "colors_avoid", other: "colors_love" | "colors_avoid") => (
    <div className="swatch-chips">
      {COLOURS.map(([name, hex]) => {
        const on = form[key].includes(name);
        const taken = form[other].includes(name);
        return (
          <button key={name} type="button" className={`swatch-chip ${on ? "is-on" : ""}`} disabled={taken}
            aria-pressed={on} onClick={() => set(key, toggle(form[key], name))} title={taken ? `Already in the other list` : name}>
            <span className="swatch" style={{ background: hex }} /> {name}
          </button>
        );
      })}
    </div>
  );

  return (
    <PageFrame title="About you" kicker="So neor dresses you, not an average person" className="profile-page">
      <div className="pf">
        <aside className="pf-side">
          <div className="profile-photo">
            {profile.mirror_url
              ? <img src={assetUrl(profile.mirror_url)!} alt="Your mirror photo" />
              : <span>No mirror photo yet. <Link to="/mirror">Add one</Link></span>}
          </div>
          <p className="pf-stats">{items.length} pieces in your closet{profile.points ? ` · ${profile.points} points` : ""}</p>
          <div className="pf-privacy">
            <h3>How this is used</h3>
            <p>Every field is optional. neor uses these details only to choose and explain outfits for you. They're never shown to anyone else, and "Forget me" erases them.</p>
          </div>
        </aside>

        <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Section title="The basics">
            <div className="pf-grid">
              <label className="pf-field">
                <span>What should we call you?</span>
                <input className="text-input" value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="given-name" />
              </label>
              <label className="pf-field sm">
                <span>Age</span>
                <input className="text-input" type="number" min={13} max={110} inputMode="numeric" value={form.age}
                  onChange={(e) => set("age", e.target.value)} />
              </label>
              <label className="pf-field">
                <span>Gender</span>
                <select value={customGender ? "self" : form.gender} onChange={(e) => set("gender", e.target.value === "self" ? " " : e.target.value)}>
                  <option value="">Choose…</option>
                  {GENDERS.map((g) => <option key={g}>{g}</option>)}
                  <option value="self">I'll describe it</option>
                  <option>Prefer not to say</option>
                </select>
                {customGender && <input className="text-input" placeholder="In your words" value={form.gender.trimStart()}
                  onChange={(e) => set("gender", e.target.value || " ")} />}
              </label>
              <label className="pf-field sm">
                <span>Pronouns</span>
                <input className="text-input" placeholder="she/her" value={form.pronouns} onChange={(e) => set("pronouns", e.target.value)} />
              </label>
            </div>
          </Section>

          <Section title="Faith & dress guidelines" note="neor will never suggest anything that breaks these, including things to buy.">
            <div className="pf-grid">
              <label className="pf-field">
                <span>Faith or tradition</span>
                <select value={customTradition ? "other" : form.tradition} onChange={(e) => set("tradition", e.target.value === "other" ? " " : e.target.value)}>
                  <option value="">None / not relevant</option>
                  {TRADITIONS.map((t) => <option key={t}>{t}</option>)}
                  <option value="other">Other…</option>
                  <option>Prefer not to say</option>
                </select>
                {customTradition && <input className="text-input" placeholder="Your tradition" value={form.tradition.trimStart()}
                  onChange={(e) => set("tradition", e.target.value || " ")} />}
              </label>
              <div className="pf-field">
                <span>Overall</span>
                <div className="seg">
                  {([["", "No guidelines"], ["modest", "Modest"], ["very modest", "Very modest"]] as const).map(([v, label]) => (
                    <button key={v} type="button" className={form.modesty === v ? "is-on" : ""} onClick={() => set("modesty", v)}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            <p className="pf-label">Specific rules you follow</p>
            <div className="chips">
              {DRESS_RULES.map((r) => (
                <button key={r} type="button" className={`chip ${form.dress_rules.includes(r) ? "is-on" : ""}`}
                  aria-pressed={form.dress_rules.includes(r)} onClick={() => set("dress_rules", toggle(form.dress_rules, r))}>{r}</button>
              ))}
            </div>
            <label className="pf-field wide">
              <span>Anything else to respect?</span>
              <textarea className="text-input" rows={2} placeholder="e.g. covered shoulders at the mosque on Fridays; no red at funerals"
                value={form.modesty_notes} onChange={(e) => set("modesty_notes", e.target.value)} />
            </label>
          </Section>

          <Section title="Your style">
            <p className="pf-label">Styles you like</p>
            <div className="chips">
              {STYLES.map(([v, label]) => (
                <button key={v} type="button" className={`chip ${form.styles.includes(v) ? "is-on" : ""}`}
                  aria-pressed={form.styles.includes(v)} onClick={() => set("styles", toggle(form.styles, v))}>{label}</button>
              ))}
            </div>
            <p className="pf-label">Colours you love</p>
            {colourRow("colors_love", "colors_avoid")}
            <p className="pf-label">Colours you'd rather avoid</p>
            {colourRow("colors_avoid", "colors_love")}
          </Section>

          <Section title="Fit & sizes" note="Helps with shop suggestions. Leave blank if you'd rather not.">
            <div className="pf-grid four">
              <label className="pf-field"><span>Height (cm)</span>
                <input className="text-input" inputMode="numeric" value={form.height_cm} onChange={(e) => set("height_cm", e.target.value)} /></label>
              <label className="pf-field"><span>Top size</span>
                <input className="text-input" placeholder="M" value={form.top_size} onChange={(e) => set("top_size", e.target.value)} /></label>
              <label className="pf-field"><span>Bottom size</span>
                <input className="text-input" placeholder="28 / 10" value={form.bottom_size} onChange={(e) => set("bottom_size", e.target.value)} /></label>
              <label className="pf-field"><span>Shoe size</span>
                <input className="text-input" placeholder="US 8" value={form.shoe_size} onChange={(e) => set("shoe_size", e.target.value)} /></label>
            </div>
            <div className="pf-field">
              <span>How you like things to fit</span>
              <div className="seg">
                {["Fitted", "Relaxed", "Oversized"].map((v) => (
                  <button key={v} type="button" className={form.fit === v ? "is-on" : ""} onClick={() => set("fit", form.fit === v ? "" : v)}>{v}</button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Life & budget">
            <div className="pf-grid">
              <label className="pf-field"><span>Monthly clothes budget ($)</span>
                <input className="text-input" inputMode="numeric" value={form.budget} onChange={(e) => set("budget", e.target.value)} /></label>
              <label className="pf-field"><span>Where you live / your weather</span>
                <input className="text-input" placeholder="Seattle: mild, rainy" value={form.climate} onChange={(e) => set("climate", e.target.value)} /></label>
            </div>
            <label className="pf-toggle">
              <input type="checkbox" checked={form.ai_consent} onChange={(e) => set("ai_consent", e.target.checked)} />
              <span>Let neor's AI look at my clothing photos to tag them</span>
            </label>
          </Section>

          <div className={`pf-savebar ${dirty ? "is-dirty" : ""}`}>
            <span>{dirty ? "You have unsaved changes." : "All saved."}</span>
            <button className="btn" disabled={!dirty || saving}><Icon name="check" size={16} /> {saving ? "Saving…" : "Save"}</button>
          </div>

          <div className="pf-danger">
            <button type="button" className="btn ghost" onClick={async () => { await signOut(); nav("/"); }}>Sign out</button>
            <button type="button" className="btn ghost danger" onClick={forget}>Forget me</button>
          </div>
        </form>
      </div>
      {toast}
    </PageFrame>
  );
}
