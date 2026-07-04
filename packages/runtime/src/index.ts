/**
 * @weave-framework/runtime — the reactive core. Zero dependencies.
 * The DOM helpers live in the `./dom` entry point (added in M1).
 */
export {
  signal,
  computed,
  effect,
  batch,
  untrack,
  tick,
  onCleanup,
  onMount,
  catchError,
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

export {
  enableDevtools,
  isDevtoolsEnabled,
  inspect,
  inspectGraph,
  devNodeCount,
  onDevtoolsChange,
  inspectTrace,
  traceFor,
  clearTrace,
  setTraceLimit,
  type DevKind,
  type DevNode,
  type DevSnapshot,
  type DevEdge,
  type DevTrigger,
} from './devtools.js';

export { mountDevtoolsPanel, type DevtoolsPanelOptions } from './devtools-panel.js';

export { linkedSignal, debounced, watch } from './extras.js';

export { fade, fly, slide, scale } from './transitions.js';
export type { TransitionFn, TransitionConfig } from './dom.js';
