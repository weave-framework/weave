# RFC 0011: `weave migrate` — assisted migration into Weave

- **Status:** Draft
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** —

## Summary

A CLI command — `weave migrate` — that helps move an existing app (Angular first; React/others later) into a
Weave app. It is run from **inside** the target Weave app. It does two things: it **analyzes** the source app in
depth (a machine builds the map of facts), and it **plans + converts** (reasoning over that map writes a plan
file and converts what it safely can). It is an **assistant, not a magic button**: it automates the boring,
mechanical majority and, wherever a real decision or human judgement is needed, asks **one short question in
plain English** or leaves a clear TODO.

## Non-goals

- 100% automatic conversion. Paradigm gaps (RxJS operator chains → signals, hierarchical DI edge cases) are
  flagged for a human, not guessed.
- Running Angular and Weave in one runtime. The source app is read as a reference; nothing about it is executed.
- Migrating *from* Weave, or between non-Weave frameworks.

## The flow (as the user sees it)

Run from inside the target Weave app:

```
$ weave migrate

Migrate from which framework?
> Angular
  React
  Vue

Path to your Angular app (full path):
> C:\Users\me\projects\my-monorepo

No Angular app right there. I looked inside and found:
  1) C:\Users\me\projects\my-monorepo\apps\shop
  2) C:\Users\me\projects\my-monorepo\apps\admin
Pick one, or type another path:
> 1

Using: ...\apps\shop
Analyzing... done.

Found: 14 components, 6 services, 3 routes, 4 packages.
Plan written to: migration-plan.md

I can convert 11 of 14 automatically. 3 need your help.
Start now? (Y/n)
```

While converting, it acts on its own where it can, and asks only when it must:

```
"user-profile" uses ngx-charts (a chart library).
Weave has no charts built in. What do you want?
  1) Skip it for now, leave a TODO
  2) Keep ngx-charts as is
  3) Pick a replacement later
> 1

Skipped. TODO added in user-profile.
```

```
✓ button        converted
✓ user-card     converted
✓ nav-bar       converted
!  user-profile  needs you (charts) — TODO added
!  search-box    needs you (complex RxJS) — TODO added

Done. 11 converted, 3 need you. See migration-plan.md.
```

### CLI rules (invariant — this is the whole UX)

- **Can do it itself → does it.** No needless questions.
- **A real choice → one short question**, plain English, numbered options.
- **No long explanations.** One line, clear, move on.
- **Can't do it → leaves a TODO** and records it in `migration-plan.md`. Never silently guesses.
- **Absolute path in, deep detection.** Accept a full path; if the source app isn't at that exact path, look
  inside for it (an Nx monorepo root points at `apps/*`), suggest what was found, or ask for a new path.

## How it works (two parts)

### Part 1 — the analyzer MEASURES (facts, a map)

Static analysis over the source tree. It does not judge; it records what is there. The map covers, at minimum:

- **Every file** — what it imports and exports; the **dependency graph** (who depends on whom).
- **Every component** — inputs (`@Input`), outputs (`@Output`), template, what it uses.
- **Every service / method** — what it does, **who calls it**, what it touches; the **call graph**.
- **DI graph** — what is provided where, what injects what (`providedIn`, component providers).
- **Routes, guards, forms.**
- **Every third-party package** — from `package.json` **and** actual imports: which package, **where used**, how
  many sites. (This is first-class — apps lean on third-party packages and each needs a decision.)
- **The connections** between all of the above ("this screen → this service → this package").
- **The branches** — where the code decides "if this / else that", captured so the plan can reason about them.

Angular is detected by its fingerprints: `angular.json`, or a `package.json` with `@angular/core`; in an Nx
workspace, `project.json` under `apps/*`.

### Part 2 — reasoning WRITES the plan (and converts)

Over the map + the code, the reasoning layer produces `migration-plan.md` and drives the conversion:

- For each piece: **what it does** and **how it becomes Weave** (the mapping table below).
- **Easy (auto) vs hard (needs a human)**, and *why*.
- **Risky spots** and the "if this / if not" cases worth a human's eyes.
- **Per third-party package** — one of three, decided honestly (only a short confident list is automatic):
  - **auto** — Weave has a first-party equal we're sure about (`rxjs` → reactivity, `@ngx-translate` → i18n).
    Pre-selected, but you still confirm — nothing is silently rewritten.
  - **try** — no confident mapping, but it might translate. Offered as a checkbox you tick (or don't).
  - **keep** — a pure library with no Weave role (`d3`, `lodash`). Shown for information, never a checkbox —
    you keep using it as-is. (Distinguished by a known-library list + the package's own keywords, with any
    framework-role keyword pulling a package back into **try**.)
  Subpaths collapse to their package root (`rxjs/operators` → one `rxjs` decision). A workspace-internal lib
  reached via a tsconfig path alias is NOT a third-party package — it's your own code, noted as its own
  migration unit. The tool always states plainly that this is assisted, **not a 100% automatic** migration.

This split matches how the project already works: **the tool measures facts; the AI reasons over facts to write
the plan.** Not magic — facts plus judgement.

### Angular → Weave mapping (the conversion knowledge)

| Angular | → Weave |
| --- | --- |
| `*ngIf` / `*ngFor` / `*ngSwitch` | `@if` / `@for` / `@switch` |
| DI service (`providedIn:'root'`) | `store()` (singleton) / `provide`+`inject` (scoped) |
| RxJS (Observable + operators) | signals / `computed` / `resource` / `watch` / `fromObservable` — **hardest** |
| pure pipe | `computed` / helper |
| reactive forms (`FormGroup`) | `@weave-framework/forms` |
| route guard / `CanDeactivate` | `beforeEach` |
| content projection (`ng-content`) | slots |
| `@Input` / `@Output` | props / `on:` |
| structural directive | `@if`/`@for`; attribute directive → `use:` action |
| NgModule | none — module-per-file (standalone components map cleanest) |

## `migration-plan.md` (the written output)

The heart of the tool. Its exact internal shape is the **next open design item** (to be filled in). It is written
BEFORE any conversion, so the user reads it and there are no surprises, and it records every TODO the conversion
leaves behind.

## Honesty / limits

Static analysis sees almost everything, but **not 100%** — some behaviour only appears at runtime (dynamic
dispatch, reflection). Where the tool cannot see, it **says so plainly** ("can't see past here — human, look")
and records it in the plan. It never fills a gap with a silent guess.

## Build plan (small, working slices — each gated + committed)

- **M1 — the command + deep path detection.** `weave migrate` exists, asks the framework (Angular only), takes an
  absolute path, detects Angular at/inside it (Nx `apps/*`), suggests or re-asks. Tested against fixture trees.
  No analysis yet.
- **M2 — the analyzer (facts map).** ✅ DONE. The downward dependency walk, component/service/route/form
  inventory, DI + best-effort call graph, per-method branch shapes, and the third-party-package classification +
  usage map. `weave migrate` prints a coloured summary and writes the whole thing to
  `<unit>/.weave-migrate/facts.json` — raw facts, no conversion. Anything unreadable is recorded, never guessed.
- **M3 — `migration-plan.md` generation** from the facts map (its shape designed first).
- **M4 — convert the mechanical majority** (templates, component skeletons, simple bindings), with the CLI
  choice/TODO flow.
- **M5 — the hard parts assisted** (RxJS→signals suggestions, DI, forms) — surfaced as choices/TODOs, never
  silent guesses.

Later milestones add React and others behind the same `weave migrate` front door.

## Authoring a new source-framework module (React, Vue, …)

Every source framework is ONE module beside `migrate.ts`; the two layers under it are shared, so a new module
writes only what is genuinely framework-specific. The pieces:

| File | Role | Framework-specific? |
| --- | --- | --- |
| `migrate-ui.ts` | Colours (`c`) + interactive input (`inputManager`: `askLine` / `selectMenu` / `multiSelect`). | **No** — reuse as-is. Never print raw `\x1b[..m`; use `c.*` so `NO_COLOR` / `FORCE_COLOR` are honoured. |
| `migrate-analyze.ts` | Pure facts: `findEntryPoint` → `parseImports` → `walkDependencies` → `classifyPackages`. | **Mostly no.** The import walk is language-level (TS/JS), so it's shared. Two knobs are framework-specific: the `ImportKind` that marks the *source framework* (`angular` today — a React module adds `react`, so `react`/`react-dom` are the translation surface, not "third-party"), and the confident `AUTO_MAP` entries (what maps first-party to Weave). |
| `migrate-<fw>.ts` | The front door: detect the framework at/inside a path, resolve the unit, then drive analyze + the package choice. | **Yes** — this is the whole per-framework surface. Mirror `migrate.ts`: detection functions + a `runMigrate`-style flow. |
| `cli.ts` | Registration. | Add the framework to the `SOURCES` list and branch to its module (today only `Angular` proceeds). |

Rules that hold for every module (so migrations feel identical): all output goes through `c`; never guess —
an unseen fact is a recorded `unknown`; the honesty note ("assisted, not a 100% automatic migration") is always
shown; and every new pure function ships a smoke check that is mutation-proven to fail (see
`packages/cli/test/migrate.smoke.mjs`).
