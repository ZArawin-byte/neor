import { Link } from "react-router-dom";
import type { Feature } from "..";
import BagPage from "./BagPage";
import "./bag.css";

export { addToBag } from "./api";

/** A paper shop tag on a string, pinned in the hallway beside the sign-in card. */
function HallwayNotice() {
  return (
    <Link to="/bag" className="bag-notice">
      <span className="tag-hole" aria-hidden="true" />
      <span className="notice-kicker">Your bag</span>
      <strong>Ready when you are</strong>
      <span>Pieces neor thinks are worth it, each with its reason. Visa checkout.</span>
      <span className="notice-cta">Open the bag →</span>
    </Link>
  );
}

export const bag: Feature = {
  id: "bag",
  enabled: import.meta.env.VITE_FEATURE_BAG !== "off",
  routes: [{ path: "/bag", element: <BagPage /> }],
  HallwayNotice,
};
