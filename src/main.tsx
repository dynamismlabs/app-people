import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, useNavigate } from "react-router";
import { AppProvider, EmbeddedView } from "@app-builder/core/react";
import { appConfig } from "../app.config";
import { AppScreens, viewCards } from "./screens";
import { navigatePeople } from "./people/view/kit/app.js";
// Browser entry for the offline shell and the assistant view (MCP Apps). Web requests use SSR.
// In an assistant the app lives in a sandboxed frame with no address of its own. People's screens
// keep their own places (as they did in Ri), so the view goes where the host asks, open_people's
// path, a host link to a record or a card's openFullscreen(path), by moving People there.
// Settings is the core's own screen, on the view's router: going there, or anywhere else from
// there (its Back to People), moves the router as well.
const embedded = document.documentElement.dataset.mode === "mcp";
function EmbeddedPeople() {
  const navigate = useNavigate();
  const go = useCallback((path: string) => {
    if (path.split(/[?#]/)[0] === "/settings") { navigate("/settings"); return; }
    navigate("/", { replace: true });
    navigatePeople(path);
  }, [navigate]);
  return <EmbeddedView cards={viewCards} navigate={go}><AppScreens /></EmbeddedView>;
}
createRoot(document.getElementById("root")!).render(<AppProvider config={appConfig}>{embedded
  ? <MemoryRouter><EmbeddedPeople /></MemoryRouter>
  : <BrowserRouter><AppScreens /></BrowserRouter>}</AppProvider>);
