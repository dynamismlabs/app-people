import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router";
import { AppProvider, EmbeddedView } from "@app-builder/core/react";
import { appConfig } from "../app.config";
import { AppScreens, viewCards } from "./screens";
import { navigatePeople } from "./people/view/kit/app.js";
// Browser entry for the offline shell and the assistant view (MCP Apps). Web requests use SSR.
// In an assistant the app lives in a sandboxed frame with no address of its own. People's screens
// keep their own places (as they did in Ri), so the view goes where the host asks, open_people's
// path, a host link to a record or a card's openFullscreen(path), by moving People there.
const embedded = document.documentElement.dataset.mode === "mcp";
createRoot(document.getElementById("root")!).render(<AppProvider config={appConfig}>{embedded
  ? <MemoryRouter><EmbeddedView cards={viewCards} navigate={navigatePeople}><AppScreens /></EmbeddedView></MemoryRouter>
  : <BrowserRouter><AppScreens /></BrowserRouter>}</AppProvider>);
