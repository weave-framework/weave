# Weave 🧵

**A fine-grained reactive UI framework.** Small, fast, no Virtual DOM, no build step required, TypeScript-first.

Weave is the synthesis of [`framework-analize.docx`](../Downloads/framework-analize.docx) — a deep analysis of what developers love, tolerate, and want to fundamentally change about React, Next.js, Angular, Vue, and Svelte (State of JS / State of React / Stack Overflow 2024–2026). The analysis pointed in one direction; Weave is that direction, built.

```js
import { signal, computed, html, mount } from 'weave';

function Counter() {
  const n = signal(0);
  const parity = computed(() => (n() % 2 === 0 ? 'even' : 'odd'));
  return html`
    <button onclick=${() => n.set((v) => v + 1)}>
      ${n} — it is ${parity}
    </button>`;
}

mount(Counter(), document.body);
```

When `n` changes, **only the number text node and the word `even`/`odd` are touched.** No component re-runs. No Virtual DOM diff. No dependency arrays. No `useMemo`.

---

## Why Weave exists — the analysis, answered

The document's central finding: *every* modern framework is converging on **signals** (fine-grained reactivity), and developers love each framework's core while resenting its newest layer. Weave starts from that conclusion instead of carrying the legacy.

| What the analysis found developers want | Weave's answer |
|---|---|
| **"Everyone converges on signals"** — the #1 theme of 2025–2026 | Signals are *the* primitive. `signal` / `computed` / `effect` are the whole reactivity model. |
| `useEffect` + dependency arrays — React's **#1 complaint (37%)** | `effect()` tracks dependencies **automatically**. There is no dependency array, ever. |
| RxJS forced on Angular users — "Signals should take over the UI layer" | No RxJS, no observables. Just signals. |
| Manual `useMemo` / `useCallback`; React Compiler trying to automate it | Unnecessary by construction — updates are already surgical, so there's nothing to memoize. |
| Virtual DOM overhead; Svelte's ~1.6 kb runtime admired | **No Virtual DOM.** `html``` binds signals straight to real DOM nodes. ~3.6 kb gzipped for the *whole* framework. |
| Boilerplate / ceremony (React), verbosity (Angular) | Five concepts total. No classes, no decorators, no `forwardRef`, no providers-of-providers. |
| Built-in state management wanted (React wishlist) | `store()` — a lazy singleton of signals. Zero extra library. |
| Official routing wanted (React wishlist) | `router()` built in — path params, 404 fallback, client-side `link()`. |
| Single-File-Component ergonomics loved (Vue/Svelte) | Co-locate markup, logic, and styles in one function with `html``` + scoped `<style>`. |
| Server/client boundary as magic strings hated (Next.js `'use client'`) | Boundaries are plain module imports, not stringly-typed directives. (SSR is on the roadmap; see *Scope*.) |
| TypeScript-first **without** Angular's verbosity | Fully typed by inference. `signal<T>` flows everywhere. No decorators. |
| Gentle learning curve (Vue's signature strength) | If you know `let x` and a template literal, you know Weave. |
| Breaking-change fatigue (Next.js); "stabilization, not revolution" | Tiny, dependency-free, no compiler step that can break your build. |

---

## The five concepts

That's the entire mental model. Everything else (router, store, lifecycle) is built from these.

### 1. `signal(value)` — reactive state
```js
const count = signal(0);
count();            // read (and subscribe, if inside an effect/computed)
count.set(5);       // write
count.set(c => c+1) // update from previous
count.peek();       // read without subscribing
```

### 2. `computed(fn)` — cached derived value
```js
const doubled = computed(() => count() * 2);
```
Lazy and glitch-free: recomputes only when a dependency actually changes, and a diamond dependency never recomputes twice for one update.

### 3. `effect(fn)` — automatic side effect
```js
effect(() => {
  document.title = `Count: ${count()}`;
  return () => {/* optional cleanup, runs before re-run and on dispose */};
});
```
No dependency array. It re-runs when — and only when — something it read changes.

### 4. `html\`...\`` — bind signals to real DOM
```js
html`<div class="box ${color}" onclick=${handler}>${count}</div>`
```
- An interpolated **function** is reactive (`count`, or `() => a() + b()`).
- Any other value is set once.
- `on*` → event listener. `.prop=${x}` → DOM property. Otherwise → attribute (booleans toggle presence).
- Control flow: `when(cond, then, else)` and keyed `each(items, render, key)`.

### 5. Components are just functions
```js
const Card = (props) => html`<div class="card">${props.title}</div>`;
html`${Card({ title: 'Hi' })}`
```
No base class, no special return type. Compose by calling.

---

## Batteries included

**Store** — built-in state management, no extra dependency:
```js
import { store, signal, computed } from 'weave';

export const useCart = store(() => {
  const items = signal([]);
  const total = computed(() => items().reduce((s, i) => s + i.price, 0));
  return { items, total, add: (i) => items.set(xs => [...xs, i]) };
});
// anywhere: const cart = useCart();  // same singleton, reactive everywhere
```

**Router** — official, path params + 404:
```js
import { router, link } from 'weave';

html`
  <nav>${link('/', 'Home')} ${link('/user/7', 'User')}</nav>
  <main>${router({
    '/': Home,
    '/user/:id': (p) => html`<h1>User ${p.id}</h1>`,
    '*': NotFound,
  })}</main>`;
```

**Lifecycle** — `onMount`, `onCleanup`, `createContext`.

---

## Run it

No build step. It's ES modules — open the demo directly:

```bash
node test/_server.mjs       # serves on http://localhost:5050
# open http://localhost:5050/examples/index.html
```

The demo ([`examples/index.html`](examples/index.html)) is a counter, a store-backed todo app with a keyed list, and client-side routing — all in one file, zero tooling.

## Test

```bash
npm install   # jsdom, dev-only — the framework itself has zero runtime deps
npm test
```

27 tests cover the reactive core (including glitch-free diamonds, lazy memo propagation, dynamic dependencies, batching, cleanup) and the DOM/router/store layers against a real DOM.

---

## Weave vs. the field

| | React | Angular | Vue | Svelte | **Weave** |
|---|---|---|---|---|---|
| Reactivity | VDOM + hooks | RxJS + signals | signals (refs) | signals (runes) | **signals only** |
| Dependency arrays | yes (`useEffect`) | — | no | no | **no** |
| Virtual DOM | yes | yes | yes | no | **no** |
| Build step required | effectively | yes | yes | yes | **no** |
| Manual memoization | `useMemo`/Compiler | — | rare | no | **never** |
| Built-in router | no | yes | no (official lib) | SvelteKit | **yes** |
| Built-in store | no | services | Pinia (lib) | stores | **yes** |
| Runtime size (gzip) | ~45 kb | large | ~34 kb | ~1.6 kb | **~3.6 kb** |

---

## Scope & honesty

This is **v0.1** — a real, tested framework that proves the thesis, not a 1.0 replacement for an ecosystem built over a decade. The analysis itself warns against "framework jumping," so here's the straight talk:

- **What's real and working:** signals, computed, effects (all glitch-free and tested), the `html``` renderer with fine-grained text/attribute/property/event bindings, `when`/`each` keyed lists, components, lifecycle, context, the store, and the router — verified in a real browser and under 27 automated tests.
- **On the roadmap, not built yet:** SSR / streaming with a clean (non-string) server boundary, an optional compiler for `.weave` single-file components with scoped styles, a devtools time-travel inspector, and a mobile target — these are exactly the gaps the analysis flagged across Svelte/Vue/Next, called out so they aren't oversold.
- **The honest trade-off the document itself makes:** "Smart developers reach different conclusions from the same data." Weave optimizes for *small, fast, signal-native, low-ceremony*. If you need a vast hiring pool and a mature ecosystem **today**, that's still React's win — by design, not by accident.

## License

MIT.
