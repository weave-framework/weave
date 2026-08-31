import { signal, computed, type Signal } from '@weave-framework/runtime';
import { createI18n, type I18n } from '@weave-framework/i18n';

/**
 * Switching language, and the ICU plural rules that make one written message read correctly in three.
 *
 * `global: false` matters and is not decoration: `createI18n` registers itself as the global instance by
 * default, so a demo built the obvious way would have taken over the documentation site's own
 * translations. Read from the config declaration, not assumed.
 *
 * Plural CATEGORIES are the thing to watch, and the boundaries are not where an English speaker guesses.
 * Measured in the browser rather than recalled: at 21 Lithuanian says "21 prekė" (the `one` form) while
 * Polish says "21 produktów" (`other`) — two languages with three categories each, disagreeing, both
 * correct. Nothing in the component knows any of it.
 */
const MESSAGES = {
  en: {
    cart: '{n, plural, =0 {Your cart is empty} one {# item} other {# items}}',
    greeting: 'Hello, {name}!',
  },
  lt: {
    cart: '{n, plural, =0 {Krepšelis tuščias} one {# prekė} few {# prekės} other {# prekių}}',
    greeting: 'Sveiki, {name}!',
  },
  pl: {
    cart: '{n, plural, =0 {Koszyk jest pusty} one {# produkt} few {# produkty} other {# produktów}}',
    greeting: 'Cześć, {name}!',
  },
} as const;

export function setup() {
  const i18n: I18n = createI18n({ lang: 'en', messages: MESSAGES, global: false });

  const n: Signal<number> = signal(1);
  const langs = ['en', 'lt', 'pl'];

  const active = (): string => i18n.locale();
  const cart = computed((): string => i18n.t('cart', { n: n() }));
  const greeting = computed((): string => i18n.t('greeting', { name: 'Ada' }));

  const pick = (l: string): void => {
    void i18n.setLocale(l);
  };
  const setN = (e: Event): void => {
    n.set(Number((e.target as HTMLInputElement).value));
  };
}
