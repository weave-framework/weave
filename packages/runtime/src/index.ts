/**
 * @weave/runtime — the reactive core. Zero dependencies.
 * The DOM helpers live in the `./dom` entry point (added in M1).
 */
export {
  signal,
  computed,
  effect,
  batch,
  untrack,
  onCleanup,
  createOwner,
  runInOwner,
  disposeOwner,
  onDispose,
  getOwner,
  root,
  type Signal,
  type Computed,
  type Owner,
} from './reactive.js';

export { createContext, provide, inject, type Context } from './context.js';
