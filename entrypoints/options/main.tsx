import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/ui/style.css";
import { initSentry } from "../../src/sentry";
import { ErrorBoundary } from "../../src/ui/ErrorBoundary";
import { App } from "./App";

initSentry("options");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
