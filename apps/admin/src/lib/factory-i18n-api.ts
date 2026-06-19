import { api } from "@/lib/api";

export interface FactoryLanguage {
  language_code: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

export interface FactoryLanguageWithTranslations extends FactoryLanguage {
  translations: Record<string, string>;
}

export const listLanguages = () => api.get<FactoryLanguage[]>("/factory-i18n");

export const listWithTranslations = () =>
  api.get<FactoryLanguageWithTranslations[]>("/factory-i18n/with-translations");

export const createLanguage = (data: {
  language_code: string;
  display_name: string;
  translations: Record<string, string>;
}) => api.post<FactoryLanguage>("/factory-i18n", data);

export const updateLanguage = (
  code: string,
  data: { display_name?: string; is_active?: boolean },
) => api.patch<FactoryLanguage>(`/factory-i18n/${code}`, data);

export const deleteLanguage = (code: string) =>
  api.delete<void>(`/factory-i18n/${code}`);
