"""Open-Meteo weather (no key). Retrieve first, then generate: the stylist and the prompt use these numbers."""
import datetime as dt
import re
import time

import httpx

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 8
TTL = 30 * 60

_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}

# WMO weather codes -> plain words
CODES = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers",
    82: "heavy showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
}

# What the frontend sends that is not a place: "hot weather", "wearing: ..."
NOT_A_PLACE = re.compile(r"^\s*(\w+\s+weather|wearing\s*:.*)\s*$", re.I)


def _geocode(http: httpx.Client, query: str) -> dict | None:
    parts = [p.strip() for p in query.split(",") if p.strip()]
    for q in dict.fromkeys([query.strip(), *parts[:1], *parts[-1:]]):
        res = http.get(GEO_URL, params={"name": q, "count": 1}).json().get("results") or []
        if res:
            return res[0]
    return None


def get_weather(city_or_place: str, date: str | None = None) -> dict | None:
    """{temp_c, precip_prob, wind_kmh, condition, source, fetched_at, place} or None on any failure."""
    if not city_or_place or NOT_A_PLACE.match(city_or_place):
        return None
    key = (city_or_place.strip().lower(), date or "now")
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        with httpx.Client(timeout=TIMEOUT) as http:
            geo = _geocode(http, city_or_place)
            if not geo:
                return None
            params = {"latitude": geo["latitude"], "longitude": geo["longitude"], "timezone": "auto"}
            if date:
                params |= {"daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                                    "weather_code,wind_speed_10m_max", "start_date": date, "end_date": date}
                d = http.get(FORECAST_URL, params=params).json()["daily"]
                temp = (d["temperature_2m_max"][0] + d["temperature_2m_min"][0]) / 2
                precip, wind, code = d["precipitation_probability_max"][0], d["wind_speed_10m_max"][0], d["weather_code"][0]
            else:
                params |= {"current": "temperature_2m,weather_code,wind_speed_10m",
                           "hourly": "precipitation_probability", "forecast_days": 1}
                d = http.get(FORECAST_URL, params=params).json()
                cur = d["current"]
                hour = cur["time"][:13] + ":00"
                hourly = d.get("hourly", {})
                precip = next((p for t, p in zip(hourly.get("time", []), hourly.get("precipitation_probability", []))
                               if t == hour), None)
                temp, wind, code = cur["temperature_2m"], cur["wind_speed_10m"], cur["weather_code"]
        out = {
            "temp_c": round(float(temp), 1), "precip_prob": precip, "wind_kmh": round(float(wind), 1),
            "condition": CODES.get(int(code), "unknown"), "source": "open-meteo",
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "place": ", ".join(x for x in (geo.get("name"), geo.get("admin1"), geo.get("country_code")) if x),
        }
    except Exception:
        return None
    _cache[key] = (time.time() + TTL, out)
    return out


def is_cold(w: dict | None) -> bool:
    return bool(w and w.get("temp_c") is not None and w["temp_c"] < 14)


def is_wet(w: dict | None) -> bool:
    return bool(w and ((w.get("precip_prob") or 0) >= 50 or any(
        k in w.get("condition", "") for k in ("rain", "drizzle", "shower", "snow", "thunder"))))


def is_hot(w: dict | None) -> bool:
    return bool(w and w.get("temp_c") is not None and w["temp_c"] >= 26)


def describe(w: dict | None) -> str:
    if not w:
        return ""
    rain = f", {w['precip_prob']}% chance of rain" if w.get("precip_prob") is not None else ""
    return f"{w['temp_c']}°C, {w['condition']}{rain}, wind {w['wind_kmh']} km/h at {w['place']}"
