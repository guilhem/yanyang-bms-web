import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { i18n, t, initialLanguage, localizedError, errorDetails } from '../web/i18n.js';
import { informationGroups, parseCycleText } from '../web/app.js';

const catalogues = Object.fromEntries(['fr', 'en', 'zh-CN'].map(language => [language, JSON.parse(readFileSync(new URL(`../web/locales/${language}.json`, import.meta.url)))]));
const placeholders = text => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]).sort();

test('all languages cover the same catalogue and preserve interpolation parameters', () => {
  for (const [language, catalogue] of Object.entries(catalogues)) {
    assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(catalogues.fr).sort(), language);
    for (const [key, value] of Object.entries(catalogue)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0, `${language}: ${key}`);
      assert.deepEqual(placeholders(value), placeholders(catalogues.fr[key]), `${language}: ${key}`);
    }
  }
  // Include keys used in HTML attributes, error metadata, message calls and label tables.
  const sources = ['app.js', 'ble.js', 'protocol.js', 'i18n.js', 'index.html'].map(file => readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8')).join('\n');
  for (const match of sources.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const value = match[2] ?? JSON.parse(`"${match[1]}"`);
    if (/[àâéèêëîïôùûüçÀÉÈ]/.test(value) && !value.includes('<')) {
      assert.ok(Object.hasOwn(catalogues.fr, value), `Missing source key: ${value}`);
    }
  }
});

test('choose a supported browser language or persisted selection, even if storage is blocked', () => {
  assert.equal(initialLanguage(['en-US'], { getItem: () => 'zh-CN' }), 'zh-CN');
  assert.equal(initialLanguage(['de-DE', 'en-GB'], { getItem: () => null }), 'en');
  assert.equal(initialLanguage(['zh-TW'], { getItem: () => null }), 'zh-CN');
  assert.equal(initialLanguage(['fr-CA'], { getItem: () => 'invalid' }), 'fr');
  assert.equal(initialLanguage(['es-ES'], { getItem: () => null }), 'fr');
  assert.equal(initialLanguage(['en-US'], { getItem: () => { throw new Error('blocked'); } }), 'en');
});

test('translate technical values, plurals, errors and warnings without altering capture data', async () => {
  const text = readFileSync(new URL('./fixtures/cycle-synthetic.json', import.meta.url), 'utf8');
  const capture = parseCycleText(text);
  const before = JSON.stringify(capture);
  const cause = new Error('native');
  try {
    for (const language of ['fr', 'en', 'zh-CN']) {
      await i18n.changeLanguage(language);
      const rows = Object.fromEntries(Object.values(informationGroups({ ratedCapacityAh: 1234.5 })).flat());
      assert.equal(rows[t('Capacité nominale')], `${new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5)} Ah`);
      assert.equal(rows[t('Capacité restante')], t('Non disponible'));
      assert.ok(t('cellules', { count: 1 }).includes('1'));
      assert.ok(t('cellules', { count: 17 }).includes('17'));
      assert.doesNotMatch(t('cellules', { count: 17 }), /{{/);
      const error = localizedError('Exception Modbus {{code}}.', { code: '0x02' }, SyntaxError, cause);
      assert.ok(error instanceof SyntaxError);
      assert.equal(error.cause, cause);
      assert.equal(error.message, 'Exception Modbus 0x02.');
      assert.equal(errorDetails(error).key, error.translationKey);
      assert.ok(t(error.translationKey, error.translationValues).includes('0x02'));
      assert.notEqual(t(errorDetails({ name: 'NetworkError' }).key), 'NetworkError');
      assert.equal(errorDetails(new Error('native detail')).values.detail, 'native detail');
      assert.ok(t('Alarmes inconnues : {{bits}}', { bits: '0x80000000' }).includes('0x80000000'));
      assert.equal(JSON.stringify(capture), before);
    }
  } finally { await i18n.changeLanguage('fr'); }
  assert.equal(t('cellules', { count: 1 }), '1 cellule');
  assert.equal(t('cellules', { count: 17 }), '17 cellules');
});
