import { Link } from "react-router-dom";
import type { Feature } from "..";
import CareLabelPage from "./CareLabelPage";
import "./care-label.css";

/** A woven label stitched onto the hallway wall. */
function HallwayNotice() {
  return (
    <Link to="/care-label" className="label-notice">
      <span className="label-notice-kicker">New in the hall</span>
      <strong>Read a care label</strong>
      <span>Photograph the tag inside a piece. neor reads the fibres and tells you how to wash it.</span>
      <span className="label-notice-cta">Try it →</span>
    </Link>
  );
}

export const careLabel: Feature = {
  id: "care-label",
  enabled: import.meta.env.VITE_FEATURE_CARE_LABEL !== "off",
  routes: [{ path: "/care-label", element: <CareLabelPage /> }],
  HallwayNotice,
};
