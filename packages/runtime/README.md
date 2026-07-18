# @weave-framework/runtime

Weave reactive core + DOM runtime. Zero dependencies.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/runtime
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## The reactive core

Three primitives carry everything. Dependencies track themselves — nothing to declare, nothing to invalidate by hand.

```ts
import { signal, computed, effect } from '@weave-framework/runtime';

const count = signal(0);
const double = computed(() => count() * 2);

effect(() => console.log(count(), double())); // logs 0 0

count.set(1);            // logs 1 2
count.set((n) => n + 1); // updater form — logs 2 4
```

A signal is callable to read (and subscribe); `set` takes a value or an updater, `update` takes an updater, and `peek` reads without subscribing. `effect` re-runs only when something it actually read changes, and returns a stop function.

Also exported from the root entry: `batch`, `untrack`, `tick`, `root`, `onMount`, `onCleanup`, `catchError`, the owner API (`createOwner`, `runInOwner`, `disposeOwner`, `getOwner`, `onDispose`), context (`createContext`, `provide`, `inject`), the extras (`linkedSignal`, `debounced`, `watch`, `fromObservable`, `toObservable`), the transitions (`fade`, `fly`, `slide`, `scale`), and the DevTools hooks (`enableDevtools`, `inspect`, `inspectGraph`, `mountDevtoolsPanel`, …).

## Entry points

| Subpath | What's in it |
|---------|--------------|
| `@weave-framework/runtime` | Signals, effects, owners, context, extras, transitions, DevTools. |
| `@weave-framework/runtime/dom` | The DOM runtime compiled templates import (`defineComponent`, the block helpers, `transition`). |
| `@weave-framework/runtime/server` | Headless render — used by `weave build --ssg`. |
| `@weave-framework/runtime/serialize` · `/resume` · `/adopt` · `/graph` · `/document` | The resume machinery behind `ssg: { resume: true }`, and graph internals. |

You write against the root entry; the `dom` entry is what your compiled templates import for you.

📚 **Guides + full API reference:** [Signals](https://weaveframework.dev/learn/signals) · [Reactivity](https://weaveframework.dev/learn/reactivity) · [API reference](https://weaveframework.dev/reference/runtime)

## License

MIT
