import type { Board, Look, WornPiece } from "./types";

/**
 * Bookmark-table boards and archived looks.
 *
 * TODO(backend): there are no /api/boards or /api/looks routes yet, so these live in
 * localStorage. The function signatures match what the routes should return; swapping
 * to fetch() calls here is the only change the pages need. See FRONTEND_SPEC.md §7.
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

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 16);

export const saved = {
  boards: (): Board[] => read<Board[]>(BOARDS, []),
  lastBoard: (): Board | null => read<Board[]>(BOARDS, [])[0] ?? null,
  saveBoard(board: Omit<Board, "id" | "savedAt"> & { id?: string }): Board {
    const all = saved.boards().filter((b) => b.id !== board.id);
    const next: Board = { ...board, id: board.id ?? newId(), savedAt: new Date().toISOString() };
    write(BOARDS, [next, ...all]);
    return next;
  },

  draft: (): Board["pieces"] => read<Board["pieces"]>(CURRENT, []),
  saveDraft: (pieces: Board["pieces"]) => write(CURRENT, pieces),

  tryon: (): WornPiece[] => read<WornPiece[]>(TRYON, []),
  saveTryon: (worn: WornPiece[]) => write(TRYON, worn),

  looks: (): Look[] => read<Look[]>(LOOKS, []),
  saveLook(look: Omit<Look, "id" | "savedAt" | "favorite">): Look {
    const next: Look = { ...look, id: newId(), favorite: false, savedAt: new Date().toISOString() };
    write(LOOKS, [next, ...saved.looks()]);
    return next;
  },
  rate(id: string, rating: number) {
    write(LOOKS, saved.looks().map((l) => (l.id === id ? { ...l, rating } : l)));
  },
  toggleFavorite(id: string) {
    write(LOOKS, saved.looks().map((l) => (l.id === id ? { ...l, favorite: !l.favorite } : l)));
  },
  deleteLook(id: string) {
    write(LOOKS, saved.looks().filter((l) => l.id !== id));
  },
};
