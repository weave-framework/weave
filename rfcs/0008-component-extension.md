# RFC 0008: Component extension (`extendComponent`)

- **Status:** ✅ Accepted — 2026-07-06. Decided directly (maintainer, per GOVERNANCE — no
  community to gauge yet; the RFC is the decision record). Resolved: **Variant A** (loader
  follows the base import); **one template mode per extension — `#1` full override *xor* `#3`
  patches, never mixed** (mixing is unmanageable and ambiguous); **override + add are always
  available together** within the chosen mode; **chained extension allowed** (test-pinned);
  **name = `extendComponent`**. Remaining unresolved questions are refinements, not blockers.
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** captured from a design session; decided directly. Records the direction; the
  built API may refine details (maintainer owns the final shape).

## Summary

A first-class way to **take an existing component and extend it** — reuse all of its
functionality (its `setup` state, its behaviour, its template) and then *add to* or *override*
parts of it, **without forking or copying the base**. The primitive is `extendComponent(Base,
overrides)`. Crucially it works on **both sides of a Weave component at once**: the TypeScript
`setup` (runtime) **and** the HTML template (build time). This is distinct from RFC 0002
(registry-style extension points, e.g. Table `columnTypes`): that plugs a *value* into a slot a
component deliberately exposes; this **subclasses the whole component**.

## Motivation

Today the only way to reuse a Weave component and change it is composition-from-outside: you
write a new component that wraps it. That cannot reach *into* the component — you cannot change
how its data is shaped, add an event to a specific element in its template, or drop a piece of
UI into its markup, without re-authoring the whole thing.

Concrete case (from the design session): a developer uses `<List>`. It does almost everything
they need, but:

- they need to **reshape the data** it renders (its `items` come in via a signal, but their app's
  data has a different structure), **and/or**
- they need to **add an event** — say a double-click on a row — that the base doesn't expose,
  **and/or**
- they need to **inject a small piece of markup** — a count header above the rows.

Each of those touches **both** the TS `setup` (a new derived value, a new handler) **and** the
HTML template (a new binding, new markup). Copying the whole `List` to add two lines is the pain
this RFC removes. The value: a developer reuses 100% of a component and adds the missing 5% as a
small, typed, testable unit — and never forks the base.

## How it fits Weave

- **Zero runtime dependencies.** `extendComponent` is a plain in-house function; the template
  side reuses the existing compiler (`parseTemplate` → transform → `compileTemplate`). No new
  machinery beyond a template-patch API. (RULE #1.)
- **One reactive model.** The extended `setup` composes the base `setup`'s returned context —
  the base's signals/getters are reused as-is; overrides and additions are ordinary signals in
  the same graph. No parallel reactivity.
- **Compose, don't duplicate.** The whole point: reuse the base, don't re-create it. Full-string
  override (`#1`) is the fallback; declarative patches (`#3`) are the intended path precisely
  because they avoid copying.
- **Fail-loud.** A template patch whose selector matches no element is a build error, not a
  silent no-op. Extending a base with no resolvable template (a compiled-only third party) fails
  loud with a clear message.
- **Accessible-by-construction.** Extension reuses the base's template and ARIA contract; the
  developer adds to it rather than bypassing it, so the base's accessibility survives by default.

## Design

### The signature

```ts
extendComponent(Base, {
  props?:    (props) => props,               // A — transform props BEFORE the base setup runs
  setup?:    (props, base) => Partial<Ctx>,  // B — receive the base context; override / add keys
  template?: string                          // #1 — a full replacement template
           | ((t: TemplatePatcher) => void), // #3 — declarative patches against the base template
}): Component
```

All three keys are optional; you use only what you need.

### Build + runtime — a hybrid, recognised by the loader

`extendComponent` is **not a pure runtime call.** A Weave component is two things — a `template`
string (compiled to a render function at build time) and a `setup` function (runs at instance
time). Extension therefore splits:

- **`props` / `setup` — runtime.** Wrapping functions that run when the extended component is
  instantiated. `setup(props, base)` receives `base` = the base `setup(effectiveProps)`'s
  returned context object, and returns the keys to override or add. `props(props)` runs *before*
  the base setup, so it can reshape the data the base's own internals read.

- **`template` — build time.** The loader recognises `extendComponent(Base, { template … })`,
  **follows the `Base` import to its source, reads the base `template` string** (chosen design —
  "Variant A", below), applies the override or patches, and compiles the result to the render
  function. The extended component ships as `defineComponent(newRender, wrappedSetup)`.

### Variant A — the loader resolves the base (chosen)

The developer imports the base the normal way and extends it; the loader does the work of
finding the base's template:

```ts
import List from '@weave-framework/ui/list';
const MyList = extendComponent(List, { /* … */ });
```

At build time the loader follows the `List` import to the component source, reads its exported
`template` (every Weave component source exports `template` + `setup`), and uses it as the base
for `#1`/`#3`. No special import form is required of the developer. (Rejected alternative:
requiring `import * as List from '…/list/source'` so the template travels explicitly — clearer
but noisier; see *Alternatives*.)

**Requirement & failure mode.** The base must be a Weave component whose template is resolvable
from source. Extending a compiled-only component with no available `template` supports only a
full-string `#1` template (you supply the markup) — a `#3` patch against it is a loud build
error naming the base.

### `TemplatePatcher` — the declarative patch API (`#3`)

Selectors match against the template **AST** by tag, `class`, or `role` (the attributes already
present on Weave markup). Operations:

```ts
t.attr(sel, name, value)      // add / set an attribute or binding on matched elements
t.removeAttr(sel, name)
t.prepend(sel, html)          // insert as first / last child
t.append(sel, html)
t.before(sel, html)           // insert as previous / next sibling
t.after(sel, html)
t.replace(sel, html)          // swap the matched element(s)
t.remove(sel)
t.wrap(sel, html)             // wrap matched element(s) in new markup
```

`html` is ordinary Weave template text (`{{ … }}`, `@if`, `on:click={{ … }}`, `<Component>`) —
it is parsed and compiled with the merged setup context, so a binding like `{{ totalCount() }}`
resolves to the key the extended `setup` added. A selector matching **zero** elements throws at
build time.

### Worked example — two additions, both sides

Base `<List>` (`packages/ui/src/list/list.ts`) plus: (1) a row double-click event; (2) a total
count header.

```ts
import { computed, extendComponent } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

const MyList = extendComponent(List, {
  setup(props, base) {                                   // runtime
    return {
      ...base,                                            // items, activate, onKeydown, … reused
      totalCount: computed(() => base.items().length),    // (2) new derived
      onRowDblClick: (item) => props.onOpen?.(item.value),// (1) new handler
    };
  },
  template: (t) => {                                      // build time
    t.attr('.weave-list__row', 'on:dblclick', '{{ () => onRowDblClick(item) }}'); // (1)
    t.prepend('[role]', '<div class="my-list__count">{{ totalCount() }} total</div>'); // (2)
  },
});
```

The same result via `#1` (full override) is a copy of the base template with those two edits
inline — simpler mechanically, but it duplicates the base and drifts when the base changes.

### The one honest limit — closure privacy

`setup(props, base)` reaches the base's **returned context** (`base.items`, `base.activate`, …).
It does **not** reach the base's **private closures**: in `List`, `activate` closes over a
private `items`, not over the returned `items`. So overriding the returned `items` key changes
what the *template* renders but **not** what the base's own internal functions compute.

Guidance, documented loudly: to reshape data the base's internals depend on, use **`props`**
(A) — it runs before the base setup, so the base reads your reshaped data through its normal
`props` contract. Use **`setup`** (B) for additions and for overriding template-facing keys. This
is a deliberate boundary, not a bug: it keeps a base component's internals encapsulated.

### Where it lives

- `extendComponent` (+ the `TemplatePatcher` type) in **`@weave-framework/runtime`** — core,
  because "any component" is framework-wide, not UI-only.
- Loader recognition + template composition in **`packages/cli`** (the dev/build loader) reusing
  **`packages/compiler`** (`parseTemplate`, the AST, `compileTemplate`).

## Alternatives considered

- **Do nothing (compose from outside only).** Cannot reach into a component's template or reshape
  its rendered data without re-authoring it — the exact pain here.
- **Registry extension points only (RFC 0002).** Complementary, not a substitute: RFC 0002 plugs
  a value into a slot the component *chose* to expose; this extends a component that exposed
  nothing special. Different problem.
- **Variant B — explicit source import** (`import * as List from '…/list/source'`). No loader
  "magic", the template travels with the value — but it forces a second, unusual import form on
  every extension and diverges from how components are normally imported. Rejected for ergonomics;
  Variant A chosen.
- **Setup-only extension (no template side).** Insufficient: additions that need new bindings or
  markup never reach the HTML, so the feature would only cover overriding existing keys.
- **Class-based inheritance.** Off-model for Weave (no component classes; `setup` is a plain
  function returning a plain object). Function composition is the native shape.

## Drawbacks & risks

- **A build-time construct, not just a function.** The template side means the loader must
  recognise `extendComponent` and follow the base import — real compiler/loader surface to
  maintain, and a public contract under semver once shipped.
- **Closure-privacy surprise.** Developers may expect `setup` overrides to change internal
  behaviour; the boundary must be documented prominently and shown in errors/DevTools.
- **Base-drift with `#1`.** Full-string override duplicates the base template and silently drifts
  when the base changes. `#3` mitigates but a selector can still break if the base restructures
  its markup — a patch that no longer matches must fail loud.
- **Selector coupling.** `#3` patches couple to the base's class/role/tag structure; a base
  refactor can break an extension. Acceptable (same as CSS overrides) but must be visible.
- **Type flow.** Carrying the base context type into `setup(props, base)` for full autocomplete on
  `base.*`, and merging the added keys into the component's props/exports, is non-trivial TS work.

## Unresolved questions

1. **Patch selector power.** Just tag/class/role, or also attribute selectors / nth-of-type /
   descendant combinators? Start minimal (tag/class/role) and grow on demand?
2. **Multiple template modes together.** May an extension use `#1` *and* `#3`? (Leaning: no —
   a full override replaces the base, so patches are meaningless against it; pick one.)
3. **Chained extension.** Can you `extendComponent(MyList, …)` (extend an already-extended
   component)? Should work by construction (it's just another component with a resolvable
   template + setup) — but needs a test to pin it.
4. **Type surface.** How far to push `base`-context typing and added-key inference before it's not
   worth the complexity — full inference vs a typed-but-open first cut.
5. **Slots / snippets.** How do `#3` patches interact with a base that renders `slots` /
   `@snippet`? Can a patch target inside a slot region?
6. **DevTools.** Should `inspectTree()` show an extended component as "MyList (extends List)" so
   the relationship is visible when debugging?
7. **Naming.** `extendComponent` vs `extend` vs `derive` — pick before freeze.
