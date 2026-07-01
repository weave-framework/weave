/**
 * Icon registry — the signal-native, global+context source of SVG markup that the
 * `<Icon>` component renders. Mirrors `@weave-framework/i18n`'s shape: one global
 * instance backs the bare `<Icon>`, and `provide(IconContext, registry)` overrides
 * it within a subtree.
 *
 * Sources are consulted in order; the first that yields an icon wins. Sync sources
 * (the built-in set, an inline map) resolve instantly; async sources (an SVG sprite
 * fetched over the network) fill a reactive cache, so a binding re-renders itself
 * the moment the fetch lands — no reload, no streams. The built-in Lucide set is a
 * batteries-included fallback, so `<Icon name="search" />` works with zero config.
 *
 * Zero third-party deps: `fetch` + `DOMParser` are native.
 */

import { signal, createContext, inject, type Signal, type Context } from '@weave-framework/runtime';
import { lucideIcons } from './lucide-icons.js';

/**
 * Resolves an icon name to SVG markup — either a complete `<svg>…</svg>` or just the
 * inner geometry (paths/circles), which the registry wraps in the standard Keyline
 * `<svg>`. Returns `undefined` if this source doesn't know the name; may be async.
 */
export type IconSource = (name: string) => string | undefined | Promise<string | undefined>;

export interface IconConfig {
  /** Extra sources, consulted before the built-in set (first hit wins). */
  sources?: IconSource[];
  /** Append the built-in Lucide set as the last source. Default `true`. */
  builtin?: boolean;
  /** Register this instance as the global one backing the bare `<Icon>`. Default `true`. */
  global?: boolean;
}

export interface IconRegistry {
  /** Resolve `name` to a full `<svg>` string, or `undefined` while pending / unknown. Reactive. */
  resolve(name: string): string | undefined;
  /** Imperatively register (or override) an icon by name — inner geometry or full `<svg>`. */
  register(name: string, svg: string): void;
  /** Whether `name` currently resolves. Reactive. */
  has(name: string): boolean;
}

/** Context token: `provide(IconContext, registry)` to override the global within a subtree. */
export const IconContext: Context<IconRegistry | undefined> = createContext<IconRegistry | undefined>(undefined);

let globalIcons: IconRegistry | undefined;

/** Normalize a source's output to a full `<svg>` string (wrapping bare inner geometry). */
function normalize(markup: string): string {
  const svg: string = markup.trim();
  if (svg.slice(0, 4).toLowerCase() === '<svg') return svg;
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    svg +
    '</svg>'
  );
}

/** The built-in Lucide set, as a source (inner geometry → wrapped by `normalize`). */
const builtinSource: IconSource = (name) => lucideIcons[name];

/** A source backed by an in-memory map of `name → svg` (full or inner markup). */
export function inlineIcons(map: Record<string, string>): IconSource {
  return (name) => map[name];
}

/**
 * A source backed by an SVG sprite fetched from `url` once and indexed by element
 * `id` (`<symbol id>` / `<g id>` / `<svg id>`), using the native `DOMParser`.
 */
export function spriteIcons(url: string): IconSource {
  let index: Promise<Record<string, string>> | undefined;
  const load = (): Promise<Record<string, string>> =>
    (index ??= fetch(url)
      .then((r) => r.text())
      .then(parseSprite));
  return async (name) => (await load())[name];
}

function parseSprite(text: string): Record<string, string> {
  const doc: Document = new DOMParser().parseFromString(text, 'image/svg+xml');
  const out: Record<string, string> = {};
  doc.querySelectorAll('[id]').forEach((el) => {
    out[el.id] = el.innerHTML;
  });
  return out;
}

/** Create an icon registry. Prefer {@link configureIcons} unless you want a standalone one. */
export function createIconRegistry(config: IconConfig = {}): IconRegistry {
  const sources: IconSource[] = [...(config.sources ?? [])];
  if (config.builtin !== false) sources.push(builtinSource);

  // Async-loaded results (name → svg, or '' for a cached miss). Reactive: a fill re-renders bindings.
  const cache: Signal<Record<string, string>> = signal<Record<string, string>>({});
  // Imperative registrations win over every source.
  const registered: Record<string, string> = {};
  const loading: Set<string> = new Set<string>();

  function fill(name: string, svg: string): void {
    cache.set({ ...cache(), [name]: svg });
  }

  function ensureAsync(name: string): void {
    if (loading.has(name)) return;
    loading.add(name);
    void (async () => {
      for (const src of sources) {
        const r: string | undefined = await src(name);
        if (r != null) return fill(name, normalize(r));
      }
      fill(name, ''); // negative cache — don't retry a known miss
    })();
  }

  function resolve(name: string): string | undefined {
    if (registered[name] !== undefined) return registered[name];
    const cached: string | undefined = cache()[name]; // tracked — async fills re-render
    if (cached !== undefined) return cached || undefined;
    // Fast path: return the first sync source hit without touching the signal.
    for (const src of sources) {
      const r: string | undefined | Promise<string | undefined> = src(name);
      if (typeof r === 'string') return normalize(r);
      if (r != null && typeof (r as PromiseLike<unknown>).then === 'function') {
        ensureAsync(name); // an async source owns this name — load it, then re-render
        return undefined;
      }
    }
    return undefined; // unknown across all sync sources
  }

  return {
    resolve,
    register: (name, svg) => {
      registered[name] = normalize(svg);
    },
    has: (name) => resolve(name) !== undefined,
  };
}

/**
 * Configure icons for the app. Returns the registry; by default it becomes the
 * global one backing every bare `<Icon>`. Pass `global: false` for a standalone
 * registry you wire up via {@link IconContext}.
 */
export function configureIcons(config: IconConfig = {}): IconRegistry {
  const registry: IconRegistry = createIconRegistry(config);
  if (config.global !== false) globalIcons = registry;
  return registry;
}

/**
 * The active registry: a context-provided one wins, else the global, else a lazily
 * created built-in-only default (so `<Icon>` works with zero configuration).
 */
export function activeIcons(): IconRegistry {
  const ctx: IconRegistry | undefined = inject(IconContext);
  return ctx ?? globalIcons ?? (globalIcons = createIconRegistry());
}
