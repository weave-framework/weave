# Weave — changelog

> **Versioning discipline.** The version is **semver, decided by the change** — see
> [VERSIONING.md](VERSIONING.md), which is the public promise: PATCH for a compatible fix, MINOR for new
> compatible surface, MAJOR for a break. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The VS Code extension
> (`editor/vscode`) is versioned independently. **This version is exactly what is published to npm.**
> Publishing is a separate, explicit step (the `/publish` skill / `pnpm publish:packages`) — pushing code does
> **not** publish to npm.
>
> *(Corrected 2026-07-17.* This note used to read "every commit bumps the patch version by 1", a pre-1.0
> bookkeeping habit from 2026-07-02. It **contradicted VERSIONING.md** the moment the API was frozen on
> 2026-07-05: a scheme where a bug fix and a new feature both cost +1 patch cannot express semver. Practice had
> already left it behind — Phase E ran 94 commits without a bump, and then released as one MINOR. The public
> promise wins; the habit is retired.)*

## Unreleased

### Fixed — prettier plugin
- **Formatting no longer changes rendered whitespace between inline elements.** A body made only of elements
  took the block layout, which drops whitespace-only text nodes and rejoins children with a newline and
  indent — and HTML collapses that back to a single space. So `<span><b>a</b><b>b</b></span>` ("ab") became
  "a b", and a document that had a space became indistinguishable from one that did not. Elements whose
  children are all inline-level now keep the inline layout, where whitespace is preserved as written. Bodies
  of block-level elements are still reflowed onto their own lines.

### Fixed — weave check
- **`weave check` honours the project's `tsconfig.json`.** It used a hardcoded option set with no `paths`
  and no `baseUrl`, so any app with path aliases — the norm in a real codebase, and universal in one being
  migrated from another framework — got "Cannot find module" on every aliased import. The project config is
  now discovered and parsed, with only the checker's own invariants overlaid (`noEmit`, `skipLibCheck`, and
  a DOM-capable `lib` floor when the project sets none). Everything else — `paths`, `baseUrl`, `strict`,
  `types`, `lib` — belongs to the project, since disagreeing with its tsconfig means disagreeing with the
  editor. A missing or malformed config falls back to the previous defaults rather than failing.

### Added — repository safety
- **A tracked gate keeps private working files out of the public repository.** The public/private split was
  enforced entirely by `.git/info/exclude` and a local `.git/hooks/pre-commit` — git versions and clones
  neither, so the whole boundary rested on one manual restore step being remembered on every machine. One
  miss and `git add .` stages the private working notes into public history, where a push is permanent.
  `verify:no-private` reads the tracked file list in CI and fails if any private path appears. The path
  names themselves reveal nothing, which is what makes the check safe to run in public.

### Fixed — release engineering
- **Publishing is gated on a green suite.** The publish workflow was conditioned only on the `[publish]`
  marker: a marked commit with failing tests shipped to npm — with a provenance attestation — while CI went
  red minutes later in a parallel workflow, and an npm version is permanent. Typecheck, lint and the browser
  suite now run inside the publish job, before anything is uploaded.
- **A partial publish can be resumed.** The failure message promised that "already-published packages will
  be skipped by npm"; they are not — publishing over an existing version fails with E403. So a run that died
  on package 9 of 16 died again on package 1 when re-run, stranding a half-published lockstep release. Each
  package is now checked against the registry first and skipped if present, so a re-run resumes where it
  stopped, and the message says what actually happens.
- **`editor/vscode` is a workspace member again.** It declares `@weave-framework/language-server:
  workspace:*` but was not listed in `pnpm-workspace.yaml`, so a fresh clone could not link it and
  installing from the extension directory rejects `workspace:*` outright. It packaged only because a stale
  `node_modules` survived locally; the hash gate checks the shipped artifact, not that it still builds.

### Fixed — CLI / dev loop
- **A failed rebuild no longer reloads the browser into a white page.** `weave dev` cleared its in-memory
  outputs, repopulated them from a failed build's empty output list, and notified every client anyway — so
  a syntax error reloaded the page into a `/main.js` that no longer existed, and the real error was visible
  only in the terminal. The last good bundle is now kept, and the client is sent the build error instead,
  painted as an overlay over the still-working page. The next successful build swaps the bundle, reloads
  and clears the overlay. Gated by `verify:dev-overlay`, which drives the real dev server through
  break-and-repair.

### Added — CLI
- **Source maps in `weave dev` and `weave build`.** Neither emitted any, so breakpoints and stack traces
  landed in bundled output with no way back to the author's `.ts`/`.html`. Dev emits inline maps (it serves
  from memory); production emits linked `.js.map` files, opt-out via `build.sourcemap: false`.

### Fixed — forms + router
- **`fieldArray.dirty()` sees compensating edits.** It compared the item COUNT against the seeds and asked
  each item whether it differed from its own initial — never the array value against the seed values. So
  `removeAt(0)` followed by `push(...)` read clean, as did a pure reorder: same length, every item pristine
  against the value it was constructed with. `dirty` is the documented unsaved-changes signal and feeds
  router leave-guards, so the prompt was never raised and the edit was lost without warning.
- **A function-valued signal write stores the function.** `Signal.set` treats any function argument as an
  updater `(prev) => next`, so two places that wrote a raw value invoked it instead: `field.reset()` called
  a function-valued initial and stored the result, and a route loader resolving to a function (a component,
  a factory, a formatter) had it called with the previous data. Both now write through `set(() => value)`,
  which `resource.mutate` and the forms submit path already did.

### Fixed — UI
- **Layered modals released out of order no longer strand the page unscrollable.** `blockScroll` snapshotted
  `body.style.overflow` per instance, so opening A then B and closing A FIRST restored the pre-A value while
  B was still open (the page scrolled behind the modal), and closing B then restored `hidden` with nothing
  open — leaving the page permanently unscrollable short of a reload. The lock is now reference-counted:
  captured on the first acquire, restored on the last release, order-independent.
- **A Table column revealed after mount gets a working pointer drag.** The resize grips were attached once in
  `onMount` by a single query, but the header is a keyed `@for` over reactive columns — so a column unhidden
  or appended later produced a grip whose keyboard resize worked (a template binding, re-applied per element)
  while pointer drag silently did not. Columns arriving asynchronously got no drag at all. Attachment now
  re-runs whenever the column set changes, destroying the previous handles first.

### Fixed — router
- **A malformed percent-escape in the URL no longer blanks the app.** `decodeURIComponent` throws
  `URIError` on a lone `%`, and it ran unguarded inside the route-resolution computed — so the throw
  escaped through `matched()`/`params()`, killed the RouterView effect and emptied the page instead of
  falling back to `*`. An undecodable segment is now passed through raw. Any user-controlled URL is an
  input, including one a mis-built link produced.
- **A guard redirect replaces its history entry instead of pushing one.** Visiting a guarded `/admin` that
  redirects to `/login` left both entries in history: Back returned to `/admin`, the guard fired again and
  pushed `/login` a second time, so the user could never navigate back out.
- **A guard-vetoed pop rolls back by the distance actually travelled.** The rollback was hardcoded to one
  entry while a pop can jump any distance (a history dropdown, a long-press back), so vetoing a three-entry
  jump left the URL on an intermediate entry with the previous page still rendered. Relatedly, the current
  history position is now seeded from `history.state` at startup: `pushState` state survives a reload, so
  after a refresh mid-history the position reset to 0 and every direction test was wrong — a Back read as a
  Forward, and a vetoed pop rolled further back instead of returning.

### Fixed — compiler
- **`@for ... track` is keyed by the row, not by a same-named component binding.** The key function is
  `(item, $index) => <track>`, so `track` must resolve against the row parameter — but it was rewritten
  against the PARENT scope. When a `setup` binding shared the loop variable name, the parameter stopped
  shadowing and every row keyed on the same `ctx.<name>`: one constant key for the whole list, so keyed
  reconciliation reused the wrong nodes, state bled between rows and removals collapsed, all silently.
  The inference pass already scoped `track` correctly; this was the codegen half disagreeing with the
  compiler own scope model.

  The trigger is narrower than it looks: the name must ALSO be referenced outside the loop, since a name
  used only as a loop variable never enters the inferred component scope in the first place.

### Fixed — runtime (security)
- **`renderDocument` escapes what it interpolates (stored XSS in SSG output).** The page title, `lang` and
  the client-entry URL were written into the document raw. A title is routinely DERIVED FROM DATA — a
  route-title effect reading a CMS record, a product name, a username — so a title containing a closing
  title tag followed by a script tag was executable markup baked into every statically generated page, and
  it persisted there. The snapshot JSON was already escaped; the document own interpolations were not.
  Title is now HTML-escaped, `lang` and `entry` attribute-escaped. `head` stays raw — injecting markup is
  that option documented purpose, and it takes author markup, not data.

### Fixed — store
- **A store no longer dies with the component that happened to use it first.** `store(factory)` is an
  app-lifetime singleton, but the factory ran synchronously under whatever owner was ambient at the FIRST
  call — the first consuming component. Every `effect`/`watch`/`computed` created inside registered its
  disposer there, so unmounting that one component permanently killed the store's own reactions while every
  other consumer went on holding the same, now half-dead, instance. The failure is silent and depends on
  mount order: the signals keep working, so the store still looks alive. `optimistic()` uses `watch`
  internally, which makes a store-created optimistic exactly this case — its overlay would never clear again.
  The factory now runs in its own `root()`, which is what a global store's lifetime always meant.

  `@weave-framework/store` consequently depends on `@weave-framework/runtime` (for `root`), as
  `forms`/`router`/`data`/`i18n` already do. Still zero third-party dependencies.

### Fixed — prettier plugin
- **Formatting no longer rewrites an explicitly empty attribute into a bare one.** `disabled=""` was printed
  as `disabled`, and the two are not interchangeable: the parser marks a valueless attribute `bare`, and on a
  component tag that becomes the boolean prop `true` while `disabled=""` is the string `""`. One formatting
  pass therefore changed a child component's prop type and value — a formatter silently editing the program,
  which is the one thing a formatter may never do. The printer now branches on the `bare` flag the parser
  actually sets, instead of inferring it from an empty value.

  The package's own "no semantic change" gate compares normalized ASTs before and after formatting and would
  have caught this, but no fixture contained an empty attribute — so the case was never presented to it. A
  fixture now covers both forms, and it fails without the fix.

### Fixed — compiler + runtime
- **A destructured handler parameter no longer kills the handler on resume.** Deciding whether a `setup`
  binding can be rebuilt after resume meant asking which names its body reads that the client will not have.
  That answer was assembled lexically, and a destructuring pattern defeated it: `({ id, label }) => …` was
  reported as reading its own `id`, and `({ a: { b } }) => …` its own `b`. A binding blamed for a name it
  does not read is refused, and a refused handler falls back to a `ctx.<name>` that resume never
  reconstructs — so the control was inert after resume, silently. The analysis now runs on the TypeScript
  AST, where a parameter pattern binds exactly the names it binds and a type annotation references nothing.
  TypeScript is **injected by the CLI, never imported by the compiler** (an optional peer dependency), so the
  compiler keeps its zero-dependency install and nothing new reaches the browser bundles.
- **Listener modifiers no longer change meaning between build targets.** In a resumable build
  (`--ssg` + `ssg.resume`), `once`/`capture`/`passive` were dropped with only a code comment saying so,
  so `on:click|once` fired on EVERY click while the same template on the eager target fired one.
  `once` is now carried through the delegated dispatch (the runtime removes that event's marker after the
  first invoke). `capture` and `passive` cannot be expressed by one delegated listener per event type —
  `capture` needs its own capture-phase listener and `passive` is a property of the listener REGISTRATION,
  which delegation shares — so a component using either now **refuses adoption and client-renders**, where
  the eager path applies them correctly. Silent divergence is gone either way.
- **A server/client DOM mismatch is no longer silent.** When `adoptText` cannot find the server text node
  it was compiled to adopt, it still recreates one — a mismatch should not blank a page over one binding —
  but it now warns once per page. A mismatch means the adopt walk disagreed with the DOM the server wrote,
  which is the failure this subsystem hides best: resume on the documentation site was dead for an unknown
  period and nothing said a word. Resilient AND audible.

### Changed — ui
- **A typo in `overrides()` now warns.** `overrides('button', (backgrond: red))` emitted
  `--weave-button-backgrond` — a perfectly valid custom property that no rule reads, so nothing happened
  and nothing said why. Unknown keys are checked against the component's real token schema (the
  `$_builtins` registry the engine already had) and warned, not rejected: adding a token is legitimate,
  and a component you `define()`d yourself has no builtin schema, so it never warns.

### Changed — runtime
- **`@for` writes one `$count` per block instead of one per row.** The value is identical for every row,
  so a 1000-row list was doing 1000 writes and 1000 equality checks per reconcile for a number that
  changes at most once — a third of the refresh loop. Also adds the first direct test of `$count`,
  covering shrink as well as growth (only `$last` was exercised before, and only while growing).

### Added — tests
- **`packages/ui/src/shared/` has tests.** 760 lines shared by up to seven components had zero direct
  coverage — only whatever their consumers happened to exercise, so a defect in the engine surfaced as
  "the datepicker behaves oddly" and every fix had to be verified twice. 25 tests added: the calendar
  engine on the boundaries where date arithmetic breaks (month ends, leap day, year rollover, min/max,
  dateFilter, roving focus, the 24-year page), the option model's fallback chain, and the position
  table's flip invariants. Mutation-checked — each deliberately broken behaviour fails its own test.

## 1.8.0 — 2026-07-19

### Fixed — forms docs
- **The submit page described an implementation that no longer exists.** `/learn/forms` said `validateAsync()`
  is *"a bounded poll (~30 ms ticks, capped at ~2 s)"*. It watches `validating()` flip to false with an
  `effect` — no polling, no timeout, no chance of resolving mid-validation. The source comment says so
  outright; the docs were describing a replaced version.
- **The `fieldArray` JSDoc example did not type-check.** A group-returning factory with `['Write tests']`
  makes the item type both `string` and `{text,done}` (`TS2322`, verified). That example shows up in editor
  tooltips and the generated API reference. Seeds now mirror the group shape. Also: the module JSDoc named
  the aggregate member `values`; it is `value`.

### Changed — skills
- **The skills now cover the whole public API, and a gate keeps them there.** They are what an AI agent
  reads before writing Weave code, so an omission is not a documentation gap — it is an agent inventing an
  API in its place, which is exactly how `field('', { validate })` came to be taught. Measured: **84 public
  exports were never mentioned** (41 of 56 in runtime, 18 in router, 12 in data, 10 in forms, 3 in i18n),
  including `onMount`, `provide`/`inject`, every devtools export, every transition, `Interceptor` and
  `Optimistic`. All now documented from source, with the failure modes that matter.
- **New gate `verify:skills`** (in CI): every public export of a package must appear in its skill; every
  fenced `ts`/`html` example must parse; `weave-templates` must show every block, directive and special
  attribute the parser accepts. A fence now carries a promise — `ts`/`html` is real code and is checked,
  shorthand notation goes in `txt`.

### Fixed — skills
- **The component skill taught a resource leak.** Its lifecycle example was
  `onMount(() => { const id = setInterval(…); onCleanup(() => clearInterval(id)) })`. `onCleanup` registers
  on the *running computation* (`if (listener) …`) and an `onMount` callback fires later on a microtask,
  outside any computation — so it silently registered nothing and the interval outlived the component. Uses
  `onDispose` now, and both hooks are documented with the distinction spelled out.

### Changed — mcp
- **The server now speaks MCP up to `2025-11-25` (was `2024-11-05`) and NEGOTIATES.** The revision date
  marks the last backwards-incompatible protocol change, not a release of this package, and the server was
  about a year behind. Checked against the spec changelogs rather than assumed: for a stdio server that
  advertises only `tools`, everything added since is HTTP-transport business, gated behind a capability it
  does not advertise, or purely additive — and the one REMOVAL (JSON-RPC batching, dropped in 2025-06-18)
  was never implemented here. It now declares the full supported range and echoes the version the client
  asked for when it is one of them, per the spec: answering with its own constant regardless would make an
  older client disconnect, which the spec tells it to do, over a session that would have worked.

### Fixed — mcp
- **A declared `required` argument was never enforced.** Every tool listed `required` in its
  `inputSchema` and the server never read it, so a caller that omitted or misspelled an argument fell
  through to the handler with `undefined` — `weave_compile_template` answered *"Empty template
  fragment"*, which points an agent at its markup instead of at its own call. Missing arguments are now
  named in an `isError` result. (`McpTool.inputSchema` is typed rather than `object`, so the schema is a
  contract the server can actually read.)
- **The scaffold emitted a directive that does not exist.** A generated component carried
  `// styles: ./name.css`, which reads like a mechanism and is not one: the sibling stylesheet is picked
  up by the same convention as the sibling template. Verified by building a scaffolded component in a
  real app with and without the line — identical CSS. It now states what is actually true.

### Fixed — editor tooling
- **The VS Code extension had the WebStorm bug, older.** The shipped `weave-language-0.5.0.vsix`
  bundled a language server built on 30 June — it predated `auto-expose`, so every `{{ binding }}`
  of a component whose `setup()` omits its `return` came up red (11 false errors in one file, 1642
  across 41, with `weave check` clean on the same tree). Its staged tsserver plugin was also still
  under the pre-rename `@weave/` scope, which VS Code resolves *by name*, so the `.ts` side silently
  loaded no plugin and kept its `TS1192`. Ships `0.6.0`, verified at 0 diagnostics across the same
  41 files. `editor/vscode/build.mjs` also stops hard-coding the staged plugin's version.
- **The editor-plugin gate went red on a correct tree the first time CI ran it.** It compared the
  server inside the shipped archive to a fresh local build byte for byte, and esbuild is not
  byte-reproducible across platforms — the Linux runner's bundle was 76 bytes larger than the
  Windows one from the same commit. Now pinned to two platform-stable hashes (the shipped bytes,
  and the language-server sources with line endings normalised) in a committed manifest per plugin.
  Renamed `verify:webstorm-plugin` → **`verify:editor-plugins`**; it covers both editors, and
  additionally asserts the `.vsix` carries a correctly scoped tsserver plugin.

## 1.7.0 — 2026-07-18

### Deprecated — ui
- **Five design tokens are inert but kept.** `button.mark-width`, `chips.remove-font-size`,
  `input.clear-size` and `typography.cell-size` on both pickers stopped being read when their glyphs
  became lucide icons (and the picker token was renamed to `cell-font`). They had been **deleted**;
  deleting a public token is a MAJOR change that fails silently for the consumer — their override
  simply stops applying — so all five are restored as deprecated no-ops, each naming its replacement.
  See RELEASE-NOTES for the table.

### Added — tooling
- **`verify:ui-tokens`** (in CI): the `--weave-*` names the library actually emits are snapshotted in
  `packages/ui/token-contract.json`. A removed token fails hard; a new one fails until recorded with
  `--update`. Ground truth is the built stylesheet, not the SCSS source. 617 tokens recorded.
- **`skills:check` / `skills:install`**: the skill suite exists in three places and two are derived
  copies. The one in a user profile — what an agent actually loads — sat two months behind, teaching a
  `field()` signature that does not exist. The template copy is checked in CI; the profile copy cannot
  be reached from CI, so it is checked at session start instead.

### Fixed — editor tooling
- **A call inside a binding had no color (WebStorm plugin `0.23.0`).** `WEAVE_BINDING_CALL` fell back
  to `DEFAULT_FUNCTION_CALL`, which has no foreground in **any** scheme the IDE ships — Default,
  IntelliJ Light and Darcula all leave it as plain text. `{{ onPick }}` was colored (its
  `DEFAULT_INSTANCE_FIELD` fallback is), every `{{ foo() }}` was not, and the highlighting read as
  broken. Colors are now stated outright in bundled `colorSchemes/Weave{Default,Darcula}.xml` via
  `additionalTextAttributes`, for calls and for the `on:`/`use:`/`bind:` prefixes (same hole in the
  light scheme). `verify:webstorm-plugin` gained two checks: every `WEAVE_*` key must have an
  explicit color in both schemes or a recorded measurement proving its fallback is colored, and
  every `<additionalTextAttributes file=…>` path must resolve inside the jar — a wrong path is not a
  build error, the IDE just logs it and leaves the colors unset.
- **The WebStorm plugin's bundled language server was stale, and it made every binding red.** The
  server inside `weave-webstorm-0.21.0.zip` was built just before `auto-expose` landed, so it typed a
  `setup()` that omits its `return` as `void` and reported *"Property 'x' does not exist on type
  'void'"* on **every** `{{ }}` binding of **every** such component: 1642 false errors across 39 of 41
  files in a real app, while `weave check` on the same tree reported none. Shipped `0.22.0` with a
  server built from the same commit. New gate `verify:webstorm-plugin` (in CI) fails if the
  `server/server.cjs` inside the shipped `.zip` is not byte-identical to
  `packages/language-server/dist/server.cjs` — nothing checked that copy before.

### Fixed — language server
- **A child component's prop contract was inert in the editor.** The server never built a virtual for
  an imported component `.ts`, so it never saw the synthesized default export; `typeof Child`
  degraded to `any` and every `<Child prop={{ … }}>` silently passed — a wrong prop type, a prop the
  child does not declare, both accepted. The same degradation stripped an inline handler parameter of
  its contextual type, producing a *spurious* "implicitly has an 'any' type" on correct code. The
  server now claims a component `.ts` (script region mapped only, so it does not duplicate the
  editor's own TypeScript diagnostics). `weave check` was unaffected throughout — the CLI and the
  editor disagreed, which is exactly what the shared emitter exists to prevent.

### Fixed — check
- **A prop-contract diagnostic mapped nowhere and was dropped.** TypeScript pins a mismatched-prop
  (TS2322) or unknown-prop (TS2353) error to the property *key*, and the key was emitted as unmapped
  scaffolding. `weave check` (line-mapped) still reported them, so the loss was invisible from the
  CLI. Attribute names on a component tag now carry a `nameOffset` through the parser, and the
  emitter writes the key mapped — the error lands on the prop name in the template.

### Fixed — compiler
- **Nested `@for` row shadowing.** Row functions all took a parameter named `_row`, so a nested loop
  shadowed its parent's and an outer loop variable read inside the inner loop resolved to the inner
  item — no error, just the wrong object. Each loop now gets its own identifier (`_row0`, `_row1`, …)
  from a dedicated counter, so `_b` block numbering is unchanged. `$index`/`$count`/`$first`/`$last`/
  `$even`/`$odd` still rebind to the innermost loop (correct shadowing, via `childScope` layering).
  Regression test renders a real nested loop and asserts the outer variable resolves in both a text
  interpolation and an attribute.

### Fixed — router
- **`navigate('#fragment')` no longer navigates to `/`.** The target was split on `#` and the empty
  remainder taken as the path. A bare fragment now preserves the current path *and* query, and falls
  through to the existing fragment-scroll handling.

### Fixed — ui
- **`<Sidenav>`**: `.weave-sidenav` gets `height: 100%` so the shell fills a sized container (no-op in
  an auto-height parent); drawer and content stretch via the default flex `align-items: stretch`.
- **`<Tree>`**: disclosure marker is a lucide `chevron-right` `<Icon>` instead of a CSS `::before` `▸`
  glyph, rotated 90° when expanded; rendered only for expandable nodes. Token `toggle-glyph` 12px → 14px.
- **`<Tree>` / `<List>`**: reorder drag handle is a lucide `grip-vertical` `<Icon>` instead of a `⠿`
  character. `grip-vertical` added to the built-in lucide set (and to the generator's name list).

### Documentation site
- API reference package pages open with a jump index of their exports, grouped by kind, with a
  per-entry kind badge; anchor jumps scroll smoothly (honouring `prefers-reduced-motion`).
- Generated API anchors are now unique per package — `slugify` lowercases, so a function and a
  same-named type produced one shared `#anchor` (a duplicate DOM id). Anchors are assigned after the
  sort, so the established anchor is kept and the collision is disambiguated by kind.
- Demo-stage presentation: raised surfaces for tabs/stepper/menubar/list/paginator/tree/table/
  grid-list/expansion, full-width tabs/stepper/menubar, visible Progress Bar, and a context-menu
  right-click target that reads as a box.

## 1.6.0 — 2026-07-17

**Phase E — SSG + a resumable signal core.** 94 commits, released as one MINOR: everything below is new,
opt-in surface with a safe default. The eager SPA path is untouched by design (byte-for-byte), and a SPA-only
app pays **zero bytes** for any of it.

### Static generation — `weave build --ssg`
- **`--ssg`** prerenders every route to real HTML at build time and derives the route list automatically (E1.2, E1.3a–d). Per-page `<title>` captured from `document.title` (E1.3d). Per-route chunks: a reader downloads the page they opened (E1.2) — docs page **1555.7 KB → 169.7 KB**, measured in the browser, not on disk.
- **`resource()` data is awaited before the HTML is written** and travels in the snapshot (E1.3). The build settles tracked async work via a global sink, so `@weave-framework/data` does not pull the headless render into a client bundle.
- **`lazy()` prerenders**: its `import()` joins the same sink, so a lazily-imported component writes real HTML *and* stays out of other bundles. This made per-component splitting free and retired the eager-routes twin built to work around the old constraint.
- **Router**: headless location injection (E1.3c-1), per-route SSG via router-SSR (E1.3c-2), `RouterView` adopts its server-rendered view (E1.12).

### Resume — `ssg: { resume: true }`
- **Wire format + resume entry** (E0.1–E0.3): serialize/deserialize, resumable event dispatch via `data-won-*` markers, graph rebuild with **no `setup()` re-run**. **Headless render to an HTML string** (E0.4) — the DOM seam.
- **Adopt-mode render** (E1.2a–E1.2c-6): reactive bindings re-attach to server DOM in place; block-boundary markers give a cursor walk; `@if`/`@switch`/`@for` adopt via island-replay; post-block elements and interpolations adopt; multi-root fragments; nested component resume with per-instance state + shared-signal dedup.
- **`derive(ctx, props)`** rebuilds what cannot serialize: computeds (E1.6), module-scope bindings so a router no longer blocks resume (E1.11), `props` (E1.25), bare `effect()`s (E1.47), and `onMount()` hooks (E1.49).
- **Coverage for real components**: element `ref`s re-bound from the adopted DOM rather than serialized (E1.16 — refusals 52 → 0, drops 228 → 29); `<slot>` (E1.17); `use:` actions, including forwarded onto a component (E1.21, E1.22); `@key`/`@render`/`@snippet` (E1.24); component-level `on:` handlers (E1.13); named + inline-in-return handlers (E1.5, E1.34); nested-component events with ancestry-scoped resolution (E1.8).
- **Never silent**: a component that cannot be adopted **names its cause** at build time (E1.14), a handler that won't inline or a computed that can't be rebuilt emits a real esbuild warning under a resume build (E1.7), and a non-serializable binding **degrades to client rendering instead of failing the build** (E1.9).

### Fixes
- **1.6.0 — fix(cli):** resume adopted off the **wrong root** on every multi-root app (E1.46). The entry hard-coded `_m.firstElementChild`; a multi-root component's roots *are* the mount target's children, so the walk got the first root, threw `nextSibling of null` on step one, and **nothing ever adopted** — silently, because the throw precedes any console listener and the server HTML looks right. Our own documentation site had never resumed, not once. The compiler now publishes the contract (`adopt.container`) instead of the caller guessing; a root that emitted no `adopt` CSRs outright rather than arming handlers over unadopted DOM. Gated by `verify:resume` (a real multi-root app — every prior test app was single-root, which is why the bug could exist).
- **1.6.0 — fix(compiler):** a bare `effect()` in `setup()` binds no name, so `derive` never rebuilt it — a per-route `document.title` effect froze at the server's value forever (E1.47).
- **1.6.0 — fix(compiler):** an `onMount()` in `setup()` **resumes** (E1.49). A prior build refused to adopt any component with one, calling it a structural limit; `derive` re-creates the hook exactly as it re-creates an effect, and the refusal was strictly *more* expensive (client-rendering re-runs `setup()` and fires the hook anyway, plus a full re-render). Docs cannot-adopt **34 → 6**. Enabling hooks ran their bodies through the setup scanners for the first time and exposed three real bugs: comments were not skipped (an apostrophe in prose opened a string and swallowed live code), the previous-significant-character was read from raw text, and `returnEntries` dropped a comment-introduced entry and everything after it.
- **1.6.0 — fix(runtime):** `onMount` is inert during a headless render **by construction** (`__weaveHeadless`), not merely because the render used to be synchronous — E1.3's settling would otherwise have let mount hooks fire at build time.
- **1.6.0 — fix(compiler):** the setup analysis no longer misreads **regex literals** (`/\/+$/` reported `$` as a variable), comments, TS type annotations, `as` casts, function-type annotations, generics with commas, destructured declarations, optional params, shadowed declarations, or a handler's own locals as ctx references (E1.18–E1.48). Each quietly narrowed what could resume without ever being visible.
- **1.6.0 — fix(ui):** `<Timepicker>`, `<Select>`, `<Datepicker>` and `<DateRangePicker>` use **lucide icons** instead of hand-drawn Unicode/CSS glyphs.

### Under the hood
- **1.6.0 — ci:** this repository had **no CI at all** — only a docs deploy and an npm publish, neither of which ran a test. Every gate ran on memory alone. `.github/workflows/ci.yml` now runs build · test · verify on every push (~1.5 min), including **`verify:resume`**: a real app, the real CLI, a real browser, real clicks.
- **1.6.0 — build(size):** `verify:size` enforces the budgets. SPA core **21.2 KB gz**; resume/adopt/serialize sit on their own lines.
- **1.6.0 — style:** `pnpm lint` went **916 errors → 0** (the rules were fixed, never relaxed) and is now a CI step; `no-unused-vars` was added after a dead import survived a retraction unnoticed.

## 1.5.28 — 2026-07-14
- **1.5.28 — fix(ui):** `<DateRangePicker>` — the **second click now always commits** (FW-17 follow-up). Selecting the first date worked, but the second click frequently did nothing: while the pointer moved toward the end date, every `mouseenter` re-ran a full `calendar.render()` that **rebuilt the entire day grid**, detaching the cell under the cursor mid-click — `mousedown` on the old node, `mouseup` on the replacement → the browser fires no `click`. Two causes fixed: (1) the hover preview + the anchor-set now call a new **`refreshDays()`** on the shared calendar core, which re-decorates the existing day buttons **in place** (reset className → re-derive selected/today/range/preview + focus) instead of recreating them, so each cell keeps its element identity and a real `mousedown+mouseup` always lands; (2) the value-sync `effect` was implicitly **tracking `pendingStart`/`hoverDate`** (read by `decorateDay` during its `render()`), so a hover re-ran it → another rebuild — it now wraps `render()` in `untrack()` and depends only on the external `rawValue()`. `<Datepicker>` shares the core but has no hover path, so it is unchanged (32 tests green). Pinned by a new `date-range-picker.browser.ts` regression test that drives a real `mousedown → mid-click hover → mouseup` and asserts the target cell is never detached + the range commits (fails against the pre-fix rebuild-on-hover). Root cause: my original tests used a synthetic atomic `.click()` which never split mousedown/mouseup, so they missed the real-cursor failure.

## 1.5.27 — 2026-07-13
- **1.5.27 — release:** documentation reconcile + lockstep version bump (1.5.23 → 1.5.27) for the FW-17 batch; this is the published `[publish]` commit.
- **1.5.26 — docs(ui):** `<DateRangePicker>` **reference page** (`/ui/date-range-picker` — prose + API table + live basic demo) and **examples gallery** (`/examples/components/date-range-picker` — basic, bounds+filter, forms control), both registered in nav. Mirrors the Datepicker docs surface.
- **1.5.25 — feat(ui):** `<DateRangePicker>` — a new `@weave-framework/ui/date-range-picker` for picking a start/end **date range** (FW-17). An underline trigger field shows `start – end` and opens the shared calendar popover (day → year grid → month grid, one month at a time). Range selection is **two clicks**: the first sets the anchor (accent-filled), the second completes it with the ends auto-ordered (click before the anchor and it becomes the new start); while picking the end, **hovering previews** the span (a `--in-range`-style tinted band + a dashed `--preview-edge` ring on the tentative end). The value is a `DateRange` (`{ start: Date | null, end: Date | null }`) bound via `value` + `onChange` or a forms `control` (`Field<DateRange>`); it commits only on the second click and a half-picked range is discarded on close. Supports `min`/`max`/`dateFilter`, `firstDayOfWeek` (default Monday), `labels` (translatable chrome), `separator` (default `' – '`), `clearable`, `required`, `disabled`, `position`, and full keyboard nav. Pinned by 13 `date-range-picker.browser.ts` tests (two-click commit, order swap, hover preview, keyboard, discard-on-Escape, bounds, clear, value/onChange, shared drill-down) + verified live in the docs. Docs: new *UI → DateRangePicker* reference + *Examples → Components → DateRangePicker* gallery.
- **1.5.24 — refactor(ui):** extracted the three-view calendar engine out of `<Datepicker>` into a shared, prefix-parameterised **`createCalendarView`** core (`src/shared/calendar-view.ts`) + a matching **`calendar($name, $range)`** SCSS mixin (`src/styles/_calendar.scss`), consumed by both `<Datepicker>` and `<DateRangePicker>` — zero calendar duplication (UI RULE #1). `<Datepicker>` delegates its popover to the core with identical class names/CSS/behaviour; all 32 `datepicker.browser.ts` tests stay green (the guardrail). The `$range` flag emits the range-only day modifiers (in-between band, rounded ends, hover preview).

## 1.5.23 — 2026-07-10
- **1.5.23 — feat(ui):** `<Datepicker>` **year + month drill-down views**, **configurable first day of week**, and **translatable chrome** (FW-16). The popover is now three views in one panel: clicking the day-view header ("June 2026" — now a button, aria `chooseYear`) opens a **year grid** (24 years, 4×6; ‹/› page ±24; range label "2016 – 2039"); picking a year opens a **month grid** (Jan–Dec, 3×4, no paging; its header year switches back to the year grid); picking a month opens that month's day calendar — so navigating across decades is a couple of clicks instead of dozens of month steps. Each grid is a `role="grid"` with full keyboard nav (Arrows within the page — year row = 4, month row = 3; PageUp/Down jump a 24-year page; Home/End to edges; Enter/Space drills down or commits; Esc closes). Years/months entirely outside `min`/`max` are disabled in their grids. New **`firstDayOfWeek`** prop (`0` Sun … `6` Sat) defaulting to **Monday (1)** — a component default, not the locale's — overridable per instance. New **`labels`** prop (`Partial<DatepickerLabels>`) translates every chrome string (nav aria-labels, year switch, dialog name, clear, open-calendar) with English defaults; being reactive props they can carry `t('…')` from i18n. Month/weekday/year *text* stays locale-driven (Intl). The imperative panel was refactored to a single `renderPanel()` dispatching per view (day/year/month), each with its own keyboard handler; the day view keeps its exact classes/structure so it is fully back-compatible. Pinned by 13 new `datepicker.browser.ts` tests (drill-down chain, year paging, per-view keyboard, first-day default + override + lead-blank shift, label overrides, year/month min-max disabling) + verified live in the docs. Docs: *UI → Datepicker* updated (new views, first day, `labels`, keyboard, props).
- **1.5.22 — fix(ui):** `<Tabs>` sliding indicator — **measure the active tab on the next animation frame, not mid-selection** (FW-15 follow-up). 1.5.21 re-queried the live button but still measured **synchronously** inside the reactive flush; on a **direction reversal** (clicking a tab on the opposite side of the active one, after moving one way) that read the newly-active button *before* its `tabTemplate` body had re-rendered/laid out for the new selection — a small **non-zero** (icon-sized) width, i.e. the circle in the wrong place (the `offsetWidth === 0` guard couldn't catch a partial). The measurement is now deferred to a coalesced `requestAnimationFrame`, so it always runs **after** the active button's DOM + layout have settled and **never** captures a pre-render/partial box — every selection, any direction, any distance. Rapid selections cancel the pending frame (only the final one measures); the `ResizeObserver` (list + active button) still re-fires for genuinely-later async resizes (font/icon load). Pinned by two new `tabs.browser.ts` tests — a **pre-layout guard** (a template whose selected body finishes a frame late: the indicator must NOT snap to the partial width on the selection tick — *fails* under the old synchronous measure) and a **direction-reversal sequence**.
- **1.5.21 — fix(ui):** `<Tabs>` **sliding indicator now tracks the active tab under a `tabTemplate`** (FW-15). With `slidingIndicator` + a custom `tabTemplate`, switching tabs left the indicator the wrong size and place — it collapsed to a tiny box (a circle under a pill skin) parked near the first tab, because the geometry was read off a **captured-once-in-`onMount`** list of tab buttons that goes stale when the templated button bodies re-render. The indicator effect now (a) re-queries the **live** active button each run instead of a snapshot, (b) also depends on the `tabs` set so add/remove/reorder re-places it, (c) **observes the active button** (not only the tab list) so content that lays out a **frame later** — an icon/label sizing after render — re-fires a re-measure even when the list's own box is unchanged, and (d) **never settles on a zero width** (a body mid-re-render is skipped; a later resize tick re-places it). No API change; plain (no-`tabTemplate`) tabs behave exactly as before. Pinned by three new `tabs.browser.ts` tests (switch-under-template, late-frame layout, tabs-set change) — the late-layout + set-change tests fail without the fix. With `slidingIndicator` + a custom `tabTemplate`, switching tabs left the indicator the wrong size and place — it collapsed to a tiny box (a circle under a pill skin) parked near the first tab, because the geometry was read off a **captured-once-in-`onMount`** list of tab buttons that goes stale when the templated button bodies re-render. The indicator effect now (a) re-queries the **live** active button each run instead of a snapshot, (b) also depends on the `tabs` set so add/remove/reorder re-places it, (c) **observes the active button** (not only the tab list) so content that lays out a **frame later** — an icon/label sizing after render — re-fires a re-measure even when the list's own box is unchanged, and (d) **never settles on a zero width** (a body mid-re-render is skipped; a later resize tick re-places it). No API change; plain (no-`tabTemplate`) tabs behave exactly as before. Pinned by three new `tabs.browser.ts` tests (switch-under-template, late-frame layout, tabs-set change) — the late-layout + set-change tests fail without the fix.

## 1.5.20 — 2026-07-10
- **1.5.20 — feat(skills):** shipped a suite of **11 focused Weave skills** (`skills/weave-*`) — per-subsystem guidance for AI systems building Weave apps of any complexity: `weave-app` (orchestrator/index) · `weave-component` · `weave-reactivity` · `weave-templates` · `weave-router` · `weave-forms` · `weave-store` · `weave-i18n` · `weave-data` · `weave-ui` · `weave-tooling`. Each is a self-contained `SKILL.md` (a specific trigger description + accurate API + examples + "which tool when" tables + gotchas), grounded in the real package exports and the 1.5.x authoring DX (auto-expose, `propDefaults`, `bind:` on components, typed `@snippet` params, no `void` keep-alives). `create-weave` now scaffolds them into a new app's editor-skills dir via `tools/sync-skills.mjs` (wired into `build-packages.mjs`), so every scaffolded app ships them auto-discovered; existing apps copy `skills/` in. `skills/` is the single source of truth.
- **1.5.19 — feat(compiler+check):** **(A5)** `bind:value={{ sig }}` (and any `bind:<prop>`) now works **on a component tag**, not only DOM elements — it passes the signal itself by reference (sugar for the "hand the child the writable signal" convention), so stepper/form-style two-way reads uniformly across elements and components. `weave check` types the signal against the child's prop; the old `'bind' binding on <Tag> is not supported yet` throw is gone. Pinned in `component.browser.ts` (emit + a real two-way mount). Docs updated (*Learn → Components*).
- **1.5.18 — fix(runtime+forms):** two robustness fixes from the DX audit. **(B6)** `bind:group` compares stringwise (`String(sig()) === radio.value`) so a non-string signal (e.g. `Signal<number>`) checks the right radio instead of never matching, and writes back in the signal's own type (a number stays a number, not the string `"1"`). **(B7)** a form's `validateAsync()` waits for async validation by watching `validating()` flip to false (a one-shot `effect`) instead of a 30 ms poll capped at ~2 s — no latency quantum, no premature resolve mid-validation. **(B5** from the audit — an "infinite-loop guard" — was investigated and **dropped**: the reactive core's existing loop-safety (`markDirty` early-return) already terminates a self-writing effect, so there is no stack-overflow to guard; verified empirically.) Pinned in `bind.browser.ts` + the existing `validateAsync` submit test.
- **1.5.17 — feat(runtime+compiler+check):** **(A2) prop defaults** — `export const propDefaults = { … }` gives a component static default prop values, cutting the `() => props.x ?? default` wrappers that pepper component authoring. The loader passes it as `defineComponent(render, setup, propDefaults)`; the runtime layers it *under* props (`Object.create(defaults)` + the parent's own descriptors on top), so a prop the parent **omits** reads the default while one it **passes wins and stays reactive** (an explicit `undefined`/falsy counts as passed). `weave check` makes the defaulted keys **optional for the parent** (`__WeaveWithDefaults<P, typeof propDefaults>`) while `setup` still sees them as declared; a required non-defaulted prop stays required. Pinned in `component.browser.ts` (emit + runtime + reactive + falsy-wins) and a new `propdefaults` smoke (`verify:check`). Docs: *Learn → Components → Prop defaults* (replaces the old "no default-props mechanism" note).
- **1.5.16 — feat(compiler+check):** **(A3)** `@snippet` parameters may carry a **TS type annotation** — `@snippet row(ctx: ListRowContext<Task>) { … }` — and `weave check` type-checks the body against it (a typo in `ctx.item` is caught); an un-annotated param stays `any` (backward compatible). This closes the type hole under the template-prop features (`rowTemplate`/`itemTemplate`/`tabTemplate`), whose snippet bodies were previously untyped. Parser splits `name: Type` with type-aware bracket depth (generics with commas — `Map<K, V>` — and arrow types — `(n) => T` — survive); the prettier-plugin re-attaches the annotation when formatting. Pinned in `snippet.browser.ts` + the `snippet-type` smoke. Documented in *Learn → Components*.
- **1.5.15 — feat(compiler+check):** **(A1)** a **bare** attribute on a component tag (`<Button disabled>`) now passes the boolean prop `true` instead of the empty string `""` — so a `boolean` prop actually receives `true`, and `weave check` stops flagging `'' is not assignable to boolean`. A quoted value (`label="Go"`) or an explicit empty (`hint=""`) still passes a string. Implemented via a `bare` flag on the parser's static attr (valueless = no `=`); DOM elements are unchanged (a bare attribute still renders bare). Pinned in `component.browser.ts`; documented in *Learn → Components*.
- **1.5.14 — feat(compiler):** two template-authoring DX wins. **(A4)** common DOM/timer globals — `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`, `requestAnimationFrame`/`cancelAnimationFrame`/`queueMicrotask`, `alert`/`confirm`/`prompt`, `performance`, `crypto`, `Event`/`CustomEvent`, `AbortController`, `FormData`, `Blob`/`File`, `Image`/`Audio`, `getComputedStyle`, `atob`/`btoa` — are no longer inferred as `ctx` bindings, so an inline handler like `on:click={{ () => setTimeout(close, 200) }}` resolves the real global instead of compiling to `ctx.setTimeout(…)` (a runtime `TypeError`). **(A6)** every parser `ParseError` now carries its source offset (35 throws that previously reported none), so the dev-server overlay frames the real `line:col` instead of collapsing to line 1. (From the DX audit.)
- **1.5.13 — fix(compiler):** codegen no longer rewrites an arrow-function **parameter** that shadows a same-named `setup` binding. `items().map((value) => value * 2)` compiled to `ctx.items().map((ctx.value) => ctx.value * 2)` — `(ctx.value) =>` is a **SyntaxError** — whenever `value` was also a component binding (a real, if narrow, build-breaker). `rewrite()` now spares arrow parameters (same basis as `freeIdentifiers`/`inferCtxNames`, so inference and codegen agree on what is a parameter). Pinned in `scope.browser.ts`. (Found by a framework DX/optimization audit.)
- **1.5.12 — test+docs(typescript-plugin):** pinned that a child component imported **only** for a template tag (`<Badge/>`, never referenced elsewhere in the `.ts`) is **not** reported "unused" — the plugin's virtual harness already references each tag as `typeof Tag`, so `noUnusedLocals` stays quiet and the old `void Badge;` keep-alive lines are unnecessary whenever the Weave editor tooling (`@weave-framework/typescript-plugin` / VS Code / WebStorm) is active. New `packages/typescript-plugin/test/unused-import.smoke.mjs` (used-in-template → 0 unused; genuinely-unused import → still flagged, as a control) wired as `verify:tsplugin`; documented in *Learn → Components*. (Chose "keep the imports, drop the `void`" over resolving tags without imports — imports stay explicit for go-to-definition.)
- **1.5.11 — feat(compiler+check):** **auto-expose** — a component's `setup` may omit its `return`. When there is no top-level `return`, the loader (runtime module) and `@weave-framework/check` both synthesize `return { …names }` exposing exactly the identifiers the template references (`inferCtxNames`) — a private local/timer the template never names is not exposed, and a module-scope name the template uses (`t`, an icon map) is forwarded for free. An explicit top-level `return` opts out and is used verbatim, so every existing component (all of which return) is unaffected. New `packages/compiler/src/auto-return.ts`: a hand-rolled string/comment/regex/template-literal-aware scanner (zero-dep) that classifies each `{` FUNCTION-vs-BLOCK, so a `return` inside a nested arrow/function is ignored while one in a top-level `if`/`switch` block still counts; **fail-safe** — any ambiguity (odd signature, return-type annotation, unbalanced scan) leaves the script byte-for-byte untouched. `check` maps its script region as two runs around the injected span so `.ts` diagnostics still land correctly. Pinned by `auto-return.browser.ts` (16 cases), a real mount in `component.browser.ts`, and `auto-return.smoke.mjs` (wired into `verify:check`). Also fixed 3 pre-existing `Signal<T>`-invariance type errors in `list.browser.ts` (FW-14 test) that were failing `typecheck`.

## 1.5.10 — 2026-07-09
- **1.5.10 — feat(publish):** `@weave-framework/typescript-plugin` is now **published to npm** (16th package). It's the `.ts`-side editor support — a tsserver plugin that synthesizes the loader-generated default export, so `import X from './x-component'` no longer reports **TS1192 "no default export"** in WebStorm (and any editor using the project's tsconfig). Wire it up per project: `compilerOptions.plugins: [{ "name": "@weave-framework/typescript-plugin" }]` + install it (dev). The Nx `application` generator and the `create-weave` template now scaffold both. (VS Code's extension already bundles it; WebStorm needs the tsconfig entry since its tsserver loads plugins only from there.) Publish pipeline: added to `build-packages.mjs` (its esbuild bundle) + the publish ORDER + `publishConfig.access=public`.
- **1.5.9 — fix(language-server):** go-to-definition on a template binding (`{{ x }}`) now lands on the `const x = …` declaration in `setup()` instead of the `return { x, … }` shorthand. Template vars emit as `__ctx.x` over `ReturnType<typeof setup>`, so TS resolved the member to the return object's shorthand property (a "huge return" jump); a definition post-processor in the language server (`redirect-definition.ts`, wrapping `provideDefinition`) detects a `ShorthandPropertyAssignment` inside a `setup` return and re-points it at the same-named `const`. Ships in the editors (WebStorm plugin `0.15.0`; benefits the VS Code extension on rebuild). DoD-pinned in `verify:ls`.
- **1.5.8 — feat(nx) + docs:** in a **mixed Nx workspace** (Weave beside another framework, e.g. an Angular→Weave migration) a project keeps behaving like the old framework until its own config says otherwise — that's what made a migrated project's `.html` templates show native/other-framework errors in the editor. The Nx `application` generator now also scaffolds a **project-local `tsconfig.json`** (mirrors `create-weave`; scopes the app as its own Weave TS program), and a new docs section — *"Make a project use Weave — not the framework beside it"* — documents the three markers (`weave.config.*` + `tsconfig.json` + `.prettierrc`) and a `project.json` target override (which outranks any inferred target) so both `nx` CLI and the editor treat the project, and its templates, as Weave. No plugin-code change — the WebStorm/VS Code Weave tooling already keys off these once the project stops declaring the old framework's targets.
- **1.5.7 — fix(ui):** `<Tabs>` `tabTemplate` (FW-12) now renders over **dynamic** `tabs` — same fix as `<List>` FW-14: the button body moved from a one-shot `onMount` snapshot into the reactive keyed `@for` block (`@if (hasTemplate()) { @key (tabKey) { @render (tabBody) } }`), so tabs added/edited after mount get (and refresh) their template body. `tabKey` folds a per-tab WeakMap version + selected state. (Panel *content* still mounts in `onMount` — tabs are a fixed strip by design.)
- **1.5.7 — fix(check):** a `@snippet` is now typed `() => Node` (was `() => void`), so passing one to a component's template prop typed `(row) => Node` (`rowTemplate` / `itemTemplate` / `tabTemplate` on a locally-typed component) no longer flags a spurious `'void' is not assignable to 'Node'` error in `weave check`. New `snippet-type` smoke pins it (part of `verify:check`).

## 1.5.6 — 2026-07-09

- **1.5.6 — fix(ui):** `<List>` `rowTemplate` (FW-14 follow-up #2) now re-renders a row body when the item's **data** changes, not only on a selected/disabled flip. The body was keyed solely by `selected:disabled`, constant for a non-selectable list — so a reused row (`eachBlock` keyed by `item.value`) kept its stale body after an edit-then-reload (same id, new data). The `@key` now folds in a per-item version (a data edit hands a fresh object → new version), so editing a record refreshes every templated field with no app-side key hack. Selected/disabled re-render preserved.
- **1.5.5 — fix(ui):** `<List>` `rowTemplate` (FW-14 follow-up) now renders over **dynamic** `items`. The row body was wired once in `onMount` over a static `querySelectorAll` snapshot, so rows created *after* mount (async initial load, infinite-scroll append, reload after create/edit/delete) rendered **empty** (default title/meta suppressed). The body now mounts inside the reactive keyed `@for` block (`@render` guarded by `hasTemplate()`, wrapped in `@key(selected:disabled)` for the per-row selected/disabled re-render) — create / append / replace / remove all flow through the block's `track item.value` diffing. No `onMount`, no index-fragile `rows[i]`. API unchanged.
- **1.5.4 — feat(ui):** `<List>` `rowTemplate` (FW-14) — an authored `@snippet` renders the whole body of each `.weave-list__row` (colour dot, name, tag pills, description, trailing action buttons) from the row's `ListRowContext` (`item` + `data`, `value`, `title`, `meta`, `index`, reactive `selected`, `disabled`). `<List>`/`ListItem` are now generic over the item payload (`data?: T`). The framework keeps the row, its role, `aria-selected`, roving tabindex, keyboard nav and (when `reorderable`) the drag handle rendered before the template; `title` stays the accessible name + typeahead. Re-renders per row on `selected` change, bindings owned/disposed cleanly. In selectable mode a click on an interactive descendant (`button`/`a`/`[role=button]`) inside the template no longer toggles selection. Omit → the default title + meta spans (back-compatible). Mirrors the menu's `itemTemplate` (FW-10) and tabs' `tabTemplate` (FW-12).

## 1.5.3 — 2026-07-08

- **1.5.3 — feat(ui):** `<Tabs>` `slidingIndicator` (FW-13) — opt-in animated marker. When set, the framework renders one `.weave-tabs__indicator` in the tab list and slides + resizes it (`transform: translateX` + `width`) to the active tab's box on every selection and on resize (ResizeObserver), the CSS transition doing the animation. Default look is a bottom accent underline (`--weave-tabs-indicator-*` tokens); app CSS re-skins it to a pill. Off by default (Weave has no sliding marker unless asked); torn down (observer disconnected) on unmount. Composes with `tabTemplate`.

## 1.5.2 — 2026-07-08

- **1.5.2 — feat(ui):** `<Tabs>` `tabTemplate` (FW-12) — an authored `@snippet` renders the whole content of each `role="tab"` button (icon + label, badge, two lines) from the tab's `TabRowContext` (`item` + `data`, `label`, `index`, reactive `selected`, `disabled`). `<Tabs>`/`TabItem` are now generic over the item payload (`data?: T`). The framework keeps the button, ARIA, roving tabindex and panels; `label` stays the accessible name. Re-renders per tab on `selected` change, bindings owned/disposed cleanly. Omit → the default label span (back-compatible). Mirrors the menu's `itemTemplate` (FW-10).

## 1.5.1 — 2026-07-08

- **1.5.1 — fix(prettier-plugin), security:** hardened the SFC/template tag-detection regexes in `parse.ts` against polynomial ReDoS (CodeQL `js/polynomial-redos`, 5 alerts). The ambiguous `(\s[^>]*)?` (where `\s ⊆ [^>]`) is replaced by a zero-width `(?=[\s>])` assertion, and `lang` is now read from the captured `<style>` attribute slice instead of a second full-document scan. Detection semantics unchanged; smoke tests + a regression sentinel added.

## 1.5.0 — 2026-07-07

Released from the local batch `1.4.1`→`1.4.22` (npm went `1.4.0` → `1.5.0` directly). Per-step log:

- **1.4.22 — docs(site):** context-menu example galleries for `selected`, `optionContent`, `itemTemplate` (3 demos) — parity with the menu galleries.
- **1.4.21 — docs(site):** menu example galleries for `selected`, `optionContent`, `itemTemplate` (3 demos + reference prose); RELEASE-NOTES/CHANGELOG batch ledger opened.
- **1.4.20 — fix(compiler):** object spread/rest (`{ ...opts }`) in a template expression is now scope-rewritten (the `...` was mistaken for a member `.`), so `use:menu={{ { ...opts, itemTemplate: row } }}` resolves `opts`. Fixed in both `rewrite` and `inferCtxNames`.
- **1.4.19 — feat(ui):** menu/contextMenu `itemTemplate` (FW-10) — authored `@snippet` renders the whole row from the full row context (`item` + `checked`/`active()`/`index`/`disabled`).
- **1.4.18 — feat(ui):** menu/contextMenu `optionContent` (FW-9) — custom row body `Node`; `optionLabel` still drives the accessible name + typeahead.
- **1.4.17 — fix(compiler):** self-closing SVG/foreign tags (FW-8) serialize with a close tag → siblings, not nested.
- **1.4.16 — fix(cli):** `styles` url() assets (FW-7) hashed, emitted into the build + served in dev (no more font 404s).
- **1.4.15 — fix(compiler):** parenthesize reactive binding expressions so object literals in `use:` compile.
- **1.4.14 — feat(ui):** menu/contextMenu `selected` — value-picker rows (`role=menuitemradio` + `aria-checked` + check).
- **1.4.7–1.4.13 — docs(site):** per-component example galleries for all 38 `@weave-framework/ui` components.
- **1.4.6 — feat(ui):** Input `revealTooltip` selector (FW-6) — `'none' | 'native' | 'weave'`.
- **1.4.5 — feat(ui):** Input `onRevealToggle(shown)` callback.
- **1.4.4 — feat(i18n):** standalone Intl formatters (`formatNumber`/`formatCurrency`/`formatPercent`/`formatDate`/`formatRelativeTime`/`formatList`).
- **1.4.3 — feat(ui):** Input reveal toggle native `title` tooltip (FW-5).
- **1.4.2 — feat(runtime):** Observable↔signal bridge (`fromObservable` / `toObservable`).
- **1.4.1 — feat(ui):** Input password/secret reveal (`revealable`) — eye toggle.

## 1.4.0 — 2026-07-06

**Feature (`@weave-framework/router`) — async before-leave / canDeactivate guards (`beforeEach`).**
Adds `beforeEach(fn: LeaveGuard): () => void`: a guard run before every navigation commits
(push / replace / pop) that may return `boolean | Promise<boolean>` — a `false` cancels and the
current path + address bar stay put. All guards must allow to proceed; the first `false`
short-circuits; the returned function unregisters. Push/replace are gated in `navigateState`
(with a synchronous fast path when no guard is registered, so existing behavior/timing is
unchanged); `popstate` awaits the guards and, on a veto, rolls history back via `history.go` so
the URL matches staying put (no half-state). `afterEach` fires only on a committed navigation.
Also adds `navigate(to, { replace: true })` + the `NavigateOptions` type (via `history.replaceState`),
making the previously internal `'replace'` `NavType` a public API. New types exported: `LeaveGuard`,
`LeaveInfo`, `NavigateOptions`. Tests: `packages/router/test/router.browser.ts` (cancel navigate,
multi-guard short-circuit, `<Link>` click, replace gating + afterEach-only-on-commit, pop gate) —
DoD-proven (all go red when the gate is neutered).

## 1.3.2 — 2026-07-06

**Fix (`@weave-framework/check`, `@weave-framework/cli`, `@weave-framework/compiler`) — a template
parse error is now a located diagnostic, not a stack trace.** 1.3.1's `parseAttrs` advance-guard
stopped the hang/OOM but the `ParseError` still bubbled up as a raw parser stack with no filename. Now
`ParseError` carries a structured `offset`; `weave check` catches it in `checkProject` and reports
`file:line:col - error: <message>` (so one malformed template no longer aborts the whole check), and
the build loader (`packages/cli/src/plugin.ts`) returns an esbuild error framed at the template's
`file:line:col` (source line + caret). `weave build` summarizes a build failure as `weave build failed
— N errors.` instead of dumping esbuild's internal stack; non-esbuild failures still show their message.
New `verify:check` smoke asserts `checkProject` returns a precise diagnostic (not a throw) for a
malformed attribute; `braces.browser.ts` asserts the `ParseError` carries `.offset`. Patch release.

## 1.3.1 — 2026-07-06

**Fix (`@weave-framework/nx`) — build output follows the Nx convention.** The `build` executor now
defaults `outputPath` to `<workspaceRoot>/dist/<projectRoot>` (forwarded to the CLI as `--out`, via a
pure `withBuildDefaults` helper) and the application generator scaffolds
`outputs: ["{workspaceRoot}/dist/{projectRoot}"]`, so a Weave app's artifact lands where every other
Nx plugin puts it and cache restore targets the same place. Projects may override with `outputPath` in
`project.json`. To enable this, `weave build` in config mode now honors an explicit `--out` as an
override of the config's `outDir`; standalone builds with no `--out` are unchanged.

**Fix (`@weave-framework/nx`) — the `build` executor is now actually published.** The repo's
`.gitignore` had an unanchored `build/` rule that swallowed `packages/nx/src/executors/build/`, so the
source was never committed and `@weave-framework/nx` shipped without its `build` executor
(`nx build` → "Unable to resolve @weave-framework/nx:build"). Un-ignored via a negation + committed;
`verify:nx` now asserts every executor in `executors.json` has a non-ignored source and (when built)
resolves in `dist/`.

**Fix (`@weave-framework/compiler`) — parser fails loud instead of hanging on a bad attribute.**
`parseAttrs` gained an advance-guard: if `readAttrName` can't consume the current character and it
isn't a terminator (e.g. `}`, `(`, `[`, `*`, `#`), the parser throws
`Unexpected character '<c>' in attributes of <tag> (line N, col M)` instead of looping forever until
Node OOMs (~5 GB / `RangeError: Invalid array length`). Regression-tested with the real repro
`<RouterView router="{{" router }} />` (a Prettier-mangled binding — also fixed at the source by
`@weave-framework/prettier-plugin`).

**Scaffold — Weave Prettier plugin wired in.** The Nx application generator now adds
`@weave-framework/prettier-plugin` as a devDependency and writes a project `.prettierrc`
(`plugins: ["@weave-framework/prettier-plugin"]` + an `.html` → `weave` parser override), written
after `formatFiles` (the plugin isn't installed at generation time), so a generated app formats its
templates instead of mangling `{{ }}` bindings. Patch release.

## 1.3.0 — 2026-07-06

**New package — `@weave-framework/prettier-plugin`.** A Prettier plugin that formats Weave templates
(`.weave` SFCs + Weave-template `.html`). It reuses `@weave-framework/compiler`'s parser (no separate
grammar, so it can't drift from what compiles): elements/attributes lay out by width, bindings are
preserved by kind (`on:`/`bind:`/`use:`/`class:`/`style:`/`ref`/`.prop`), control-flow `@`-blocks
reindent with `@@` kept escaped, `{{ }}` expressions format via Prettier's `typescript` printer, and SFC
`<script>`/`<style>` via `typescript`/`css`/`scss`. `.weave` is picked up automatically; Weave `.html`
opts in via a Prettier `overrides` glob (`parser: "weave"`) so plain HTML is untouched. Output is
idempotent; whitespace handling is conservative (block-level reindent only, no inline reflow, `<pre>`
verbatim) in this first release. Smoke-tested via `verify:prettier` — no `SyntaxError`, idempotency, and
a normalized-AST round-trip proving attribute kinds, comments, and `@@` escaping are preserved.

**Compiler — opt-in comment preservation.** `parseTemplate(src, { comments: true })` emits `CommentNode`s
instead of discarding `<!-- … -->`; **off by default**, so the compile path (codegen, `weave check`) is
unchanged — proven by the existing compiler+check browser suite (214 tests) staying green. The Prettier
plugin is the only consumer. First **minor** bump for the new package.

## 1.2.0 — 2026-07-06

**Feature (compiler, cli) — component-extension template patches (`#3`), RFC 0008.** An extension file that
exports `const extend = Base` + a STATIC `const patch = [ … ]` (and no own template) patches the base
template instead of overriding it. The loader (`packages/cli/src/plugin.ts`) resolves the LOCAL base's raw
template, reads the ops statically (isolated `new Function` eval — no module evaluation), and
`compileComponent` applies them via `packages/compiler/src/patch.ts` `applyPatches` on the base AST (new
`compileTemplateAst` compiles from the transformed AST, no text round-trip). Ops:
`attr`/`removeAttr`/`prepend`/`append`/`before`/`after`/`replace`/`remove`/`wrap`; selectors by
tag/`.class`/`[attr]`/`[attr=value]`; inserted markup + added attributes are parsed by the same Weave parser;
a zero-match selector is a loud build error. **Build-time** (a patch on a `@for` row applies to
dynamically-added rows — runtime DOM patching would not); compiles with the **base's style hash** so the
base's scoped CSS still matches; base child tags resolve relative to the base dir. **LOCAL base only**
(published packages ship no raw template) and one template mode per extension (`#1` xor `#3`). New gate
`verify:extend` (end-to-end through the real loader, DoD revert-proven) + `patch.browser.ts` (10 tests).
Completes RFC 0008 (both modes). **Known limitation:** `weave check` doesn't type-check patch markup yet
(a deferred follow-up; `#1` full-override extensions are fully checked). First **minor** bump for this
additive surface.

## 1.1.0 — 2026-07-06

**Feature (compiler, runtime) — component extension (`extend`), RFC 0008 mode #1.** A component whose script
exports `const extend = Base` compiles to `defineComponent(render, extendSetup(extend, setup?, extendProps?))`:
it reuses the base component's whole setup context and its own `setup(props, base)` overrides/adds on top, with
its own template as the full override. `extendProps(props)` reshapes props BEFORE the base setup (the deep seam
past closure privacy — a returned-key override only changes what the template sees, not what the base's internal
closures read). `defineComponent` now attaches the raw setup as `__wSetup` so `extendSetup` can compose it;
chaining works by construction (an extended component's `__wSetup` is the composed function). The runtime helper
is `@internal` (api-gen skips it — `runtime/dom` stays 21 documented exports); no loader change. Declarative
template *patches* (`#3`) remain a planned follow-up. First **minor** since 1.0 — additive, nothing existing
changes. Docs: learn/components "Extending a component".

## 1.0.15 — 2026-07-06

**Feature (compiler, check) — `use:` actions on component tags.** `use:action={{ arg }}` on a `<Component>` now
forwards to the component's single **root DOM element** through the same `applyAction` path elements use — identical
lifecycle (mount timing, returned cleanup or `{ update, destroy }`, `update(arg)` on change, multiple in order). The
compiler no longer rejects `use:` on a component tag; the mounted node is resolved to its root via a new `@internal`
`componentRoot(node, tag)` guard that throws a clear single-root error for a fragment/text/empty root ("use: on
`<Tag>`: actions attach to a single root element, but `<Tag>` renders N nodes.") — never a silent mis-attach.
`@weave-framework/check` already type-checked component directives as `(Element, arg)`; a parity test pins it. Props,
`on:` events, and element `use:` are unchanged. Docs updated (learn/templates + components, reference/template-syntax).

**Docs (rfc) — RFC 0008 accepted.** `extendComponent` — a future primitive to subclass any component (reuse its
`setup` + template, override/add on both sides) without forking. Design record only; not implemented.

## 1.0.12 — 2026-07-05

**Feature (cli) — `weave dev` proxy (`dev.proxy`).** A Vite/Angular/Next-style dev proxy so an app's API calls stay
same-origin in dev (no CORS; `HttpOnly` cookie auth works): `dev: { proxy: { '/api': 'http://localhost:5201' } }`
(shorthand) or the full `{ target, changeOrigin, rewrite }` form. A request is proxied when its path equals a key or
starts with `key + '/'` (`/api` matches `/api`/`/api/x`, not `/apiary`; first key wins), checked before the dev
server's own routes. Method/headers/body/query stream to the backend and the response pipes back unchanged, so
`Cookie`/`Set-Cookie` pass both ways; `changeOrigin` (default `true`) sets the forwarded `Host`; `rewrite` rewrites
the path only (query preserved); an unreachable backend → `502`, no crash. Dev-only, zero new deps (Node
`http`/`https`). Pinned by a new `verify:dev-proxy` gate (boots the real dev server + a throwaway backend; 5 checks
fail without the proxy).

## 1.0.10 — 2026-07-05

**Fix (ui) — `@weave-framework/ui` dist now ships a real `export default`, so components are consumable in a real
app.** The ui build was plain `tsc`, which shipped components UNCOMPILED (`export const template` /
`export function setup`, no `render`, no default export), so the documented
`import Button from '@weave-framework/ui/button'` failed a real consumer's `weave build` (*"No matching export for
default"*) and `weave check` (*TS1192*) — masked in the monorepo, where dev exports resolve to `src` and the loader
compiles on the fly. The ui build now compiles each component at build time through the loader's own
`compileComponent` (`tools/build-ui-components.mjs` → staged tree → `tsconfig.compiled.json`), emitting
`export default defineComponent(render, setup)` + a props-typed `.d.ts` default; `weave check` gained
`esModuleInterop` + `resolveJsonModule`. New gate `verify:ui-consume` proves consumption against the built dist for
all 29 components (fails on the old output — DoD-proven).

**Infrastructure — docs deploy moved from GitHub Pages to Cloudflare Workers** (`docs/wrangler.toml` +
`.github/workflows/docs.yml`). The Pages `deploy` step had begun intermittently returning a terminal *"Deployment
failed, try again later."* (build always passed); the docs now deploy to the same reliable Cloudflare static-assets
path as the flagship demo, still `[publish]`-gated. No framework change.

## 1.0.0 — 2026-07-05

**🏆 1.0 — the public API is frozen and stable.** The `0.2.108→1.0.0` arc (see `RELEASE-NOTES.md` for the
highlights) shipped Phase C (transition callbacks, reactive `@await`, DevTools panel + trigger-trace + component
tree, Forms v2 `dirty()`, Router v2), all Tier-2 template features (`<Teleport>`/`<Dynamic>`/`<KeepAlive>`,
reactive `style:`/`use:`), schema-driven forms, and two new packages — `@weave-framework/mcp` (MCP server) and
`@weave-framework/nx` (Nx plugin). The freeze (RFC 0005) `@internal`-tagged the compiler-emitted `runtime/dom`
helpers and made `VERSIONING.md`'s stability promise binding. All 14 packages went live on npm at `1.0.0`;
`1.0.1→1.0.5` followed with the README 1.0 hero, the `create-weave` template version pin, and three scaffolder
hotfixes (nx exports / nx generators / scaffolded-starter type error).

## 0.2.120 — 2026-07-04

**Fix (compiler + runtime) — SVG child elements in a nested fragment now get the SVG namespace.** An SVG-only
element (`<path>`, `<g>`, `<circle>`, `<rect>`, …) that is the root of a *separately-compiled* fragment — an
`@if` / `@for` / `@key` body, or a component/slot root — was parsed at the top level of a plain `<template>`, where
the HTML parser (having no `<svg>` ancestor to enter foreign content) created an inert `HTMLUnknownElement` in the
XHTML namespace: it appeared in the DOM but the browser never painted it. This is why a `@for`-driven SVG chart
(e.g. bars/paths bound to data) silently failed and had to be worked around with `<div>`s. The compiler now detects
a fragment rooted at an SVG-only tag and emits a namespace-aware `templateSvg()` runtime helper (parses inside a
throw-away `<svg>` wrapper, then lifts the children out) so those nodes are real SVG elements. `<svg>` itself is
unaffected (the HTML parser handles it correctly), and an SVG child in the *same* template already worked. Pinned by
five browser tests (`packages/compiler/test/svg.browser.ts`), three of which fail on revert.

## 0.2.108 — 2026-07-04

**Docs — new Examples section (six complete, runnable apps built with nothing but Weave).** A new top-level
`Examples` area (`/examples`) sits alongside Learn / Reference / UI, each page an end-to-end mini-app with the live
demo running on the page and its full `app.html` / `app.ts` / `app.scss` source beneath it. **Todo list** (signals,
`computed`, `store`, `localStorage` via an `effect`, keyed `@for`), **Data dashboard** (a `filtered → sorted →
paginated` pipeline owning the `Table` with `clientSort` off, custom `cell` renderers, live KPI `Card`s),
**Settings panel** (every form control bound one way, a live `Tabs` preview via factory content + `effect`,
`snackbar()`), **Sign-up wizard** (`@weave-framework/forms` `field`/`validators` wired to a linear `Stepper`'s
per-step `completed`, the idiomatic `control` binding on Input/Select/Checkbox, a Finish guard), and **Kanban board**
(the CDK `dropList` + `moveItemInArray` for drag-to-reorder, arrow buttons for lane moves). Each demo dogfoods the
real `@weave-framework/ui` components and was live-verified. No framework code changed.

## 0.2.87 — 2026-07-03

**Fix — composed child components resolve when nested inside `@if`/`@for` and documented as an import example
(`@weave-framework/cli`).** `<Table selectable>` silently blanked the whole render: its selection column composes the
real `<Checkbox>` (inside `@if`/`@for` blocks), but the child-import auto-resolver in the esbuild loader skipped
wiring it, so the compiled module referenced a bare `Checkbox` and threw a swallowed `ReferenceError`. Root cause was
in `importsBinding` — it scanned the component's **whole script including comments**, so Table's JSDoc usage example
(`import Checkbox from '@weave-framework/ui/checkbox'`) was mistaken for a real import and the resolver assumed the
child was already provided. It now scans a **comment-stripped** copy of the script (a small tokenizer that preserves
string/template literals so a `//` inside a string is not treated as a comment), so a documented import example no
longer suppresses auto-resolution. The compiler already collected nested PascalCase children correctly; an audit of
every UI component confirmed Table→Checkbox was the only one affected. Pinned by a failing-first end-to-end test
(`tools/verify-ui-compose.mjs`) that builds `<Table selectable>` through the real consumer loader and asserts the
composed `<Checkbox>` selection column mounts. The docs `/ui/table` page's Selection section is now a live demo.

## 0.2.61 — 2026-07-03

**U6 a11y audit — cross-cutting pass (reduced motion + RTL, `@weave-framework/ui`).** Completes the U6 accessibility
audit. **Reduced motion:** a new `reduced-motion()` mixin (included automatically by `all-styles()`) emits one
`@media (prefers-reduced-motion: reduce)` block, scoped to `weave-*` classes, that collapses every transition and
animation the library owns — including the previously-unguarded infinite Progress-Bar and Progress-Spinner loops — to
an instant duration, while keeping animation end-states intact. It never touches the consumer's own markup, and is
exposed standalone for per-component compiles. **RTL:** the cheap, direction-safe spacing swaps are now logical
(`margin-inline-*` on Chips/Paginator/Snackbar/Stepper); the deeper RTL work (bidi-aware keyboard arrows, fill/sticky
positioning) is a scoped follow-on. With this, all 37 styled components have been audited across roles/states,
keyboard, focus, reduced-motion, and RTL, with every fix pinned by a test.

## 0.2.60 — 2026-07-03

**U6 a11y audit — Batch D (power-user, `@weave-framework/ui`).** Audited Menubar, Popover-edit, and the Table
column-resize grip. One genuine fix, pinned by a failing-first test: the Table's `role="separator"` resize grip now
exposes **`aria-valuenow`** (the current column width, reactive as you resize) and **`aria-valuemin`** (the
min-width clamp) — the WAI-ARIA window-splitter values it was missing (`aria-valuemax` is intentionally omitted since
a column has no hard maximum). Menubar and Popover-edit audited fully conformant (roles/states, keyboard, focus).
Reduced-motion and RTL (arrow/drag direction) findings are batched into the centralized cross-cutting pass.

## 0.2.59 — 2026-07-03

**U6 a11y audit — Batch C (complex/data, `@weave-framework/ui`).** Audited the 10 complex components (Tabs, Sidenav,
Expansion, Stepper, Slider, Paginator, Table, Tree, Datepicker, Timepicker). Three genuine ARIA fixes, each pinned by
a failing-first test: **`<Datepicker>`** now exposes `aria-controls` from its combobox trigger to the calendar panel
(set on open, cleared on close), matching Select/Autocomplete; **`<Timepicker>`** spinbutton columns now carry the
APG-required `aria-valuemin`/`aria-valuemax` (hour 0–23 or 1–12 by 12/24h, minute 0–59); **`<Sidenav>`** declares
`aria-modal="true"` on the over-mode drawer while open (it already trapped focus and closed on Esc). Everything else
audited conformant on roles/states, keyboard, and focus; reduced-motion and RTL findings are batched into the
upcoming centralized cross-cutting pass. No behaviour change beyond the added ARIA.

## 0.2.58 — 2026-07-03

**U6 a11y audit — Batch B (overlay, `@weave-framework/ui`).** Audited the 8 overlay components (Tooltip, Menu,
Context-Menu, Dialog, Bottom-Sheet, Snackbar, Select, Autocomplete). The focus machinery is sound — modal focus-trap
activates after attach and restores focus on close; non-modal surfaces don't steal focus. One genuine fix:
**`<Autocomplete>`** used to set `aria-controls` once and leave it pointing at its (detached) listbox after close;
it now sets `aria-controls` on open and removes it on close, matching `<Select>` (pinned by a failing-first test).
Reduced-motion and one RTL (Snackbar `start/end` positioning) finding are batched into the upcoming centralized
cross-cutting pass; modal background `inert`/`aria-hidden` is logged as a scoped follow-on (the components are
already `aria-modal`-conformant). No other behaviour change.

## 0.2.57 — 2026-07-03

**U6 a11y audit — Batch A (foundational, `@weave-framework/ui`).** Audited the 17 foundational components (Button,
Button-Toggle, Icon, Badge, Card, Toolbar, List, Grid-List, Progress-Bar/Spinner, Checkbox, Radio, Slide-Toggle,
Form-Field, Input, Chips, Ripple) across roles/states, keyboard, and focus management: **all conformant** — no
behavioural defects found (several speculative findings were verified against the source and rejected). Added a
regression test pinning that `<ButtonToggle>`'s `aria-checked` tracks its bound value signal reactively after mount.
The only genuine issues are reduced-motion (unguarded CSS animations/transitions) and a few RTL physical-property
sites; both are batched into the upcoming centralized cross-cutting pass rather than fixed per-component. No
behaviour change ships in this version.

## 0.2.56 — 2026-07-03

**U6 a11y audit — start (`@weave-framework/ui`).** First unit of the structural accessibility audit (see
`UI-PLAN-U6.md` / `UI-A11Y-AUDIT.md`): the pre-identified **M9 — Select** finding. The `<Select>` combobox trigger
now exposes **`aria-controls`** pointing at its listbox (the listbox gained a stable `id`; the attribute is set on
open and removed on close, since the popup is detached while closed), and **Space** now selects/toggles the active
option in the open listbox exactly like Enter (WAI-ARIA APG listbox behaviour — previously Space only worked when no
option was active). Two failing-first tests pin both. No visual/token change. The U6 scope is **structural a11y only**
(roles/states, keyboard, focus, reduced-motion, RTL); contrast is consumer-owned and intentionally out of scope.

## 0.2.54 — 2026-07-03

**Security hardening (CodeQL code-scanning).** Fixed the flagged findings on the published packages, no API or
behaviour change: the `weave dev` static-file handler now **rejects path traversal** (a requested asset that
resolves outside `servedir` returns 403); the router's `basename` normalizer and the compiler's
`template`/`styles` extractor drop **polynomial-ReDoS regex shapes** (non-regex trailing-slash trim; the optional
type-annotation match is bounded to a single line); and the `gen-lucide-icons` build tool strips HTML comments to
a **fixpoint**. The remaining CodeQL findings (compiler codegen constructing code from the developer's own
compile-time source; `<Icon>` markup that is always run through `sanitizeSvg` before `innerHTML`) were reviewed as
false positives and dismissed.

## 0.2.53 — 2026-07-03 (first CI npm release since 0.2.0)

Release automation: a `[publish]`-marked commit → GitHub Actions publishes all `@weave-framework/*` + `create-weave`
to npm (provenance) and cuts a GitHub Release from `RELEASE-NOTES.md`. See `RELEASE-NOTES.md` for the highlights
shipped in this release.

## 0.2.52 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**polish + version sync**. Two low-risk correctness fixes
(each with a test that fails without it): **numeric `bind:value`** compares with `Object.is`, not `!==`, so a
NaN model value no longer always clobbers a mid-edit input (`NaN !== NaN` was always true); **`validators.pattern`**
clones a `g`/`y` regex without those flags, so `.test()` is no longer stateful across calls (it alternated as
`lastIndex` advanced). Also **synced the private root `package.json` to the lockstep version** (was `0.2.32`).
Deferred (riskier behaviour changes, tracked for a dedicated pass): custom-element disconnect-on-move grace,
`connectedPosition` listener cleanup between detach/attach, `dropList` unconditional `preventDefault`, ParseError
line:col, first-memo `equals(undefined,…)`. **962 tests green. Phase A complete.**

## 0.2.51 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Icon SVG sanitization (security)**. **M5** — `<Icon>` now
sanitizes any SVG before it reaches `innerHTML` (both the `svg`/registry markup and a fetched `src`): a zero-dep
`sanitizeSvg` parses it as `image/svg+xml` (nothing executes on parse) and strips `<script>`/`<foreignObject>`,
every `on*` event-handler attribute, and `javascript:` URLs — closing a `<svg onload=…>` execution vector. Also,
`<w:element this="…">` now refuses to build a `<script>` element (a dynamic tag is attacker-influenceable and would
execute). Both have tests that fail without them. **961 tests green.**

## 0.2.50 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**reactivity performance**. **M1** — block/component
construction is now wrapped in `untrack`: `ifBlock`'s branch, `eachBlock`'s `renderRow`/`empty`, and every
`defineComponent` instance, so a signal read *synchronously* during render no longer subscribes the enclosing
block/effect (their own bindings self-subscribe) — an unrelated change won't re-run a whole `@for` reconcile or
re-instantiate a component. **M2** — `eachBlock` wraps its per-row positional writes (`item`/`index`/`count`) in a
single `batch`, so a binding that reads more than one recomputes once per reconcile instead of up to three times
per row. Both have tests that fail without them. **959 tests green.**

## 0.2.49 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**compiler rewrite robustness**. **H4** — the expression
rewriter now (a) resolves bindings inside a template literal's `${ … }` (so `` {{ `Hi ${name}` }} `` becomes
`` `Hi ${ctx.name}` `` instead of leaving `name` a bare global — spliced in WITH source-map segments), and
(b) expands object shorthand, so `{{ { name } }}` emits `{ name: ctx.name }` instead of the invalid `{ ctx.name }`;
`freeIdentifiers` scans `${ … }` too, so auto-scope infers those names. **M4** — `inferCtxNames`' `declared` set is
now **per-scope, not global**: a `@for` item / `@let` / `@if (… as x)` / await-alias / snippet-param name is
subtracted only within its own block, so the same name used as component data elsewhere is still inferred as ctx
(snippet names stay template-wide via a pre-pass). Both have tests that fail without them. **957 tests green.**

## 0.2.48 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Select reactivity + parser strings**. **H3** — `Select` no
longer builds its option listbox once and caches it; a reactive effect (re)renders the open panel's options from
the current `props.options`, so async-loaded or edited options reflect live and every re-open renders fresh (mirrors
`Autocomplete`). **M3** — text interpolation now uses the same brace-balanced, string-aware scan as attribute
`{{ }}`, so a literal `}}` inside a string (`{{ fn("}}") }}`) or an inner object literal no longer cuts the
expression short at a naive `indexOf('}}')`. Both fixes have tests that fail without them. **952 tests green.**

## 0.2.47 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**reactive-core hardening**. Two verified core fixes,
each with a test that fails without it: **H1** — `computed()` now registers an owner-disposer, so a memo reading a
long-lived signal (router / i18n / store / `@let`) is detached (`unlink` + cleanups) on unmount instead of leaking
its subscription (and closure) forever; reads after disposal recompute and re-link (Solid semantics). **H2** — a
memo that throws is now left `DIRTY` instead of silently `CLEAN`, so the next read recomputes (and re-throws, or
succeeds once fixed) rather than returning a stale value — restoring fail-loud. Investigated **M8** (runaway-loop
guard): not reachable — `markDirty`'s DIRTY-guard + eager synchronous flush already terminate mutual/self cycles;
added a loop-safety regression test, no hot-path guard. `packages/runtime/src/reactive.ts`. **949 tests green.**

## 0.2.46 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Session wrap-up (docs).** No code change — added a cross-cutting **UI Library (U0–U5)** section to `NOTES.md`
(the arc + the durable decisions/gotchas; per-milestone detail stays in `UI-PLAN-U<n>.md`), refreshed HANDOFF +
the auto-memory. U4 + U5 complete; next is U6. Not published, not mirrored.

## 0.2.45 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Popover-edit** — inline cell editing (U5 §5.3). **This completes U5.**

### UI (`@weave-framework/ui`) — `./popover-edit`
- **`popoverEdit(host, config)`** (a `use:popoverEdit` action) — click / Enter / F2 opens a **non-modal** CDK-overlay
  editor (the U3 overlay-republic chrome) seeded from `config.value()`. **Enter and click-away commit**
  (`onCommit`), **Esc cancels**; focus moves into the editor and back to the host. Default editor = a text field
  sharing Input's `field-underline` (RULE #1); a custom `editor` factory (`{ element, read, focusTarget? }`)
  supplies a Select/date/etc. `aria-haspopup=dialog`. **Deferred:** Table `column.editable` wiring, multi-cell edit.
- Gates: **946 tests (+8); verify:ui-sass 287 (+1);** typecheck + `eslint .` clean.

> **✅ U5 (Experimental) COMPLETE** — Table column-resize · Menubar · Popover-edit. (Dropped the standalone
> "selection" widget — the U4 CDK `SelectionModel` already closes it.) Next: U6 (harnesses + docs + gallery).

## 0.2.44 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Menubar** — an app menu bar (WAI-ARIA menubar, U5 §5.2).

### UI (`@weave-framework/ui`) — `./menubar`
- **`<Menubar menus onSelect>`** — a `role=menubar` of top `<button role=menuitem>`s; each opens the **shared Menu
  panel** (`menu-core.openMenuPanel`, so the panel chrome / roving / typeahead / Esc / backdrop are reused — RULE
  #1, no new dropdown). Roving Left/Right/Home/End + typeahead; ArrowDown/Enter/Space open (focused on the first
  item); click toggles; **Left/Right switch to the neighbour menu while one is open**; Esc closes + returns focus.
  `onDispose` tears down any open dropdown. The dropdown reuses `.weave-menu`.
- **Deferred:** nested submenus.
- Gates: **938 tests (+9); verify:ui-sass 286 (+1);** typecheck + `eslint .` clean.

## 0.2.43 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Table column-resize** (U5 §5.1) + a `datepicker.browser.ts` typecheck fix.

### UI (`@weave-framework/ui`) — `./table`
- **Column resize** — a per-column `resizable` (or table-level `resizableColumns`) puts a `role=separator` grip on
  each resizable `<th>`. **Pointer** drag via the CDK `draggable` (axis x) sets a live width (clamped to `minWidth`,
  default 48); **keyboard** Arrow Left/Right resize by 16px. Widths ride an internal signal (a controlled
  `columnWidths` prop wins) so `widthCss` + the sticky-offset maths recompute reactively. Emits
  `onColumnResize({ key, width })`; `[data-resizing]` marks the table during a drag. **Deferred:** double-click
  auto-fit, column reorder.
- **Fix:** `datepicker.browser.ts` had two test-only type errors (a `void` arrow returning a boolean; a 3-arg
  `matchRe`) that slipped into `0.2.42` (committed after eslint but before `tsc`). Restored a clean typecheck.
- Gates: **929 tests (+3); verify:ui-sass 285 (+1);** typecheck + `eslint .` clean.

## 0.2.42 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Datepicker text-entry** (opt-in `editable`) + the **U5 sub-plan** is written.

### UI (`@weave-framework/ui`) — `./datepicker`
- **`<Datepicker editable>`** — swaps the design's button trigger for a typeable **input-as-combobox** (role
  moves to the input; the wrapper drops its role). Typing + Enter/blur **parses via the CDK `adapter.parse`** →
  commits (clamped + normalised to the display format), OR flags **`aria-invalid`** + `--invalid` and keeps the
  text. The calendar icon becomes a toggle button; ArrowDown opens the calendar; clear × empties. Default
  (non-editable, the design's button) is unchanged. New `__input` + `__icon-button` styles.
- Gates: **926 tests (+6); verify:ui-sass 284 (+1);** typecheck + `eslint .` clean.

### Plan
- **`UI-PLAN-U5.md`** written (Experimental milestone): Table column-resize · Menubar · Popover-edit.

## 0.2.41 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree reorder** + a `dropList` keyboard opt-out.

### UI (`@weave-framework/ui`) — `./tree`, `./cdk`
- **`<Tree reorderable onReorder>`** — a per-node `__drag-handle` via the CDK **`dropList`** (`handle` selector, so
  node clicks still select/expand). `onReorder({ previousIndex, currentIndex })` — indices over the **visible** node
  order (`visible()[i].node`); the consumer applies it. (Hierarchy-aware reparenting is a deferred refinement.)
- **CDK `dropList` — new `keyboard?: boolean`** (default true). List + Tree pass `keyboard: false` so the
  listbox/tree keeps Space/Arrows for selection + roving (dropList's Space-to-lift would otherwise hijack them).
- Gates: **921 tests (+4); verify:ui-sass 283 (+1);** typecheck + `eslint .` clean.

## 0.2.40 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**List reorder** — drag-to-reorder rows (via the CDK `dropList`).

### UI (`@weave-framework/ui`) — `./list`
- **`<List reorderable onReorder>`** — a per-row `__drag-handle` (⠿ grip) wired via the CDK **`dropList`** with a
  `handle` selector, so a row-body click still selects and only the handle starts a drag. Emits
  `onReorder({ previousIndex, currentIndex })`; the List is controlled (the consumer reorders `items`). New handle
  tokens + `touch-action: none`.
- Gates: **917 tests (+3); verify:ui-sass 282 (+1);** typecheck + `eslint .` clean.

## 0.2.39 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Bottom Sheet drag-to-dismiss** — the U3-deferred gesture, now unblocked by the CDK Drag & Drop (§4.11).

### UI (`@weave-framework/ui`) — `./bottom-sheet`
- **`openBottomSheet({ dragToDismiss })`** (default true) — a top `__handle` grabber wired via the CDK
  **`draggable`** (axis `y`): dragging the handle down translates the sheet; releasing past `max(80, 0.3·height)`
  closes it, else it snaps back. New handle tokens + `touch-action: none`.
- Gates: **914 tests (+3); verify:ui-sass 281 (+1);** typecheck + `eslint .` clean.

## 0.2.38 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Timepicker** — a time field + spinner popover (U4 §4.14, Phase D). **This completes U4.**

### UI (`@weave-framework/ui`) — `./timepicker`
- **`<Timepicker>`** — the design's spinner-column variant: a Select-style trigger field (shared `field-underline`
  chrome) + clock icon opens a CDK-overlay panel of **hour ▲/▼ : minute ▲/▼** `role=spinbutton` columns + an
  **AM/PM toggle** (12-hour locales). 12h vs 24h is derived from the locale (`use24` override); `step` (minutes,
  default 5); `min`/`max` clamp the committed time.
- **Value** — a neutral `{ hours, minutes }` (24-hour internal). Binding follows the Weave form convention
  (`value`/`onChange` OR a `control`; touched-on-close; `aria-invalid`).
- **Keyboard** — Arrow Up/Down per column (`aria-valuenow`/`-valuetext`), Esc close. **Deferred:** the interval-
  listbox alternative, text-entry parsing, seconds.
- Gates: **911 tests (+13); verify:ui-sass 280 (+5);** typecheck + `eslint .` clean.

> **✅ U4 (Complex / data) COMPLETE** — 14 units: Expansion · Tabs · Stepper · Slider · Paginator · Sidenav · CDK
> SelectionModel/DataSource · CDK Virtual Scroll · Table · Tree · CDK Drag&Drop · CDK Date-adapter · Datepicker ·
> Timepicker. Next: U5 (Experimental), then U6 (harnesses + docs + gallery).

## 0.2.37 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Datepicker** — a date field + calendar popover (U4 §4.13, Phase D).

### UI (`@weave-framework/ui`) — `./datepicker`
- **`<Datepicker>`** — a Select-style trigger field (shares Input's `field-underline` chrome; the design's field is
  a button trigger) with a calendar icon, opening a **CDK-overlay calendar** (non-modal — transparent backdrop +
  Esc). Calendar = a `role=grid` month view: ‹/› month nav, a locale weekday header (reordered by `firstDayOfWeek`),
  `role=gridcell` day buttons — **selected = accent fill + white, today = an inset accent ring**.
- **Keyboard:** Arrows (day), PageUp/Down (month), Shift+PageUp/Down (year), Home/End (week edges), Enter/Space
  (select), Esc (close + return focus). All date math via the CDK **Date adapter**; `min`/`max` + a `dateFilter`
  predicate disable cells.
- **Binding:** the Weave form convention — `value` (`Date | null`) + `onChange`, OR a `control` `Field<Date>`
  (touched-on-close, `aria-invalid`). Compose with `<FormField>` for label/hint/error.
- **Deferred (noted):** text-entry parsing (the `adapter.parse` is ready — a cheap follow-up), date-range,
  year-picker view.
- Gates: **898 tests (+12); verify:ui-sass 275 (+6);** typecheck + `eslint .` clean.

## 0.2.36 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**CDK Date adapter** — the zero-dep date model under the pickers (U4 §4.12, Phase D).

### UI (`@weave-framework/ui`) — `./cdk`
- **`createDateAdapter({ locale?, firstDayOfWeek? }) → DateAdapter`** — native `Date` + `Intl` only (rule #1, no
  date library). Neutral value type = a plain **local-midnight `Date`**.
- Arithmetic: create/clone/today; add days/months/years (**overflow-clamped** — Jan 31 + 1 month → Feb 28/29;
  DST-safe); start/end of month + days-in-month (leap-year correct, incl. 1900/2000); compare / isSameDay / clamp.
- `format` via `Intl.DateTimeFormat`; **`parse`** = ISO `yyyy-mm-dd` fast-path + the locale's numeric field order
  (from `formatToParts`), **rejecting overflow** (Feb 30 → null) + expanding 2-digit years.
- Calendar helpers: locale `firstDayOfWeek` (`Intl.Locale` weekInfo, override-able), `getDayOfWeekNames` /
  `getMonthNames` (JS order). **Deferred:** custom parse masks, non-Gregorian calendars.
- Gates: **886 tests (+13); verify:ui-sass 269 (unchanged — headless);** typecheck + `eslint .` clean.

## 0.2.35 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**CDK Drag & Drop** — the headless pointer-drag + reorder engine (U4 §4.11, Phase D).

### UI (`@weave-framework/ui`) — `./cdk`
- **`draggable(el, opts)`** — standalone free-drag via pointer capture: an `offset()` signal (constrainable to one
  `axis`), a `threshold` (click-vs-drag), a `handle`, and `onStart`/`onMove`/`onEnd`. The single-gesture case (the
  Bottom Sheet's drag-to-dismiss).
- **`dropList(container, opts)`** — a reorderable list: the **insertion index** = the count of non-dragged sibling
  midpoints the pointer has crossed; `dragging()`/`activeIndex()`/`overIndex()` signals; `onDrop({previousIndex,
  currentIndex})`. Full **keyboard DnD** (Space lift → Arrows move → Space drop, Escape cancel). Event delegation.
- **`moveItemInArray(array, from, to)`** — immutable reorder applier (clamps `to`).
- **Deferred (noted):** cross-list transfer (`connectedTo`), a drag-preview helper. Unblocks the U3 Bottom Sheet
  drag-dismiss + reorderable List/Table-row/Tree.
- Gates: **873 tests (+10); verify:ui-sass 269 (unchanged — headless);** typecheck + `eslint .` clean.

## 0.2.34 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree** — controlled `expanded` (follow-up to `0.2.33`).

### UI (`@weave-framework/ui`) — `./tree`
- **`<Tree expanded>`** — expansion is now **controlled** (`expanded?` is the source of truth) OR **uncontrolled**
  (`defaultExpanded`), the Tabs convention. When controlled, expand/collapse emit `onExpandedChange` **without
  self-mutating** — the owner applies the next set. Pinned by a guard test (`no self-open — the prop still says
  collapsed`). Added after review flagged that deferring it was wrong (cheap + the library's own binding
  convention). No CSS change.
- Gates: **863 tests (+1); verify:ui-sass 269 (unchanged);** typecheck + `eslint .` clean.

## 0.2.33 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree** — the WAI-ARIA `role=tree` hierarchy (U4 §4.10, Phase C).

### UI (`@weave-framework/ui`) — `./tree`
- **`<Tree>`** — a template-based hierarchical disclosure surface (keyed `@for` over the **visible flattened
  nodes**, arbitrary content via `@render`). **Two data models:** *nested* (a `children` accessor, `node.children`
  by default, recursed; descendants show only while expanded) or *flat* (pass `getLevel` → a DFS scan hides
  descendants of collapsed nodes). Both emit `aria-level`/`-setsize`/`-posinset`.
- **Expansion + selection** ride the CDK `SelectionModel` (expansion uncontrolled + `onExpandedChange`; selection
  optional `selectable` single/multiple + `onSelectionChange` + `compareWith`; selected node = accentSoft tint +
  2px accent left border, the List visual).
- **Keyboard** = CDK `listKeyManager` (vertical, typeahead) for Up/Down/Home/End + a single roving tab stop, plus
  **Right** (expand / step into first child) / **Left** (collapse / move to parent) / Enter-Space (activate).
- Indent = an inline `--weave-tree-depth` custom prop × the `indent` token (design: depth × 18px); rotating ▸
  disclosure marker (CSS `::before`). `./tree` subpath (JS + SCSS); `tree-overrides()` wired.
- **Deferred (noted):** checkbox nodes + parent/child cascade, drag-reorder (Phase D DnD), virtual body, controlled
  `expanded`.
- Gates: **862 tests (+13); verify:ui-sass 269 (+5);** typecheck (all 12 pkgs) + `eslint .` clean.

## 0.2.32 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Regression guard for the `0.2.31` double-fire fix. The existing suite passed the fix
*independently* of it (the Table test only survived via idempotent select; the isolated
Checkbox test never exercised the runtime forward loop) — so the fix was not actually pinned.

### Compiler (`@weave-framework/compiler`) — `component.browser.ts`
- **`defineComponent does NOT forward a data-callback prop (no double-fire)`** — composes a
  child that consumes `onChange` via a setup binding fired by an inner `<input>`'s bubbling
  `change` (mirrors Checkbox). Asserts it fires **once**. Verified it **fails (calls=2)** when
  `defineComponent` is reverted to the old `/^on[A-Z]/` forward — a true guard.
- **`defineComponent forwards a real on:X event to the child root`** — asserts `$events`-marked
  events are still forwarded (guards the other direction — that the fix didn't break Button-style
  composition).

## 0.2.31 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Framework fix — composed-component event handlers no longer double-fire. This removes the
Table selection workaround (idempotent select + bool-or-Event normalisation) and is the
correct foundation for every future component that passes a data-callback prop to a child.

### Compiler (`@weave-framework/compiler`)
- A component tag now emits a hidden **`$events` marker** listing only its real `on:X`
  event-attr prop keys (e.g. `<Checkbox on:click … onChange={{…}}>` → `$events: ['onClick']`,
  `onChange` excluded). Data-callback props (`onChange`, `onInput`) are ordinary reactive
  getters, not events.

### Runtime (`@weave-framework/runtime`)
- `defineComponent` now auto-forwards **only the `$events` keys** to the child root element
  (previously it forwarded any `/^on[A-Z]/` function prop). A data-callback consumed *inside*
  the child (e.g. Checkbox's `onChange`, fired by its own `on:change`) is no longer ALSO
  attached as a bubbled DOM listener — so it fires exactly once instead of twice. `on:X`
  forwarding (Button's click, etc.) and consume-by-name are both unchanged.

### UI (`@weave-framework/ui`)
- **Table selection simplified** now that the double-fire is gone: `toggleSelect(row, checked)`
  + `onSelectAll(checked)` take a plain boolean; the `checkedFrom` bool-or-Event normaliser and
  the idempotent-select workaround are removed.

## 0.2.30 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Table — RULE #1 correctness: the selection checkboxes now COMPOSE the real Checkbox
component (not a restyled native input), which forced a rewrite of the Table to a
template-based component.

### UI (`@weave-framework/ui`)
- **Table is now a template-based component** (was built imperatively). The rows are a keyed
  `@for` over the sorted data, cells mount via `@render`, and — crucially — the selection
  column **composes the real `<Checkbox>`** (full behaviour + one checkbox visual in the
  library), exactly like Paginator composes `<Button>`. The earlier native-`<input>` +
  `.weave-table__checkbox` restyle (a RULE #1 violation the user caught) is gone, along with
  its tokens. A selectable Table therefore pulls in `@weave-framework/ui/checkbox` styles.
- **Gotchas fixed along the way:**
  - Nested `@for` (rows × columns) can't reference the outer row — the compiler names every
    loop item `_row`, so the inner loop shadows it. Cells are pre-resolved per row into a
    `cellsFor(row)` array so the inner `@for` only touches its own item.
  - Rows are keyed by **object identity** (or `trackBy`), not index, so a sort reorders the
    existing DOM by identity instead of stranding one-shot `@render` cell content.
  - The composed `<Checkbox>`'s `onChange` fires **twice** (once as its data callback, once
    via the runtime's event auto-forward to the child root). The Table's handlers read the
    checkbox's actual checked state and use idempotent `select`/`deselect`/`setSelection` —
    so the row lands in the right state regardless. `aria-expanded` is emitted as a string.
- 13 browser tests (all green); `verify:ui-sass` 262; full typecheck + eslint clean.
  Live-verified: select/deselect a row, select-all + indeterminate + uncheck, expand/collapse.

## 0.2.29 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Table follow-up — inner vertical scroll with a fixed header.

### UI (`@weave-framework/ui`)
- **`<Table maxHeight>`** — caps the body height so the `<tbody>` scrolls **vertically inside**
  the table while the sticky header stays pinned (previously the header only stuck to the page
  because the scroll box had `overflow-x` only). The scroll box is now `overflow: auto` (both
  axes), so a `max-height` gives an inner vertical scroll and a wide table an inner horizontal
  scroll — sticky header + sticky columns both pin to the scroll-box edges. Live-verified
  (body scrolls 200px, header delta 0; sticky Order column offset; live show/hide columns).

## 0.2.28 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C — the **Table**, the flagship data surface.

### UI (`@weave-framework/ui`)
- **New `<Table>` component** (`@weave-framework/ui/table`) — a real `<table>` (native
  `<thead>/<tbody>/<th scope=col>/<td>` semantics) driven by a **column-def + DataSource**
  API. Built imperatively in `setup()` (cells are arbitrary `Node`s and the body is reactive
  over data/sort/selection/expansion — text interpolation carries neither), styled by the
  Weave design (hairline rows, compact 34px, accent-as-a-mark).
- **Sort headers:** sortable `<th>` = a `<button>` cycling asc→desc→none (asc↔desc with
  `disableClear`), sets `aria-sort`, shows the accent arrow, single active column; emits
  `onSort` **and** convenience client-side sort for array/signal sources (a custom DataSource
  owns its own order).
- **Row selection** via the CDK `SelectionModel`: leading checkbox column, header
  select-all + indeterminate, `single`/`multiple`, `aria-selected` on the `<tr>` + accentSoft
  tint + 2px accent left border; `onSelectionChange` / bring-your-own model.
- **Beyond the base plan (user-requested):** **sticky columns** (`column.sticky: 'start'|'end'`,
  any column, computed offsets; the select/expand columns auto-stick), **show/hide columns**
  (`column.hidden`, reactive when `columns` is bound), and **expandable detail rows**
  (`expandable` + `detail(row)`, chevron toggle + full-width detail `<tr>`, expansion state in
  its own `SelectionModel`). Sticky header + hairline separators + tabular-nums numeric cells.
- **Virtual body:** plain-scroll in v1; the CDK `virtualScroll` hook is ready for the
  follow-on. `./table` subpath (JS + SCSS).
- 13 browser tests (structure, node cells, sort cycle + client-sort + `aria-sort`, selection +
  select-all + indeterminate + single, expandable, show/hide, sticky column, ArrayDataSource +
  reactive signal source, numeric); `verify:ui-sass` 262 (+9). Live-verified in the gallery.

## 0.2.27 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C — the **Virtual Scroll** headless engine.

### UI CDK (`@weave-framework/ui/cdk`)
- **`virtualScroll(options)`** (`cdk/virtual-scroll.ts`) — the rendered-window engine under
  large Table/Tree bodies + long lists. Given a viewport element, a fixed `itemSize` and a
  `total` (number or getter), it computes the buffered slice to render — `renderedRange()`
  `[start, end)`, `scrollOffset()` (top spacer), `endOffset()` (bottom spacer), `totalSize()`
  — all as signals; plus `scrollToIndex()`, `measure()`, `destroy()`. Fixed-size strategy
  first (autosize is a follow-on). Built on the U1 `onScroll` dispatcher + `resizeSignal`
  (ResizeObserver → viewport height); `renderedRange` is a `computed` with a start/end
  equality guard so it only notifies when the window actually changes (not every scroll pixel).
  Edge-cased: empty/short lists never produce negative ranges; the window clamps to `total`.
- 11 headless tests (window math at scroll 0/mid/end, buffer overscan + top clamp, empty +
  short lists, reactive total, sub-item-scroll stability, scrollToIndex clamp, ResizeObserver
  recompute).

## 0.2.26 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C (start) — two headless CDK data primitives, built before Table/Tree.

### UI CDK (`@weave-framework/ui/cdk`)
- **`selectionModel<T>(options)`** (`cdk/selection-model.ts`) — the signal-native selection
  engine under Table rows / Tree nodes / List multi-select. `select`/`deselect`/`toggle`/
  `setSelection`/`clear`, `single` vs `multiple`, an optional `compareWith` (object copies
  match by key), reactive `selected()`/`count()`/`isEmpty()`/`isSelected()`, and an
  `onChange` delta stream (`{ added, removed }`) that only fires on a real change. Zero DOM.
- **`DataSource<T>` + `ArrayDataSource`** (`cdk/data-source.ts`) — the collection-viewer
  contract a Table/Tree consumes so paging/sorting/filtering/virtualization can be swapped
  without the component knowing: `connect(viewer?) → Computed<T[]>` (read-only signal) /
  `disconnect()`. `ArrayDataSource` wraps a static array **or** a signal (reactive updates
  propagate through `connect()`); `isDataSource()` guard. Signal-native, no RxJS.
- 15 headless tests (single/multi transitions, no-op guards, `compareWith` identity, delta
  payloads, reactivity; DataSource static + reactive-signal propagation + read-only view).

## 0.2.25 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase B — the **Sidenav** responsive layout shell.

### UI (`@weave-framework/ui`)
- **New `<Sidenav>` component** (`@weave-framework/ui/sidenav`) — a `__drawer` beside a
  `__content` with three modes: **`side`** (drawer in flow, pushes content), **`over`**
  (drawer floats over a dimming backdrop; a modal focus context — CDK focus-trap in, Esc +
  backdrop-click close), **`push`** (drawer floats + shifts content). **Responsive:** omit
  `mode` and it consumes the CDK `breakpointSignal` — below the Weave `Narrow` breakpoint
  (900px) it auto-switches to over + closed, above to side + open. This fulfils the off-canvas
  drawer deferred from the U2 Toolbar (a Toolbar hamburger toggles it).
- **Open state** follows the Weave convention: controlled `opened` (getter) + `onOpenedChange`,
  or uncontrolled `defaultOpened`; imperative `open()`/`close()`/`toggle()`/`opened()` exposed
  via the `api` ref callback (like Input's `onInputRef`). Drawer edge via `position: 'start' | 'end'`.
- **State rides root modifier classes** (`--side`/`--over`/`--push`, `--opened`, `--end`,
  `--backdrop`) — no per-element state class. The `over` backdrop **reuses the shared overlay
  scrim token** (`--weave-sidenav-backdrop: var(--weave-overlay-backdrop)`) so every scrim in
  the library reads identically. Fully tokenized SCSS (RULE #1). 12 browser tests
  (structure/modes/controlled/api/Esc/responsive/focus-trap); `verify:ui-sass` 253.

## 0.2.24 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Completes the RULE #1 tokenization pass — the last per-component spacing/typography
literals now resolve from each component's own token schema (no hard-coded values left).

### UI (`@weave-framework/ui`)
- **Tokenized the remaining literals in 10 components** (chips, menu, dialog, bottom-sheet,
  card, tooltip, snackbar, list, expansion, autocomplete): `line-height` (1.3/1.4/1.5),
  `font-weight: 400` subtext weights, small `gap`/`padding-y` values, the chips × glyph
  size + edge nudge, and the menu divider height — each now a `var(--weave-<c>-…)` backed by
  a new key in the component's `_tokens.scss`. Structural constants (`0`, `100%`, `50%`,
  `line-height: 1` resets, 1px hairline borders, keyframe transforms) stay literal, matching
  the established convention. **Compiled CSS is byte-identical** (token value = former
  literal) — `verify:ui-sass` 245 unchanged, confirming no visual change.
- **✅ RULE #1 fully satisfied** across the UI library: every component composes the real
  child components and every SCSS value flows from a token schema.

## 0.2.23 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

The U4 (complex/data) build **plus** a mid-milestone architecture correction — RULE #1:
UI components must **compose** already-built components, never re-create them.

### Framework (runtime/compiler)
- **`defineComponent` auto-forwards component-level `on:X` handlers to the rendered root
  element.** `<Button on:click={{…}}>` now just works — a component never re-declares events
  to be composable. Skips events the component consumes itself (a setup binding shadows it).

### UI — RULE #1 composition (no duplicates)
- Components now **compose** the real components instead of re-creating look-alikes:
  Stepper Back/Continue → `<Button>`; Paginator page/nav → `<Button>`, jump field →
  `<Input>`, page-size → `<Select>`; Autocomplete field → `<Input>`.
- Shared style helpers (single source) in `styles/_helpers.scss`: `field-underline`,
  `clear-button`, `checkmark` — used by Input/Select (and Autocomplete via Input) and
  Checkbox/Stepper. No duplicated field chrome or glyphs.
- `Button` gains `ariaCurrent`; `Input` gains `onInputRef` (composers add combobox ARIA) and
  `clear()` dispatches a real `input` event so composers react.
- Internal `src/internal/compose.ts` (`toComponent`) + the `_c` child-component map power
  composition in the library's own tests/gallery (a real `weave build` emits the same shape).

### UI — new U4 components (Phase A)
- **Expansion Panel** (accordion), **Tabs**, **Stepper**, **Slider**, **Paginator**.

### Gates
- 796 browser tests, `verify:ui-sass` 245, monorepo typecheck + `eslint .` — all green.

## 0.2.0 — 2026-06-30

First npm release: 10 `@weave-framework/*` packages + `create-weave`. Framework (runtime/
compiler/store/router/forms/i18n/data/cli), editor tooling, docs site, and U0–U3 of the UI
library. See `NOTES.md` / git history for detail.
