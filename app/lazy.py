"""Lazy mode: one text every morning saying what to wear, from the weather where you are and
what's on your calendar.

  * Weather: Open-Meteo (free, no key).
  * Calendar: the user's secret iCal link (Google Calendar -> Settings -> "Secret address in
    iCal format"). It's a secret, so it stays on the server and is never sent back to the browser.
  * Outfit: Neor's own picker (ai.outfit), from the user's closet minus the laundry basket.
  * SMS: Twilio when TWILIO_* is set; otherwise the text is written to the server log and
    the user's outbox, so the whole flow can be tested without an SMS account.
"""
import asyncio
import datetime as dt
import logging
import re
import smtplib
import ssl
import time
from email.message import EmailMessage
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import icalendar
import recurring_ical_events
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import ai, config, store
from .net import fetch_public

log = logging.getLogger("neor.lazy")

WEATHER = {0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy",
           51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
           61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
           71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow", 80: "showers", 81: "showers",
           82: "heavy showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms"}

# Calendar words -> Neor's occasions. First match wins; the day's outfit follows the most formal event.
OCCASIONS = [
    ("wedding", r"wedding|ceremony|reception|gala|black tie"),
    ("uni", r"interview|meeting|standup|stand-up|presentation|class|lecture|seminar|lab|exam|office hours|study|work"),
    ("birthday", r"birthday|party|dinner|drinks|date|concert|show|celebrat|brunch|bar\b"),
    ("gym", r"gym|workout|yoga|pilates|run\b|running|climb|swim|training|soccer|tennis|basketball|hike"),
]
PRIORITY = ["wedding", "uni", "birthday", "everyday", "gym"]
_last_send: dict[str, float] = {}


def occasion_for(title: str) -> str:
    for occasion, pattern in OCCASIONS:
        if re.search(pattern, title, re.I):
            return occasion
    return "everyday"


def season_for(tmax_c: float, month: int, south: bool) -> str:
    if tmax_c <= 8:
        return "winter"
    if tmax_c >= 22:
        return "summer"
    autumn = month in (9, 10, 11) if not south else month in (3, 4, 5)
    return "fall" if autumn else "spring"


def normalize_phone(raw: str) -> str:
    """Accepts (206) 555-0123, 206.555.0123, +44 7700 900123... and returns E.164 (+12065550123)."""
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not digits.startswith("+"):
        digits = "+1" + digits if len(digits) == 10 else "+" + digits
    if not re.fullmatch(r"\+[1-9]\d{7,14}", digits):
        raise ValueError("Enter a mobile number with its country code, e.g. +1 206 555 0123.")
    return digits


def masked(phone: str) -> str:
    return phone[:-4].replace(phone[2:-4], "•" * len(phone[2:-4])) + phone[-4:] if len(phone) > 6 else phone


def clean_ics_url(url: str) -> str:
    url = url.strip()
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    if not url.startswith("https://"):
        raise ValueError("Paste the calendar's https:// (or webcal://) address.")
    return url


# ---------------------------------------------------------------- outside world

async def geocode(query: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as http:
        res = await http.get("https://geocoding-api.open-meteo.com/v1/search",
                             params={"name": query, "count": 6, "language": "en", "format": "json"})
    if res.status_code >= 400:
        raise HTTPException(502, "Place search isn't answering. Try again in a moment.")
    out = []
    for r in res.json().get("results", []) or []:
        bits = [r.get("name"), r.get("admin1"), r.get("country")]
        out.append({"name": ", ".join(b for b in bits if b), "lat": r["latitude"], "lon": r["longitude"],
                    "timezone": r.get("timezone") or "UTC", "country": (r.get("country_code") or "").upper()})
    return out


async def forecast(lat: float, lon: float, day: dt.date, fahrenheit: bool) -> dict:
    params = {
        "latitude": lat, "longitude": lon, "timezone": "auto",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
        "temperature_unit": "fahrenheit" if fahrenheit else "celsius",
        "start_date": day.isoformat(), "end_date": day.isoformat(),
    }
    res = None
    async with httpx.AsyncClient(timeout=15) as http:
        for _ in range(2):  # one retry: the free API occasionally drops a request
            try:
                res = await http.get("https://api.open-meteo.com/v1/forecast", params=params)
                if res.status_code < 400:
                    break
                log.warning("Open-Meteo answered %s", res.status_code)
            except httpx.HTTPError as e:
                log.warning("Open-Meteo request failed: %s", e.__class__.__name__)
                res = None
            await asyncio.sleep(0.8)
    if res is None or res.status_code >= 400:
        raise HTTPException(502, "The weather service isn't answering. Try again in a moment.")
    d = res.json()["daily"]
    tmax, tmin = d["temperature_2m_max"][0], d["temperature_2m_min"][0]
    return {"desc": WEATHER.get(d["weather_code"][0], "mixed weather"), "tmax": round(tmax), "tmin": round(tmin),
            "rain": d["precipitation_probability_max"][0] or 0, "wind": d["wind_speed_10m_max"][0] or 0,
            "unit": "°F" if fahrenheit else "°C", "tmax_c": (tmax - 32) * 5 / 9 if fahrenheit else tmax}


async def calendar_events(url: str, tz: ZoneInfo, day: dt.date) -> list[dict]:
    """The day's events from a secret iCal link, recurring ones included, in local time."""
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, headers={"User-Agent": "Neor/0.1 (lazy mode)"}) as http:
        try:
            res = await fetch_public(http, url)
        except httpx.HTTPError:
            raise HTTPException(502, "Couldn't open that calendar link.") from None
    if res.status_code >= 400:
        raise HTTPException(400, "That calendar link didn't work. Copy the *secret* iCal address again.")
    if len(res.content) > 5_000_000:
        raise HTTPException(413, "That calendar is too large to read.")
    try:
        cal = icalendar.Calendar.from_ical(res.content)
    except ValueError:
        raise HTTPException(400, "That link isn't an iCal calendar. In Google Calendar, use “Secret address in iCal format”.") from None
    start = dt.datetime.combine(day, dt.time.min, tz)
    events = []
    for ev in recurring_ical_events.of(cal).between(start, start + dt.timedelta(days=1)):
        begin = ev.get("DTSTART").dt
        all_day = not isinstance(begin, dt.datetime)
        when = None if all_day else (begin if begin.tzinfo else begin.replace(tzinfo=tz)).astimezone(tz)
        events.append({"title": str(ev.get("SUMMARY", "Busy"))[:80], "where": str(ev.get("LOCATION", ""))[:80],
                       "time": when, "all_day": all_day})
    events.sort(key=lambda e: (not e["all_day"], e["time"] or start))
    return events[:8]


def sms_mode() -> str:
    """How the morning message travels: text (Twilio/TextBelt), email, or just the server log."""
    if config.USE_TWILIO:
        return "twilio"
    if config.TEXTBELT_KEY:
        return "textbelt"
    return "email" if config.USE_EMAIL else "log"


def by_email() -> bool:
    return sms_mode() in ("email", "log") and not config.USE_TWILIO


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")


def masked_email(addr: str) -> str:
    name, _, domain = addr.partition("@")
    return (name[:2] + "•" * max(1, len(name) - 2)) + "@" + domain


def _smtp_send(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = f"Neor <{config.SMTP_USER}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body + "\n\n-- \nNeor lazy mode. To stop, open Neor -> Lazy mode -> Stop.")
    html_lines = "".join(f"<p style='margin:0 0 10px'>{line}</p>" for line in body.replace("&", "&amp;").replace("<", "&lt;").split("\n"))
    msg.add_alternative(
        "<div style='font-family:Georgia,serif;font-size:16px;color:#1d1611;background:#f5eee2;padding:24px;border-radius:10px;max-width:520px'>"
        f"<p style='margin:0 0 14px;font-size:13px;letter-spacing:.12em;color:#8b6240'>NEOR · LAZY MODE</p>{html_lines}"
        "<p style='margin:18px 0 0;font-size:12px;color:#74675b'>To stop these, open Neor → Lazy mode → Stop.</p></div>",
        subtype="html")
    with smtp_session() as s:
        s.send_message(msg)


def smtp_session():
    """Gmail uses implicit TLS on 465; Outlook and most others use STARTTLS on 587."""
    ctx = ssl.create_default_context()
    if config.SMTP_PORT == 465:
        s = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=ctx, timeout=20)
    else:
        s = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20)
        s.starttls(context=ctx)
    s.login(config.SMTP_USER, config.SMTP_PASSWORD)
    return s


async def send_email(to: str, subject: str, body: str) -> dict:
    if not config.USE_EMAIL:
        log.warning("Lazy mode email (SMTP not configured) to %s:\n%s", masked_email(to), body)
        return {"status": "logged", "detail": "Email isn't set up on this server, so the message was logged instead of sent."}
    try:
        await asyncio.to_thread(_smtp_send, to, subject, body)
        return {"status": "sent"}
    except smtplib.SMTPAuthenticationError:
        return {"status": "failed", "detail": "Gmail rejected the login. Check SMTP_USER and use an app password, not your normal password."}
    except (smtplib.SMTPException, OSError) as e:
        return {"status": "failed", "detail": f"Couldn't send the email ({e.__class__.__name__})."}


async def notify(sub: dict, body: str, subject: str) -> dict:
    """Send through whatever this subscription uses."""
    if sub.get("email") and by_email():
        return await send_email(sub["email"], subject, body)
    return await send_sms(sub["phone"], body)


async def send_textbelt(to: str, body: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as http:
        try:
            res = await http.post("https://textbelt.com/text", data={"phone": to, "message": body, "key": config.TEXTBELT_KEY})
            data = res.json()
        except (httpx.HTTPError, ValueError):
            return {"status": "failed", "detail": "Couldn't reach TextBelt."}
    if data.get("success"):
        return {"status": "sent", "sid": str(data.get("textId", "")), "detail": f"{data.get('quotaRemaining', '?')} free texts left today"}
    return {"status": "failed", "detail": str(data.get("error", "TextBelt rejected the message."))[:240]}


async def send_sms(to: str, body: str) -> dict:
    if not config.USE_TWILIO and config.TEXTBELT_KEY:
        return await send_textbelt(to, body)
    if not config.USE_TWILIO:
        log.warning("Lazy mode SMS (Twilio not configured) to %s:\n%s", masked(to), body)
        return {"status": "logged", "detail": "Twilio isn't set up on this server, so the text was logged instead of sent."}
    sender = {"MessagingServiceSid": config.TWILIO_FROM} if config.TWILIO_FROM.startswith("MG") else {"From": config.TWILIO_FROM}
    async with httpx.AsyncClient(timeout=20, auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)) as http:
        try:
            res = await http.post(f"https://api.twilio.com/2010-04-01/Accounts/{config.TWILIO_ACCOUNT_SID}/Messages.json",
                                  data={"To": to, "Body": body, **sender})
        except httpx.HTTPError:
            return {"status": "failed", "detail": "Couldn't reach Twilio."}
    data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code >= 400:
        # Twilio's message is safe to show (no credentials in it); trial accounts can only text verified numbers.
        return {"status": "failed", "detail": str(data.get("message", "Twilio rejected the message."))[:240]}
    return {"status": "sent", "sid": data.get("sid", "")}


# ---------------------------------------------------------------- the morning text

def _clock(t: dt.datetime, us: bool) -> str:
    if not us:
        return t.strftime("%H:%M")
    h = t.hour % 12 or 12
    return f"{h}{'' if t.minute == 0 else f':{t.minute:02d}'}{'am' if t.hour < 12 else 'pm'}"


async def compose(uid: str, sub: dict, day: dt.date | None = None) -> dict:
    tz = ZoneInfo(sub["timezone"])
    day = day or dt.datetime.now(tz).date()
    us = sub.get("country") == "US"
    # Calendar first: a bad link should fail with its own error, before we spend a weather call.
    events = await calendar_events(sub["ics_url"], tz, day) if sub.get("ics_url") else []
    weather = await forecast(sub["lat"], sub["lon"], day, us)

    found = [occasion_for(e["title"]) for e in events] or ["everyday"]
    occasion = min(found, key=PRIORITY.index)
    season = season_for(weather["tmax_c"], day.month, sub["lat"] < 0)
    profile = store.get_profile(uid)
    closet = [i for i in store.list_items(uid) if not i.get("laundry")]
    plan = ai.outfit(profile, closet, occasion,
                     f"{sub.get('place_name', '')}; {weather['desc']}, {weather['tmin']}-{weather['tmax']}{weather['unit']}, {weather['rain']}% rain",
                     season)
    by_id = {i["id"]: i for i in closet}
    wear = [by_id[i]["name"] for i in plan.get("closet_ids", []) if i in by_id]

    lines = [f"Neor · {day.strftime('%a %b')} {day.day}: {weather['desc']}, {weather['tmin']}–{weather['tmax']}{weather['unit']}."]
    if events:
        bits = [("All day " if e["all_day"] else _clock(e["time"], us) + " ") + e["title"] for e in events[:3]]
        lines.append("Today: " + "; ".join(bits) + ("…" if len(events) > 3 else "") + ".")
    lines.append(("Wear: " + ", ".join(wear) + ".") if wear else "Your closet is empty: add a few pieces in Neor and I'll start picking.")
    if weather["rain"] >= 50:
        lines.append(f"{weather['rain']}% chance of rain, so take a jacket that can handle it.")
    elif weather["tmax_c"] <= 5:
        lines.append("It's cold: layer up.")
    if occasion != "gym" and "gym" in found:
        lines.append("Pack gym clothes too.")
    if not (sub.get("email") and by_email()):
        lines.append("Reply STOP to stop.")
    return {"text": "\n".join(lines), "day": day.isoformat(), "weather": weather | {"tmax_c": None},
            "events": [{"title": e["title"], "time": None if e["all_day"] else _clock(e["time"], us), "occasion": occasion_for(e["title"])} for e in events],
            "occasion": occasion, "outfit": wear, "why": plan.get("why", "")}


async def deliver(uid: str, sub: dict, kind: str = "daily") -> dict:
    msg = await compose(uid, sub)
    day = dt.date.fromisoformat(msg["day"])
    result = await notify(sub, msg["text"], f"What to wear today, {day.strftime('%a %b')} {day.day}")
    store.lazy_log(uid, {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "kind": kind,
                         "status": result["status"], "detail": result.get("detail", ""), "text": msg["text"]})
    return {**msg, "delivery": result}


async def scheduler():
    """Checks once a minute; sends each subscriber's text once per day at (or soon after) their time."""
    while True:
        await asyncio.sleep(60)
        for uid, sub in store.lazy_all():
            try:
                if not sub.get("active"):
                    continue
                now = dt.datetime.now(ZoneInfo(sub["timezone"]))
                hh, mm = map(int, sub["send_at"].split(":"))
                target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
                if sub.get("last_sent") == now.date().isoformat() or not (target <= now < target + dt.timedelta(hours=2)):
                    continue
                sub["last_sent"] = now.date().isoformat()  # mark first, so a slow send can't double-text
                store.lazy_save(uid, sub)
                await deliver(uid, store.lazy_get(uid) or sub)
            except Exception:  # one bad calendar mustn't stop everyone else's mornings
                log.exception("Lazy mode send failed for one subscriber")


def start(app):
    @app.on_event("startup")
    async def _start():
        asyncio.get_running_loop().create_task(scheduler())


# ---------------------------------------------------------------- API

class Place(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    timezone: str = Field(min_length=1, max_length=64)
    country: str = Field(default="", max_length=2)

    @field_validator("timezone")
    @classmethod
    def real_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown time zone.") from None
        return value


class Setup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone: str = Field(default="", max_length=24)
    email: str = Field(default="", max_length=254)
    place: Place
    ics_url: str = Field(default="", max_length=1000)  # "" keeps the saved one
    send_at: str = Field(default="07:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    consent: bool


class Preview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    place: Place
    ics_url: str = Field(default="", max_length=1000)


class Query(BaseModel):
    query: str = Field(min_length=2, max_length=120)


def public_sub(sub: dict | None) -> dict | None:
    """What the browser may see: never the phone in full, never the calendar link."""
    if not sub:
        return None
    return {"phone": masked(sub["phone"]) if sub.get("phone") else "", "email": masked_email(sub["email"]) if sub.get("email") else "",
            "place_name": sub.get("place_name"), "send_at": sub.get("send_at"),
            "timezone": sub.get("timezone"), "active": sub.get("active", False), "has_calendar": bool(sub.get("ics_url")),
            "last_sent": sub.get("last_sent"), "outbox": sub.get("outbox", [])[:5]}


def router(current_user):
    routes = APIRouter(prefix="/api/lazy", tags=["lazy mode"], dependencies=[Depends(current_user)])

    @routes.get("/me")
    def me(uid: str = Depends(current_user)):
        return {"subscription": public_sub(store.lazy_get(uid)), "sms": sms_mode()}

    @routes.post("/geocode")
    async def find_place(req: Query):
        return {"places": await geocode(req.query)}

    @routes.post("/preview")
    async def preview(req: Preview, uid: str = Depends(current_user)):
        saved = store.lazy_get(uid) or {}
        try:
            ics = clean_ics_url(req.ics_url) if req.ics_url else saved.get("ics_url", "")
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        sub = {"lat": req.place.lat, "lon": req.place.lon, "timezone": req.place.timezone, "country": req.place.country,
               "place_name": req.place.name, "ics_url": ics}
        return await compose(uid, sub)

    @routes.post("/subscribe")
    async def subscribe(req: Setup, uid: str = Depends(current_user)):
        if not req.consent:
            raise HTTPException(400, "Tick the box to agree to receive the texts.")
        saved = store.lazy_get(uid) or {}
        try:
            phone, email = "", ""
            if by_email():
                email = req.email.strip().lower() or saved.get("email", "")
                if not EMAIL_RE.match(email):
                    raise ValueError("Enter the email address to send your outfits to.")
            else:
                phone = normalize_phone(req.phone or saved.get("phone", ""))
            ics = clean_ics_url(req.ics_url) if req.ics_url else saved.get("ics_url", "")
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        if ics and ics != saved.get("ics_url"):
            await calendar_events(ics, ZoneInfo(req.place.timezone), dt.date.today())  # proves the link works before saving
        sub = {**saved, "phone": phone, "email": email, "lat": req.place.lat, "lon": req.place.lon, "place_name": req.place.name,
               "timezone": req.place.timezone, "country": req.place.country.upper(), "ics_url": ics, "send_at": req.send_at,
               "active": True, "consented_at": saved.get("consented_at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
        store.lazy_save(uid, sub)
        # Confirm a new number once, with opt-out instructions. On TextBelt's free tier (one text
        # a day) the welcome is only logged, so the day's single text is the outfit.
        if (email and saved.get("email") != email) or (phone and saved.get("phone") != phone):
            hh, mm = map(int, req.send_at.split(":"))
            nice = _clock(dt.datetime(2000, 1, 1, hh, mm), sub["country"] == "US")
            if email:
                body = f"You're signed up for Neor lazy mode: an outfit email every morning at {nice}, from your weather and calendar."
                result = await send_email(email, "You're signed up for Neor lazy mode", body)
            else:
                body = f"You're signed up for Neor lazy mode: an outfit text every morning at {nice}, from your weather and calendar. Reply STOP to stop."
                result = await send_sms(phone, body) if config.TEXTBELT_KEY != "textbelt" or config.USE_TWILIO else \
                    {"status": "logged", "detail": "Not texted: the free tier allows one text a day, saved for your outfit."}
            store.lazy_log(uid, {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "kind": "welcome",
                                 "status": result["status"], "detail": result.get("detail", ""), "text": body})
        return {"subscription": public_sub(store.lazy_get(uid)), "sms": sms_mode()}

    @routes.post("/send-now")
    async def send_now(uid: str = Depends(current_user)):
        sub = store.lazy_get(uid)
        if not sub:
            raise HTTPException(404, "Set up lazy mode first.")
        if time.monotonic() - _last_send.get(uid, 0) < 60:
            raise HTTPException(429, "One test text a minute, please.")
        _last_send[uid] = time.monotonic()
        result = await deliver(uid, sub, kind="test")
        return {**result, "subscription": public_sub(store.lazy_get(uid))}

    @routes.post("/pause")
    def pause(body: dict, uid: str = Depends(current_user)):
        sub = store.lazy_get(uid)
        if not sub:
            raise HTTPException(404, "Set up lazy mode first.")
        sub["active"] = bool(body.get("active"))
        store.lazy_save(uid, sub)
        return {"subscription": public_sub(sub)}

    @routes.delete("/me")
    def stop(uid: str = Depends(current_user)):
        store.lazy_delete(uid)
        return {"ok": True}

    return routes
