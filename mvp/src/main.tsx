import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "generative-loaders/styles.css";
import "./styles.css";

// PWA：注册离线壳 SW；失败静默（不影响主应用）。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
