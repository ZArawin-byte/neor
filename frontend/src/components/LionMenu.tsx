import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MASCOT, mascotTitle, mascotWhere } from "../lib/mascot";

/**
 * Right-click (or long-press on Android) on the lion opens this little menu instead of the
 * browser's: a lion montage on YouTube, or straight to the critique.
 */
export function useLionMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [at]);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setAt({ x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 140) });
  };

  const menu = at && (
    <div className="lion-menu" role="menu" style={{ left: at.x, top: at.y }} onClick={(e) => e.stopPropagation()}>
      <p className="lion-menu-head">{mascotTitle()}{mascotWhere()}</p>
      <a role="menuitem" href={MASCOT.montage} target="_blank" rel="noreferrer" onClick={() => setAt(null)}>
        Watch a lion montage on YouTube <span aria-hidden="true">↗</span>
      </a>
      <button role="menuitem" onClick={() => { setAt(null); nav("/critique"); }}>
        Ask for a closet critique
      </button>
    </div>
  );

  return { onContextMenu, menu };
}
