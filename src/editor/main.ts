import "./editor.css";
import { ComponentEditorApp } from "./ui";

const root = document.getElementById("editor-root");

if (!root) {
  throw new Error("Editor root container not found.");
}

new ComponentEditorApp(root);
