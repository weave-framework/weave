// @ts-check
/**
 * Weave — components, lifecycle, and context.
 *
 * A component is just a function that returns DOM (from `html```). There is no
 * base class, no decorators, no forwardRef, no memo — fine-grained reactivity
 * means re-renders never happen, so there is nothing to memoize. This is the
 * "loved core, minimal ceremony" the analysis asked for.
 */

import { onCleanup } from './reactive.js';

/** Stack of context providers active during synchronous component construction. */
const contextStack = [];

/**
 * Run after the component is mounted to the document. Return a function (or call
 * `onCleanup`) to tear down. Runs on the next microtask, after the DOM is live.
 * @param {() => (void | (() => void))} fn
 */
export function onMount(fn) {
  queueMicrotask(() => {
    const cleanup = fn();
    if (typeof cleanup === 'function') onCleanup(cleanup);
  });
}

/**
 * Create a context token with a default value.
 * @template T
 * @param {T} [defaultValue]
 * @returns {{ provide(value:T, fn:()=>any):any, use():T }}
 */
export function createContext(defaultValue) {
  const token = {
    /** @param {any} value @param {() => any} fn */
    provide(value, fn) {
      contextStack.push([token, value]);
      try {
        return fn();
      } finally {
        contextStack.pop();
      }
    },
    use() {
      for (let i = contextStack.length - 1; i >= 0; i--) {
        if (contextStack[i][0] === token) return contextStack[i][1];
      }
      return defaultValue;
    },
  };
  return token;
}

/**
 * Optional helper to declare a component with typed props. Purely ergonomic —
 * `const Foo = (props) => html`...`` works just as well.
 * @template P
 * @param {(props: P) => any} render
 * @returns {(props?: P) => any}
 */
export function component(render) {
  return (props) => render(props || /** @type {any} */ ({}));
}
