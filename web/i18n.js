import i18next from './vendor/i18next.js';
import fr from './locales/fr.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh-CN.json' with { type: 'json' };

export const i18n = i18next.createInstance();
await i18n.init({
  lng: 'fr', fallbackLng: 'fr', supportedLngs: ['fr', 'en', 'zh-CN'],
  resources: { fr: { translation: fr }, en: { translation: en }, 'zh-CN': { translation: zh } },
  keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false },
});
export const t = (...args) => i18n.t(...args);

export function initialLanguage(languages = globalThis.navigator?.languages ?? [], storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem('yybms-language');
    if (['fr', 'en', 'zh-CN'].includes(saved)) return saved;
  } catch { /* Storage may be disabled. */ }
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (['fr', 'en', 'zh'].includes(base)) return base === 'zh' ? 'zh-CN' : base;
  }
  return 'fr';
}

// Keep exported diagnostic messages deterministic; the UI translates their metadata.
export function localizedError(key, values = {}, ErrorType = Error, cause) {
  return Object.assign(new ErrorType(i18n.getFixedT('fr')(key, values), cause ? { cause } : undefined), {
    translationKey: key, translationValues: values,
  });
}

export function errorDetails(error) {
  const browserErrors = {
    NotFoundError: 'Aucun appareil sélectionné ou appareil introuvable.',
    NetworkError: 'Connexion Bluetooth impossible. Vérifiez l’appareil, puis réessayez.',
    SecurityError: 'Accès Bluetooth refusé. Vérifiez les autorisations du navigateur.',
    NotSupportedError: 'Cette opération n’est pas prise en charge par le navigateur ou l’appareil.',
    AbortError: 'Opération annulée.',
    NotReadableError: 'Impossible de lire le fichier sélectionné.',
  };
  return {
    key: error.translationKey ?? browserErrors[error.name] ?? 'Erreur inattendue : {{detail}}',
    values: error.translationValues ?? { detail: error.message || error.name },
  };
}

export function translatePage(root = document) {
  root.documentElement.lang = i18n.language;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'content']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
