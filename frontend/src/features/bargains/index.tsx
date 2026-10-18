import { Link } from "react-router-dom";
import type { Feature } from "..";
import MarketPage from "./MarketPage";
import "./bargains.css";

/** A kraft-paper notice pinned to the hallway wall. */
function HallwayNotice() {
  return (
    <Link to="/bargains" className="bargain-notice">
      <span className="notice-pin" aria-hidden="true" />
      <span className="notice-kicker">Pinned in the hall</span>
      <strong>Bargains nearby</strong>
      <span>Compare prices, find shops, see what people paid.</span>
      <span className="notice-cta">Have a look →</span>
    </Link>
  );
}

export const bargains: Feature = {
  id: "bargains",
  enabled: import.meta.env.VITE_FEATURE_BARGAINS !== "off",
  routes: [{ path: "/bargains", element: <MarketPage /> }],
  HallwayNotice,
};
