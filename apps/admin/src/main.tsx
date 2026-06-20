import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import "./i18n";

// Surface the live build id in the console — the fastest way to confirm a
// browser is actually running the deployed build and not a stale cache.
// eslint-disable-next-line no-console
console.info(`Pixie Girl Hub build ${__BUILD_ID__}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Remove the CSS splash screen now that React has mounted
document.getElementById("splash")?.remove();
