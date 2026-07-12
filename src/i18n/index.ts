import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import ko from './locales/ko'
import en from './locales/en'
import es from './locales/es'
import ja from './locales/ja'
import id from './locales/id'

export const SUPPORTED_LANGUAGES = [
  { code: 'ko', name: '한국어', nativeName: '한국어' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code']

/**
 * Union of every leaf translation key path, derived from the en locale
 * (the structural source of truth — locale parity is enforced separately).
 * Use for values that hold i18n keys and for guarded dynamic-key casts.
 */
type LeafKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafKeys<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type TranslationKey = LeafKeys<typeof en>

const resources = {
  ko: { translation: ko },
  en: { translation: en },
  es: { translation: es },
  ja: { translation: ja },
  id: { translation: id },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'zappi-language',
    },
  })
  .then(() => {
    document.documentElement.lang = i18n.language?.split('-')[0] || 'en'
  })

export default i18n

// Helper to change language
export const changeLanguage = (lang: SupportedLanguage) => {
  i18n.changeLanguage(lang)
  localStorage.setItem('zappi-language', lang)
  document.documentElement.lang = lang
}

// Get current language
export const getCurrentLanguage = (): SupportedLanguage => {
  return (i18n.language?.split('-')[0] as SupportedLanguage) || 'en'
}
