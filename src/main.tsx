import "@fontsource-variable/quicksand/index.css";
import "./index.css";

import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { SessionRoundDraftsProvider } from "./components/GameEditor/SessionRoundDrafts";
import { LogoThemeProvider } from "./components/Logo/LogoThemeProvider";
import { useKeyboardFreeze } from "./components/PageShell/useKeyboardFreeze";
import { QueryProvider } from "./components/QueryProvider/QueryProvider";
import { router } from "./routes/-router";

const rootElement = document.getElementById("root");
function App() {
  useKeyboardFreeze();
  return (
    <QueryProvider>
      <LogoThemeProvider>
        <SessionRoundDraftsProvider>
          <RouterProvider router={router} />
        </SessionRoundDraftsProvider>
      </LogoThemeProvider>
    </QueryProvider>
  );
}

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
