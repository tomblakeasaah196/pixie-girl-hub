import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

const LANG_KEY = "pgh-lang";

i18n.use(initReactI18next).init({
  resources: {
    en: { factory: en },
    zh: { factory: zh },
  },
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

/** Call from ProductionPage to toggle between en ↔ zh */
export function toggleFactoryLang() {
  const next = i18n.language === "zh" ? "en" : "zh";
  i18n.changeLanguage(next);
}

/** Auto-switch to zh for factory_manager users who haven't set a preference yet */
export function autoDefaultFactoryLang(isFactoryManager: boolean) {
  const stored = typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY);
  if (isFactoryManager && !stored) {
    i18n.changeLanguage("zh");
  }
}
