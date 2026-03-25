import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

declare const __APP_BUILD_ID__: string;

// ── Register Service Worker for offline PWA support ──────────────────────────
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let didRefreshForNewWorker = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (didRefreshForNewWorker) return;
      didRefreshForNewWorker = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register(`/sw.js?build=${encodeURIComponent(__APP_BUILD_ID__)}`)
      .then((reg) => {
        console.log("[SW] Registered:", reg.scope);

        const activateWaitingWorker = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.postMessage("skipWaiting");
        };

        if (reg.waiting) {
          activateWaitingWorker(reg.waiting);
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              activateWaitingWorker(newWorker);
            }
          });
        });

        // Auto-update check every 60s
        setInterval(() => reg.update(), 60000);
      })
      .catch((err) => console.warn("[SW] Registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
