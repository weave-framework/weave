# @weave-framework/i18n

Weave i18n — optional, signal-native translations with ICU plural/select. Zero third-party deps.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/i18n
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## Usage

Create one instance at startup. It registers itself as the global one, so the bare `t` works everywhere — in a `.ts` file and in a template alike.

```ts
import { createI18n } from '@weave-framework/i18n';

createI18n({
  lang: 'en',
  fallbackLang: 'en',
  messages: {
    en: { greeting: 'Hello, {name}!', cart: { items: '{n, plural, one {# item} other {# items}}' } },
    lt: { greeting: 'Sveiki, {name}!' },
  },
});
```

```ts
import { t, locale, setLocale } from '@weave-framework/i18n';

t('greeting', { name: 'Ada' });  // "Hello, Ada!"
t('cart.items', { n: 3 });       // "3 items"
locale();                        // 'en' — reactive, read it to subscribe
await setLocale('lt');           // lazy-loads if needed, then switches
```

`locale()` is a signal, so every `t()` read inside an effect or template re-evaluates on a language switch — no re-render pass, no reload.

```html
<p>{{ t('greeting', { name: user.name() }) }}</p>
```

## Lazy loading and scopes

Skip `messages` and give a `loader` to fetch languages (and feature scopes within them) on demand:

```ts
createI18n({
  lang: 'en',
  loader: (lang, scope) => import(`./locales/${lang}${scope ? `/${scope}` : ''}.json`).then((m) => m.default),
});
```

`load(lang, scope?)` warms a language without switching; `loading()` is reactive; `scoped('checkout')` returns a `t` whose keys are prefixed. `missing` handles keys that resolve nowhere (default: return the key).

## Formatting

Locale-aware wrappers over the platform's own `Intl` — no data tables shipped:

```ts
import { formatNumber, formatCurrency, formatPercent, formatDate, formatRelativeTime, formatList } from '@weave-framework/i18n';

formatCurrency(1299.5, 'EUR');       // follows the active locale
formatRelativeTime(-3, 'day');
formatList(['a', 'b', 'c']);
```

Each takes an optional `locale` argument to override the active one.

## Scoped instances

`createI18n({ …, global: false })` builds an instance that doesn't take over the globals; `provide(I18nContext, instance)` then overrides `t` for one subtree.

📚 **Guides + full API reference:** [i18n guide](https://weaveframework.dev/learn/i18n) · [API reference](https://weaveframework.dev/reference/i18n)

## License

MIT
