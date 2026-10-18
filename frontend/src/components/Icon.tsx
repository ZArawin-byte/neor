const PATHS = {
  back: "M15 5 L8 12 L15 19",
  next: "M9 5 L16 12 L9 19",
  plus: "M12 5 V19 M5 12 H19",
  x: "M6 6 L18 18 M18 6 L6 18",
  check: "M5 12.5 L10 17 L19 7",
  star: "M12 3.5 L14.6 9 L20.5 9.6 L16 13.6 L17.3 19.5 L12 16.5 L6.7 19.5 L8 13.6 L3.5 9.6 L9.4 9 Z",
  basket: "M4 10 H20 L18 20 H6 Z M8 10 L11 4 M16 10 L13 4 M9 13 V17 M12 13 V17 M15 13 V17",
  pin: "M12 21 C12 21 5 14 5 9.5 A7 7 0 0 1 19 9.5 C19 14 12 21 12 21 Z M12 7 A2.5 2.5 0 1 0 12 12 A2.5 2.5 0 1 0 12 7",
  upload: "M12 16 V4 M7 9 L12 4 L17 9 M5 20 H19",
  door: "M6 21 V3 H18 V21 M3 21 H21 M14.5 12 H15.5",
  spark: "M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z",
  trash: "M5 7 H19 M10 7 V4 H14 V7 M7 7 L8 20 H16 L17 7",
  hanger: "M12 7 A2 2 0 1 1 14 5 M12 7 V9 L3 16 A1 1 0 0 0 3.6 18 H20.4 A1 1 0 0 0 21 16 L12 9",
  mirror: "M7 21 L8 19 M17 21 L16 19 M12 2.5 C8.5 2.5 6.5 5 6.5 9 V19 H17.5 V9 C17.5 5 15.5 2.5 12 2.5 Z M9.5 8 L11.5 6",
  window: "M12 3 L21 12 L12 21 L3 12 Z M12 3 V21 M3 12 H21",
  paw: "M12 13 C9 13 7 16 8 18 C9 20 15 20 16 18 C17 16 15 13 12 13 Z M4.5 11 a1.5 2 0 1 0 3 0 a1.5 2 0 1 0 -3 0 M8 7.5 a1.5 2 0 1 0 3 0 a1.5 2 0 1 0 -3 0 M13 7.5 a1.5 2 0 1 0 3 0 a1.5 2 0 1 0 -3 0 M16.5 11 a1.5 2 0 1 0 3 0 a1.5 2 0 1 0 -3 0",
  book: "M4 5 C7 4 10 4.5 12 6 C14 4.5 17 4 20 5 V19 C17 18 14 18.5 12 20 C10 18.5 7 18 4 19 Z M12 6 V20",
  person: "M12 12 A4 4 0 1 0 12 4 A4 4 0 1 0 12 12 Z M4.5 20.5 C5.5 16.5 8.5 14.5 12 14.5 C15.5 14.5 18.5 16.5 19.5 20.5",
  phone: "M8 2.5 H16 A1.5 1.5 0 0 1 17.5 4 V20 A1.5 1.5 0 0 1 16 21.5 H8 A1.5 1.5 0 0 1 6.5 20 V4 A1.5 1.5 0 0 1 8 2.5 Z M10.5 18.5 H13.5",
  tag: "M3.5 12.5 L11 5 H19 V13 L11.5 20.5 Z M14.8 8.5 a0.8 0.8 0 1 0 1.6 0 a0.8 0.8 0 1 0 -1.6 0",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="icon"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
