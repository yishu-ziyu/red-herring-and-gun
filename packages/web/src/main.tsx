import { createRoot } from "react-dom/client";
import { APP_TITLE } from "./index.js";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
createRoot(el).render(APP_TITLE);
