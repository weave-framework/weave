/**
 * @weave-framework/i18n — signal-native internationalization. Zero third-party deps.
 *
 * An *optional* add-on: the runtime never depends on it, so if an app doesn't
 * `createI18n()` it pays nothing. When it does, translation is just another
 * signal graph — `t('key')` reads the active-locale and message signals, so
 * every `{{ t('…') }}` binding (and every `computed`/`effect` over `t`) updates
 * itself the instant `setLocale()` runs, with no reload and no streams.
 *
 * The same `t` works in a template *and* in plain `.ts`: called inside a tracked
 * scope (binding / `computed` / `effect`) it subscribes and re-runs on language
 * change; called bare it returns the current snapshot. One import, no RxJS, no
 * `selectTranslate` vs `translate` split.
 *
 * Resolution per call: active language → fallback language → `missing` handler.
 * Lazy `loader` fills languages (and scopes) on demand; ICU plural/select/number/
 * date come from {@link formatMessage} (see `./icu`), all on native `Intl`.
 */

import { signal, createContext, inject, type Signal, type Context } from '@weave-framework/runtime';
import { formatMessage, type FormatParams } from './icu.js';

export type { FormatParams } from './icu.js';

/** A (possibly nested) message tree: `{ home: { title: 'Hi {{ name }}' } }`. */
export interface Messages {
  [key: string]: string | Messages;
}

/** Loads the messages for a language — and optionally a lazy *scope* within it. */
export type Loader = (lang: string, scope?: string) => Messages | Promise<Messages>;

/** Configuration for {@link createI18n} — initial / fallback language, eager messages, a lazy `loader`, and the missing-key handler. */
export interface I18nConfig {
  /** Initial active language. */
  lang: string;
  /** Language consulted when a key is missing in the active one. */
  fallbackLang?: string;
  /** Advertised languages (for a switcher); defaults to the keys of `messages`. */
  langs?: string[];
  /** Eagerly-available messages, keyed by language. */
  messages?: Record<string, Messages>;
  /** Lazy loader for languages/scopes not present in `messages`. */
  loader?: Loader;
  /** Called when a key resolves nowhere. Default: returns the key itself. */
  missing?: (key: string, lang: string) => string;
  /** Register this instance as the global one used by the bare `t`/`setLocale`. Default `true`. */
  global?: boolean;
}

/** A translate function bound to a (root or scoped) message namespace. */
export type TranslateFn = (key: string, params?: FormatParams) => string;

/** An i18n instance — the reactive `locale()`, the known languages, and `t()` translate functions. Created by {@link createI18n}. */
export interface I18n {
  /** Active language. Reactive — read it to subscribe. */
  locale(): string;
  /** Languages this instance knows about. */
  availableLangs(): string[];
  /** Whether any language/scope load is in flight. Reactive. */
  loading(): boolean;
  /** Switch language, lazy-loading it (and the fallback) first. Resolves once active. */
  setLocale(lang: string): Promise<void>;
  /** Ensure a language (and optional scope) is loaded without switching to it. */
  load(lang: string, scope?: string): Promise<void>;
  /** Translate `key`, interpolating `params` (ICU plural/select/number/date supported). */
  t: TranslateFn;
  /** Whether `key` currently resolves (active or fallback language). Reactive. */
  has(key: string): boolean;
  /** A `t` whose keys are prefixed with `scope.` — for feature-scoped messages. */
  scoped(scope: string): TranslateFn;
}

/** Context token: `provide(I18nContext, instance)` to override the global within a subtree. */
export const I18nContext: Context<I18n | undefined> = createContext<I18n | undefined>(undefined);

let globalI18n: I18n | undefined;

/** Set the instance backing the bare `t`/`setLocale`/`locale` exports. */
export function setGlobalI18n(instance: I18n): void {
  globalI18n = instance;
}

/** The active instance: a context-provided one wins, else the global. Throws if neither exists. */
function active(): I18n {
  const ctx: I18n | undefined = inject(I18nContext);
  const instance: I18n | undefined = ctx ?? globalI18n;
  if (!instance) {
    throw new Error(
      'weave i18n: no active instance — call createI18n() once, or provide(I18nContext, instance) in a subtree.'
    );
  }
  return instance;
}

/** Look up a dotted (or flat) key in a message tree. */
function resolve(messages: Messages | undefined, key: string): string | undefined {
  if (!messages) return undefined;
  const flat: string | Messages | undefined = messages[key];
  if (typeof flat === 'string') return flat;
  let cur: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Create an i18n instance. By default it becomes the global one, so a bare
 * `import { t } from '@weave-framework/i18n'` resolves to it; pass `global: false` for a
 * standalone instance you wire up via {@link I18nContext}.
 */
export function createI18n(config: I18nConfig): I18n {
  const lang: Signal<string> = signal<string>(config.lang);
  const store: Signal<Record<string, Messages>> = signal<Record<string, Messages>>({
    ...(config.messages ?? {}),
  });
  const pending: Signal<number> = signal<number>(0);

  // Track which (lang, scope) pairs are resolved so we never re-load or re-await.
  const loaded: Set<string> = new Set<string>();
  for (const l of Object.keys(config.messages ?? {})) loaded.add(l + '::');

  const tag = (l: string, scope?: string): string => `${l}::${scope ?? ''}`;

  async function load(l: string, scope?: string): Promise<void> {
    if (loaded.has(tag(l, scope))) return;
    if (!config.loader) {
      loaded.add(tag(l, scope));
      return;
    }
    pending.set(pending() + 1);
    try {
      const msgs: Messages = await config.loader(l, scope);
      const next: Record<string, Messages> = { ...store() };
      const langMsgs: Messages = { ...(next[l] ?? {}) };
      if (scope) langMsgs[scope] = msgs;
      else Object.assign(langMsgs, msgs);
      next[l] = langMsgs;
      store.set(next);
      loaded.add(tag(l, scope));
    } finally {
      pending.set(pending() - 1);
    }
  }

  async function setLocale(l: string): Promise<void> {
    await load(l);
    if (config.fallbackLang && config.fallbackLang !== l) await load(config.fallbackLang);
    lang.set(l);
  }

  function lookup(key: string): string | undefined {
    const l: string = lang(); // tracked
    const s: Record<string, Messages> = store(); // tracked
    let raw: string | undefined = resolve(s[l], key);
    if (raw === undefined && config.fallbackLang && config.fallbackLang !== l) {
      raw = resolve(s[config.fallbackLang], key);
    }
    return raw;
  }

  const t: TranslateFn = (key, params) => {
    const raw: string | undefined = lookup(key);
    if (raw === undefined) return config.missing ? config.missing(key, lang()) : key;
    // Fast path: no params and no message syntax → the string verbatim.
    if (params === undefined && raw.indexOf('{') === -1) return raw;
    return formatMessage(raw, params, lang());
  };

  const instance: I18n = {
    locale: () => lang(),
    availableLangs: () => config.langs ?? Object.keys(store()),
    loading: () => pending() > 0,
    setLocale,
    load,
    t,
    has: (key) => lookup(key) !== undefined,
    scoped:
      (scope) =>
      (key, params) =>
        t(`${scope}.${key}`, params),
  };

  // Kick off the initial language (and fallback) load; `loading()` reflects it.
  if (config.loader) {
    void setLocale(config.lang);
  }

  if (config.global !== false) globalI18n = instance;
  return instance;
}

/* ───────────────────── bare exports (global default + context override) ───────────────────── */

/** Translate via the active instance (context-provided, else global). */
export const t: TranslateFn = (key, params) => active().t(key, params);

/** Active language of the active instance. Reactive. */
export function locale(): string {
  return active().locale();
}

/** Switch language on the active instance. */
export function setLocale(lang: string): Promise<void> {
  return active().setLocale(lang);
}

/** Whether the active instance is loading. Reactive. */
export function loading(): boolean {
  return active().loading();
}

/* ─────────────────── standalone Intl formatters (the "pipes" replacement) ─────────────────── */

/**
 * The locale to format with when none is passed: the active i18n instance's locale (reactive —
 * so a formatter used in a binding re-runs on `setLocale`), or `undefined` (→ the runtime's
 * default locale) when no `createI18n()` has run. Never throws, so the formatters work with or
 * without i18n set up.
 */
function currentLocale(): string | undefined {
  const instance: I18n | undefined = inject(I18nContext) ?? globalI18n;
  return instance ? instance.locale() : undefined;
}

/**
 * Format a number with `Intl.NumberFormat` — the standalone replacement for Angular's
 * `{{ n | number }}` (Weave has no pipes; you call a function). Locale defaults to the active
 * i18n locale (reactive), else the runtime default. `{{ formatNumber(n, { minimumFractionDigits: 2 }) }}`.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: string): string {
  return new Intl.NumberFormat(locale ?? currentLocale(), options).format(value);
}

/**
 * Format a money amount with `Intl.NumberFormat`'s currency style — the replacement for
 * `{{ v | currency:'EUR' }}` (and for ICU's unsupported `{v, number, currency}`).
 * `{{ formatCurrency(9.9, 'EUR') }}` → `"€9.90"` (per locale).
 */
export function formatCurrency(
  value: number,
  currency: string,
  options?: Intl.NumberFormatOptions,
  locale?: string
): string {
  return new Intl.NumberFormat(locale ?? currentLocale(), { style: 'currency', currency, ...options }).format(value);
}

/**
 * Format a ratio as a percent with `Intl.NumberFormat` — the replacement for `{{ v | percent }}`.
 * The value is a ratio, so `formatPercent(0.42)` → `"42%"`.
 */
export function formatPercent(value: number, options?: Intl.NumberFormatOptions, locale?: string): string {
  return new Intl.NumberFormat(locale ?? currentLocale(), { style: 'percent', ...options }).format(value);
}

/**
 * Format a date/time with `Intl.DateTimeFormat` — the replacement for `{{ d | date }}`. Accepts a
 * `Date`, an epoch ms number, or a date string. Use `dateStyle`/`timeStyle` (`'short'|'medium'|
 * 'long'|'full'`) for the Angular-preset feel: `{{ formatDate(d, { dateStyle: 'medium' }) }}`.
 */
export function formatDate(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  const d: Date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale ?? currentLocale(), options).format(d);
}

/**
 * Format a relative time with `Intl.RelativeTimeFormat` — no Angular pipe equivalent, but a common
 * need. `formatRelativeTime(-3, 'day')` → `"3 days ago"`; `formatRelativeTime(2, 'hour')` → `"in 2 hours"`.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
  locale?: string
): string {
  return new Intl.RelativeTimeFormat(locale ?? currentLocale(), options).format(value, unit);
}

/**
 * Join a list with `Intl.ListFormat` (locale-correct conjunction/disjunction) — e.g.
 * `formatList(['a', 'b', 'c'])` → `"a, b, and c"` in en. No Angular pipe equivalent.
 */
export function formatList(items: readonly string[], options?: Intl.ListFormatOptions, locale?: string): string {
  return new Intl.ListFormat(locale ?? currentLocale(), options).format(items);
}
