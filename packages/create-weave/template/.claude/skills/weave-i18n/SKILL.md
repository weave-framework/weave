---
name: weave-i18n
description: >-
  Internationalization / translations in a Weave app with @weave-framework/i18n.
  Use this whenever text needs translating or locale-aware formatting: `t()` in a
  template AND in `.ts`, `createI18n`, `setLocale`, locale-reactive UI, ICU
  messages (plurals/select/interpolation), and Intl-based number/currency/date/
  relative-time/list/percent formatting. Reach for it on any mention of i18n,
  translation, locale/language switching, message catalogs, plurals, or formatting
  numbers/dates for a locale — even "make this multilingual".
---

# Weave i18n

`@weave-framework/i18n` is signal-based and zero-dep: the active locale is a signal,
so **every `t()` call re-renders surgically when the locale changes**. Messages use
ICU syntax; formatters wrap native `Intl`.

## Setup

```ts
// i18n/i18n.ts
import { createI18n, setGlobalI18n } from '@weave-framework/i18n';
export const i18n = createI18n({
  locale: 'en',
  fallback: 'en',
  loader: (lang) => import(`./messages/${lang}.json`).then((m) => m.default),
});
setGlobalI18n(i18n);   // powers the bare t()/setLocale()/locale() exports
```

## Translate — same `t()` in template and `.ts`

```html
<h1>{{ t('home.title') }}</h1>
<p>{{ t('cart.items', { count: count() }) }}</p>
```
```ts
import { t } from '@weave-framework/i18n';
export function setup() {
  const label = () => t('users.method.password');   // reactive: re-computes on locale change
}
```
`t(key, params?)` looks up the key in the active locale's messages and applies ICU. Expose `t` to a template by simply using it — auto-expose includes it (weave-component). Because `t` reads the locale signal, a `{{ t(...) }}` binding updates when the locale changes.

## ICU messages

```json
{
  "cart.items": "{count, plural, =0 {No items} one {# item} other {# items}}",
  "greeting": "Hello, {name}!",
  "role": "{kind, select, admin {Administrator} other {Member}}"
}
```
Interpolation `{name}`, plural `{count, plural, …}` (with `#`), and select `{kind, select, …}` are supported (in-house ICU — no library).

## Switch locale

```ts
import { setLocale, locale, loading } from '@weave-framework/i18n';
setLocale('lt');   // loads the catalog (via `loader`) then flips the signal
locale();          // current locale (reactive)
loading();         // true while a catalog is loading (reactive)
```
A language `<select>` just calls `setLocale(code)` on change; everything reading `t()`/`locale()` updates.

## Locale-aware formatting (Intl)

```ts
import { formatNumber, formatCurrency, formatPercent, formatDate, formatRelativeTime, formatList } from '@weave-framework/i18n';
formatCurrency(1234.5, 'EUR');       // "€1,234.50" (in the active locale)
formatDate(new Date(), { dateStyle: 'medium' });
formatRelativeTime(-3, 'day');       // "3 days ago"
formatNumber(0.4212, { maximumFractionDigits: 1 });
formatList(['a', 'b', 'c']);         // "a, b, and c"
```
All take an optional explicit `locale` last arg; otherwise they use the active locale.

## Scoped / context override

`createI18n` returns an `I18n` you can `provide(I18nContext, instance)` to give a subtree its own locale (e.g. a preview pane), overriding the global. Descendant `t()` from context resolves against it.

## Patterns

- **Every user-facing string** goes through `t()` — no hardcoded copy. Keep keys structured (`feature.thing`).
- **Store the chosen locale** (localStorage) and `setLocale` it on boot.
- **Formatting** for money/dates/relative-time uses the formatters, not manual string building.

## Gotchas

- `t()` is reactive **because** it reads the locale signal — call it where reactivity is tracked (template binding, computed) so it updates on switch.
- `setLocale` is async (it may load a catalog) — `await` it if you need the new messages immediately.
- ICU uses `{ … }` — inside a Weave **template** that's fine (it's a string argument to `t()`), not a template brace.
