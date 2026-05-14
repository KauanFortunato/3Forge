import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./playground.css";

const host = document.getElementById("w3d-translation-root");
if (!host) {
  throw new Error("Missing #w3d-translation-root host element in index.html");
}

createRoot(host).render(<App />);
