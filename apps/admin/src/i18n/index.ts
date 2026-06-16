/**
 * Factory i18n — react-i18next setup for factory-facing screens.
 *
 * Adding a new language requires NO frontend code changes:
 *   1. Create  apps/admin/src/i18n/locales/<code>.json  (e.g. ko.json)
 *   2. Add     "<code>": "<Native Name>"  to language-names.json
 *   3. Deploy — Vite bundles the new file automatically via import.meta.glob
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import languageNames from "./language-names.json";

const LANG_KEY = "pgh-lang";

// Auto-discover every locales/*.json at build time — no manual imports needed.
const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  "./locales/*.json",
  { eager: true },
);

const resources: Record<string, { factory: Record<string, string> }> = {};
for (const [path, mod] of Object.entries(localeModules)) {
  const code = path.replace("./locales/", "").replace(".json", "");
  resources[code] = { factory: mod.default };
}

i18n.use(initReactI18next).init({
  resources,
  lng: (typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY)) || "en",
  fallbackLng: "en",
  ns: ["factory"],
  defaultNS: "factory",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LANG_KEY, lng);
  }
});

export default i18n;

/**
 * Map of language code → native display name, driven entirely by language-names.json.
 * The dropdown in ProductionPage reads this — no UI change needed when you add a language.
 */
export const FACTORY_LANGUAGES: Record<string, string> = languageNames;

/** Auto-switch to Chinese for factory_manager users who haven't set a preference yet */
export function autoDefaultFactoryLang(isFactoryManager: boolean) {
  const stored = typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY);
  if (isFactoryManager && !stored) {
    i18n.changeLanguage("zh");
  }
}
