# RFC 0002: Component extension points (plugins)

- **Status:** Draft — 2026-07-04
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** captured from a design session; not yet gauged. This RFC records the
  *direction and open questions*, not a final API.

## Summary

A second extension model for Weave, alongside "author a component and use it". Today the only
way to extend the library is **composition from the outside** — you write a new component and
place it. This RFC proposes **extension from the inside**: a way for a developer to *plug a
missing piece into an existing component* — a new cell renderer, a new field type, a new
behaviour — without forking or re-authoring that component.

A plugin here is **not** "just another component". A plugin is a **registered extension that a
component calls into during its own work**, at points the component deliberately exposes
("extension points"). The motivating case is the `<Table>`: a developer declares a column
`type: 'timestamp'` or `type: 'icon'`, and a registered plugin supplies how that type renders
(a timestamp formatted per the *application's* datetime settings; an icon chosen from the
cell's value). The same shape should generalise to other components (Input, Select, Form,
Menu, Tree…), so the pattern is framework-wide, not a Table-only trick.

## Motivation

The recurring situation: a developer reaches for `<Table>` (or `<Input>`, or `<Select>`), and
it does **almost** everything they need — but they're missing one piece. Today their options
are poor: fork the component, wrap it in layers, or drop to the raw escape hatch (`col.cell`)
and re-implement the same rendering by hand in every column, in every table, in every app.

Concretely, from the design session:

- **Column types.** A developer wants a `timestamp` column that renders every date using the
  format configured *once* in their application, and an `icon` column that maps a cell value to
  an icon. They don't want to paste a `cell: (row) => …` formatter into every column def. They
  want to say `type: 'timestamp'` and have it *just work* app-wide. Real column types are far
  more involved than these examples (currency, progress, badge, editable, link, per-row dynamic
  rendering) — the mechanism must scale to the hard cases, not just the toy ones.
- **The same itch elsewhere.** Input masks/formatters by type (`phone`, `iban`, `card`);
  Select/Autocomplete option renderers by type; **schema-driven Forms** (a field-type registry
  that maps a field's `type` to a control); Menu/List/Tree item renderers; status→appearance
  maps for Badge/Chip.

The value to developers: a **structured escape hatch**. When they "run out of" what a component
gives them, they add the missing piece as a small, typed, tree-shakable, independently testable
unit — and never fork the component. It also opens the door to a third-party plugin ecosystem
(`@weave-ui-plugins/*`) that extends the library without touching its core.

## How it fits Weave

- **Zero runtime dependencies.** Plugins are plain in-house objects/functions; the registry is a
  small map with fallbacks. No third-party machinery. (RULE #1, [[weave-zero-dependencies]].)
- **One reactive model.** Registries and plugin state are signals; a plugin that contributes
  derived data participates in the same signal graph — no parallel reactivity.
- **Compose, don't duplicate.** Plugin renderers **compose existing components** (`<Icon>`,
  `<Badge>`, `<Checkbox>`), never re-create them ([[weave-ui-rule-one]]).
- **Fail-loud.** An unknown `type` with no registered handler and no explicit `cell` is a loud
  error in dev, not a silent blank cell.
- **Accessible-by-construction.** Extension points hand plugins the context they need to stay
  accessible (the column, the row, the a11y-relevant state); they don't bypass the host
  component's ARIA contract.
- **Two-tier wiring mirrors [[weave-i18n]].** App-wide provider (context) for shared types +
  global config, per-instance prop for local overrides — the same global+context model i18n
  already uses.

## Design

> Sketch, not a frozen API. The point is to fix the *shape* and surface the decisions.

### Two kinds of extension point

**A. Registry-style — "what to render / how to behave" at a point.**
The component picks a developer-supplied handler by key. This is the column-type case, and the
one that generalises furthest. Abstraction: a **named renderer/handler registry with
fallbacks**.

**B. Feature-pipeline — "new behaviour".**
The atkabinamas features discussed separately: `sorting()`, `filtering()`, `pagination()`,
`grouping()`, `column-resize()` that insert into the data/state pipeline, add their own signals
and API. Today these live inside `Table.setup()` as a **monolith** (`packages/ui/src/table/table.ts`);
the goal is to make them addable/removable. See the pipeline sketch in the session notes.

A and B differ: **A changes content/rendering at points; B changes behaviour/data flow.** A good
design gives them **one plugin protocol** that covers both, or two clearly-related ones.

### The one core hook a component needs (Table example)

Today the cell renderer is fixed (`packages/ui/src/table/table.ts`, `cellNodeOf`):

```ts
const cellNodeOf = (row, col) =>
  asNode(col.cell ? col.cell(row) : String(row[col.key] ?? ''));
```

The only change to the base component is to consult the registry between the explicit escape
hatch and the default:

```ts
const cellNodeOf = (row, col) => {
  if (col.cell) return asNode(col.cell(row));           // explicit — always wins
  const t = col.type && registry.get(col.type);          // plugin-supplied type
  if (t) return asNode(t.cell(row[col.key], row, col, ctx));
  return asNode(String(row[col.key] ?? ''));             // default
};
```

Everything else lives in plugins. Making a component "plug-able" is a small, countable set of
such hooks (Table needs ~1 for cell types).

### A plugin's shape (`columnType`)

A type carries **defaults for behaviour**, not just a renderer — `align`, `numeric`, `compare`
(sort as a date/number), and potentially `filter`, `aggregate`, `editor`. Explicit column
fields override the type's defaults.

```ts
const timestamp = columnType({
  name: 'timestamp',
  align: 'end',
  compare: (a, b) => (a as number) - (b as number),      // default sort = chronological
  cell: (value, row, col, ctx) =>
    formatDate(value as number, ctx.dateFormat ?? 'yyyy-MM-dd HH:mm'),
});

const icon = columnType({
  name: 'icon',
  align: 'center',
  cell: (value, row, col, ctx) => {
    const name = col.iconMap?.[value as string] ?? String(value);
    return renderIcon(name);                              // composes <Icon> (RULE #1)
  },
});
```

The column def stays the array-of-objects it is today:

```ts
const cols = [
  { key: 'name' },
  { key: 'createdAt', type: 'timestamp' },
  { key: 'status', type: 'icon', iconMap: { active: 'check', error: 'x' } },
];
```

### Context passed to a handler (must be rich enough for real cases)

Real columns are more complex than the toy examples, so a handler receives the full context:

- `value` (the cell value) **and** the whole `row`, the `column` def, an app `ctx`
  (locale / date format / icon set), and access to the table instance (to read selection /
  expansion state).
- A type may set defaults for `cell`, `header`, `align`, `numeric`, `compare`, and later
  `filter` / `aggregate` / `editor` / `width`.
- **Dynamic type selection** (à la AG Grid `cellRendererSelector`): `type` may be a function of
  the row, not only a fixed string — the same column can render differently per row.

### Wiring — two tiers (like i18n)

- **App-wide provider (context):** register shared types + global config once at the root —
  `provideColumnTypes([timestamp, icon])`, `provideColumnTypeContext({ dateFormat, locale })`.
  This is where "formatted per the *application's* datetime settings" lives.
- **Per-instance prop:** `<Table columnTypes={{ [customType] }} />` — scoped override,
  tree-shakable.

## Alternatives considered

- **Do nothing (keep only `col.cell`).** The escape hatch works but forces per-column,
  per-table, per-app duplication of the same formatter, with no shared behaviour defaults (sort,
  align) and no app-wide config point. Rejected: it's the exact pain this RFC names.
- **"Just write a component."** Composition-from-outside can't reach *into* a column cell or a
  form field slot to change how the host renders a point it owns. Different problem.
- **Per-component bespoke registries only** (a `columnTypes` for Table, an unrelated
  `fieldTypes` for Form, etc.) with no shared abstraction. Simpler per component, but developers
  re-learn each one and third-party plugins can't share machinery. Weigh against one core
  abstraction with thin per-component names.
- **Directive-based (`use:`)** attach-behaviour. Fine for small element enhancements, weak for
  shared cross-cutting state (sort+filter+paginate over one model). Complementary at best.

## Drawbacks & risks

- **A public API contract, maintained forever.** Once plugins exist, the extension-point
  signatures are a stable surface under semver — a real, permanent cost.
- **Surface creep.** Each "plug-able" component adds hooks and a registry; kept undisciplined,
  the library grows a maze of extension points. Needs a deliberate, minimal hook budget per
  component.
- **Type-system cost.** Full autocomplete for type-specific extra fields (`iconMap`,
  `dateFormat`) needs discriminated-union / module-augmentation work that is non-trivial.
- **Debuggability.** Indirection (value → type → registry → renderer) is harder to trace than an
  inline `cell`. DevTools ([[weave-roadmap]] C3) should be able to show which plugin rendered a
  cell.
- **Overlap with Forms v2.** A field-type registry is *the same idea* as schema-driven forms
  (roadmap C4). These must be designed together, not twice.

## Unresolved questions

1. **One protocol or many?** A single core extension-point abstraction with thin per-component
   names (`columnTypes`, `fieldTypes`, `itemTypes`…), or bespoke registries per component?
   (Leaning: one core abstraction + thin names.)
2. **TS typing.** Free `type?: string` (simple, no autocomplete for extra fields) vs a
   discriminated union keyed on `type` (full autocomplete — pick `type:'icon'` and TS
   requires/suggests `iconMap`).
3. **A and B unified?** Do registry-style (A) and feature-pipeline (B) share one registration
   mechanism, or are they two related-but-separate systems?
4. **Core hook budget.** The minimal set of hooks to make each existing component plug-able
   (Table already ~1: `cellNodeOf`). Which components first?
5. **UI chrome plugins?** May a plugin inject UI (a filter toolbar, a bulk-action bar), or only
   cell/behaviour-level extensions?
6. **Can a type customise `header`, not just `cell`** (e.g. a type that adds an icon to the
   header)?
7. **Sequencing.** Standalone track (like SSR / RFC 0001), or folded into Forms v2 (C4) which
   needs the same registry? Likely Phase C+ or its own track.
