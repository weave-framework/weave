import { test, assert } from '../../../tools/harness.js';
import {
  createOwner,
  runInOwner,
  disposeOwner,
  effect,
  provide,
  type Owner,
} from '@weave-framework/runtime';
import {
  createI18n,
  t,
  locale,
  setLocale,
  I18nContext,
  type I18n,
  type Messages,
  type TranslateFn,
} from '@weave-framework/i18n';

const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

const EN: Messages = { greeting: 'Hello {{ name }}', home: { title: 'Home' } };
const LT: Messages = { greeting: 'Sveiki {{ name }}', home: { title: 'Pradžia' } };

/* ───────────────────────── basic lookup ───────────────────────── */

test('i18n: translates with params and nested keys', () => {
  const i18n: I18n = createI18n({ lang: 'en', messages: { en: EN }, global: false });
  assert.equal(i18n.t('greeting', { name: 'Aidas' }), 'Hello Aidas');
  assert.equal(i18n.t('home.title'), 'Home');
});

test('i18n: missing key returns the key by default, or the custom handler', () => {
  const a: I18n = createI18n({ lang: 'en', messages: { en: EN }, global: false });
  assert.equal(a.t('nope.key'), 'nope.key');
  const b: I18n = createI18n({
    lang: 'en',
    messages: { en: EN },
    global: false,
    missing: (k) => `?${k}?`,
  });
  assert.equal(b.t('nope.key'), '?nope.key?');
});

test('i18n: falls back to fallbackLang when a key is missing in the active one', () => {
  const i18n: I18n = createI18n({
    lang: 'lt',
    fallbackLang: 'en',
    messages: { en: { ...EN, only: 'english only' }, lt: LT },
    global: false,
  });
  assert.equal(i18n.t('home.title'), 'Pradžia', 'present in active lang');
  assert.equal(i18n.t('only'), 'english only', 'missing in lt → english fallback');
});

test('i18n: has() reflects resolvability', () => {
  const i18n: I18n = createI18n({ lang: 'en', messages: { en: EN }, global: false });
  assert.equal(i18n.has('home.title'), true);
  assert.equal(i18n.has('home.subtitle'), false);
});

/* ───────────────────────── reactivity ───────────────────────── */

test('i18n: t() is reactive — switching locale re-runs an effect', async () => {
  const owner: Owner = createOwner();
  const i18n: I18n = createI18n({ lang: 'en', messages: { en: EN, lt: LT }, global: false });

  let seen: string = '';
  runInOwner(owner, () => {
    effect(() => {
      seen = i18n.t('greeting', { name: 'A' });
    });
  });
  assert.equal(seen, 'Hello A', 'initial');

  await i18n.setLocale('lt');
  assert.equal(seen, 'Sveiki A', 'effect re-ran after setLocale');
  disposeOwner(owner);
});

/* ───────────────────────── scopes ───────────────────────── */

test('i18n: scoped() prefixes keys', () => {
  const i18n: I18n = createI18n({
    lang: 'en',
    messages: { en: { cart: { title: 'Your cart' } } },
    global: false,
  });
  const ct: TranslateFn = i18n.scoped('cart');
  assert.equal(ct('title'), 'Your cart');
});

/* ───────────────────────── lazy loading ───────────────────────── */

test('i18n: lazy loader fills a language on setLocale', async () => {
  const i18n: I18n = createI18n({
    lang: 'en',
    global: false,
    loader: (lang) => (lang === 'lt' ? LT : EN),
  });
  await i18n.setLocale('en');
  assert.equal(i18n.t('home.title'), 'Home');

  await i18n.setLocale('lt');
  assert.equal(i18n.t('home.title'), 'Pradžia', 'lt loaded lazily');
});

test('i18n: loading() is false once the active language has loaded', async () => {
  const i18n: I18n = createI18n({
    lang: 'en',
    global: false,
    loader: () => Promise.resolve(EN),
  });
  await i18n.setLocale('en');
  await tick();
  assert.equal(i18n.loading(), false);
});

/* ───────────────────────── global + context override ───────────────────────── */

test('i18n: bare t()/locale() use the global instance', async () => {
  const i18n: I18n = createI18n({ lang: 'en', messages: { en: EN, lt: LT } }); // global: true
  assert.equal(locale(), 'en');
  assert.equal(t('greeting', { name: 'G' }), 'Hello G');

  await setLocale('lt');
  assert.equal(locale(), 'lt');
  assert.equal(t('greeting', { name: 'G' }), 'Sveiki G');
  // restore so later tests relying on the global aren't surprised
  await i18n.setLocale('en');
});

test('i18n: a provided instance overrides the global within a subtree', () => {
  createI18n({ lang: 'en', messages: { en: EN } }); // global
  const scoped: I18n = createI18n({ lang: 'lt', messages: { lt: LT }, global: false });

  const owner: Owner = createOwner();
  let inside: string = '';
  runInOwner(owner, () => {
    provide(I18nContext, scoped);
    effect(() => {
      inside = t('greeting', { name: 'X' });
    });
  });
  assert.equal(inside, 'Sveiki X', 'bare t() resolved to the provided instance');
  assert.equal(t('greeting', { name: 'X' }), 'Hello X', 'outside the subtree → global');
  disposeOwner(owner);
});
