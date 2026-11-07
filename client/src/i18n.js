import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Each language's texts are a file of their own, loaded when the language is
// first used: a visitor downloads only the one they read (the two together
// are about a tenth of the app's first download). Hebrew has every English
// key, so neither falls back on the other.
const LANGUAGES = Object.freeze({
  en: () => import('./locales/en.json'),
  he: () => import('./locales/he.json'),
});

i18n.use(initReactI18next).init({
  resources: {},
  lng: 'en',
  fallbackLng: false,
  interpolation: {
    escapeValue: false,
  },
});

// The language the app starts in, as AppSideProvider picks it: Hebrew for a
// browser set to Hebrew, English otherwise.
export function browserLanguage() {
  const browserLang = navigator.languages?.[0] || navigator.language || 'en';
  return browserLang.split('-')[0] === 'he' ? 'he' : 'en';
}

// Switches to a language, loading its texts first if this is its first use.
export async function loadLanguage(lang) {
  const language = Object.hasOwn(LANGUAGES, lang) ? lang : 'en';
  if (!i18n.hasResourceBundle(language, 'translation')) {
    const { default: texts } = await LANGUAGES[language]();
    i18n.addResourceBundle(language, 'translation', texts);
  }
  return i18n.changeLanguage(language);
}

export default i18n;
