import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./editor.css";
import { registerPwaServiceWorker } from "./pwa";
import { App } from "./react/App";
import { testOpenUSD } from "../lib/openusd/testOpenUsd";

const root = document.getElementById("editor-root");

if (!root) {
  throw new Error("Editor root container not found.");
}

registerPwaServiceWorker();

// Smoke-test helper available from DevTools: window.testOpenUSD()
(window as unknown as { testOpenUSD: typeof testOpenUSD }).testOpenUSD = testOpenUSD;

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
