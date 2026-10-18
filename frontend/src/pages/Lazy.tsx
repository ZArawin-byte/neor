import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { PageFrame, useToast } from "../components/PageFrame";
import { ApiError } from "../lib/api";
import { lazy, type LazyPlace, type Morning, type Subscription } from "../lib/lazy";
import "../styles/lazy.css";

const TIMES = ["06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"];
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error) && e.message ? e.message : fallback;
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

/** A phone, showing what the morning text will look like. */
function PhonePreview({ morning, busy, onRefresh, canRefresh }: { morning: Morning | null; busy: boolean; onRefresh: () => void; canRefresh: boolean }) {
  return (
    <div className="lz-phone-wrap">
      <div className="lz-phone" aria-label="Preview of the morning text">
        <div className="lz-phone-notch" />
        <div className="lz-phone-head">
          <span className="lz-avatar">N</span>
          <strong>Neor</strong>
          <small>Text message · {morning ? new Date(morning.day + "T12:00").toLocaleDateString(undefined, { weekday: "long" }) : "tomorrow"}, 7:00</small>
        </div>
        <div className="lz-thread">
          {busy ? <p className="lz-typing"><i /><i /><i /></p>
            : morning ? morning.text.split("\n").map((line, i) => <p key={i} className="lz-bubble">{line}</p>)
            : <p className="lz-bubble is-ghost">Pick a place and I'll show you what your morning text looks like.</p>}
        </div>
      </div>
      <button className="link-back" onClick={onRefresh} disabled={!canRefresh || busy}>
        <Icon name="spark" size={13} /> {morning ? "Preview again" : "Preview my text"}
      </button>
      {morning && (
        <ul className="lz-why">
          <li><b>Weather:</b> {morning.weather.desc}, {morning.weather.tmin}–{morning.weather.tmax}{morning.weather.unit}, {morning.weather.rain}% rain</li>
          <li><b>Today:</b> {morning.events.length ? morning.events.map((e) => `${e.time ?? "all day"} ${e.title}`).join(" · ") : "nothing on your calendar"}</li>
          <li><b>Dressing for:</b> {morning.occasion === "uni" ? "work or class" : morning.occasion}</li>
        </ul>
      )}
    </div>
  );
}

export default function Lazy() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [sms, setSms] = useState<"twilio" | "textbelt" | "email" | "log">("log");
  const byEmail = sms === "email" || sms === "log";
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [toast, say] = useToast();

  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<LazyPlace[]>([]);
  const [place, setPlace] = useState<LazyPlace | null>(null);
  const [ics, setIcs] = useState("");
  const [phone, setPhone] = useState("");
  const [sendAt, setSendAt] = useState("07:00");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [morning, setMorning] = useState<Morning | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    lazy.me().then((r) => { setSub(r.subscription); setSms(r.sms); if (r.subscription) setSendAt(r.subscription.send_at); })
      .catch(() => { /* signed-out or offline: the form still shows */ })
      .finally(() => setLoading(false));
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await lazy.geocode(q);
      setPlaces(r.places);
      if (!r.places.length) setError("No place by that name. Try a city.");
    } catch (err) { setError(errorText(err, "Place search isn't answering.")); }
  }

  function useHere() {
    if (!navigator.geolocation) return setError("This browser can't share its location. Search for a city instead.");
    navigator.geolocation.getCurrentPosition((p) => {
      const region = (navigator.language.split("-")[1] || "").toUpperCase();
      pick({ name: "Where I am now", lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, country: region });
    }, () => setError("Location was blocked. Search for a city instead."), { timeout: 10000 });
  }

  function pick(p: LazyPlace) {
    setPlace(p); setPlaces([]); setQ(p.name);
    preview(p);
  }

  async function preview(p: LazyPlace | null = place) {
    if (!p) return;
    setPreviewing(true); setError("");
    try { setMorning(await lazy.preview(p, ics.trim())); }
    catch (err) { setError(errorText(err, "Couldn't build a preview just now.")); }
    finally { setPreviewing(false); }
  }

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!place) return setError("Choose where you'll be first.");
    setBusy(true);
    try {
      const r = await lazy.subscribe({ phone: byEmail ? "" : phone, email: byEmail ? phone : "", place, ics_url: ics.trim(), send_at: sendAt, consent });
      setSub(r.subscription); setSms(r.sms); setEditing(false); setIcs(""); setPhone("");
      say(r.sms === "email" ? "You're signed up. Check your inbox for a welcome email." : r.sms === "twilio" ? "You're signed up. Check your phone for a welcome text." : r.sms === "textbelt" ? "You're signed up. Your first outfit text arrives tomorrow morning." : "You're signed up. (Texts are being logged on the server until SMS is switched on.)");
    } catch (err) { setError(errorText(err, "That didn't save. Try again?")); }
    finally { setBusy(false); }
  }

  async function sendNow() {
    setBusy(true);
    try {
      const r = await lazy.sendNow();
      setSub(r.subscription); setMorning(r);
      say(r.delivery?.status === "sent" ? "Sent. Check your phone." : r.delivery?.status === "failed" ? `Couldn't send: ${r.delivery.detail}` : "Logged on the server (SMS isn't switched on yet).");
    } catch (err) { say(errorText(err, "Couldn't send just now.")); }
    finally { setBusy(false); }
  }

  const showForm = !sub || editing;

  return (
    <PageFrame title="Lazy mode" kicker="Get dressed without opening the app" className="lazy-page">
      <p className="lz-lede">
        Give Neor your calendar and where you are. Every morning you get one text: the weather, what's on today, and what to wear from your own closet.
      </p>
      {sms === "textbelt" && (
        <p className="offline-note">Texts go out through TextBelt's free tier: one text a day, which is your morning outfit. Test sends count toward it.</p>
      )}
      {sms === "email" && (
        <p className="offline-note">Your morning outfit arrives by email. Check spam the first time and mark it “not spam”.</p>
      )}
      {sms === "log" && (
        <p className="offline-note">Email isn't switched on for this server yet, so messages are written to the server log instead. Everything else works. To send real emails, add <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> to the server's <code>.env</code>.</p>
      )}

      <div className="lz-layout">
        <section className="lz-card">
          {loading ? <p className="muted">Checking your settings…</p> : !showForm && sub ? (
            <div className="lz-status">
              <p className="kicker">{sub.active ? "Lazy mode is on" : "Lazy mode is paused"}</p>
              <h2>{sub.active ? <>Every day at <em>{clock(sub.send_at)}</em></> : "Your texts are paused"}</h2>
              <dl>
                <div><dt>{sub.email ? "Emails go to" : "Texts go to"}</dt><dd>{sub.email || sub.phone}</dd></div>
                <div><dt>Weather for</dt><dd>{sub.place_name}</dd></div>
                <div><dt>Calendar</dt><dd>{sub.has_calendar ? "Connected (kept private on the server)" : "Not connected, so weather only"}</dd></div>
                {sub.last_sent && <div><dt>Last morning text</dt><dd>{new Date(sub.last_sent + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</dd></div>}
              </dl>
              <div className="row">
                <button className="btn" onClick={sendNow} disabled={busy}><Icon name="spark" size={15} /> Send me one now</button>
                <button className="btn ghost" onClick={async () => setSub((await lazy.pause(!sub.active)).subscription)}>{sub.active ? "Pause" : "Resume"}</button>
                <button className="btn ghost" onClick={() => { setEditing(true); setSendAt(sub.send_at); }}>Change settings</button>
              </div>
              {sub.outbox.length > 0 && (
                <>
                  <h4>Recent texts</h4>
                  <ul className="lz-outbox">
                    {sub.outbox.map((m) => (
                      <li key={m.at + m.kind}>
                        <span className={`lz-badge st-${m.status}`}>{m.status}</span>
                        <span className="lz-ob-when">{m.kind === "welcome" ? "Welcome" : m.kind === "test" ? "Test" : "Morning"} · {new Date(m.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        <span className="lz-ob-text">{m.status === "failed" ? m.detail : m.text.split("\n")[1] ?? m.text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button className="link-back lz-stop" onClick={async () => { if (confirm("Stop lazy mode and delete your number, place and calendar link?")) { await lazy.stop(); setSub(null); setMorning(null); say("Stopped. Your number and calendar link are deleted."); } }}>
                <Icon name="trash" size={13} /> Stop and delete my details
              </button>
            </div>
          ) : (
            <form className="lz-form" onSubmit={subscribe}>
              {sub && <button type="button" className="link-back" onClick={() => setEditing(false)}><Icon name="back" size={13} /> Back</button>}

              <fieldset>
                <legend><span className="lz-n">1</span> Where you'll be</legend>
                <div className="lz-inline">
                  <input className="text-input" placeholder="City, e.g. Seattle" value={q} onChange={(e) => { setQ(e.target.value); setPlace(null); }}
                    onKeyDown={(e) => e.key === "Enter" && search(e as unknown as React.FormEvent)} aria-label="City" />
                  <button type="button" className="btn ghost sm" onClick={search} disabled={q.trim().length < 2}>Search</button>
                  <button type="button" className="btn ghost sm" onClick={useHere}><Icon name="pin" size={14} /> Here</button>
                </div>
                {places.length > 0 && (
                  <ul className="lz-places">{places.map((p) => <li key={`${p.lat},${p.lon}`}><button type="button" onClick={() => pick(p)}>{p.name}</button></li>)}</ul>
                )}
                {place && <p className="lz-chosen"><Icon name="check" size={14} /> {place.name} <small>· {place.timezone.replace("_", " ")}</small></p>}
              </fieldset>

              <fieldset>
                <legend><span className="lz-n">2</span> Your Google Calendar <small>(optional, but it's what makes this good)</small></legend>
                <input className="text-input" type="url" placeholder={sub?.has_calendar ? "Connected. Paste a new link to change it" : "https://calendar.google.com/calendar/ical/…/basic.ics"}
                  value={ics} onChange={(e) => setIcs(e.target.value)} aria-label="Secret iCal address" />
                <details className="lz-help">
                  <summary>Where do I find this?</summary>
                  <ol>
                    <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">Google Calendar settings ↗</a> on a computer.</li>
                    <li>Under <b>Settings for my calendars</b>, click your calendar.</li>
                    <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li>
                    <li>Paste it here.</li>
                  </ol>
                  <p>Treat that link like a password. Neor keeps it on the server, only reads today's events, and never shows it again.</p>
                </details>
              </fieldset>

              <fieldset>
                <legend><span className="lz-n">3</span> {byEmail ? "Where to email you" : "Where to text you"}</legend>
                <div className="lz-inline">
                  {byEmail ? (
                    <input className="text-input" type="email" inputMode="email" autoComplete="email" placeholder={sub?.email ? `${sub.email} (retype to keep)` : "you@example.com"}
                      value={phone} onChange={(e) => setPhone(e.target.value)} required={!sub?.email} aria-label="Email address" />
                  ) : (
                    <input className="text-input" type="tel" inputMode="tel" autoComplete="tel" placeholder={sub ? `${sub.phone} (retype to keep)` : "+1 206 555 0123"}
                      value={phone} onChange={(e) => setPhone(e.target.value)} required aria-label="Mobile number" />
                  )}
                  <select value={sendAt} onChange={(e) => setSendAt(e.target.value)} aria-label="Send at">
                    {TIMES.map((t) => <option key={t} value={t}>{clock(t)}</option>)}
                  </select>
                </div>
                <label className="lz-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  {byEmail
                    ? <span>Email me one outfit a day. Turn it off here any time.</span>
                    : <span>Text me one outfit message a day. Message and data rates may apply. Reply <b>STOP</b> to any text to stop, or turn it off here.</span>}
                </label>
              </fieldset>

              {error && <p className="error">{error}</p>}
              <button className="btn lz-go" disabled={busy || !place || !consent || (byEmail ? !phone.includes("@") && !sub?.email : phone.trim().length < 7)}>
                {busy ? "Setting it up…" : sub ? "Save changes" : byEmail ? "Start my morning emails" : "Start my morning texts"}
              </button>
              <p className="facts">Your {byEmail ? "email address" : "number"} is only used for these messages. Stop any time and it's deleted.</p>
            </form>
          )}
        </section>

        <PhonePreview morning={morning} busy={previewing} onRefresh={() => preview()} canRefresh={!!place} />
      </div>
      {toast}
    </PageFrame>
  );
}
