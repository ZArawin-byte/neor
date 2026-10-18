import { call, json } from "./api";
import { initAuth } from "./auth";
import type { Board, Look, WornPiece } from "./types";

/**
 * Bookmark-table boards and archived looks.
 *
 * Reads stay synchronous: pages read localStorage, which acts as a cache. The first read syncs
 * with /api/boards and /api/looks in the background, and every write goes to localStorage first
 * and then to the API, so the closet still works offline. Ids are made here, and the server keeps
 * them, so an offline save matches its online copy. The draft table and the mirror try-on stay
 * on this device only.
 */
const BOARDS = "neor.boards";
const LOOKS = "neor.looks";
const CURRENT = "neor.table"; // the unsaved table, so a refresh doesn't wipe it
const TRYON = "neor.tryon"; // what's placed on the mirror photo

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / private mode */ }
};

// Letters and digits only: the server accepts ids matching ^[A-Za-z0-9_-]{8,64}$.
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);

/** Fire-and-forget: the local copy is already saved, so a failed request only means "not synced yet". */
const background = (p: Promise<unknown>) => { p.catch(() => undefined); };

/** Server copies win; anything only on this device (saved while offline) is kept and pushed up. */
function merge<T extends { id: string }>(key: string, server: T[], push: (item: T) => Promise<unknown>) {
  const ids = new Set(server.map((x) => x.id));
  const localOnly = read<T[]>(key, []).filter((x) => !ids.has(x.id));
  write(key, [...localOnly, ...server]);
  localOnly.forEach((x) => background(push(x)));
}

let synced: Promise<void> | null = null;
function sync() {
  synced ??= initAuth()
    .then(async () => {
      const [boards, looks] = await Promise.all([call<Board[]>("/api/boards"), call<Look[]>("/api/looks")]);
      merge(BOARDS, boards, (b) => call("/api/boards", json("POST", b)));
      merge(LOOKS, looks, (l) => call("/api/looks", json("POST", l)));
    })
    .catch(() => { synced = null; }); // offline or signed out: try again on the next read
}

export const saved = {
  boards: (): Board[] => { sync(); return read<Board[]>(BOARDS, []); },
  lastBoard: (): Board | null => saved.boards()[0] ?? null,
  saveBoard(board: Omit<Board, "id" | "savedAt"> & { id?: string }): Board {
    const all = read<Board[]>(BOARDS, []).filter((b) => b.id !== board.id);
    const next: Board = { ...board, id: board.id ?? newId(), savedAt: new Date().toISOString() };
    write(BOARDS, [next, ...all]);
    background(call("/api/boards", json("POST", next)));
    return next;
  },

  draft: (): Board["pieces"] => read<Board["pieces"]>(CURRENT, []),
  saveDraft: (pieces: Board["pieces"]) => write(CURRENT, pieces),

  tryon: (): WornPiece[] => read<WornPiece[]>(TRYON, []),
  saveTryon: (worn: WornPiece[]) => write(TRYON, worn),

  looks: (): Look[] => { sync(); return read<Look[]>(LOOKS, []); },
  saveLook(look: Omit<Look, "id" | "savedAt" | "favorite">): Look {
    const next: Look = { ...look, id: newId(), favorite: false, savedAt: new Date().toISOString() };
    write(LOOKS, [next, ...read<Look[]>(LOOKS, [])]);
    // The server only takes linked photos; an embedded (data:) photo stays on this device.
    const photo = next.photo && !next.photo.startsWith("data:") ? next.photo : null;
    background(call("/api/looks", json("POST", { ...next, photo })));
    return next;
  },
  rate(id: string, rating: number) {
    write(LOOKS, saved.looks().map((l) => (l.id === id ? { ...l, rating } : l)));
  },
  toggleFavorite(id: string) {
    const looks = read<Look[]>(LOOKS, []).map((l) => (l.id === id ? { ...l, favorite: !l.favorite } : l));
    write(LOOKS, looks);
    const look = looks.find((l) => l.id === id);
    if (look) background(call(`/api/looks/${id}`, json("PATCH", { favorite: look.favorite })));
  },
  deleteLook(id: string) {
    write(LOOKS, read<Look[]>(LOOKS, []).filter((l) => l.id !== id));
    background(call(`/api/looks/${id}`, { method: "DELETE" }));
  },
};
