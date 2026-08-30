# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

## 3.3.0 — 2026-08-30

A **minor**, and the useful summary is that two of its three parts are about the tooling refusing to
guess, while the third is a security fix you would never have noticed until a file made your build hang.

### Two compiler scans could be made to hang on hostile input

Both read text whose length you control — a component's own script, and the prose inside a template —
and both backtracked polynomially. `import` followed by 8,000 spaces and no `from` took **59 seconds**
inside the compiler's import scan; 16,000 did not finish in two minutes. 120 KB of `@A(` took 5.7
seconds inside the text lint. One file was enough to stall a build or an editor.

Both are fixed and held by a gate that asserts the same inputs complete in milliseconds. Reported by
GitHub code scanning as `js/polynomial-redos`. **No action needed on your side** — nothing about the
API or the output changed.

### A component with typed props goes into a dialog

`component(X, props)` — how you put a component into a dialog or a sheet — refused every component that
declares typed props. Parameters are contravariant, so a component written as
`(props: TheseProps) => Node` was not assignable to the general `Component` type the helper asked for,
and the normal case failed to type-check at the exact call the documentation shows. It now accepts any
props shape, the same way `lazy()` already did for routed pages.

This was found by pointing `weave check` at a real 61-template application, where it was **57 of the 59
errors** reported. Nothing in this repository could have found it: no template here puts a typed
component inside an imperative overlay.

Also from that run: `<Icon>` now takes a `class`, which thirty of the other forty-five components
already did.

### A malformed template tells you where, instead of crashing

Two shapes made the parser fail without saying anything you could act on. Thousands of unclosed tags or
blocks overflowed the stack — `Maximum call stack size exceeded`, about a file, with no position. And an
unterminated `<!--` quietly swallowed the rest of the file, surfacing as `Empty template fragment`: a
true sentence about the wrong thing.

Both are now located errors. Nesting is capped at 500 levels, a bound measured rather than guessed — the
stack gives out around 2,500, and the deepest template in the Weave repository nests 25.

### A two-way binding declares its signal

`weave check --fix` and the editor lightbulb could already declare a name your template asks for, when
the markup left exactly one answer — a name bound to `on:click` can only be `() => void`. `bind:` now
qualifies too, and for the same kind of reason rather than a looser one: the runtime writes a specific
type BACK into the signal, and your markup settles which one.

| you wrote | you get |
| --- | --- |
| `bind:checked={{ done }}` | `const done = signal(false);` |
| `bind:value={{ age }}` on `type="number"` or `range` | `const age = signal(0);` |
| `bind:value={{ tags }}` on `<select multiple>` | `const tags = signal<string[]>([]);` |
| `bind:value={{ name }}` anywhere else | `const name = signal('');` |

The `signal` import comes with it, in the same single edit — joining your existing
`@weave-framework/runtime` import if you have one, opening one if you do not.

Two shapes are still refused, and the refusals are deliberate. `bind:group` writes back in whatever type
the signal already holds, so a fresh declaration has no forced type at all; an `<input>` whose `type` is
itself a binding is a string one render and a number the next. `{{ total }}` and `@for (t of items())`
stay refused for the same reason they always were: an element type of `unknown` makes every use of `t`
an error, which is worse than silence.

### The editor offers it in a `.weave` too

An SFC keeps its script inside the same file, so the edit had to be shifted by where that script begins.
Without the shift the lightbulb simply declined, and every `.weave` author was left with
`weave check --fix` in the terminal. Both authoring forms now behave the same.

Editor plugins: VS Code **0.6.7**, WebStorm **0.23.7**.

### Upgrading

Nothing to do. No API moved, no behaviour of a running app changed, and `weave check` reports the same
set of things it reported in 3.2.0 — it can now repair more of them.

## 3.2.0 — 2026-08-30

A **minor**, and it has one theme: the two files stop being two files. Everything a template knows about
its `.ts` — and everything the `.ts` knows about its template — is now something the tooling can act on,
in the terminal and in the editor, with the same code behind both.

### Upgrading

`weave check` reports more than it used to, so **a project that was green can go red on the first run
after this upgrade** — nothing about your code's behaviour changed, and nothing in the API moved. Two
things are new to it: the template mistakes below (warnings, which do not fail the command), and the
props of a component imported from another package or another directory, which it could not type before
and therefore never checked. See [VERSIONING.md](VERSIONING.md) — a tool that reports more is a MINOR.

### A template mistake tells you where it is, and offers the fix

The five template lint rules always produced the right sentence. Three of them even computed the exact
answer — `on:clik` knew it meant `on:click` — and that answer only ever reached you as prose, with no
position attached, naming the `.ts` rather than the template the mistake is in.

Now a finding is framed at its line in its own file, with the source underlined; `weave check` reports
these at all (it used to type-check the template and say nothing about markup that compiles clean and
fails silently); and `weave check --fix` applies the ones with exactly one answer.

The editor shows the same findings as squiggles with the same fix on the lightbulb — the same code, not a
second implementation.

### The template writes into `setup()`

Write `on:click={{ save }}` with no `save`, and the fix declares it in the `.ts` for you — from the
terminal or from the editor lightbulb. It declines on anything ambiguous, and every refusal is tested:
this is the one place where guessing would put code in your file that you did not write.

Renaming follows, in both directions: rename a binding in the template and the `const` behind it and
everything reading it follow.

### `weave check --impact <file>` — what renders this component

The question everyone asks before editing a component, and the honest answer was never available: grep
finds a tag's NAME, which is not the same as the components that resolve to this file. Reading the
composition graph answers it exactly, separating direct users from those reached through them.

### `weave merge` — git stops inventing template conflicts

Two people on one template is the everyday case, and git merges lines. A tag and its text share a line,
so a handler added to a button and that button's label reworded are one hunk to git: a conflict, with
nothing actually in disagreement.

`weave merge --install`, once per clone, teaches git to read the file as a tree. Git still runs first and
its clean results are used as-is, so installing this can add resolutions but never change one you already
had; nothing is reformatted; and the same node changed two ways is still a conflict, because it is one.

### Any screen, in any state, in one second

Getting a screen into the state you need to look at — no rows, ten thousand rows, the request failed —
meant driving the app there by hand, every time. `weave dev --devtools` now shows the reactive graph in
the page, and its **States** tab saves the screen you are on to `.weave/states/<name>.json`. Plain JSON:
commit it, and the whole team has that screen. `weave dev --state <name>` opens the app already in it.

A state is exactly the values of the signals you **named**. Nothing is predicted, nothing is inferred,
and none of it exists in a production build.

### Eight APIs that refused their own documented usage

The new tooling was then pointed at the biggest Weave app in this repo — the documentation site, which
nothing had ever type-checked. It reported **456 errors**, and most of them were the framework's:

- A component imported from **outside the checked roots** was always `has no default export` — 396 of the
  456 — because a component's default export is synthesized by the compiler. It is compiled as a
  dependency now, so a wrong prop across a package boundary is caught rather than the import itself.
- A component that declares its own **`interface Node`** retyped its own default export.
- **`field('', [validators.required()])`** froze into `Field<''>` — a field that could never hold another
  string. The validators no longer get a vote on the value type.
- **`control={{ field }}`** did not type-check on the datepicker, timepicker or date-range picker, which
  is the exact line each of their own examples shows.
- **`<Table dataSource>`** and **`<Stepper steps>`** rejected the getter their own examples use.
- **`<Toolbar role>`** was documented from the start and never existed: the attribute landed nowhere.
- **`lazy()`** could not load a page that declares the props the router hands it, so the module
  `weave routes` generates did not type-check for any app with a dynamic route.

`pnpm docs:check` runs in CI now, so the site cannot drift back.

### Also

- Reordering a keyed list reparents its rows (`Element.moveBefore`) instead of removing and re-inserting
  them, so focus, a running animation and playing media survive a `@for` reorder.
- The size budget measures the bytes a browser actually downloads (minified, then gzipped). It had been
  counting doc comments: the SPA core reads **6.6 KB**, not the 22.1 KB the old number claimed.

## 3.1.0 — 2026-08-29

A **minor**: nothing about writing a Weave app changed, but a great deal about being *told* what you did.

This release came out of a first-run audit — scaffold an app from the published package, follow the
documentation literally, then make the mistakes a beginner makes. Every finding had the same shape: Weave
was **silent** exactly where it should have spoken. A clean build, a green check, and an app that does not
work. Ten of those are closed here.

### The dev server no longer stops working after one typo

`weave dev` turned a template *parse* error into a proper message, and every other compiler failure into a
thrown exception — which took esbuild's watch state with it. After one of those, the server kept serving the
last good bundle **forever**: every later save was ignored, with nothing in the terminal and nothing in the
browser. The cure was restarting, if you guessed that was the problem.

An editor truncating a file on save was enough to trigger it. Now every failure is a located diagnostic —
your file, your line — and the save that fixes it rebuilds.

### The five silent template mistakes

Each of these compiled cleanly, passed `weave check`, and then failed invisibly in the browser:

- **`{{ count }}` without its `()`.** A function in a text position renders as its own source code, so the
  page read `clicked () => { track(node); return node.value; } times`. It is now a type error that says to
  call it.
- **`onclick={{ inc }}`** set an *attribute* to the stringified function. The button rendered, clicked, and
  did nothing.
- **`on:clik`** bound a listener for an event nothing fires.
- **`xyz:abc={{ … }}`** was emitted as a plain attribute.
- **`@fro (t of todos()) { … }`** was left in the page as literal text.

The last four are build warnings that name the fix. The rules are deliberately narrow — a static
`onclick="…"` is real HTML, `xlink:href` is a real namespace, and an event or block name only warns when it
is one edit from a real one, so a genuinely custom event stays silent.

### `weave check` checks your whole project

It built one program from your components and then asked for diagnostics on those files alone. Everything
else — services, stores, helpers, generated route modules — was pulled in as a dependency and never reported
on. A scaffolded app, whose only quality script is `weave check`, could hold a type error that plain
`tsc --noEmit` refuses.

**This can surface errors in code that was never checked before.** That is the point, but it is worth
knowing before you upgrade a CI pipeline.

It also stopped disagreeing with the build about child components: the loader resolves `<TodoItem>` to
`./todo-item/todo-item.ts` by convention, and the checker used to call that same working app broken.

### The UI library has an installation page

There was none. Nothing in the documentation said `npm install @weave-framework/ui`, and the theming page
gave its Sass block without saying where the file goes. Put it in the obvious place — your component's own
stylesheet — and it does *nothing*: component styles are scoped, so `:root { --weave-… }` compiles to
`[data-w-xxxxxx]:root`, a selector that can never match. 120 KB of theme, applied to nothing, with a clean
build and an unstyled button on screen.

Now: a four-step [Installation](https://weaveframework.dev/ui/installation) page, and the compiler warns
whenever it scopes a `:root`, `html` or `body` rule into something unmatchable.

The scaffold also ships a **README** — it had none — with the same recipe, the scripts, and the deploy notes.

### Deploying somewhere other than the domain root

`base: '/my-app/'` in `weave.config.ts`. Every URL the framework injects picks it up, `weave dev` answers
under it, static generation carries it, and the router adopts it as its basename — so `<Link to="/about">`
still reads as `/about` in your code. Without it, a GitHub Pages *project* site (which the installation page
recommends by name) asked for `user.github.io/main.js`, got a 404, and showed a white page.

Alongside it: injected assets now carry a content marker (`/main.js?v=1a2b3c`) so a CDN cannot answer fresh
HTML with a stale bundle, and an app with client routes also gets a **`404.html`** — what a static host
serves for an unknown path, and therefore what makes a deep-link refresh work where rewrite rules are not
available.

### A blank page explains itself

A `setup()` that throws rendered nothing at all — a white document with the message only in the console. The
dev overlay now paints uncaught runtime errors too, but only when the page came out empty: an app that
rendered and then threw keeps its screen.

### Editor plugins refreshed

WebStorm **0.23.2** and VS Code **0.6.2** ship in
[`plugins/editor/`](https://github.com/weave-framework/weave/tree/main/plugins/editor). Each bundles a copy
of the Weave language server, and this release changed it — the editor now resolves a child component by the
same convention the build does, so a component that renders no longer shows a red squiggle. If you have an
earlier build installed, reinstall from the file to pick it up.

### The CLI's front door

- A busy port crashed the dev server with Node's `Unhandled 'error' event` and a raw EADDRINUSE stack — for
  the most ordinary situation there is, a second terminal. It steps to the next free port and says so.
- `weave --help` exited 1 with a single usage line, and **`weave build --help` ran a build**, wiping the
  output directory. There is real help now, and an unknown command says what it is before printing it.
- A finished build reports what it produced: elapsed time, then each file with its size.

## 3.0.1 — 2026-08-12

A **patch**: three fixes for things that were quietly not working, and every open security advisory closed.
Nothing new, nothing changed shape.

### Numbers in template expressions

`{{ 182_400 }}` did not compile. Neither did `{{ 0xFF }}`, `{{ 1e3 }}`, `{{ 0b1010 }}`, `{{ 0o17 }}` or
`{{ 9007199254740993n }}` — every numeric literal except a plain integer and a plain decimal was a build
error on valid JavaScript, reported against generated code rather than against your template.

The expression tokenizer had no notion of numbers: digits were copied one at a time, so the first
character inside a literal that can also *start* an identifier — `_`, `x`, `b`, `o`, `e`, `n` — began one,
and it was then resolved against your component's context. `182_400` was emitted as `182ctx._400`. A
numeric literal is now a single token, covering hex, binary, octal, exponents, separators and BigInt.

### Security — every open advisory closed

Eight dependency advisories (`undici` ×5, `fast-uri`, `js-yaml`, `nx`) and two code-scanning findings. The
dependency half is entirely build tooling — none of it is in a published Weave package's dependency tree,
and the zero-runtime-dependency promise is unchanged.

The two code-scanning findings were real and in the compiler: two declaration-reading regexes with a
polynomial-backtracking shape, run over your own source files. Both were rewritten so the scan is linear.

### `weave check` no longer dies on a file that quotes a component declaration

Any module holding Weave examples as *data* — a documentation page, a snippet library — had its own prose
read as a component declaration, and one such file stopped the entire check with a stack trace instead of a
diagnostic.

## 3.0.0 — 2026-08-11

A **major**, for one reason: a type that used to accept code now refuses it. Everything else here is a fix
for something that was quietly not working — checking that wasn't happening, a page shipping without its own
`<head>`, a tool that died on a file it should have skipped.

### Breaking: `<Select>` / `<Autocomplete>` require their option accessors

`optionValue` and `optionLabel` default to reading `.value` and `.label` off each option. If your options are
an API row with neither, those defaults return `undefined` and every row renders empty — and the type said
nothing, because it declared the accessors optional. It now requires them for an option type it cannot read:

~~~ts
// still fine — the defaults genuinely handle these
Select({ options: [{ value: 'lt', label: 'Lithuania' }] });
Select({ options: ['Small', 'Large'] });

// now an error, and always was broken at runtime
Select({ options: rows });                       // rows: { id, name }[]
// the fix is the two accessors you already needed
Select({ options: rows, optionValue: (r) => r.id, optionLabel: (r) => r.name });
~~~

An option type is "self-describing" when it is a plain string or carries a `value` field — a `{ value, label }`
list, a string list, an empty list, and a domain object that already passes its accessors are all unchanged.
If you annotate the props bag by hand, name the whole contract: `SelectProps<Row> & RequiredAccessors<Row>`.

### A generic component was never really type-checked

The same audit found why the above stayed invisible. A component whose `setup` is generic — six of them:
`autocomplete`, `list`, `select`, `table`, `tabs`, `tree` — shipped a default export with the type parameter
thrown away, because both producers of it read the parameter out of the function type, and TypeScript resolves
an uninstantiated generic to `unknown`. In a template that meant `options` was `unknown[]` and accepted
anything at all; imperatively it meant `Select<Option>(…)` would not compile and an accessor written for your
own row type was rejected against `(item: unknown)`.

Both halves are fixed. The parameters are re-declared onto the default export from the source, and a
component tag's props are now checked by *calling* the component, so the parameter is inferred from the props
you pass. One consequence you may see: a wrong prop type is now reported on the prop's expression rather than
on its name.

### `weave check` reads the markup inside `patch` ops

A component-file extension that patches its base's template (RFC 0008) wrote no template of its own, so the
checker treated it as an ordinary module and its patched markup was the one template Weave never looked at. It
is now checked *in place* — patched into the base and checked there, so an op landing inside the base's `@for`
sees that block's local, and the context is the base's plus your own. A typo lands on the character you wrote
it on. Errors in the base's own markup stay the base's.

### A prerendered page is your document

`weave build --ssg` assembled each page from scratch — charset, title, stylesheet — and dropped everything
your `index.html` said: the viewport meta, `lang`, your description and social meta, your favicon, and
`<base>`. That last one broke more than itself, since a page at `/learn/templates` resolves relative URLs
against `/learn/`. Your `<html>` attributes and whole `<head>` are now inherited by every generated route;
only `<meta charset>` and the per-route `<title>` stay the generator's.

### `weave migrate` tells you where the missing styles live

A migrated component carries its own `styleUrls`. A project that keeps a shared stylesheet library keeps half
its look in no component folder at all, so the component arrived correct and rendered unstyled with nothing
saying why. Every converted template is now read for the classes it applies, and any class its own stylesheets
don't define is looked up across your source workspace — the file that defines it is named at the top of the
template. The rules are named, never copied: lifted out of their library they lose the variables and mixins
around them.

### Also

- **Auto-expose no longer writes a `return` naming bindings your `setup` cannot see** — it could, for a patch
  extension, and the component threw `ReferenceError` the first time it was created.
- **`weave check` no longer dies on a module that quotes a component declaration.** Any file holding Weave
  examples as data — a documentation page does — had its own prose read as a declaration, and one such file
  aborted the whole run with a stack trace.
- **Editor plugins:** the VS Code extension (`0.6.1`) no longer bundles the vulnerable `brace-expansion`, and
  the WebStorm plugin (`0.23.1`) declares no `until-build`, so a new IDE build no longer disables it.

## 2.3.0 — 2026-07-31

One small addition, from a real screen that needed it. A **minor**: new optional surface with a safe
default, nothing existing touched.

**`tooltip` takes a `class`, so one tooltip can look different from the rest.** The bubble renders into the CDK
overlay container at the top of the document, not inside the component that asked for it — so component-scoped
CSS never reaches it, and neither does a token set on an ancestor of the host. Until now the only lever was
`.weave-tooltip` itself, which is every tooltip in the app.

The class lands on the same element that carries `.weave-tooltip`, so your rule sets that component's own
tokens and nothing else needs to know:

~~~html
<span use:tooltip={{ { text: message(), class: 'tooltip-error' } }}>!</span>
~~~
~~~scss
.tooltip-error {
  --weave-tooltip-background: var(--weave-color-error);
  --weave-tooltip-text: var(--weave-color-surface);
}
~~~

A field's validation bubble reads as an error while the submit button's tooltip on the same screen stays
neutral. Omitting `class` leaves the panel exactly as before.

## 2.2.1 — 2026-07-29

A router fix, reported from a real app. A **patch** by the rule in
[VERSIONING.md](VERSIONING.md): behaviour moves toward what was documented and intended, and no API shape
changes — the behaviour being replaced was a blank page, not something an app could have worked against.

**`guard` and `redirect` on `path: '/'` no longer fire for every other route.** Matching is prefix-based and
`/` — like an index child `''` — compiles to **zero segments**, so it is a prefix of every URL at its level.
Policy was evaluated on such a candidate before anything checked whether a child consumed the remainder, so a
redirect meant for the index fired on unrelated paths, sent the router back to a path that matched the same
route again, and the 16-hop cap returned an **empty chain**: nothing rendered, nothing threw, nothing was
logged. A menu-driven route table with `{ path: '/', guard: () => '/login' }` simply looked like a router that
does not work.

Resolution is now two passes — match structurally, then apply `redirect`/`guard` **outside-in** over the chain
that actually resulted — so a layout's auth check still decides before its child is consulted, and `path: '/'`
is usable both as the home route and as a root layout with children. The same change fixes a subtler case: a
route **with** children whose guard used to run for a sub-path none of them matched.

`false` still means "block this branch", and now does so at every depth: the blocked route is struck out and
matching runs again, so the next route matching that URL gets its turn. That is what the docs already
described; at the top level the code did not do it.

**Two silent failures now speak.** A redirect loop that exhausts its 16 hops logs the cycle it followed
(`/users → /login → /users → …`) instead of rendering nothing, and a matched route with no `component` — which
blanks the outlet and stops any nested `<RouterView>` from mounting — is named in a warning.

## 2.2.0 — 2026-07-29

A feature release built around one large addition — a migration path into Weave — plus a crash in the reactive
core that any large list could reach. Everything is backward-compatible; 2.x code keeps working.

**`weave migrate` — assisted migration of an Angular app into Weave** ([RFC 0011](rfcs/0011-migrate.md)). Run it
from inside the Weave app you are migrating *into*. It reads your Angular project (only ever reads it), builds a
map of facts, writes a `migration-plan.md` you read **before** anything changes, and then — only if you say yes —
writes the converted code into `src/`. An existing file in the target is never overwritten.

It converts `@Component` → `setup()` plus a sibling template · `@Injectable({providedIn:'root'})` → `store()`,
and a scoped one → `createContext` + `provide`/`inject` · `@Pipe` → a plain function · `@Directive` → a `use:`
action · `*ngIf`/`*ngFor`/`*ngSwitch` → `@if`/`@for`/`@switch` · `[prop]`/`(event)`/`[(ngModel)]` →
`.prop`/`on:`/`bind:value` · `<ng-template>`/`*ngTemplateOutlet` → `@snippet`/`@render` · `<ng-content>` →
`<slot>` · reactive forms → `@weave-framework/forms` · route guards → `beforeEach` · `HttpClient` →
`@weave-framework/data` · Angular Material → the Weave UI library. **RxJS is translated, not described**: chains
are rewritten by folding the operators over the shape of their source, so an app that finishes a migration is not
left importing `rxjs`. It is an assistant, not a magic button — everything it cannot do confidently is written
into the plan as *needs you*, with the reason.

**`<Table>` gained a per-column filter row and a virtual body.** `headerRow={{ (col) => … }}` renders a second
row inside `<thead>`, directly under the headers, each cell inheriting its column's width, alignment and sticky
treatment — the one place a filter row can live and stay aligned when a column auto-sizes. `virtual` renders only
the rows in view: first render of a 1000×20 grid was ~480 ms of build and ~850 ms laid out, and a viewport holds
20–40 rows however long the data is. It needs `maxHeight` and a uniform `rowHeight`; the two configurations it
cannot honour are refused at setup rather than left to show the wrong rows.

**A signal written during a render no longer recurses per item.** `flush()` guarded only against batching, so a
write that happened *while* the effect queue was draining started a second drain inside the effect still running.
Writing a signal from an effect is ordinary — `ref={{ el }}` alone does it, on every component that takes a ref —
so a long list of such components nested one stack frame per item and ended in `RangeError: Maximum call stack
size exceeded`, with the render abandoned mid-list and the DOM left half-updated. Reported against a large
`<Table>` where a column change tipped it over. `batch` could not help and was measured not to.

**A component's type now says it returns a `Node`.** Both places that synthesize a component's default export —
`weave check` (and through it the editor plugin) and the built `@weave-framework/ui` `.d.ts` — said `unknown`, so
every imperative call site needed a cast. That is most of the composition surface: a `<Table>` column's `cell`, an
`<Expansion>` panel body, anything typed to take a `Node`. Pure narrowing, no runtime change.

**Overlays follow their trigger when the page rearranges.** A connected panel — a Select listbox, a Menu, an
Autocomplete panel, a Tooltip — only repositioned on window scroll/resize, so it stayed where it was placed when a
splitter was dragged, a sidebar collapsed, or a drawer animated open. It now observes the origin, its containing
block and the panel.

**Also:** a component **library** can declare a `weave.config.ts` (it needs one for `styleLang`, and resolving a
config used to reject anything without `root`/`entry`) · `weave build` no longer fails when `publicDir` is left at
its default, and no longer copies an undeclared project directory — sources, `node_modules`, `.env` — into `dist/`
· a **comment between the pieces of a split `template`** is no longer read as a non-static template · the ui
publish build no longer breaks on a component declaring `propDefaults` or `extend`.

**Security.** `brace-expansion` is pinned past CVE-2026-14257 (the pin's old target would have let a future
resolution land back on a vulnerable version), which also moved the VS Code extension to
`vscode-languageclient@10` — raising its floor to VS Code ^1.91. Four code-scanning alerts are closed, one of
which was a gate quietly not gating: a word-boundary regex written inside a template literal accepted a different
symbol than the one it was checking for.

## 2.1.0 — 2026-07-24

A feature release driven by real-app use, plus an internal refactor of the resume engine. Everything is
backward-compatible — 2.x code keeps working.

**Input masking (`use:mask`, `@weave-framework/ui/cdk`).** A headless CDK primitive that formats a text input
as the user types — phone, card, date templates, and a **numeric mode for money** that fills from the right,
groups thousands, and keeps a canonical decimal string as the value. Two fixes landed with it from the
dogfooding app: `use:mask` now binds the inner control of `<Input>` (not its wrapper `<div>`), and the numeric
mode exists because a positional template genuinely cannot carry an amount (RFC 0010 records why).

**`openDialog` can host a live component.** Pass `[Component, props]` (or `component(C, p)`) and the dialog
mounts it under an owner and disposes it on close — reactivity inside a dialog now works and the graph no
longer leaks. `Node` / `string` / factory content is unchanged.

**App-wide date/time picker defaults.** `provideDateTimeDefaults()` sets adapter, locale, first day of week,
display format, translated chrome and 12/24h once on the owner tree, instead of repeating them on every
`<Datepicker>` / `<DateRangePicker>` / `<Timepicker>`. Resolution is instance prop → context → built-in, and a
settings change now reaches an already-mounted field.

**`infiniteScroll` in the CDK.** A load-more sentinel (`use:infiniteScroll`) that requests the next page as the
list nears the end — never overlapping a request in flight, re-arming when a filter resets, and chaining even
when a page is too short to fill the viewport. Composes with `virtualScroll` (that decides what to render, this
when to fetch).

**Resume engine — the adopt navigation is now one cursor program (internal).** The client-side DOM adoption
that makes a resumed page interactive without re-rendering was rebuilt around a single sequential `AdoptCursor`
walk, replacing the old absolute build-time index math and its post-block special cases. No public API or
template behaviour changed and the non-resumable output is byte-for-byte identical; a `@let` after a block now
resumes instead of client-rendering, and a resumed page carries ~0.9 KB more JS (the navigation logic moved
into the runtime — a deliberate one-time cost that should fall when per-island splitting lands). A plain
client-only SPA is unaffected.

**Also:** a proxied stream in `weave dev` could take the whole dev server down — fixed. The one open axios
Dependabot alert (a transitive of the build tooling, never shipped) is closed via a scoped override.

## 2.0.1 — 2026-07-19

A same-day fix to 2.0.0: `npm create weave` was still scaffolding projects onto 1.x.

The template pinned its dependencies at `^1.0.0`, and a caret range does not cross a major — so a brand-new
project created minutes after 2.0.0 shipped installed 1.8.0 and got none of it, including both security
fixes. Exactly the people least able to notice.

The ranges now follow the release major, and a gate (`verify:template-ranges`) fails the build if they ever
drift again. Nothing else changed.

## 2.0.0 — 2026-07-19

A release made entirely of things that were already wrong. An external audit went through the whole
codebase and produced 24 defects; GitHub code scanning had 11 open alerts. All 35 are closed here, each
one reproduced before it was fixed and each fix pinned by a test that fails without it.

**Why the major.** Nothing was removed, nothing was renamed, no signature changed — code written against
1.x still compiles. But four fixes change how existing code *behaves*, and Weave's versioning promise says
plainly that a changed default behaviour is a major. Paying that cost now is the honest option; the
[CHANGELOG](CHANGELOG.md) lists all four at the top of the 2.0.0 section.

### 🔒 Two security fixes

**A stored XSS in static builds.** `renderDocument` wrote the page title, `lang` and the client-entry URL
into the HTML without escaping. A title is routinely derived from data — a route-title effect reading a CMS
record, a product name, a username — so a title containing a closing `</title>` followed by a script tag
became executable markup baked into every generated page, and it persisted there. Now escaped for the
position it lands in. `head` stays raw, because injecting markup is that option's documented purpose.

**Code injection in the compiler's own output.** The compiler builds JavaScript source by interpolating
template text into string literals, and quoted it with `JSON.stringify`. That is right for JSON and wrong
for code: JSON leaves `</script>` and U+2028/U+2029 raw. A template attribute holding `</script>` came
through verbatim, so the generated module terminated any script block it was inlined into. Three emit sites
bypassed the quoting helper entirely — including the one carrying the whole hoisted template.

### 🐛 The silent ones

The defects worth naming are the ones that produced no error at all.

**A reactive update aimed at a running effect was dropped.** A running computation is marked dirty for its
whole execution, and the invalidation check returned early on an already-dirty node — so an update arriving
mid-run vanished. The effect finished holding a value that was already stale, went clean, and left the
queue. Nothing threw, nothing looped; it was simply one update behind, permanently, and every later run
landed one behind again.

**`@await` showed stale data.** The rendered branch was rebuilt only when the await *state* changed, and
`resource.mutate()` — the documented optimistic-update path — writes data while leaving `loading` false. So
the branch kept showing the previous value. Refetches survived only because they bounce through `pending`
first, which is a different transition entirely. Two documented APIs, quietly incompatible.

**`@for … track` could key every row identically.** The key expression was resolved against the parent
scope instead of the row, so when a component binding shared the loop variable's name the parameter stopped
shadowing and every row got the same key. Keyed reconciliation then reused nodes for the wrong rows, state
bled between them, and removals collapsed.

**A store died with the component that happened to use it first.** `store()` ran its factory under whichever
owner was ambient at the first call, so every effect created inside it was disposed when that one component
unmounted — while every other consumer went on holding the same half-dead instance. Order-dependent, and
invisible: the signals kept working, so the store still looked alive.

**Two ways the formatter changed your program.** The Prettier plugin printed `disabled=""` as bare
`disabled` — a different prop *type* on a component tag — and dropped whitespace between inline elements, so
`<span><b>a</b><b>b</b></span>` started rendering "a b" instead of "ab". A formatter may reflow anything it
likes except the output.

### 🧭 Router, at the edges where the browser pushes back

A malformed percent-escape in a URL threw inside route resolution and blanked the page instead of falling
back to `*`. A guard redirect pushed a history entry instead of replacing it, so Back returned to the
guarded page, the guard fired again, and the user was trapped. A guard-vetoed multi-entry pop rolled back by
exactly one entry regardless of how far the jump went, leaving the URL and the rendered page disagreeing.

### 🛠 The daily loop

**`weave check` honours your `tsconfig.json`.** It used a hardcoded option set with no `paths` and no
`baseUrl`, so any project using path aliases got "Cannot find module" on every aliased import — a wall of
errors from the framework's own quality tool, against a project that is correct.

**A failed rebuild no longer reloads the browser into nothing.** `weave dev` cleared its in-memory outputs,
refilled them from a failed build's empty list, and reloaded anyway — so a syntax error produced a white
page with the real error only in the terminal. The last good bundle is now kept and the error is painted
over the still-working page.

**Source maps.** Neither `weave dev` nor `weave build` emitted any. Both do now.

### ⚙️ Release engineering

Publishing was gated only on a `[publish]` marker — no test ran before packages went to npm with a
provenance attestation. The suite now runs inside the publish job. And a partial publish can be resumed:
the failure message used to promise that npm skips already-published packages, which it does not.

### Full detail

Every entry, with the reasoning: [CHANGELOG.md](CHANGELOG.md).

## 1.8.0 — 2026-07-19

A release about the parts of Weave that *teach* — the skills an AI agent reads, the MCP server it
calls, the JSDoc your editor shows on hover. None of it changes how your app runs. All of it changes
whether the code written against Weave is correct.

The theme, plainly: **documentation that is wrong is worse than documentation that is missing.**
Missing docs make someone look things up. Wrong docs get copied.

### ✨ MCP server speaks the current protocol, and negotiates

`@weave-framework/mcp` declared MCP revision `2024-11-05` — about a year behind current. It now
speaks through **`2025-11-25`** and, more importantly, **negotiates**: it answers with the version the
client asked for when it knows that one, instead of always announcing its own. Bumping the number
alone would have been a regression — the spec tells a client to disconnect when handed a version it
does not support, so an older client would have been shown the door over a session that worked fine.

Also: a tool called with a missing argument now says which one. Every tool declared `required` in its
schema and nothing enforced it, so `weave_compile_template` answered *"Empty template fragment"* — a
message that sends you to inspect your markup when the fault was in the call.

### 🐛 The skills no longer teach a resource leak

The component skill's lifecycle example was:

```ts
onMount(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id)); // registers nothing
});
```

`onCleanup` registers on the **currently running computation**, and an `onMount` callback fires later
on a microtask, where there is none. It silently did nothing. Every component written from that
example kept its interval running after unmount, with no error anywhere. It uses `onDispose` now, and
both hooks are documented with the distinction spelled out.

### 📚 The skills now cover the whole public API

They are what an AI assistant reads before writing Weave code, so a gap there is not a missing
paragraph — it is an assistant inventing an API in its place. Measured: **84 public exports were never
mentioned**, including `onMount`, `provide`/`inject`, the entire devtools surface, every transition,
`Interceptor` and `Optimistic`. All documented now, written from the source, weighted toward what
goes wrong rather than what exists.

A new CI gate keeps it that way: every public export must appear in its skill, every `ts`/`html`
example must parse, and the templates skill must show every block, directive and special attribute
the parser accepts. A code fence now carries a promise — `ts`/`html` is real, checked code you can
paste; shorthand notation lives in `txt`.

### 🐛 Two documentation defects worth naming

- **`/learn/forms` described an implementation that no longer exists.** It called `validateAsync()`
  *"a bounded poll (~30 ms ticks, capped at ~2 s)"*. It watches `validating()` with an effect: no
  polling, no timeout. A reader was budgeting for a two-second cap that was never there.
- **The `fieldArray` JSDoc example did not compile.** Its seeds did not match the shape its factory
  returned (`TS2322`). That snippet is what your editor shows on hover and what the published API
  reference prints — a broken example handed over at the exact moment you are about to copy it.

## 1.7.0 — 2026-07-18

Correctness fixes in the framework and a substantial repair of the WebStorm editing experience,
plus a pass over the documentation site's own presentation.

### 🐛 Fixes

- **WebStorm no longer paints correct code red.** The language server bundled inside the WebStorm
  plugin had gone stale: it predated `auto-expose` (a `setup()` may omit its `return`), so it typed
  the template context as `void` and flagged *every* binding of *every* such component. On a real
  application that was 1642 false errors across 39 of 41 files — while `weave check` on the same
  files reported none. Install `weave-webstorm-0.23.0.zip`. A new CI gate now fails the build if the
  server inside the shipped `.zip` ever differs from the one in the repository again.

- **Template highlighting is no longer one lonely colored word.** A call inside a binding —
  `{{ rangeValue() }}`, `{{ adapter() }}` — rendered as plain black text, because the color key it
  inherited from has no foreground in *any* scheme WebStorm ships. A bare identifier next to it was
  colored, which made the whole thing look broken rather than merely plain. Calls and directive
  prefixes now carry explicit colors, and remain retunable under
  **Settings → Editor → Color Scheme → Weave**.

- **The editor now actually enforces a child component's props.** Because the server never resolved
  an imported component's synthesized default export, `typeof Child` fell back to `any` and every
  `<Child prop={{ … }}>` check quietly passed — passing a number where a handler belongs, or a prop
  the child does not declare, produced no error. The same gap stripped inline handler parameters of
  their contextual type, so `onChange={{ (v) => … }}` reported a *spurious* implicit-`any`. Both are
  fixed, and a prop error is now pinned to the prop name in the template.

- **A nested `@for` no longer reads the wrong row.** Every loop row function took a parameter
  literally named `_row`, so an inner loop shadowed its parent. An outer loop variable referenced
  inside a nested loop compiled to the *inner* item — silently, with no error. Where the inner item
  happened to carry a same-named property the value looked plausible; where it did not, the binding
  rendered empty. Each loop now gets its own row identifier. The magic names (`$index`, `$first`,
  `$last`, …) still rebind to the innermost loop, which is the correct shadowing.

- **A bare `#fragment` scrolls instead of navigating away.** `navigate('#section')` took the empty
  string before the `#` as the destination path, which resolves to `/` — so an in-page anchor threw
  the app back to the root route and lost the page you were reading. A bare fragment now keeps the
  current path and query and just scrolls.

- **`<Sidenav>` fills its container.** The shell set no height, so a drawer stopped at its last nav
  item instead of running the full height of the box it was given. Auto-height parents are
  unaffected (it resolves to a no-op there).

- **`<Tree>` and `<List>` use real icons.** The tree disclosure marker was a CSS `▸` glyph and both
  components drew their reorder handle as a `⠿` character; they are lucide `<Icon>`s now
  (`chevron-right`, `grip-vertical`). `grip-vertical` joins the built-in icon set. The tree's
  `toggle-glyph` token moves 12px → 14px, since a chevron icon needs slightly more than the glyph
  did to read at the same weight.

### ⚠️ Deprecated (still emitted, still safe to set)

Five design tokens became inert during this cycle — the rules that read them went away when a `×`
character became a lucide icon and a `marked` button's underline became a tonal fill. They are **kept
and emitted**, because the design-token contract is frozen public API: a token is deprecated first and
removed only in a major. If you set one of these, nothing breaks — but nothing happens either, so move
to the replacement when convenient.

| Deprecated | Instead |
| --- | --- |
| `--weave-button-mark-width` | no replacement — `marked` is a tonal fill, not an underline |
| `--weave-chips-remove-font-size` | `--weave-chips-remove-icon` |
| `--weave-input-clear-size` | sized by the icon rules |
| `--weave-datepicker-cell-size` *(typography)* | `--weave-datepicker-cell-font` |
| `--weave-date-range-picker-cell-size` *(typography)* | `--weave-date-range-picker-cell-font` |

(The `sizing` group's `cell-size` on both pickers is untouched and still does what it always did.)

### 📚 Documentation site

- Each API reference package page now opens with a **jump index** of its exports, grouped by kind
  with a per-entry badge — `@weave-framework/runtime` alone is 56 symbols, previously all expanded
  end to end with no way to see what the package contained.
- **API anchors are unique.** A function and a same-named type collided (`resource` and `Resource`
  both became `#resource`), which is a duplicate DOM id and sent half those links to the wrong
  symbol. Existing deep links still resolve.
- Component demos read as finished, anchored surfaces rather than floating on the backdrop, and the
  Progress Bar — previously zero-width in the demo stage, with a track the colour of the page — is
  visible.

## 1.6.0 — 2026-07-17

The big one: **Weave renders to HTML at build time, and the browser resumes it instead of rebuilding it.**
Everything here is opt-in and additive — a normal `weave build` is byte-for-byte what it was, and no existing
code changes.

### ✨ Features

- **`weave build --ssg` — static generation.** Every route renders to real HTML at build time: painted on
  arrival, crawlable, and served as plain files (no server at request time). Routes are derived automatically,
  each page gets its own `<title>`, and each is its own chunk — a reader downloads the page they opened, not
  your whole site. On our own documentation site that is **1555.7 KB → 169.7 KB** of transferred payload for a
  single page, measured in the browser.

- **`ssg: { resume: true }` — resumability.** With `--ssg` alone the browser client-renders over the
  prerendered HTML; add this and it **adopts** it instead. The build snapshots the reactive graph — every
  signal's value, per component instance — into an inline `<script type="application/weave">`; the client
  rebuilds the signals and attaches the *existing* DOM to them. **`setup()` is never called on the client.**
  The nodes the server wrote are the nodes you keep, down to the same text node. Re-running means paying for
  the render twice — once to produce the HTML, once to discover what it already says. Resuming pays once.

- **Data prerenders with the page.** A `resource()` that fetches during a build is awaited **before the HTML is
  written**, and its result travels in the snapshot. No spinner on first paint, and no second request for data
  the build already has.

- **`lazy()` prerenders too.** A lazily-imported component still renders its real HTML into the page, and still
  stays out of everyone else's bundle. Lazy means "not in your bundle", not "not in your HTML" — so there is no
  trade between a complete first paint and a small download.

- **Resume covers what real components actually do:** nested components, `<slot>`, element `ref`s (re-bound
  from the adopted DOM rather than serialized), `use:` actions, `@if`/`@for`/`@switch`/`@key`/`@render`/
  `@snippet`, routed views, component-level `on:` handlers, `props`, module-scope bindings, `effect()` and
  `onMount()` in `setup()`.

- **It tells you what it cannot resume, at build time.** A value that cannot cross the wire (a live socket, a
  class instance) makes that component client-render — with a warning that names the binding, the file and the
  cause, never a silent degradation. `weave build --ssg` also warns for a handler that won't inline or a
  computed that can't be rebuilt.

- **`<Timepicker>`, `<Select>`, `<Datepicker>`, `<DateRangePicker>` use lucide icons** instead of hand-drawn
  glyphs, matching the rest of the library.

### 🐛 Fixes

- **`--ssg` + `resume` was broken for every multi-root app — including ours.** The client entry handed the
  adopt walk `firstElementChild`, which is right for a single-root component and wrong for a multi-root one,
  whose roots *are* the mount target's children. It threw on its first step, silently, and the page stayed
  inert server HTML. Nothing on our documentation site had ever resumed. The compiler now publishes the
  contract (`adopt.container`) rather than the caller guessing it, and a root that cannot adopt client-renders
  outright instead of arming handlers over DOM nobody adopted.

- **A bare `effect()` in `setup()` is re-created on resume.** It binds no name, so nothing rebuilt it: a
  per-route `document.title` effect stayed frozen at the server's value forever.

- **An `onMount()` in `setup()` resumes.** An earlier build refused to adopt any component that had one; that
  refusal was wrong (the hook is re-created, exactly as an effect is) and it was also the more expensive
  answer, since client-rendering re-runs `setup()` and fires the hook anyway.

- **`onMount` is inert during a build by construction** — there is no browser at build time, and it no longer
  depends on the render happening to be synchronous to stay that way.

- **Regex literals, comments, type annotations, casts, destructuring, generics and shadowed declarations** are
  no longer misread as variable references by the compiler's setup analysis. Each of these quietly narrowed
  what could resume.

### 🔬 Under the hood

- **CI.** This repository had none: the test suite, typecheck, lint and size budgets ran only when someone
  remembered. Three jobs now run on every push, including `verify:resume` — a real app, built by the real CLI,
  resumed and clicked in a real browser.
- **Size budgets are enforced** (`verify:size`). The SPA core is 21.2 KB gzipped; resume, adopt and serialize
  sit on their own budget lines and cost a SPA-only app **zero bytes**.
- **Zero third-party runtime dependencies**, unchanged.

## 1.5.28 — 2026-07-14

### 🐛 Fixes

- **`<DateRangePicker>` — the second click now always registers (FW-17 follow-up).** Picking the
  first date worked, but the second click often did nothing: while you moved the pointer toward the
  end date, each hover rebuilt the whole day grid, so the day cell under the cursor was replaced
  mid-click — the `mousedown` landed on the old node and the `mouseup` on the new one, and the
  browser never fired a `click`. The hover preview now re-decorates the existing day cells **in
  place** (a new shared `refreshDays()` on the calendar core) instead of rebuilding them, so cells
  keep their identity and real clicks always land. Also stopped the value-sync effect from
  re-rendering on hover (it was tracking the pending/hover signals through the day-cell decorator —
  now runs untracked). `<Datepicker>` is unaffected. Pinned by a regression test that drives a real
  `mousedown → hover → mouseup` and asserts the cell is never detached.

## 1.5.27 — 2026-07-13

### ✨ Features

- **`<DateRangePicker>` — pick a start/end date range (FW-17).** A new
  `@weave-framework/ui/date-range-picker`: an underline trigger field showing `start – end` plus the same
  calendar popover as `<Datepicker>` (day → year → month drill-down, one month at a time). Selecting a range
  is **two clicks** — the first sets the anchor, the second completes it (the ends are ordered for you, so
  clicking before the anchor just makes it the new start); while you pick the end, **hovering previews** the
  span (a tinted band with a dashed ring on the tentative end). The value is a `DateRange` —
  `{ start, end }` of local-midnight `Date`s — bound the usual two ways (`value` + `onChange`, or a forms
  `control` (`Field<DateRange>`)). Supports `min`/`max`/`dateFilter`, `firstDayOfWeek` (default Monday),
  translatable `labels`, a configurable `separator`, `clearable`, and full keyboard nav. Closing the popover
  before the second click discards the half-picked range.

### 🔧 Internal

- **Shared headless calendar engine.** The three drill-down calendar views (day/year/month grids, ‹/› nav,
  view-switch header, roving focus, full keyboard) were pulled out of `<Datepicker>` into a reusable
  `createCalendarView` core + a prefix-parameterised `calendar()` SCSS mixin, so `<Datepicker>` and
  `<DateRangePicker>` share **one** engine and one visual with zero duplication. `<Datepicker>` is behaviourally
  unchanged (its full test suite stays green).

## 1.5.23 — 2026-07-10

### ✨ Features

- **`<Datepicker>` — year & month drill-down, configurable first day of week, translatable chrome.**
  Navigating far in time is now a couple of clicks: click the calendar's "Month Year" header to open a
  **year grid** (pages of 24, ‹/› jump a page), pick a year for a **month grid** (Jan–Dec), pick a month to
  land on that month's day calendar — all in the one popover, fully keyboard-navigable. A new
  **`firstDayOfWeek`** prop (`0` Sunday … `6` Saturday) sets the grid's starting weekday, defaulting to
  **Monday** (override per instance). A new **`labels`** prop translates all the calendar chrome strings
  (nav buttons, year switch, dialog name, clear / open-calendar) — English by default, and since props are
  reactive they can carry `t('…')` from i18n. Month / weekday / year text stays locale-driven. The day view
  is unchanged for existing users.

### 🐛 Fixes

- **`<Tabs>` sliding indicator tracks the active tab under a `tabTemplate` (FW-15).** Combining
  `slidingIndicator` with a custom `tabTemplate` used to leave the indicator the wrong size and in the
  wrong place — it collapsed to a small circle (under a pill skin) parked near the first tab, most stubbornly
  when you **reversed direction** across the active tab. Two causes: its geometry was read off a list of tab
  buttons captured once at mount (stale once templated bodies re-render), and it was measured *synchronously*
  while the newly-active button's content was still being re-rendered for the new selection. The indicator
  now always measures the **live** active button **on the next animation frame** — after its DOM + layout
  have settled — so it lands on the correct position and full width for **every** selection, any direction,
  any distance, and never captures a pre-render/partial box. It also re-places when the `tabs` set changes
  and catches genuinely-later async resizes (font/icon load). Plain (no-`tabTemplate`) tabs are unchanged.

## 1.5.20 — 2026-07-10

### ✨ Features

- **Auto-expose — `setup` without a `return`.** A component's `setup` no longer needs to end with a
  `return { … }` mirror of its bindings. Omit it and Weave synthesizes one, exposing exactly the names
  the template reads — a private helper, a timer, an intermediate value the template never names stays
  private. Writing an explicit top-level `return` opts out (it is used verbatim). The runtime module and
  `weave check` apply the *same* transform, so the runtime context and the type-checked context are
  identical. See *Learn → Components → You can skip the `return`*.

- **No `void Tag;` for template-only component imports.** A child component you import but use only in a
  template (`<Badge/>`) is recognized as used by the Weave editor tooling — it is no longer flagged
  "unused import", so the `void Badge;` keep-alive lines are unnecessary (the imports stay, for
  go-to-definition). Pinned by a regression test.

- **Call common globals inline in templates.** `setTimeout`, `confirm`, `requestAnimationFrame`,
  `FormData`, `crypto`, and other everyday DOM/timer globals now resolve to the real global inside a
  template expression (e.g. `on:click={{ () => setTimeout(close, 200) }}`) instead of being mistaken for
  component data. Parser errors also now point at the exact line, not the top of the file.

- **Bare boolean attributes on components.** `<Button disabled>` now passes the boolean `true` (not the
  empty string), so boolean props work as written and `weave check` no longer flags `'' vs boolean`. A
  quoted attribute still passes a string.

- **Typed `@snippet` parameters.** Annotate a snippet parameter — `@snippet row(ctx: ListRowContext<Task>)`
  — and its body is type-checked against the type (typos caught). Un-annotated parameters stay `any`. This
  makes the `rowTemplate` / `itemTemplate` / `tabTemplate` authoring pattern fully typed.

- **Prop defaults — `export const propDefaults`.** Give a component static default prop values in one place
  instead of `() => props.x ?? default` per prop. A prop the parent omits reads the default; one it passes
  wins (and stays reactive). Defaulted props become optional for the parent, so `weave check` won't demand
  them. `export const propDefaults = { size: 'md', variant: 'primary' };`

- **`bind:` on components.** `<Stepper bind:value={{ count }} />` now works — two-way is the same syntax on
  a component (passing the signal) as on a DOM `<input>`, instead of a compile error.

- **A skill suite for building Weave apps.** Eleven focused, per-subsystem skills (component, reactivity,
  templates, router, forms, store, i18n, data, ui, tooling — plus an orchestrator) that guide an AI editor
  through building Weave apps of any complexity, each grounded in the real API. New apps scaffold them
  automatically; existing apps copy the `skills/` folder into their editor's skills directory.

### 🐛 Fixes

- **Arrow-parameter shadowing in templates.** A template expression whose inline arrow reuses a
  component-binding name — e.g. `items().map((value) => value * 2)` where `value` is also a binding —
  compiled to invalid JS (`(ctx.value) =>`) and broke the build. Codegen now leaves arrow parameters
  alone.

- **`bind:group` with non-string signals.** A radio group bound to a `Signal<number>` now checks the right
  option and writes back a number (not the string). And a form's async validation now settles precisely
  (a reactive watch, not a timed poll).

## 1.5.10 — 2026-07-09
### ✨ Features & docs

- **`@weave-framework/typescript-plugin` published to npm** — the `.ts`-side editor support. A tsserver
  plugin that synthesizes the loader-generated default export so `import X from './x-component'` stops
  reporting **TS1192 "no default export"** in WebStorm and other tsconfig-driven editors. Add
  `"plugins": [{ "name": "@weave-framework/typescript-plugin" }]` to your `tsconfig.json` `compilerOptions`
  and install it as a dev dependency; the Nx generator and `create-weave` template now scaffold both.

- **Nx — use Weave in a mixed workspace** (`@weave-framework/nx`). New guidance (and a scaffolded
  project-local `tsconfig.json`) for making a project use Weave tooling when it sits next to another
  framework — including migrating an Angular project. Three markers (`weave.config.*`, `tsconfig.json`,
  `.prettierrc`) plus a `project.json` target override make both the `nx` CLI and your editor treat the
  project — and its `.html` templates — as Weave rather than the framework beside it. See *Adopt Weave
  one piece at a time → Make a project use Weave*.

### 🐞 Fixes

- **Tabs — `tabTemplate` over dynamic `tabs`** (`@weave-framework/ui`). A custom tab-button template now
  renders (and refreshes) for tabs added or edited after mount, mirroring the `<List>` `rowTemplate` fix —
  the body moved into the reactive keyed tab block. (Panel content still binds at mount; a tab strip is a
  fixed set by design.)
- **`weave check` — a `@snippet` satisfies a `(row) => Node` template prop** (`@weave-framework/check`).
  Snippets are now typed `() => Node` instead of `() => void`, so authoring a `rowTemplate` / `itemTemplate` /
  `tabTemplate` as a `@snippet` and passing it to a locally-typed component no longer reports a spurious
  `'void' is not assignable to 'Node'` type error.

## 1.5.6 — 2026-07-09

`<List>` gains a custom **row template** (FW-14) — the same escape hatch the menu (FW-10) and tabs
(FW-12) have — plus two fixes so it holds up on real, data-driven admin lists. All additive.

### 🐞 Fixes — `@weave-framework/ui`

- **List — `rowTemplate` over dynamic `items`.** The custom row body now renders for rows that appear
  *after* mount — async initial load, infinite-scroll append, reload after create/edit/delete. It was
  wired once at mount over a static snapshot, so any list whose data isn't known synchronously showed
  empty rows. Now the body mounts inside the reactive keyed list block, so create / append / replace /
  remove all just work. API unchanged.
- **List — `rowTemplate` refreshes edited rows.** A row whose `value` stays the same but whose data
  changes (edit a record → refetch) now re-renders its body instead of keeping the stale one. The body
  is re-keyed on the item's identity as well as its selected/disabled state, so every templated field
  updates on a reload — no need to bake a data digest into the row key.

### ✨ Features — `@weave-framework/ui`

- **List — custom row content (`rowTemplate`).** Hand a `<List>` an authored `@snippet` and it
  renders the whole body of each row — a colour dot, the name, tag pills, a muted description,
  trailing action buttons — from the row's `ListRowContext` (`item` + your `data` payload, plus
  `value` / `title` / `meta` / `index` / `selected` / `disabled`). `<List>` and `ListItem` are now
  generic over the payload (`data?: T`). The framework still owns the row, its role, `aria-selected`,
  roving tabindex, keyboard nav and (when `reorderable`) the drag handle rendered *before* the
  template; `title` stays the accessible name + typeahead. It re-renders when a row's `selected`
  flips. In selectable mode a click on an interactive control inside the row (a `<Button>` / link) no
  longer toggles row selection. Off by default → the current title + meta spans. Mirrors the menu's
  `itemTemplate` (FW-10) and tabs' `tabTemplate` (FW-12).

## 1.5.3 — 2026-07-08

Two opt-in `<Tabs>` enhancements (FW-12 `tabTemplate`, FW-13 `slidingIndicator`) plus a
security hardening of the Prettier plugin. All additive — nothing changes without opting in.

### ✨ Features — `@weave-framework/ui`

- **Tabs — sliding indicator (`slidingIndicator`).** Opt into an animated marker that slides and
  resizes to the active tab. The framework renders one `.weave-tabs__indicator` in the list and, on
  every selection (and on resize), sets its `transform: translateX()` + `width` to the active tab's
  box — the CSS transition animates it. Default look is a bottom accent underline
  (`--weave-tabs-indicator-*` tokens); app CSS re-skins it to a pill. Off by default. Composes with
  `tabTemplate`.
- **Tabs — custom tab-button content (`tabTemplate`).** Hand `<Tabs>` an authored `@snippet` and it
  renders the whole content of each `role="tab"` button — an icon before the label, a badge, two
  lines — from each tab's `TabRowContext` (`item` + your `data` payload, `label`, `index`, reactive
  `selected`, `disabled`). The framework still owns the button, ARIA, roving tabindex and panels;
  `label` stays the accessible name. `<Tabs>`/`TabItem` are now generic over the payload
  (`data?: T`). Omit `tabTemplate` for the default label span — fully back-compatible. Mirrors the
  menu's `itemTemplate` (FW-10/FW-12).

### 🔒 Security

- **prettier-plugin — ReDoS hardening.** The `<script>`/`<style>`/`lang` detection regexes in the
  plugin's `parse.ts` no longer use the ambiguous `(\s[^>]*)?` form that CodeQL flagged as polynomial
  backtracking (5 `js/polynomial-redos` alerts). They now use a zero-width `(?=[\s>])` assertion and
  read `lang` from the captured `<style>` attributes, not a second whole-document scan. Formatting
  behaviour is unchanged.

## 1.5.0 — 2026-07-07

Everything since **1.4.0** (developed locally as `1.4.1`→`1.4.22` in batch mode, released here as a
single **minor** — new public API across `ui`, `runtime` and `i18n`).

### ✨ Features — `@weave-framework/ui`

- **Input — password/secret reveal (`revealable`).** An opt-in eye toggle that flips an
  `<input type="password">` to text and back; composes `<Icon>` (eye / eye-off), is a real
  `type="button"` with `aria-pressed`, and is i18n-labelled (`revealLabel` / `hideLabel`).
  Companion props: **`onRevealToggle(shown)`** (notified on each toggle) and
  **`revealTooltip`** (`'none' | 'native' | 'weave'`) choosing the toggle's tooltip — `'native'`
  is a plain `title`, `'weave'` lazily mounts the CDK tooltip. Opt-in: nothing renders without
  `revealable`.
- **Menu / Context Menu — richer rows.** Three additive options, all preserving keyboard nav,
  typeahead (`optionLabel`), ARIA, `disabled`, `divider` and positioning:
  - **`selected`** — a value picker: the row equal to it is marked `role=menuitemradio` +
    `aria-checked` with a leading check. Pass a getter so the mark tracks the value (re-read on
    every open).
  - **`optionContent(item) => Node`** (FW-9) — custom row body (a flag, icon, swatch, avatar)
    in place of the default label; `optionLabel` still drives the accessible name + typeahead.
  - **`itemTemplate(row) => Node`** (FW-10) — an authored `@snippet` that renders the **whole**
    row from the full row context (`item`, `checked`, reactive `active()`, `index`, `disabled`),
    owning the layout, marker (position + icon) and selected/active styling. `selected` still
    sets the ARIA; the visible marker becomes the template's job.

### ✨ Features — runtime & i18n

- **`@weave-framework/runtime` — Observable↔signal bridge.** `fromObservable(obs, initial)` and
  `toObservable(signal)` interop with any `Symbol.observable` / `.subscribe` source (RxJS, etc.)
  with no dependency added.
- **`@weave-framework/i18n` — standalone Intl formatters.** `formatNumber` / `formatCurrency` /
  `formatPercent` / `formatDate` / `formatRelativeTime` / `formatList` — the zero-dep replacement
  for Angular pipes, usable in `.ts` and templates, honouring the active locale.

### 🐞 Fixes — `@weave-framework/compiler`

- **`use:` config object literals now compile.** A reactive binding expression that is an object
  literal (`use:tip={{ { placement: 'top' } }}`) was read as a statement block; expressions are
  now parenthesized at every binding site.
- **Object spread/rest is scope-rewritten.** `{ ...opts, … }` inside a template expression left
  `opts` as a bare global (the `...` was mistaken for a member `.`), so
  `use:menu={{ { ...menuOpts, itemTemplate: row } }}` silently lost its options. Both the rewriter
  and auto-scope inference now recognise a spread argument as a data reference.
- **Self-closing SVG tags stay siblings (FW-8).** A self-closing foreign-content element
  (`<path/>`, `<circle/>`) is serialized with an explicit close tag, so following siblings no
  longer nest inside it.

### 🐞 Fixes — `@weave-framework/cli`

- **`styles` url() assets are emitted + served (FW-7).** Relative `url(...)` references in compiled
  CSS (fonts, images) are hashed, copied into the build, and served in dev — previously they
  404'd because only the CSS text was bundled.

### 📚 Docs

- **Per-component example galleries** for all 38 `@weave-framework/ui` components under
  Examples → Components (each a live, full-option-surface page).
- **Menu and Context Menu galleries** for `selected`, `optionContent` and `itemTemplate`.

## 1.4.0 — 2026-07-06

### ✨ Feature — `@weave-framework/router`: async before-leave guards (unsaved-changes prompts)
- **New `beforeEach(fn)` — an async, cancellable guard that runs before every navigation commits**
  (push, replace, *and* browser back/forward). Route `guard`s are synchronous by design (great for
  auth), so there was no point at which navigation could pause to **await a user decision** — which is
  exactly what an *"you have unsaved changes, really leave?"* prompt on a routed page needs. `beforeEach`
  fills that gap:
  - The guard receives `LeaveInfo { to, from, type }` and returns `boolean | Promise<boolean>` — return
    `false` (or `Promise<false>`) to cancel; the current path and the address bar stay put.
  - **All registered guards must allow** for a navigation to proceed; the first `false` short-circuits.
    `beforeEach(fn)` returns an unregister function — call it in the page's cleanup so the guard only
    lives while that page is mounted.
  - **Browser back/forward is handled too:** on a cancelled `pop` the router rolls history back
    (`history.go`) so the URL matches staying put — no "content old, address new" half-state.
  - `afterEach` fires only on a **committed** navigation (never on a cancelled one); the synchronous
    route guards and matching are unchanged and run only after before-leave allows.
- **New `navigate(to, { replace: true })`** (and the `NavigateOptions` type) — swap the current history
  entry instead of pushing, via `history.replaceState`. This promotes the previously internal-only
  `'replace'` `NavType` to real public API.
- When **no** `beforeEach` guard is registered, navigation stays fully synchronous — existing behavior
  and timing are unchanged.

## 1.3.2 — 2026-07-06

### 🐞 Fix — a template parse error points at the file, not a stack trace
- **`weave check` and `weave build` now surface a malformed template as a clean `file:line:col`
  diagnostic.** 1.3.1 stopped the infinite-loop / OOM on a bad attribute (e.g. `<div }>` or a
  leftover Angular-style `(click)` / `[prop]`), but still dumped a raw parser stack trace with no
  filename. Now:
  - `weave check` prints `path/app.html:2:8 - error: Unexpected character "}" in attributes of <div>`,
    and one bad template no longer aborts the whole check — it becomes an ordinary diagnostic.
  - `weave build` frames the error at the template with the offending source line + caret and fails
    with a concise `weave build failed — N errors.` instead of esbuild's internal stack.
  `ParseError` now carries a structured source offset, so the tools that know the filename can map it
  precisely.

## 1.3.1 — 2026-07-06

### 🐞 Fixes — Nx integration & the template parser
- **`@weave-framework/nx`: builds now land at the Nx-conventional `dist/<project>`.** The `build`
  executor defaults its output to `<workspaceRoot>/dist/<projectRoot>` (matching every other Nx
  plugin) instead of the app-local `dist/`, and the app generator scaffolds
  `"outputs": ["{workspaceRoot}/dist/{projectRoot}"]` so Nx caching restores files to the right
  place. A project can still override via `outputPath` in `project.json`. Standalone (non-Nx)
  `weave build` is unchanged — internally an explicit `--out` now overrides the config's `outDir`,
  which is the seam the executor uses.
- **`@weave-framework/nx`: the `build` executor is now actually published.** A `.gitignore` `build/`
  rule (meant for build output) silently swallowed `packages/nx/src/executors/build/`, so the
  executor's source was never committed and `nx build` failed with *"Unable to resolve
  @weave-framework/nx:build."* The source is un-ignored and shipped, and a smoke test now asserts
  every executor declared in `executors.json` has a non-ignored source and resolves on disk.
- **The template parser no longer hangs / OOMs on a malformed attribute.** A stray character the
  attribute scanner can't consume (e.g. `}` from a Prettier-mangled `router="{{" router }}`) used to
  spin the parse loop forever until Node ran out of memory (~5 GB). It now fails fast with a clear
  `Unexpected character '}' in attributes of <RouterView> (line N, col M)`.

### ✨ Scaffolded apps format their Weave templates
- **`nx g @weave-framework/nx:application` wires up `@weave-framework/prettier-plugin`** — the new
  app gets it as a devDependency plus a `.prettierrc` routing `.html` to the `weave` parser, so
  `{{ }}` bindings format correctly instead of being mangled by a Weave-unaware Prettier.

## 1.3.0 — 2026-07-06

### ✨ New package — `@weave-framework/prettier-plugin`
- **A Prettier plugin for Weave templates.** Prettier's stock HTML parser throws on the first Weave
  token (`SyntaxError: Opening tag "Button" not terminated`), so until now the only workaround was to
  `.prettierignore` your templates — meaning the files you edit most never got formatted. This plugin
  makes `.weave` SFCs and Weave-template `.html` files first-class Prettier citizens: `{{ }}`
  interpolation, `@if`/`@for`/`@switch`/`@defer`/`@await` control flow, and every binding kind
  (`on:`/`bind:`/`use:`/`class:`/`style:`/`ref`/`.prop`). Format-on-save, `prettier --check` in CI,
  and pre-commit hooks all work on templates again.
- **It reuses the compiler's own parser** rather than shipping a separate grammar, so the formatter can
  never drift from what actually compiles. Embedded `{{ }}` expressions are formatted by delegating to
  Prettier's `typescript` printer; a `.weave` SFC's `<script>`/`<style>` blocks go through the
  `typescript`/`css`/`scss` printers. Output is idempotent, and `@@` escaping / comments / binding
  kinds are preserved.
- **`.weave` files are picked up automatically.** Route Weave `.html` templates to the `weave` parser
  with a Prettier `overrides` entry so plain HTML elsewhere is untouched:
  ```jsonc
  { "plugins": ["@weave-framework/prettier-plugin"],
    "overrides": [{ "files": "src/**/*.html", "options": { "parser": "weave" } }] }
  ```
  See [Tooling → Formatting templates](https://weaveframework.dev/learn/tooling#formatting-templates-prettier).
- **Whitespace is conservative by design** in this first release: block structure is reindented and
  expressions are formatted, but inline text runs are not aggressively reflowed (and `<pre>`/`<textarea>`
  are left verbatim), so nothing that could change rendering is touched. Prettier-grade inline
  whitespace reflow is a planned follow-up.

### 🧩 Compiler — opt-in comment preservation
- `parseTemplate(src, { comments: true })` now preserves `<!-- … -->` as `CommentNode`s instead of
  dropping them. It's **off by default**, so codegen and `weave check` are byte-for-byte unchanged; the
  Prettier plugin is the sole consumer, and it's what lets the formatter round-trip comments losslessly.

## 1.2.0 — 2026-07-06

### ✨ Feature — extend a component by *patching* its template
- **A component extension can now patch its base's template instead of overriding it.** Declare
  `export const patch` — a static array of ops — and skip writing your own template; the loader
  resolves the (local) base template, applies the ops, and compiles the result:
  ```ts
  // my-list.ts
  import List from './list';
  export const extend = List;
  export const patch = [
    { op: 'attr',    sel: '.weave-list__row', attr: 'on:dblclick={{ () => onRowDblClick(item) }}' },
    { op: 'prepend', sel: '[role]',           html: '<div class="count">{{ totalCount() }} total</div>' },
  ];
  export function setup(props, base) {
    return { ...base, totalCount: () => base.items().length, onRowDblClick: (i) => props.onOpen?.(i.value) };
  }
  ```
  Ops: `attr` / `removeAttr`, `prepend` / `append`, `before` / `after`, `replace`, `remove`, `wrap`.
  Selectors match by tag, `.class`, `[attr]`, or `[attr=value]`; a selector that matches nothing is a
  **loud build error**. Inserted markup and added attributes are ordinary Weave template text (`{{ }}`,
  `on:`, `use:`, `@if`/`@for`, nested components all work).
- **It's build-time, so it's correct for reactive content** — a patch on a `@for` row applies to every
  row, including ones added later (a runtime DOM patch would miss them). The extension compiles with the
  **base's style hash**, so the base's **scoped CSS still applies**.
- **Two constraints:** the base must be a **local** component (a published package ships no raw template
  — patch a local base, or use full override), and an extension uses **either** patches **or** a
  full-override template, never both.
- **Known limitation:** patch markup isn't type-checked by `weave check` yet (a typo in a patched
  expression surfaces at build/runtime, not in the editor). Full-override (`#1`) extensions are fully
  checked. See [Extending a component](https://weaveframework.dev/learn/components).
- This completes [RFC 0008](rfcs/0008-component-extension.md) (both modes: `#1` full override from 1.1.0,
  `#3` patches here).

## 1.1.0 — 2026-07-06

**Weave's first minor since 1.0** — new, backward-compatible surface (per [VERSIONING.md](VERSIONING.md)):
nothing you already wrote changes.

### ✨ Feature — extend a component without forking it
- **A component can now `extend` another** — it reuses the base's entire `setup` context and behaviour, then
  overrides or adds on top, with its own template as a full override. Authored as an ordinary component file:
  ```ts
  // my-list.ts
  import List from '@weave-framework/ui/list';
  import { computed } from '@weave-framework/runtime';

  export const extend = List;                          // this component extends <List>
  export function setup(props, base) {                 // base = List's setup context
    return { ...base, totalCount: computed(() => base.items().length) }; // reuse + add / override
  }
  ```
  The extension's template reads base-provided names (`listClass`, `items`, …) **and** the ones it adds, all
  from one merged context. Extensions **compose** — an already-extended component can be extended again. To
  reshape data the base's *internals* read (not just what the template sees), an optional `extendProps(props)`
  runs **before** the base setup. See [Extending a component](https://weaveframework.dev/learn/components).
- This is [RFC 0008](rfcs/0008-component-extension.md) **mode #1** (full template override). Declarative
  *patches* against the base template — add just an attribute or a node without rewriting the whole template —
  are a planned follow-up.

## 1.0.15 — 2026-07-06

### ✨ Feature — `use:` actions on component tags
- **A `use:` action now works on a component tag, not just a DOM element** — Weave forwards it to
  the component's single **root element**, with the identical lifecycle it has on an element (runs
  at mount, supports a returned cleanup or `{ update, destroy }`, and re-runs `update` when the
  argument changes; multiple `use:` on one component all run, in order):
  ```html
  <Button use:menu={{ accountMenu }}>Account ▾</Button>   <!-- action attaches to the root <button> -->
  <a use:menu={{ accountMenu }}>Account (footer)</a>       <!-- same menu, native trigger -->
  ```
  This lets a `@weave-framework/ui` `<Button>` (or any single-root component) be a menu/tooltip
  trigger, and preserves the "define once, trigger from many places" pattern across a mix of
  components and native elements. The action's `aria-*` and listeners land on the component's root
  element (e.g. `aria-haspopup`/`aria-expanded` on the `<button>` inside `<Button>`). `weave check`
  type-checks the action as `(Element, arg)` on components too.
- **Single-root constraint, fail-loud.** A component that renders a fragment (multiple top-level
  nodes), a text/comment root, or nothing is a clear error — *"use: on `<Account>`: actions attach
  to a single root element, but `<Account>` renders 3 nodes."* — never a silent mis-attach.
- Component **props**, `on:` events, and element-level `use:` are unchanged — no behaviour change
  for existing code. (`transition:`/`in:`/`out:` and `ref`/`bind:this` on components are not yet
  supported — a natural follow-up on the same forwarding mechanism.)

### 📋 Docs
- Accepted **RFC 0008 — component extension (`extendComponent`)**: a future primitive to subclass
  any component (reuse its `setup` + template, override/add on both) without forking. Design record
  only — not implemented yet.

## 1.0.12 — 2026-07-05

### ✨ Feature — `weave dev` proxy (`dev.proxy`)
- **`weave dev` can now proxy API calls to your backend, so they stay same-origin** (no CORS,
  and `HttpOnly` cookie auth just works). Config it like Vite/Angular/Next:
  ```ts
  dev: { proxy: { '/api': 'http://localhost:5201' } }                     // shorthand
  dev: { proxy: { '/api': { target: '…', changeOrigin: true, rewrite: { '^/api': '' } } } }
  ```
  A request is proxied when its path equals a key or starts with `key + '/'` (so `/api` matches
  `/api` and `/api/x`, but not `/apiary`); the first match wins and runs before Weave's own dev
  routes. The request (method/headers/body/query) is streamed to the backend and the response
  piped back unchanged, so `Cookie` and `Set-Cookie` pass through both ways; `changeOrigin`
  (default `true`) sets the forwarded `Host`, and `rewrite` rewrites the path only (the query is
  preserved). An unreachable backend returns `502` without crashing the dev server. Dev-only —
  production builds are already same-origin. Built on Node's `http`/`https`, no new dependencies.

## 1.0.10 — 2026-07-05

### 🐛 Fix — `@weave-framework/ui` is now consumable from a real app
- **The documented `import Button from '@weave-framework/ui/button'` now works for real npm consumers.** The ui
  library was built with plain `tsc`, so every component shipped UNCOMPILED — `export const template` /
  `export function setup`, no `render`, and no **default export**. A real consumer's `weave build` failed with
  *"No matching export for default"* and `weave check` with *TS1192*. (The monorepo masked it: dev exports resolve
  to `src` and the loader compiles on the fly.) The ui build now compiles each component at build time through the
  same `compileComponent` the loader uses, so dist ships `export default defineComponent(render, setup)` plus a
  props-typed default in its `.d.ts` — `Parameters<typeof Button>[0]` is the component's props. `weave check` also
  gained `esModuleInterop` + `resolveJsonModule`. A new `verify:ui-consume` gate proves consumption against the
  built dist for all 29 components (and fails on the old plain-tsc output).

### 🔧 Infrastructure — docs deploy moved to Cloudflare
- **The documentation site (weaveframework.dev) now deploys to Cloudflare Workers** instead of GitHub Pages, whose
  backend had begun intermittently rejecting deployments with a terminal *"Deployment failed, try again later."*
  (the build always passed; only the Pages deploy step flaked). It now uses the same reliable static-assets path
  as the flagship demo, still gated on a `[publish]` commit so the docs stay in lockstep with npm. No user-facing
  change to the framework.

## 1.0.5 — 2026-07-05

### 🐛 Fixes — scaffolded starter type error
- **The generated starter now type-checks.** Every scaffolder (`create-weave`, the `@weave-framework/nx`
  application/component generators, and the `@weave-framework/mcp` scaffold tool) emitted
  `const inc = (): void => count.set((n) => n + 1);` — but `count.set(...)` returns the new value, so an
  expression-body arrow annotated `(): void` fails with *`TS2322: Type 'number' is not assignable to type 'void'`*.
  Changed to a block body: `const inc = (): void => { count.set((n) => n + 1); };`.
- **New gate:** the `create-weave` starter template is now type-checked in CI (`typecheck` runs its `tsconfig`), so
  a scaffolded app that doesn't compile can no longer ship.

## 1.0.4 — 2026-07-05

### 🐛 Fixes — `@weave-framework/nx` generators
- **`nx g @weave-framework/nx:application` (and `:library`) no longer crash at the end with *"task is not a
  function"*.** The generators returned the project-root string; Nx calls a generator's return value as a task
  callback, so a non-function threw. They now return the install task (a callback).
- **Generated projects get their `@weave-framework/*` dependencies.** The scaffold imports `runtime` (and, for
  apps, the full `router`/`store`/`forms`/`i18n`/`data` set) plus the `cli` dev dependency — the generators now add
  them to `package.json` (mirroring `create-weave`) and install them.
- **The scaffolded `.html` templates keep their Weave `{{ }}` bindings.** `formatFiles` (Prettier) was mangling
  `on:click={{ inc }}` into `on:click="{{" inc }}`; templates are now written *after* formatting so they survive
  verbatim.

## 1.0.3 — 2026-07-05

### 🐛 Fixes
- **`@weave-framework/nx` works with `nx g` / target inference again.** The plugin's `exports` map didn't expose
  `./package.json`, so Nx — which resolves `@weave-framework/nx/package.json` to discover its generators — failed
  with *"Package subpath './package.json' is not defined by exports"*. Added `"./package.json"` to the exports map
  (and, defensively, to every `@weave-framework/*` package) so the manifest is always resolvable. A regression test
  now pins it.
- Fixed stale **"pre-1.0"** copy in the Installation and Quick start docs — Weave is 1.0.

## 1.0.2 — 2026-07-05

### 🐛 Fixes
- **`npm create weave@latest` now scaffolds a 1.0 app.** The starter template pinned `@weave-framework/*` at
  `^0.2.0`, so a fresh project resolved to the old `0.2.x` line instead of 1.0. Bumped the template ranges to
  `^1.0.0`.

## 1.0.0 — 2026-07-05 🎉

**Weave is 1.0.** The public API is now **stable and frozen** — from here, breaking changes only ever
land in a major version, deprecated-first, per [VERSIONING.md](VERSIONING.md). Everything you build on the
documented surface won't change out from under you.

This release is the freeze itself; the features it stabilises shipped across the `0.2.x` line (see `0.2.162`
below and [CHANGELOG.md](CHANGELOG.md) for the full history): the signal-native runtime with no Virtual DOM,
the compiler + template syntax, Router v2, Forms v2 (incl. schema-driven forms), i18n, the data layer,
DevTools, the full `@weave-framework/ui` component library, and the `mcp` + `nx` toolchain packages.

### 🔒 API freeze (what changed for 1.0)
- **Deliberate public surface** ([RFC 0005](rfcs/0005-api-surface-audit.md)) — audited to **151 documented
  exports**. The ~29 compiler-emitted `runtime/dom` helpers (`bindText`, `ifBlock`, `mountChild`, …) are now
  `@internal`: still exported for generated code, but excluded from the reference and carrying **no** stability
  promise. Their signatures stay free to change; your code never imports them directly.
- **Every public export is documented** — the API reference reports zero undocumented public exports.
- **`VERSIONING.md`** states the promise: it covers documented exports, component props, the template syntax,
  and the UI token / ARIA contract; breaking changes are major-only, deprecated first, kept until at least the
  next major.

### 🔧 Internal / CI
- The docs site deploys only on a `[publish]` release, in lockstep with npm — the documentation never runs
  ahead of the installable packages.

## 0.2.162 — 2026-07-05 (`0.2.108`–`0.2.162`)

The largest batch since the last npm release — Phase C, all Tier-2 template features, and four
new dedicated capabilities. Two brand-new packages: **`@weave-framework/mcp`** and **`@weave-framework/nx`**.

### ✨ Features
- **Router v2** (RFC 0003) — the router owns its signals + `useRouter()`; a typed `route()` builder with
  `RouteParamsOf<Path>` param inference; route-level `loader` + `useLoaderData()` (reuses `@await` v2); native
  **View Transitions**.
- **DevTools** — a live in-app panel (`mountDevtoolsPanel()`): named signals/computeds/effects with values, a
  dependency graph (who triggers whom), a temporal **trigger-trace** (`inspectTrace`/`traceFor`), and a
  **component/owner tree** (`inspectTree`) — Nodes / Trace / Tree tabs. Zero-cost when off.
- **Tier-2 template features** — `<Teleport>` (alias of `<Portal>`), `<Dynamic is>`, state-preserving
  `<KeepAlive>`, reactive `style:prop` / `style:--custom`, and reactive `use:` actions (`ActionResult { update, destroy }`).
- **Forms v2** — `dirty()` / pristine across field/group/fieldArray, plus **schema-driven forms**
  (`@weave-framework/forms/schema`): a `fieldType()` registry + `schemaForm()` builder over the existing
  primitives, with 8 built-in field types and a render model.
- **`@weave-framework/mcp`** — a Model Context Protocol server exposing the toolchain to AI editors as tools
  (`weave_compile_template`, `weave_check`, `weave_routes`, `weave_scaffold_component`). In-house JSON-RPC over
  stdio, zero third-party deps. Launch with `weave mcp` or the `weave-mcp` bin.
- **`@weave-framework/nx`** — an Nx plugin: inferred (crystal `createNodesV2`) `build`/`serve`/`check` targets with
  correct cache inputs/outputs, matching executors, and `application` / `library` / `component` generators.
- **`@await` v2** — reactive source (re-enters pending + awaits a new Promise on a dependency change); **transition
  lifecycle callbacks** `on:enterstart/enterend/leavestart/leaveend`.
- **Benchmarks** — a vanilla-baselined harness + a `/learn/performance` methodology page (~1.4× vanilla geomean).

### ♿ Accessibility / i18n
- **Full RTL** — bidi keyboard (key-manager `rtl` option + per-component swaps) and logical-CSS / positioning
  across the component library.

### 🐛 Fixes
- SVG `<path d={{ }}>` and other SVG-only fragment roots now compile and paint (namespace-aware `templateSvg()`).
- Docs sidebar highlights exactly one item — a section-root link (e.g. Examples "Overview") no longer stays
  active on its child routes (`Link` now supports `exact`).

### 🔧 Internal / CI
- The docs site (`weaveframework.dev`) now deploys only on a `[publish]`-marked release, in lockstep with npm — so
  the documentation never gets ahead of the packages you can install. Ordinary pushes still validate the build.
- `pnpm-lock.yaml` synced with the new `@weave-framework/nx` dependencies (fixes `--frozen-lockfile` CI failures).

## 0.2.107 — 2026-07-04

The first npm release since `0.2.53` — it bundles the full accessibility audit, new icon
capabilities, several correctness/performance fixes, and the now-complete UI documentation.

### ✨ Features
- **`<ButtonToggle>` per-segment icon** — an option can carry an `icon` (`{ value, label, icon }`), rendered as a
  composed `<Icon>` before the label.
- **Built-in Lucide icon set grown to 53** — added `sun`, `moon`, `copy`, `git-branch`, `graduation-cap`,
  `book-open`, `package`; every name works from `<Icon name="…">` with zero configuration.

### ♿ Accessibility
- A structural a11y audit across all 37 styled components (roles/states, keyboard, focus, reduced-motion, RTL) —
  **7 test-pinned ARIA fixes**: `aria-controls` lifecycle on Select / Autocomplete / Datepicker, Timepicker
  `aria-valuemin/max`, over-mode Sidenav `aria-modal`, Table resize-grip `aria-valuenow/min`, and Space-to-select
  on the Select listbox.
- A central `prefers-reduced-motion` mixin collapses every library transition/animation (including the infinite
  Progress-Bar and Spinner loops) when the user prefers reduced motion.

### 🐛 Fixes
- Composed child components resolve correctly in a real consumer build — including a `<Checkbox>` nested inside
  `@if`/`@for` (e.g. `<Table selectable>`) and the case where a JSDoc import example was mistaken for a real import.
- Template interpolation no longer scope-prefixes the keys of an inline object literal.
- `weave dev` no longer accumulates duplicate `<style>` tags across client-side navigation — style injection is
  idempotent now (content-hashed id + skip-if-present), so long dev sessions stay responsive.

### 🔒 Security
- `weave dev`'s static-file handler rejects path traversal (403 instead of reading outside the served dir), and
  polynomial-backtracking regex shapes were removed from the router basename normalizer and the compiler extractor.

### 📚 Docs & packaging
- The whole `@weave-framework/ui` component library is documented (38 component pages + a Styling/theming guide),
  each with live demos importing the real component; the docs site itself now dogfoods the UI library for its own
  chrome. Every package ships a README on npm.

## 0.2.54 — 2026-07-03

Security hardening — resolves the code-scanning findings on the published packages. No API change.

### 🔒 Security
- `weave dev`'s static-file handler **rejects path traversal** — a requested asset that resolves outside the
  served directory now returns 403 instead of reading the file.
- Removed polynomial-backtracking regex shapes: the router's `basename` normalizer uses a plain trailing-slash
  trim, and the compiler's `template`/`styles` extractor bounds its optional type-annotation match to one line.

## 0.2.53 — 2026-07-03

Correctness, composition, and security hardening across the core — the first `@weave-framework/*`
bump since the 0.2.0 npm release.

### 🧩 Components
- Component-level `on:X` handlers now auto-forward to the rendered root element, so
  `<Button on:click={{…}}>` works with no event re-declaration inside the component.
- A composed component's data-callback prop (e.g. a child's `onChange`) fires **exactly once** —
  the earlier double-invoke (data callback *and* event auto-forward) is fixed.

### 🐛 Fixes

- `computed()` values are now released together with the component that created them —
  a memo reading a long-lived signal (router, i18n, store) no longer leaks its subscription.
- A `computed()` that throws no longer caches and silently returns a stale value; it
  re-evaluates on the next read.
- `<Select>` reflects changes to its `options` while the panel is open (e.g. async-loaded
  results) and renders fresh on every re-open.
- Template interpolation correctly handles a `}}` inside a string literal and inner object
  literals.
- The template compiler resolves bindings inside template-literal `${ … }` and expands object
  shorthand (`{ name }` → `{ name: … }`).
- A loop variable no longer shadows same-named component data elsewhere in the same template.
- Numeric `bind:value` no longer clobbers a value while it is being typed.
- `validators.pattern` is deterministic when given a global (`/g`) regular expression.

### ⚡ Performance

- Fewer redundant updates: block and component construction no longer over-subscribe to
  unrelated signals, and `@for` row updates are batched into a single pass.

### 🔒 Security

- `<Icon>` sanitizes SVG before rendering — event-handler attributes, `<script>`,
  `<foreignObject>`, and `javascript:` URLs are stripped. A dynamic `<w:element>` refuses to
  create a `<script>` element.

### 📦 Scaffold (`create-weave`)
- `npm create weave@latest` now includes every feature package (router, store, forms, i18n,
  data) as a dependency — each is zero-dep and tree-shaken when unused, so there is no bundle
  cost and no need to install a feature mid-project. The template ships a `pnpm-workspace.yaml`
  that pre-approves the esbuild / parcel-watcher build scripts, so `pnpm install` doesn't prompt.
