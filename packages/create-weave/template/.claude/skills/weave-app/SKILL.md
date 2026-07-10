---
name: weave-app
description: >-
  Build or structure an application with the Weave framework (@weave-framework/*).
  Use this whenever you are working in a Weave project — scaffolding a new app,
  laying out folders, wiring the bootstrap/config, deciding architecture, or you
  see `weave.config.ts`, `.weave` files, or a `.ts` component beside a sibling
  `.html`. This is the ENTRY skill: it explains how a Weave app fits together and
  routes you to the focused per-subsystem skills (component, reactivity, templates,
  router, forms, store, i18n, data, ui, tooling). Reach for it before answering
  any "how do I … in Weave" question, even if the user doesn't name the subsystem.
---

# Building Weave apps

Weave is a **signal-native, compiled, zero-dependency, no-VDOM** front-end framework.
No third-party runtime deps; templates compile to fine-grained DOM updates driven by
signals. There is no re-render — a signal change patches exactly the DOM it touches.

**Golden rules that hold everywhere:**
- A component is a `setup()` function + a template. **No class, no `this`, no lifecycle methods.**
- State is **signals** (local `const`), not fields. `sig()` reads (and subscribes), `sig.set()` writes.
- Reactivity is fine-grained and lazy. You never memoize or guard against re-renders — there are none.
- Everything is TypeScript-first and type-checked against the template (`weave check`).
- **Zero dependencies** is a hard rule — never add a third-party library to solve something; build it in-house or use native platform APIs.

## App anatomy

```
my-app/
├── weave.config.ts        # the ONLY bootstrap — no main.ts
├── src/
│   ├── index.html         # HTML shell; Weave injects the script + styles
│   └── app/
│       ├── app.ts         # root component setup()
│       ├── app.html       # root component template (sibling, same base name)
│       └── app.css        # optional scoped styles (sibling)
```

`weave.config.ts` owns bootstrap — there is no hand-written mount:

```ts
import { defineConfig } from '@weave-framework/cli';
export default defineConfig({
  root: 'src/app/app',      // root component — Weave generates the bootstrap
  index: 'src/index.html',
  outDir: 'dist',
  dev: { port: 5173 },      // dev: { proxy: { '/api': 'http://localhost:8080' } } to proxy a backend
});
```

**A `.ts` file becomes a component the moment a sibling `.html` sits next to it** (or it declares a `template`). No registration, no decorator. A component may also ship as a single `.weave` file (`<script>`/template/`<style>` in one file).

**Scaffold a new app:** `npm create weave@latest <dir>`. For Nx / mixed workspaces and the editor setup, see the **weave-tooling** skill.

## Which skill to use

Weave is split into focused skills — load the one that matches what you're doing. Don't guess an API; open the relevant skill.

| You're working on… | Skill |
| --- | --- |
| A component: `setup()`, props, `propDefaults`, template/styles pairing, lifecycle (`onMount`), context/DI (`provide`/`inject`) | **weave-component** |
| Signals: `signal`/`computed`/`effect`/`batch`/`untrack`, derived state, side effects, `watch`/`debounced` | **weave-reactivity** |
| Template markup: `{{ }}`, `@if`/`@for`/`@switch`/`@await`/`@defer`, `on:`/`use:`/`bind:`/`class:`/`style:`/`ref`, snippets/`@render`/`@key` | **weave-templates** |
| Routing: routes, `<RouterView>`, `<Link>`, params, guards, lazy routes | **weave-router** |
| Forms: `field`/`form`/`validators`, `use:control`, sync + async validation, submit | **weave-forms** |
| Shared/global state beyond one component | **weave-store** |
| Translations: `t()` in template + `.ts`, ICU, number/date formatters | **weave-i18n** |
| Fetching / async resources, loading + error states | **weave-data** |
| Using `@weave-framework/ui` components (Button, Input, Dialog, Table…) or authoring a new UI component | **weave-ui** |
| CLI (`weave dev/build/check`), config, Nx, testing, editor tooling | **weave-tooling** |

## Typical build order for a non-trivial app

1. **Scaffold** (`npm create weave`) → confirm `weave dev` runs (weave-tooling).
2. **Routing shell** — a layout root + routes (weave-router).
3. **UI foundation** — pull in `@weave-framework/ui` + tokens/theme (weave-ui).
4. **Domain state** — signals per component; a **store** for cross-cutting state; **context** for subtree-scoped services (weave-reactivity, weave-store, weave-component).
5. **Screens** — components (weave-component) with templates (weave-templates), forms (weave-forms), data (weave-data), i18n (weave-i18n).
6. **Gate every change** with `weave check` (types flow through the template) before moving on (weave-tooling).

Keep each screen a thin component: state + handlers in `setup()`, structure in the template, shared behaviour lifted to a store/context or a composable function that returns signals.
