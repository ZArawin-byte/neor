import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Google sign-in goes through Supabase. The backend hands us the public URL + anon key at
 * /api/config; if it reports demo mode (no Supabase configured) the button just lets you in.
 */
let client: SupabaseClient | null = null;
let demo = true;
let ready: Promise<void> | null = null;

const DEMO_KEY = "neor.demo-session";
const API = import.meta.env.VITE_API_URL ?? "";

export function initAuth(): Promise<void> {
  ready ??= fetch(`${API}/api/config`)
    .then((r) => r.json())
    .then((cfg) => {
      demo = cfg.demo || !cfg.supabase_url;
      if (!demo) client = createClient(cfg.supabase_url, cfg.supabase_anon_key);
    })
    .catch(() => { demo = true; }); // API down -> still let people walk around the closet
  return ready;
}

export const isDemo = () => demo;

export async function getToken(): Promise<string | null> {
  await initAuth();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function isSignedIn(): Promise<boolean> {
  await initAuth();
  if (demo) return localStorage.getItem(DEMO_KEY) === "1";
  return (await getToken()) !== null;
}

export async function displayName(): Promise<string> {
  if (!client) return "";
  const { data } = await client.auth.getUser();
  const meta = data.user?.user_metadata ?? {};
  return (meta.full_name || meta.name || "").split(" ")[0];
}

/** Resolves true when signed in on the spot (demo); with real OAuth the page redirects away. */
export async function signInWithGoogle(): Promise<boolean> {
  await initAuth();
  if (demo || !client) {
    localStorage.setItem(DEMO_KEY, "1");
    return true;
  }
  // Coming back from Google lands on "/?entering=1" so the doors swing open on arrival.
  await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/?entering=1` },
  });
  return false;
}

export async function signOut() {
  localStorage.removeItem(DEMO_KEY);
  await client?.auth.signOut();
}
