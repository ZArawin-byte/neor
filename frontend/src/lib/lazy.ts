import { call } from "./api";

/** Client for app/lazy.py: morning outfit texts from your calendar and the weather. */

export interface LazyPlace { name: string; lat: number; lon: number; timezone: string; country: string }

export interface OutboxEntry { at: string; kind: "welcome" | "daily" | "test"; status: "sent" | "logged" | "failed"; detail: string; text: string }

export interface Subscription {
  phone: string; // masked, e.g. +1••••••0123 ("" when sent by email)
  email: string; // masked, e.g. an•••@gmail.com
  place_name: string;
  send_at: string; // "07:00"
  timezone: string;
  active: boolean;
  has_calendar: boolean;
  last_sent: string | null;
  outbox: OutboxEntry[];
}

export interface Morning {
  text: string;
  day: string;
  weather: { desc: string; tmax: number; tmin: number; rain: number; unit: string };
  events: { title: string; time: string | null; occasion: string }[];
  occasion: string;
  outfit: string[];
  why: string;
  delivery?: { status: "sent" | "logged" | "failed"; detail?: string };
}

const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const lazy = {
  me: () => call<{ subscription: Subscription | null; sms: "twilio" | "textbelt" | "email" | "log" }>("/api/lazy/me"),
  geocode: (query: string) => post<{ places: LazyPlace[] }>("/api/lazy/geocode", { query }),
  preview: (place: LazyPlace, ics_url: string) => post<Morning>("/api/lazy/preview", { place, ics_url }),
  subscribe: (body: { phone: string; email: string; place: LazyPlace; ics_url: string; send_at: string; consent: boolean }) =>
    post<{ subscription: Subscription; sms: "twilio" | "textbelt" | "email" | "log" }>("/api/lazy/subscribe", body),
  sendNow: () => post<Morning & { subscription: Subscription }>("/api/lazy/send-now"),
  pause: (active: boolean) => post<{ subscription: Subscription }>("/api/lazy/pause", { active }),
  stop: () => call<{ ok: true }>("/api/lazy/me", { method: "DELETE" }),
};
