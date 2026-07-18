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
import { createI18n } from '@weave-framework/i18n';
export const i18n = createI18n({
  lang: 'en',                 // NOT `locale` — the config key is `lang`
  fallbackLang: 'en',         // NOT `fallback`
  langs: ['en', 'lt'],        // advertised languages for a switcher (defaults to keys of `messages`)
  loader: (lang) => import(`./messages/${lang}.json`).then((m) => m.default),
});
```
```txt
Loader   = (lang: string, scope?: string) => Messages | Promise<Messages>
Messages = { [key: string]: string | Messages }        // nested or flat dotted keys, both resolve
```
The `loader` is called **per language, and again per lazy `scope`** — with no `scope` its result is merged into that language's messages; with a `scope` it is nested *under* that scope key. Each `(lang, scope)` pair is loaded at most once. If you supply `messages` eagerly for a language, no loader call happens for it. And note the constructor side effect: **when a `loader` is present, `createI18n` immediately kicks off `setLocale(config.lang)`**, so the initial catalog arrives asynchronously — `loading()` is `true` and `t()` returns the missing-key fallback (by default the key itself) for that first tick. Render off `loading()` rather than assuming messages are there synchronously.

The exact `I18nConfig` keys are **`lang`** (required), `fallbackLang`, `langs`, `messages`, `loader`, `missing`, and `global`. `global` defaults to **`true`**, so `createI18n` already registers the instance behind the bare `t()`/`setLocale()`/`locale()` exports — you do **not** need `setGlobalI18n` in the normal case. Pass `global: false` for a secondary instance, and call `setGlobalI18n(i18n)` only if you later want to swap which instance is global.

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
```txt
TranslateFn  = (key: string, params?: FormatParams) => string
FormatParams = Record<string, unknown>          // the placeholder bag; keys match the {names} in the message
```
`TranslateFn` is the type of the bare `t`, of `i18n.t`, and of whatever `i18n.scoped(scope)` returns — so a component can accept `t: TranslateFn` as a prop and be indifferent to which instance or namespace backs it. `FormatParams` is deliberately `unknown`-valued: a `{n, plural}` placeholder is `Number(…)`d, a `{d, date}` one accepts a `Date`, epoch ms, or a date string, and a bare `{name}` is stringified (`null`/`undefined` → `''`, silently — a typo'd param key renders as nothing, not an error).

`t(key, params?)` looks up the key in the active locale's messages and applies ICU. Expose `t` to a template by simply using it — auto-expose includes it (weave-component). Because `t` reads the locale signal, a `{{ t(...) }}` binding updates when the locale changes.

## ICU messages

```json
{
  "cart.items": "{count, plural, =0 {No items} one {# item} other {# items}}",
  "greeting": "Hello, {name}!",
  "role": "{kind, select, admin {Administrator} other {Member}}"
}
```
Supported (in-house ICU — no library): interpolation `{name}` **and** transloco-style `{{ name }}`, `{n, plural, …}` (with `=N` exact cases and `#` → the formatted number), `{n, selectordinal, …}`, `{k, select, …}`, `{x, number}` with style `integer`/`percent`, and `{d, date|time}` with length `short|medium|long|full` (default `medium`). Sub-messages nest to any depth.

ICU pitfalls, in the order they bite:

- **The apostrophe is an escape character.** `'{'` yields a literal brace and `''` a literal apostrophe — but a *lone* apostrophe swallows everything up to the next one, so `"Aujourd'hui {n} messages"` loses text. Write `"Aujourd''hui …"`. This only engages once the message is actually formatted: a message with no `{` **and** no `params` argument is returned verbatim, so the bug appears the moment you add a placeholder or pass `{}`.
- **`other` is the safety net, and its absence is silent.** A `plural`/`selectordinal`/`select` whose selector matches nothing falls back to `other`; if there is no `other` branch, the result is the **empty string**, not an error. Always ship an `other`.
- **`#` only works inside a plural sub-message.** At the top level of a message it is a literal `#`.
- **There is no `{v, number, currency}`** — currency style is not in the subset. Format it in `.ts` with `formatCurrency(v, 'EUR')` and pass the string in as a plain `{amount}` param.
- **Plural categories are locale-specific** (`Intl.PluralRules`): `one`/`other` covers English, but `lt` uses `one`/`few`/`other` and other languages more. Don't copy the English branch set into every catalog.

## Switch locale

```ts
import { setLocale, locale, loading } from '@weave-framework/i18n';
setLocale('lt');   // loads the catalog (via `loader`) then flips the signal
locale();          // current locale (reactive)
loading();         // true while a catalog is loading (reactive)
```
A language `<select>` just calls `setLocale(code)` on change; everything reading `t()`/`locale()` updates. Populate it from the instance's **`i18n.availableLangs()`**.

The `I18n` instance returned by `createI18n` also exposes `locale()`, `loading()`, `setLocale(lang)`, `load(lang, scope?)`, `t`, **`has(key)`**, and **`scoped(scope)`** (a `t` bound to a key namespace).

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

- `t()` is reactive **because** it reads the locale signal — call it where reactivity is tracked (template binding, computed) so it updates on switch. `const label = t('x')` in `setup` captures a **string snapshot** that will never update; write `const label = () => t('x')` (or a `computed`) and call it in the template.
- `t()` also tracks the *message store*, not just the locale — so a string rendered before its lazy catalog arrives re-renders itself when the load lands. Don't gate the whole page on `loading()` for that reason alone.
- A missing key is **not** an error: it falls back to the other language, then to `missing(key, lang)`, whose default returns the key itself. Use `has(key)` to branch, and a `missing` handler to make gaps loud in dev.
- `setLocale` is async (it may load a catalog) — `await` it if you need the new messages immediately.
- ICU uses `{ … }` — inside a Weave **template** that's fine (it's a string argument to `t()`), not a template brace.
