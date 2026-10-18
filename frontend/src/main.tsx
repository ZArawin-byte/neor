import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { FEATURES } from "./features";
import { isSignedIn } from "./lib/auth";
import { ClosetProvider } from "./lib/closet";
import Archive from "./pages/Archive";
import Closet from "./pages/Closet";
import Critique from "./pages/Critique";
import Landing from "./pages/Landing";
import Mirror from "./pages/Mirror";
import Profile from "./pages/Profile";
import Room from "./pages/Room";
import Window from "./pages/Window";
import "./styles/app.css";

/** Everything past the doors needs a session; without one you're sent back to the hallway. */
function Inside({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { isSignedIn().then(setOk); }, []);
  if (ok === null) return null;
  return ok ? <ClosetProvider>{children}</ClosetProvider> : <Navigate to="/" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/room" element={<Inside><Room /></Inside>} />
        <Route path="/closet" element={<Inside><Closet /></Inside>} />
        <Route path="/mirror" element={<Inside><Mirror /></Inside>} />
        <Route path="/window" element={<Inside><Window /></Inside>} />
        <Route path="/critique" element={<Inside><Critique /></Inside>} />
        <Route path="/archive" element={<Inside><Archive /></Inside>} />
        <Route path="/profile" element={<Inside><Profile /></Inside>} />
        {FEATURES.flatMap((f) => f.routes).map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
