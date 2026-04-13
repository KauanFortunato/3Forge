import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./editor.css";
import { App } from "./react/App";

const root = document.getElementById("editor-root");

if (!root) {
  throw new Error("Editor root container not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
