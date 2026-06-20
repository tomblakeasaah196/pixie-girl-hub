/**
 * Factory i18n — react-i18next setup for factory-facing screens.
 *
 * Adding a new language requires NO frontend code changes:
 *   • Go to Settings → Factory Languages in the admin app
 *   • Download the guide, generate a translation with AI, paste it in
 *   • Save — the new language is live immediately (stored in the DB)
 *
 * Bundled JSON files (locales/*.json) serve as the guaranteed fallback
 * if the API is unreachable. The DB always wins on conflict.
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
  lng:
    (typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY)) ||
    "en",
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
 * Mutable language registry. Starts with bundled language-names.json;
 * overwritten by DB data when `syncTranslationsFromApi()` resolves.
 */
export let FACTORY_LANGUAGES: Record<string, string> = { ...languageNames };

/**
 * Load translations from the DB API and hot-swap them into i18next.
 * Called by useFactoryLanguages() hook — results are TanStack Query-cached.
 * Silent on failure — bundled files remain as fallback.
 */
export async function syncFromApi(
  langs: Array<{
    language_code: string;
    display_name: string;
    translations: Record<string, string>;
  }>,
) {
  for (const lang of langs) {
    i18n.addResourceBundle(
      lang.language_code,
      "factory",
      lang.translations,
      true,
      true,
    );
  }
  FACTORY_LANGUAGES = Object.fromEntries(
    langs.map((l) => [l.language_code, l.display_name]),
  );
}

/** Auto-switch to Chinese for factory_manager users who haven't set a preference yet */
export function autoDefaultFactoryLang(isFactoryManager: boolean) {
  const stored =
    typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY);
  if (isFactoryManager && !stored) {
    i18n.changeLanguage("zh");
  }
}
