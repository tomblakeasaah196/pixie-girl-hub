import { useQuery } from "@tanstack/react-query";
import { listWithTranslations } from "@/lib/factory-i18n-api";
import { FACTORY_LANGUAGES, syncFromApi } from "@/i18n";

/**
 * Fetches factory languages + translations from the DB.
 * Side-effect: hot-swaps them into i18next so factory screens
 * immediately use DB translations without a page reload.
 * Falls back to FACTORY_LANGUAGES (bundled) on error.
 */
export function useFactoryLanguages() {
  const { data, ...rest } = useQuery({
    queryKey: ["factory-i18n-languages"],
    queryFn: async () => {
      const langs = await listWithTranslations();
      await syncFromApi(langs);
      return Object.fromEntries(
        langs.map((l) => [l.language_code, l.display_name]),
      );
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  return { languages: data ?? FACTORY_LANGUAGES, ...rest };
}
