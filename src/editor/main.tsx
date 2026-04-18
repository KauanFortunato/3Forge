import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./editor.css";
import { registerPwaServiceWorker } from "./pwa";
import { App } from "./react/App";

const root = document.getElementById("editor-root");

if (!root) {
  throw new Error("Editor root container not found.");
}

registerPwaServiceWorker();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
