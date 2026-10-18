import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useCloset } from "../lib/closet";
import { Icon, type IconName } from "./Icon";

/** Every room off the walk-in, in the order they sit in the room. */
const ROOMS: { to: string; label: string; icon: IconName }[] = [
  { to: "/closet", label: "Closet", icon: "hanger" },
  { to: "/mirror", label: "Mirror", icon: "mirror" },
  { to: "/window", label: "Window", icon: "window" },
  { to: "/critique", label: "Lion", icon: "paw" },
  { to: "/archive", label: "Archive", icon: "book" },
  { to: "/lazy", label: "Lazy", icon: "phone" },
  { to: "/profile", label: "Profile", icon: "person" },
];

/**
 * Shared chrome for every room: a brass "back to the room" plate, the title, page actions,
 * and a tab rail so you can hop between rooms (closet <-> mirror especially) without
 * walking back through the room. On phones the rail becomes a bottom bar.
 */
export function PageFrame({ title, kicker, actions, children, className = "" }: {
  title: string;
  kicker?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { offline } = useCloset();
  return (
    <div className={`page ${className}`}>
      <header className="page-head">
        <Link to="/room" className="plaque" aria-label="Back to the walk-in">
          <Icon name="back" size={15} />
          <span>The room</span>
        </Link>
        <nav className="rooms" aria-label="Rooms">
          {ROOMS.map((r) => (
            <NavLink key={r.to} to={r.to} className={({ isActive }) => `room-tab ${isActive ? "is-here" : ""}`}>
              <Icon name={r.icon} size={17} />
              <span>{r.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="page-intro">
        <div>
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {offline && (
        <p className="offline-note">
          We can't reach the Neor server, so this is a sample closet. Nothing you change will be saved.
        </p>
      )}
      {children}
    </div>
  );
}

/** One-line confirmation that fades out by itself. */
export function useToast(): [ReactNode, (msg: ReactNode) => void] {
  const [msg, setMsg] = useState<ReactNode>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3800);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}
