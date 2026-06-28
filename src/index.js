// @ts-check
/**
 * Weave 🧵 — a fine-grained reactive UI framework.
 * Small, fast, no Virtual DOM, no build step required, TypeScript-first.
 *
 * Five concepts, total: signal, computed, effect, html, component.
 * Everything else (router, store, lifecycle) is built on those.
 */

export { signal, computed, effect, batch, untrack, onCleanup } from './reactive.js';
export { html, when, each, mount } from './dom.js';
export { component, onMount, createContext } from './components.js';
export { store } from './store.js';
export { router, link, navigate, currentPath } from './router.js';
