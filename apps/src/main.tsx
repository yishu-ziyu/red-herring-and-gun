import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "generative-loaders/styles.css";
import "./styles.css";

// PWA：只在生产注册离线壳。开发时 Vite 一死，服务工仍会端出旧壳，
// 接口/模块请求变成 Failed to fetch，还会把谷歌字体缓存成坏响应。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (import.meta.env.DEV) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
