/**
 * `<Icon>` — renders an inline SVG from the active icon registry (or a directly
 * supplied `svg` / `src`). Keyline: 18px, 1.4 hairline stroke, `currentColor` (so an
 * icon takes its parent's text color). Lean DOM — a single host `<span>` whose
 * innerHTML is the SVG (Weave has no `{@html}`, so we set it via a ref + effect).
 *
 * Accessibility: pass `label` for a meaningful icon (`role="img"` + `aria-label`);
 * with no label the icon is decorative (`aria-hidden`), the WAI-ARIA default.
 *
 * Reactive: changing `name` (or the registry's async cache) re-renders in place.
 *
 *   import Icon, { configureIcons } from '@weave-framework/ui/icon';
 *   <Icon name={{ 'search' }} />
 *   <Icon name={{ 'trash-2' }} label={{ 'Delete' }} />
 */

import { signal, effect, type Signal } from '@weave-framework/runtime';
import { activeIcons, type IconRegistry } from './icons.js';

// Re-export the registry surface so `@weave-framework/ui/icon` is the one import.
export {
  configureIcons,
  createIconRegistry,
  activeIcons,
  inlineIcons,
  spriteIcons,
  IconContext,
} from './icons.js';
export type { IconRegistry, IconConfig, IconSource } from './icons.js';

export interface IconProps {
  /** Name to look up in the active registry (built-in Lucide set by default). */
  name?: string;
  /** A complete `<svg>…</svg>` string to render directly (bypasses the registry). */
  svg?: string;
  /** URL of a standalone SVG file to fetch and render (bypasses the registry). */
  src?: string;
  /** Accessible label. Present → `role="img"`; absent → decorative (`aria-hidden`). */
  label?: string;
}

export const template: string = `<span class="weave-icon" ref={{ host }}></span>`;

export function setup(props: IconProps): { host: Signal<Element | null> } {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const registry: IconRegistry = activeIcons();

  // Render the SVG + apply a11y. Re-runs when `host`, `name`, `svg`, or the
  // registry's async cache changes.
  effect(() => {
    const el: HTMLElement | null = host() as HTMLElement | null;
    if (!el) return;
    if (!props.src) {
      const markup: string | undefined =
        props.svg ?? (props.name ? registry.resolve(props.name) : undefined);
      el.innerHTML = markup ?? '';
    }
    if (props.label) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', props.label);
      el.removeAttribute('aria-hidden');
    } else {
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
  });

  // `src`: fetch a standalone SVG file, reactively (a new src cancels the last).
  effect(() => {
    const url: string | undefined = props.src;
    const el: HTMLElement | null = host() as HTMLElement | null;
    if (!url || !el) return;
    let alive: boolean = true;
    void fetch(url)
      .then((r) => r.text())
      .then((txt) => {
        if (alive) el.innerHTML = txt;
      });
    return () => {
      alive = false;
    };
  });

  return { host };
}
