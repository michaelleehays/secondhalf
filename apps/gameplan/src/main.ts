import "./styles.css";
import { start } from "./app";

start();

// iPhone ignores user-scalable=no in some cases; block the pinch gesture itself.
for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js"); });
}
