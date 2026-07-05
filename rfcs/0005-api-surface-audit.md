# RFC 0005: Public API surface audit (freeze prep)

- **Status:** In progress — 2026-07-05 (the `runtime/dom` split is **done** via option 1; `VERSIONING.md` + 1.0 bump remain)
- **Author(s):** Aidas Josas (@aidasjosas) — audit produced by the maintainer's agent as the
  pre-1.0 **API-freeze** groundwork ([[weave-launch-sequencing]]).
- **Discussion:** a findings + checklist doc. The public/internal *decisions* are the
  maintainer's; this RFC records the surface and the one structural issue to resolve before
  the freeze is meaningful.

## Summary

Before Weave promises API stability at 1.0, its **public surface** must be deliberate: every
exported symbol is either a supported public API (semver-protected) or clearly internal. Today
the surface is **173 exports across 8 packages** (per the docs `api.gen`). Most are clean and
documented. The one real problem: **`@weave-framework/runtime/dom` mixes user-facing API with
compiler-emitted runtime helpers** — they must stay exported (generated code imports them) but
must not be part of the frozen, documented public API.

## Per-package surface (2026-07-05)

| Entry | Exports | Assessment |
|-------|---------|------------|
| `runtime` (index) | ~35 re-exports | Signals/effects/owner/context + devtools + `linkedSignal`/`watch` — public, coherent. |
| **`runtime/dom`** | **51** | **⚠ mixed** — user API (`mount`, `mountComponent`, `lazy`, `Portal`/`Teleport`, `Dynamic`, `KeepAlive`, `transition`, `Action`/`ActionResult`) **+ ~24 compiler-emitted helpers** (`bindText`, `bindAttr`, `bindProp`, `bindClass`, `bindStyleProp`, `bindShow`, `bindValue`, `listen`, `setRef`, `applyAction`, `mountChild`, `dynElement`, `insert`, `placeBefore`, `removeWithOutro`, `ifBlock`, `eachBlock`, `awaitBlock`, `keyedBlock`, `slot`, …). |
| `router` | 30 | Public + coherent (router v2 just landed, RFC 0003). |
| `forms` | 17 | Public + coherent. |
| `data` | 19 | Public + coherent. |
| `i18n` | 12 | Public + coherent. |
| `store` | 1 | `store`. Fine. |
| `check` / `cli` / `compiler` | build-time | Tooling entries; `compiler` exposes `compileTemplate` etc. for the toolchain. |

## The one structural finding

**`runtime/dom` conflates two audiences.** The ~24 `bindX` / `*Block` / `mountChild` /
`dynElement` helpers exist **for the compiler's generated output** (referenced via `gen.H(...)`
in `codegen.ts`), not for application authors. They can't simply be un-exported — the emitted
code imports them from `@weave-framework/runtime/dom` — but at 1.0 they should not be:

- listed in the generated **API reference** (they read as "public API"), or
- covered by the **semver stability promise** the way `mount`/`lazy`/`Portal` are.

### Recommended fix (pick one, before freeze)

1. **`@internal` JSDoc tag** on each compiler-emitted helper + teach `docs/tools/gen-api.mjs`
   to skip `@internal` exports. Lowest-risk: nothing moves, the emitted `import` still resolves,
   the docs + the "public" surface shrink to the intended set. **Recommended.**
2. **A dedicated entry** — move them to `@weave-framework/runtime/internal` (or `/jsx-runtime`
   style) and point codegen's helper import there. Cleaner separation, but a codegen change and
   a new export map entry; more churn right before freeze.

Either way, the *documented, frozen* `runtime/dom` becomes: `mount`, `mountComponent`,
`defineComponent`, `lazy`, `Portal`, `Teleport`, `Dynamic`, `KeepAlive`, `transition` +
`Component` / `Action` / `ActionResult` / `TransitionFn` / `TransitionConfig` types. That's the
public contract to stabilise.

## Freeze checklist (the actual 1.0 gate)

- [x] **Resolve the `runtime/dom` split** — done via **option 1**: the 29 compiler-emitted helpers + the internal
  `Row` type are `@internal`-tagged in `dom.ts`, and `docs/tools/gen-api.mjs` skips `@internal` exports. The documented
  `runtime/dom` surface dropped **51 → 21** (public: `mount`/`mountComponent`/`defineComponent`/`lazy`/`Portal`/
  `Teleport`/`Dynamic`/`KeepAlive`/`transition`/`ErrorBoundary`/`defineCustomElement` + types). Emitted code still
  imports the helpers (they stay exported); typecheck + 1062 tests + docs build green.
- [x] Skim the other 7 entries for any accidental export — confirmed: after the `runtime/dom` split the documented surface is **151 exports** (runtime 51 · runtime-dom 21 · router 30 · forms 17 · data 17 · i18n 13 · forms-dom 1 · store 1); all intentional public API, no strays.
- [x] Confirm every *public* export has a doc comment — filled the last **13 gaps** (Router/RouteParams, Field/GroupOptions, I18n/I18nConfig, resource + Client/ClientOptions/RequestOptions/ResourceOptions, DevKind/DevtoolsPanelOptions). api-gen now reports **0** undocumented public exports.
- [x] Finalise `VERSIONING.md`: the stability promise applies to the audited public surface; breaking = deprecate-first, major-only. (Covers documented exports + props + template syntax + UI token/ARIA contract; now cross-links this audit and states `@internal` helpers carry no promise.)
- [x] Deprecation policy in place (how a symbol is marked deprecated and for how long) — deprecate-first, warnings to the replacement, kept until at least the next major (`VERSIONING.md` → "When a breaking change is genuinely needed").
- [ ] Bump to **1.0.0** + CHANGELOG / RELEASE-NOTES entry; then launch ([[weave-launch-sequencing]]).

## Alternatives considered

- **Freeze the whole surface as-is.** Rejected: it would promise stability on ~24 helpers whose
  signatures are an implementation detail of the compiler and should stay free to change.
- **Un-export the helpers.** Not possible — generated code imports them by name.

## Unresolved questions

1. Option 1 (`@internal`) vs option 2 (separate entry) — maintainer's call; option 1 recommended for lowest freeze-time risk.
2. Do any `runtime` (index) re-exports (e.g. `linkedSignal`, `debounced`, `watch`, `root`) warrant an "advanced" grouping in docs, or stay flat?
3. Should `compiler`'s public exports (`compileTemplate`) carry a stability promise, or be documented as toolchain-internal?
