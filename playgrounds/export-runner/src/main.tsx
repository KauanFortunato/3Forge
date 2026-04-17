import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExportRunnerApp } from "./ExportRunnerApp";
import "./runner.css";

const root = document.getElementById("export-runner-root");

if (!root) {
  throw new Error("Export runner root container not found.");
}

createRoot(root).render(
  <StrictMode>
    <ExportRunnerApp />
  </StrictMode>,
);
