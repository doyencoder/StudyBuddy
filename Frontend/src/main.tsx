import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── Register Service Worker for offline PWA support ──────────────────────────
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[SW] Registered:", reg.scope);
        // Auto-update check every 60s
        setInterval(() => reg.update(), 60000);
      })
      .catch((err) => console.warn("[SW] Registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);