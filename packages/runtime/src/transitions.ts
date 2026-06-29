/**
 * Built-in transitions (tree-shakeable — import only what you use). Each is a
 * {@link TransitionFn}: given the node + params it returns a {@link TransitionConfig}
 * the runtime `transition` directive drives. Use via `transition:fade` / `in:fly` /
 * `out:slide` (the function must be exposed from the component's `setup`).
 */

import type { TransitionFn } from './dom.js';

interface BaseParams {
  delay?: number;
  duration?: number;
  easing?: (t: number) => number;
}

/** Fade opacity in/out. */
export const fade: TransitionFn<BaseParams | void> = (_node, params) => {
  const p: BaseParams = params || {};
  return { delay: p.delay, duration: p.duration ?? 300, easing: p.easing, css: (t) => `opacity: ${t}` };
};

/** Fly in/out from an (x, y) offset while fading. */
export const fly: TransitionFn<(BaseParams & { x?: number; y?: number }) | void> = (_node, params) => {
  const p: BaseParams & { x?: number; y?: number } = params || {};
  const x: number = p.x ?? 0;
  const y: number = p.y ?? 0;
  return {
    delay: p.delay,
    duration: p.duration ?? 300,
    easing: p.easing,
    css: (t, u) => `opacity: ${t}; transform: translate(${u * x}px, ${u * y}px)`,
  };
};

/** Scale in/out from `start` (default 0) while fading. */
export const scale: TransitionFn<(BaseParams & { start?: number }) | void> = (_node, params) => {
  const p: BaseParams & { start?: number } = params || {};
  const start: number = p.start ?? 0;
  return {
    delay: p.delay,
    duration: p.duration ?? 300,
    easing: p.easing,
    css: (t) => `opacity: ${t}; transform: scale(${start + (1 - start) * t})`,
  };
};

/** Slide the element's height (collapse/expand) while fading. */
export const slide: TransitionFn<BaseParams | void> = (node, params) => {
  const p: BaseParams = params || {};
  const height: number = (node as HTMLElement).offsetHeight;
  return {
    delay: p.delay,
    duration: p.duration ?? 300,
    easing: p.easing,
    css: (t) => `overflow: hidden; height: ${t * height}px`,
  };
};
