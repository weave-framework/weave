/**
 * Bidi — the reactive text direction for the CDK, signal-native and zero-dep. One
 * global `direction()` signal (seeded from `<html dir>`) backs everything; a subtree
 * can override it via `DirectionContext`. The connected-positioning engine and any
 * direction-aware component read `activeDirection()` so a change (or a provided
 * subtree direction) re-runs their effects with no reload — mirrors the global +
 * context shape of `@weave-framework/i18n` and the icon registry.
 */

import { signal, createContext, inject, type Signal, type Context } from '@weave-framework/runtime';
import { isBrowser } from './platform.js';

export type Direction = 'ltr' | 'rtl';

function initialDirection(): Direction {
  if (!isBrowser) return 'ltr';
  const dir: string = document.documentElement.dir || getComputedStyle(document.documentElement).direction;
  return dir === 'rtl' ? 'rtl' : 'ltr';
}

const _direction: Signal<Direction> = signal<Direction>(initialDirection());

/** The global text direction. Reactive — read it to subscribe. */
export function direction(): Direction {
  return _direction();
}

/** Set the global text direction; every consumer re-runs. */
export function setDirection(dir: Direction): void {
  _direction.set(dir);
}

/** Context token: `provide(DirectionContext, 'rtl')` to override the direction within a subtree. */
export const DirectionContext: Context<Direction | undefined> = createContext<Direction | undefined>(undefined);

/** The active direction: a context-provided one wins, else the global signal. Reactive. */
export function activeDirection(): Direction {
  return inject(DirectionContext) ?? _direction();
}
