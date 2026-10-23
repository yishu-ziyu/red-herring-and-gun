import React from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/colors/sand.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/green.css";
import "@radix-ui/colors/amber.css";
import "@radix-ui/colors/black-alpha.css";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
