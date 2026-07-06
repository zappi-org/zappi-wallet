/**
 * i18next CustomTypeOptions augmentation — makes every t() key statically
 * checked against the English locale (the structural source of truth for all
 * five locales; parity is enforced separately).
 *
 * react-i18next v13+ consumes this via the 'i18next' module augmentation.
 */
import 'i18next'
import type en from './locales/en'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
  }
}
