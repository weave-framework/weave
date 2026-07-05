# RFC 0004: Nx integration (`@weave-framework/nx`)

- **Status:** ✅ Implemented — 2026-07-05 (`0.2.156`, `@weave-framework/nx`: createNodesV2 inference + build/serve/check executors + application/library/component generators)
- **Author(s):** Aidas Josas (@aidasjosas) — designed this session by the maintainer's agent,
  scoped as a **pre-launch enterprise-adoption** deliverable.
- **Discussion:** decision record + full execution checklist for the "make Weave easy to
  integrate into Nx" work item. Written so a fresh session can implement the package **and**
  update every doc/CI/version touchpoint without re-deriving anything.

> **Execution note for the next session:** this RFC is both the design *and* the task list.
> Work top-to-bottom: (1) build the package per §Implementation, (2) do every item in
> §"Docs & bookkeeping checklist" — that section is exhaustive on purpose. Keep the per-unit
> green-commit cadence (see [[working-style]], [[protect-prior-work]]). Do **not** push or
> publish until the user literally says so (see [[never-push-without-explicit-push]]).

## Summary

Add a new, **purely additive** package `@weave-framework/nx` — an Nx plugin that lets a Weave
app live as a first-class project inside an Nx monorepo. It provides:

- **Inferred targets** (Nx "crystal" `createNodesV2`) — Nx reads a project's `weave.config.ts`
  and auto-creates `build` / `serve` / `check` targets in the project graph, with correct
  cache **inputs** (source + config + templates + styles) and **outputs** (`dist`). No target
  boilerplate in `project.json`.
- **Executors** — `build`, `serve`, `check` that thin-wrap the existing Weave CLI.
- **Generators** — `application`, `library`, `component` for scaffolding.

**No breaking changes.** Nothing in `runtime` / `compiler` / `cli` behavior changes. Apps that
don't use Nx are unaffected. This is a new package that *calls* the existing CLI.

## Motivation

- **Enterprise adoption / incremental adoption.** Nx is the dominant JS monorepo tool; "drops
  into your existing Nx workspace" is a concrete answer to the safe-to-bet-on / incremental
  adoption story (see [[weave-adoption-growth]]) — high-value *before* the wide launch (see
  [[weave-launch-sequencing]]).
- **Cache + affected + graph for free.** Once Weave targets are inferred, teams get Nx caching,
  `nx affected`, and the project graph over Weave apps with zero hand-wiring.

## How it fits Weave

- **[[weave-zero-dependencies]] respected for the framework.** `@weave-framework/nx` depends on
  Nx devkit (`@nx/devkit`) — that is unavoidable and correct for an Nx *plugin* (it's a
  dev-time tool, not a runtime dep, and only pulled in by users who opt into Nx). The core
  runtime/compiler/router stay zero-dep. Call this out explicitly in the package README so the
  zero-dep rule isn't misread as broken.
- **Compose, don't duplicate.** Executors shell out to the existing `weave` CLI; generators
  reuse `create-weave` templates where practical. We do **not** re-implement the build.
- **Fail loud.** Inference throws a clear error if a project has a `weave.config.*` that can't
  be resolved, rather than silently producing no targets.

## Key enabling facts (verified this session)

- The Weave build is an **esbuild plugin** (`packages/cli/src/plugin.ts`) — portable, already
  factored out of the CLI. esbuild (not Vite) aligns with the `@nx/esbuild` ecosystem.
- One declarative config file drives everything: `weave.config.ts` / `.json` via `defineConfig`
  (`packages/cli/src/config.ts`), with `outDir` already configurable per project.
- The CLI already accepts **`--config <file>`** and resolves config relative to `process.cwd()`
  (`packages/cli/src/cli.ts:40`). **⇒ An Nx executor can run the CLI with `cwd` set to the
  project root — NO CLI change is strictly required.**

## Design

### 1. Inferred targets — `createNodesV2`

Glob: `**/weave.config.{ts,js,json}`. For each match, register targets on that project:

| Target  | Command (run with `cwd` = project root)     | Cache | Outputs        |
|---------|----------------------------------------------|-------|----------------|
| `build` | `weave build --config weave.config.ts`       | yes   | `{outDir}`     |
| `serve` | `weave dev --config weave.config.ts`         | no    | —              |
| `check` | `weave check`                                | yes   | —              |

- **Inputs** (for cache correctness): the project's source files, `weave.config.*`, all
  co-located templates (`*.html`, `*.weave`) and styles (`*.css/scss/sass`), and the
  `@weave-framework/*` package versions. Declare via `inputs` + a `weave` named input set.
- **Outputs**: read `outDir` from the resolved config (default `dist`) → declare as the target
  output so Nx caches the artifact. Parse the config at inference time by importing it the same
  way `loadConfig` does, OR (simpler, no esbuild-at-inference) shallow-parse for `outDir` with
  a documented default fallback. Prefer reusing `loadConfig` if it can be imported standalone.
- Plugin options (2nd arg): allow overriding target **names** (`buildTargetName`, etc.) so it
  co-exists with other plugins — standard Nx convention.

### 2. Executors (fallback / explicit wiring)

Thin wrappers for teams that prefer explicit `project.json` targets over inference:

- `build` — spawn `weave build` with `cwd`, `--config`, pass-through `--no-minify`.
- `serve` — spawn `weave dev` (long-running; stream output; respect Nx abort signal).
- `check` — spawn `weave check`.

Each executor sets `cwd` to the project root so `loadConfig(process.cwd())` resolves the right
config. Return `{ success: boolean }`. Keep them ~30 lines each; the CLI does the work.

### 3. Generators

- `application` — scaffold a Weave app project (reuse `create-weave` app template + a Weave
  `weave.config.ts`), register it in the Nx workspace, wire `build`/`serve`/`check` (or rely on
  inference and generate none).
- `library` — a buildable/publishable Weave component library. **This is the one area needing
  the compiler-as-plugin path** (the CLI is app-oriented — root/entry/HTML shell), so a lib
  build uses esbuild + the Weave esbuild plugin directly, or `tsc` for type-only libs. Keep v1
  minimal: a component library that other Weave apps import from source is enough; a fully
  bundled publishable lib can be a follow-up (flag it in the generator output if deferred).
- `component` — generate a component (`.ts` + sibling template/style, or `.weave` SFC) into an
  existing project, honoring the project's `styleLang`.

### 4. CLI changes — NONE required (one optional convenience)

Everything works by setting the child-process `cwd`. **Optional** nicety (do only if it falls
out cleanly): add a `--cwd <dir>` flag to the CLI so executors don't have to rely on
`process.cwd()`. Backward-compatible (defaults to `process.cwd()`). Not a blocker; skip if it
adds risk.

## Package layout

```
packages/nx/
  package.json            # name @weave-framework/nx, deps: @nx/devkit; peer: nx
  src/index.ts
  src/plugin.ts           # createNodesV2
  src/executors/build/{executor.ts,schema.json}
  src/executors/serve/{executor.ts,schema.json}
  src/executors/check/{executor.ts,schema.json}
  src/generators/application/{generator.ts,schema.json,files/}
  src/generators/library/{generator.ts,schema.json,files/}
  src/generators/component/{generator.ts,schema.json,files/}
  executors.json          # Nx executor manifest
  generators.json         # Nx generator manifest
  README.md
  test/…                  # inference + executor unit tests
```

## Testing

- **Inference tests** — given a fixture project with a `weave.config.ts`, `createNodesV2`
  produces the expected `build`/`serve`/`check` targets with correct `outputs` and `inputs`.
- **Executor tests** — assert the correct `weave` command + `cwd` are spawned (mock the child
  process); assert `--config` / `--no-minify` pass-through.
- **Generator tests** — run against an in-memory Nx tree; assert files + project config.
- Per [[definition-of-done]]: each behavior must have a test that fails without the code. Wire
  `packages/nx` into the repo test gate.

## Rollout / sequencing

Additive, so it can land any time in Phase C. Recommended order:
1. Package skeleton + `createNodesV2` inference + tests (the highest-value 80%).
2. Executors + tests.
3. Generators + tests.
4. Docs + all bookkeeping (below).
5. Publish as part of the normal lockstep release (see [[weave-npm-publishing]]).

---

## Docs & bookkeeping checklist (do ALL of these)

> This is the "sutvarkyk viską su dokumentais ir visur kur reikia" part. Nothing here is
> optional except where marked. Tick each as you go and reflect in the commit messages.

### A. Package + versioning
- [ ] Create `packages/nx/` per §"Package layout".
- [ ] Version: join the **lockstep 0.2.x** — set `version` to match the current lockstep and let
      the release bump handle it (see [[weave-versioning]]). Do **not** hand-pick a version.
- [ ] `@weave-framework/*` internal deps in `package.json` pinned the same way sibling packages
      pin them (match `packages/cli/package.json`).
- [ ] Add to the workspace so `pnpm -r` picks it up (pnpm-workspace already globs `packages/*` —
      verify no allowlist needs editing).

### B. CI / publishing
- [ ] Add `@weave-framework/nx` to the **CI publish set** (the same list that got `ui` at 0.2.63
      and got expanded for the `[publish]` flow) — find it in `.github/workflows/*` and/or the
      `publish:packages` script. Without this, the package won't publish (see
      [[weave-npm-publishing]], [[weave-git-setup]]).
- [ ] Confirm the package builds in CI (add to the build/test matrix if packages are listed
      explicitly anywhere).

### C. Docs site (`docs/`)
- [ ] New guide page: **"Nx / monorepo integration"** — logically under the **Enterprise →
      incremental-adoption** section (see [[weave-docs]], [[weave-adoption-growth]]). Cover:
      install (`nx add @weave-framework/nx` / manual), inferred targets, `nx build`/`serve`,
      caching + `affected`, generators, and the "drop into an existing Nx workspace" story.
- [ ] Link it from the Enterprise landing + (short mention) Getting Started.
- [ ] If the docs have an auto-generated **API/reference** section, make sure the new package is
      included or explicitly excluded on purpose (a plugin has no runtime API — a curated guide
      page is the right surface, not generated API docs).
- [ ] Rebuild docs + live-verify the new page renders and links resolve (text tools per
      [[no-screenshots]]).

### D. Repo-root docs
- [ ] `ROADMAP.md` — add the item (e.g. **C6: Nx integration** or a Tier-2 line), marked as a
      pre-launch enterprise deliverable; update its checkbox as it lands (see [[weave-roadmap]]).
- [ ] `README.md` (root) — packages table: bump the published-package count and add a row for
      `@weave-framework/nx` with a one-line description.
- [ ] `HANDOFF.md` — record status + next steps.
- [ ] `RELEASE-NOTES.md` — add the feature line so the GitHub Release notes pick it up on the
      next `[publish]` (see [[weave-npm-publishing]]).
- [ ] Mark this RFC's status line and the `rfcs/README.md` index once implemented.

### E. create-weave (optional but nice)
- [ ] Consider a mention or an `--nx` hint so `npm create weave` users in an Nx workspace are
      pointed at the plugin. Low priority; skip if it complicates the scaffolder.

### F. Auto-memory (end of session, via /wrap-up)
- [ ] New memory file `weave-nx-integration.md` (type: project) — what shipped, package name,
      the "CLI needs no change / executor sets cwd" fact, and the docs touchpoints. Add the
      one-line pointer to `MEMORY.md`.
- [ ] Update [[weave-versioning]] (package count / lockstep), [[weave-roadmap]] (C6 done),
      [[weave-docs]] (new guide), and [[weave-npm-publishing]] (new package in publish set).

### G. Final verification (per [[verify-before-proceeding]], [[protect-prior-work]])
- [ ] All package tests green; repo test gate green.
- [ ] Docs build green + new page verified live.
- [ ] Per-unit green commits throughout; nothing committed red.
- [ ] **Do NOT push and do NOT publish** until the user explicitly says "push" / "publish"
      (see [[never-push-without-explicit-push]]).

## Open questions (resolve during implementation, don't block)

1. **Buildable/publishable libraries** — v1 can ship "library = imported from source"; a fully
   bundled publishable Weave lib (compiler-as-plugin + esbuild directly) can be a fast-follow.
   Decide based on effort once the inference + executors are in.
2. **`outDir` at inference time** — reuse `loadConfig` (needs esbuild to compile `.ts` config)
   vs. a cheap shallow read with a `dist` default. Prefer reuse if `loadConfig` imports cleanly
   into the plugin; otherwise the shallow read is an acceptable v1.
3. **Optional `--cwd` CLI flag** — add only if trivial; not required.
