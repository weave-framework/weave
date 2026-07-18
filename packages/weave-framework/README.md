<div align="center">

<img src="https://raw.githubusercontent.com/weave-framework/weave/HEAD/assets/weave-logo.svg" alt="Weave" width="120" height="120" />

# Weave

**A fine‑grained reactive UI framework — signal‑native, tiny, and TypeScript‑first.**

*No Virtual DOM. No dependency arrays. No ceremony. Just the threads you need, woven tight.*

[📚 **Documentation**](https://weaveframework.dev/) · [🚀 Get started](https://weaveframework.dev/learn/quick-start)

</div>

---

## 👋 Welcome

Whether you've just stumbled onto Weave or you've been threading along since the early commits — glad you're here.

Weave is a UI framework built around one idea taken all the way: **the screen is a fabric, and reactivity is the thread.** When a value changes, Weave touches *only* the exact part of the page that depends on it. Nothing re‑renders wholesale. Nothing diffs a shadow copy of your UI. You describe your interface once, and from then on your signals do the talking.

The result feels calm: state that updates exactly where it should, a runtime small enough to forget about, and tooling that treats you like a grown‑up. No mental bookkeeping, no “why did this re‑render,” no incantations to make it fast.

---

## 📦 This package

`weave-framework` installs the framework in one shot — it depends on the core + feature packages:
[`@weave-framework/runtime`](https://www.npmjs.com/package/@weave-framework/runtime),
[`router`](https://www.npmjs.com/package/@weave-framework/router),
[`store`](https://www.npmjs.com/package/@weave-framework/store),
[`forms`](https://www.npmjs.com/package/@weave-framework/forms),
[`i18n`](https://www.npmjs.com/package/@weave-framework/i18n), and
[`data`](https://www.npmjs.com/package/@weave-framework/data). Each is zero‑dependency and
`sideEffects: false`, so anything you don't use is tree‑shaken away.

**Starting a new project? Don't install this by hand — scaffold a ready‑to‑run app:**

```bash
npm create weave@latest my-app
```

---

## 🧵 A first thread

A component is a `setup()` function plus a sibling template. State is signals; the template reads them.

```ts
// counter.ts
import { signal, computed } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const double = computed(() => count() * 2);
  return { count, double, inc: () => count.set((n) => n + 1) };
}
```

```html
<!-- counter.html -->
<button on:click={{ inc }}>{{ count() }} → {{ double() }}</button>
```

Press the button and Weave updates exactly the two text nodes that read those signals — nothing else is touched. No re‑render, no diff, nothing to memoize.

---

## 🪡 What it's woven from

- **Signals all the way down.** Reactivity is one model, and it powers everything — from a single piece of text to the router. There's no second system to learn and no observables to bridge.
- **Dependencies track themselves.** Things update when — and only when — what they depend on actually changes. Nothing to declare by hand, nothing to cache, nothing to forget.
- **No Virtual DOM.** Your interface maps straight onto the page, so updates stay surgical and the runtime that ships stays genuinely small.
- **Batteries included, not bolted on.** Routing, state, forms, translations, and motion are all first‑party and share the same reactive core — so they compose instead of competing.
- **A real IDE citizen.** First‑class VS Code **and** WebStorm support, with the kind of editor experience you'd expect from a mature framework.
- **Honest TypeScript.** Types flow through by inference, your editor understands your UI for free, and there's no decorator boilerplate to wade through. Type‑checking reaches all the way into your templates.

It's one set of trade‑offs — small, fast, signal‑native, low‑ceremony — for people who want exactly that.

---

## 📚 Get started

Installation, your first component, guides, and the complete API reference all live in the documentation:

### → **[Read the documentation](https://weaveframework.dev/)**

---

## 🛡️ Built to be trusted

Weave is *small, fast, signal‑native, and low‑ceremony* — and built to hold up in serious codebases, not just demos. Its sharpest edge is the one large teams worry about most: **zero third‑party runtime dependencies.** No transitive packages, no audit scramble — a supply‑chain attack surface that's effectively nil. Pair that with performance that stays flat as the UI grows, first‑party routing, state, forms, and i18n that share one reactive core, and type‑checking that reaches all the way into your templates, and you get a framework that scales *with* a team, not against it.

We won't oversell the young parts: static generation and resume are new, request‑time SSR is deliberately not built, and the ecosystem is still growing. But the foundation is real and tested today — and it's aimed squarely at the work real applications demand.

## License

MIT — woven with care. 🧵
