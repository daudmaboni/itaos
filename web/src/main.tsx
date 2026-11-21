// Apply the saved font before first paint so the page does not flash in the other font.
try { const f = localStorage.getItem("itaos-font"); if (f && f !== "geist") document.documentElement.dataset.font = f; } catch { /* storage unavailable */ }
import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./dashboard.css";
import "./mobile.css";
import "./graphite.css";
import "./glass.css";
import "./auth.css";
import { startPwa } from "./pwa";
import { startPullRefresh } from "./pullRefresh";
import { startGlassCards } from "./glassCards";

startPwa();
startPullRefresh();
startGlassCards();

// "/" is the public homepage; the app lives at "/app".
// "/r/<code>" is the public page a printed receipt's QR opens.
// Old links ("/#dashboard") and Supabase sign-in links that land on "/" with tokens are sent on to the app.
const APP_VIEWS = /^#(dashboard|kito|report|actions|chats|content|connect|settings)\b/;
const AUTH_HASH = /(access_token|refresh_token|error_description|type=(magiclink|recovery|signup|invite))=?/;
const path = location.pathname.replace(/\/+$/, "") || "/";
const isApp = path === "/app" || path.startsWith("/app/");

if (!isApp && (APP_VIEWS.test(location.hash) || AUTH_HASH.test(location.hash) || /[?&]code=/.test(location.search))) {
  location.replace("/app" + location.search + location.hash);
} else {
  const root = createRoot(document.getElementById("root")!);
  const isAdmin = path === "/app/admin";
  const isReceipt = path.startsWith("/r/"); // public receipt check from a printed QR (ReceiptCheck.tsx)
  (isReceipt ? import("./ReceiptCheck") : isAdmin ? import("./AdminPage") : isApp ? import("./App") : import("./Home")).then(({ default: Page }) => {
    root.render(<React.StrictMode><Page /></React.StrictMode>);
  });
}
