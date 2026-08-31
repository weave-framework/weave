# Tooling & CLI

Weave ships its own toolchain — a single `weave` CLI for building, serving, type-checking, and route generation, plus first-class editor support. No bundler config to assemble, no plugin soup. This page walks through every command, every flag, and the two pipelines that hide behind them.

## Running the CLI

Install `@weave-framework/cli` as a dev dependency (the [scaffold](/learn/installation) does this for you), and the `weave` command is available in your project. Run it through your `package.json` scripts or `npx`:

~~~bash
npm run dev        # if you have a "dev": "weave dev" script
npx weave build    # or invoke it directly
npx weave check
npx weave routes
~~~

Everywhere below we write `weave <cmd>` for short — that's the command as it runs from your project's scripts or `npx`. See [Installation](/learn/installation) for setup.

## The two pipelines

Here's the one thing that explains almost everything else. Every command checks for a config file first, and that single fact decides which of two pipelines you get:

- **Config-driven** — when a `weave.config.ts` (or `.js`, `.mjs`, `.json`) exists in the current directory, or you point at one with `--config <path>`. The config is the source of truth: `dev` and `build` run Weave's full pipeline (framework-owned entry, file-based routes, global styles, HTML-shell injection). This is the mode you want.
- **Legacy / flag-driven** — when there's *no* config at all. The commands fall back to a bare, flag-driven pipeline with hardcoded defaults (entry `src/main.ts`, output `dist`, serve dir `.`). It's kept around for fixtures and quick one-off bundling, and it behaves noticeably differently in `dev`. If you didn't mean to be here, you forgot a config file.

The config is auto-discovered in the current working directory. `--config <path>` works on **every** command and forces the config-driven pipeline by pointing at an explicit file.

## The commands

| Command | What it does |
|---------|--------------|
| `weave dev` | Watch, rebuild, and serve with live-reload |
| `weave build` | One-shot production bundle into `dist/` (or `outDir`) |
| `weave check` | Static type-check of your templates and components |
| `weave routes` | Generate the file-based route module from a pages dir |
| `weave migrate` | Assisted migration of an existing Angular app into this one (see [below](#migrating-an-existing-app-weave-migrate)) |
| `weave mcp` | Start the MCP server over stdio (see [below](#ai-editor-integration-mcp)) |

Below, each command's flags are spelled out in full. Where a flag only matters in one pipeline, the table says so.

### weave dev

Starts a watching dev server with live-reload. **Which server you get depends on the pipeline:**

- **Config mode** — Weave runs its *own* in-memory HTTP server (bound to `127.0.0.1`). Nothing is written to disk: the JS bundle is served from memory, component CSS self-injects, and your global `styles` ride in on a JS banner that appends one `<style>` tag. Static assets (favicons, manifest, fonts) are read live from `publicDir`. Your `index.html` is a clean shell — the framework injects the entry `<script>` and the live-reload client for you, so you never hand-write that boilerplate. Routes regenerate from `routesDir` before serving.
- **Legacy mode** — esbuild's *own* `serve` over a static `servedir`. On every rebuild it writes the collected component CSS to `outdir/app.css` (so here `dev` *does* touch disk). esbuild's `fallback` serves `servedir/index.html` for unmatched routes.

In both modes a request with no file extension falls back to the HTML shell, so client-side routing and deep-link refreshes survive. Live-reload itself is a Server-Sent-Events channel (in-memory mode) or esbuild's built-in reload (legacy).

| Flag | Pipeline | Default | Effect |
|------|----------|---------|--------|
| `--config <path>` | both | auto-discover | Point at an explicit config file; forces config mode. |
| `[entry]` (positional) | legacy | `src/main.ts` | The hand-written entry module. The first non-`-` argument. Ignored in config mode (the config's `entry`/`root` wins). |
| `--serve <dir>` | legacy only | `.` | Static web root esbuild serves from. No effect in config mode (uses `publicDir`). |
| `--port <n>` | legacy only | esbuild picks | Server port. **In config mode this CLI flag is ignored** — set the port with `dev.port` in the config instead. |

:::callout info "Two different ports"
There are two separate port knobs and they don't cross over. The `--port <n>` *CLI flag* only takes effect in legacy mode. In config mode the port comes from `dev.port` in `weave.config.ts`, and the CLI flag is not read. If you set one and nothing changes, you're probably in the other mode.
:::

:::callout tip "If a template-only edit seems ignored"
The dev server watches your `.ts`, `.html`, and `.scss`/`.sass`. Editing a SCSS partial that's pulled in via `@use`/`@import` rebuilds the components that depend on it, because the loader tracks those loaded files. But a codegen-time change — a brand-new route file, new `.md` content, a freshly-added config option — runs at startup, so it needs a restart. When in doubt, restart `weave dev`.
:::

### weave build

Produces a static bundle you can deploy. Both pipelines minify by default and code-split `lazy()` chunks into their own files (so `<Link>` prefetch has something to warm). What differs is how much they assemble:

- **Config mode** — the full artifact. It wipes `outDir` clean first, regenerates routes from `routesDir`, generates the framework-owned entry, compiles your global `styles` first then component CSS into one `app.css`, copies `publicDir` verbatim, and injects the entry `<script>` + stylesheet `<link>` into a copy of your `index` shell. The result is a self-contained, deployable `dist/`.
- **Legacy mode** — a bare bundle. It bundles the entry, writes component CSS to `app.css`, and that's it: no clean, no `publicDir` copy, no `index` injection, no global styles, no route regen.

| Flag | Pipeline | Default | Effect |
|------|----------|---------|--------|
| `--config <path>` | both | auto-discover | Point at an explicit config file; forces config mode. |
| `[entry]` (positional) | legacy | `src/main.ts` | The hand-written entry module. Ignored in config mode. |
| `--out <dir>` | both | `dist` (legacy) / config `outDir` | Output directory. In config mode an explicit `--out` **overrides** the config's `outDir` (this is how `@weave-framework/nx` redirects the build to the workspace-root `dist/<project>`); with no flag the config's `outDir` stands. |
| `--no-minify` | legacy | minified | Skip minification (handy for inspecting output). In config mode, control this with `build.minify` in the config. |
| `--check` | both | off | Type-check the project first and write **nothing** if it finds errors. Off by default: making it mandatory would turn a green pipeline red on unchanged code. Without it, the build summary says it was not type-checked. |
| `--ssg` | config only | off | Prerender each route to real HTML at build time. Requires a config `root` (it renders the root headlessly); `entry` mode opts out. Pair with `ssg.resume` to adopt that HTML on the client — see [Static generation & resume](/learn/static-generation). |

### weave check

Static type-checking for your project: the templates — the thing a plain bundler can't do — **and** the ordinary `.ts` modules beside them. It runs the same in both pipelines (it doesn't load the config at all; it just takes root paths). Covered in full in [its own section below](#type-checking-templates-weave-check).

| Flag | Default | Effect |
|------|---------|--------|
| `[paths…]` (positional) | `['src']` | One or more root directories to check. Every non-`-` argument is a root. |

~~~bash
weave check            # checks src/ by default
weave check src lib    # multiple roots
weave check --fix      # apply the fixes it is certain of, then re-check
~~~

It exits non-zero when there are **errors**, so it drops straight into CI as a gate. Template mistakes are
reported as **warnings**, so adding them to a project that was green does not turn it red.

### weave routes

Regenerates the file-based route module from a pages directory. You rarely run this by hand — `build` and `dev` do it for you when `routesDir` is configured — but it's a standalone command so you can wire it into other scripts.

It scans the directory recursively for page files (`.weave`, `.ts`, `.tsx`, `.js`, `.jsx`), skipping generated and declaration files (`*.gen.ts`, `*.d.ts`) and sibling templates/styles, builds the route manifest, and writes `routes.gen.ts`. **Routes are lazy by default** — each page becomes a `lazy()` import so it code-splits into its own chunk.

| Flag | Default | Effect |
|------|---------|--------|
| `[dir]` (positional) | `src/routes` | The pages directory to scan. The first non-`-` argument. |
| `--out <dir>` | `<dir>/routes.gen.ts` | Where to write the generated module. |
| `--eager` | lazy | Inline each page directly instead of wrapping it in `lazy()` — no code-splitting. |

~~~bash
weave routes                    # scan src/routes → src/routes/routes.gen.ts (lazy)
weave routes src/pages          # different pages dir
weave routes src/pages --out src/router/routes.gen.ts
weave routes src/pages --eager  # inline, no per-route chunks
~~~

## Migrating an existing app: weave migrate

`weave migrate` helps move an existing **Angular** app into Weave. Run it **from inside the Weave app you want the
code to land in** — usually an empty one you created for the purpose, though migrating into an app you already
have works too. It asks which framework you are coming from, then for the path to the app, library, or single
piece you want to move.

~~~bash
npm create weave my-app     # the app you are migrating INTO (pnpm/yarn/bun work too)
cd my-app
weave migrate               # then answer two questions
~~~

If the converted code needs a package your app does not have — `@weave-framework/ui` is the usual one, since the
scaffold does not install it — the command prints the exact install line **for your package manager**, detected
from your `packageManager` field or lockfile (`pnpm add …`, `yarn add …`, `bun add …`, `npm i …`).

**Your source project is only ever read.** Everything is written into the Weave app you ran the command from, and
an existing file is **never** overwritten — a path that already has something there is reported and left alone.
Writing is opt-in: the exact file list is printed first, and the prompt defaults to *no*.

### What you get

| Written to | What it is |
|---|---|
| `migration-plan.md` | The plan, for you to read **before** converting: what converts mechanically, what needs a decision, and in what order. |
| `.weave-migrate/facts.json` | The raw measurements the plan was built from. |
| `src/…` | The converted code, mirroring your source layout. |

### It knows what everything became

Converting happens one declaration at a time, but the *mapping* is built once for the whole unit before any file
is finished: which class became which export, in which file, as a default or a name. Every generated file's
imports are then resolved against that one table — so a component that became a default export is imported as
one, a service that became `useUser` is imported under that name, and no written file can name something that no
longer exists.

It models **structure**, not intent: it knows `ShortenPipe` is now the function `shorten`; it does not know what
an `Observable` in that file ought to become, and does not pretend to.

### Big units migrate a section at a time

Past about twenty files it stops handing you one list and offers the top-level folders as **sections**, so you
can take `shared/` first and `features/` next week. The mapping still spans the whole unit — section two knows
what section one renamed — and what a chosen section needs from one you left behind is named outright:

~~~text
What you chose depends on what you did not:
  • src/app/header.ts needs useUser from src/shared/user.ts
  Those imports will not resolve until you run the remaining sections. Nothing is lost — run again.
~~~

### It checks the result before writing it

Converting happens one declaration at a time, so nothing in that pipeline can see whether the *result* holds
together. Before the write prompt, the planned files are type-checked **as one program** against your app's real
dependencies:

~~~text
3 problem(s) in the converted code itself, across 2 file(s) — this is what still needs a hand:
  • src/main.ts:7            Module './app/app' has no exported member 'AppComponent'
  • src/app/user.service.ts:24  Cannot find name 'analytics'
~~~

A module your app simply does not have is listed separately — that is an install, not a broken conversion. And
two files planned for one path is reported outright: the second would overwrite the first, and the migration
would report both as written.

### It tells you what it cannot do

Before writing anything, it reports how much of your source it actually converts:

~~~text
Converted to Weave: 4/16 declarations (25%)
Carried over as-is: 12 — moved into your app, still Angular, yours to port
~~~

*Converted* means real Weave code. *Carried* means the file was moved unchanged because it is usually valid
TypeScript already — the code is there, but porting it is yours. Nothing is dropped, and the plan lists every
piece in each group. Anything with no faithful Weave equivalent is left in place with a `TODO(weave migrate)`
comment rather than guessed at.

### What it converts

| Angular | → Weave |
|---|---|
| `@Component` | a `setup()` function + a sibling template |
| `@Input() color: string = 'x'` | a typed prop + an entry in `export const propDefaults` |
| a field, a getter, a method | `signal(<its initial value>)`, `computed(…)`, a function — bodies translated, `this.` and all |
| `@HostBinding` / `@HostListener` / `host: { … }` | `class:` / `style:` / `on:` on the template's root element |
| `@HostListener('window:…')` | an `onMount` subscription, with its removal as the cleanup |
| `@Injectable({providedIn:'root'})` | `store()` |
| a constructor body | the setup/factory body — that scope *is* the constructor |
| `router.events` + `NavigationEnd` | `onDispose(afterEach(cb))` |
| one migrated service calling another | the store hook / context, wired and imported |
| `@Injectable()` (scoped) | `createContext` + `provide`/`inject` |
| `@Pipe` | a plain function — `{{ x \| shorten }}` becomes `{{ shorten(x) }}` |
| `@Directive` | a `use:` action — host bindings become `effect`s on the element, listeners are added *and removed* |
| `ElementRef` | the element itself — an action is handed it, which is what `ElementRef` was for |
| `Router.navigate([…])` | `navigate` — a shim joins the command array; a `.then()` becomes the next statement |
| `*ngIf` / `*ngFor` / `*ngSwitch` | `@if` / `@for` / `@switch` |
| `[prop]` / `(event)` / `[(ngModel)]` | `.prop` / `on:` / `bind:value` |
| `<ng-template #x>` / `*ngTemplateOutlet` | `@snippet x()` / `@render (x())` |
| `<ng-content>` / `<router-outlet>` | `<slot>` / `<RouterView>` |
| reactive forms | `@weave-framework/forms` |
| route guards | `beforeEach` |
| a route resolver | a route `loader`, read with `useLoaderData()` |
| `HttpClient` | `@weave-framework/data` — `resource` for reads, `action` for writes |
| `InjectionToken` | `createContext` |
| RxJS | translated: `of`/`concat`/`from` and their operator chains become plain values, arrays and promises; a `BehaviorSubject` becomes a `signal` |
| `@NgModule` | nothing: Weave has no modules. A note records what it declared, provided and exported. |

Third-party packages are sorted into three groups — ones Weave replaces (`rxjs`, `@ngx-translate`), ones you
choose to attempt, and ones with no Weave role (`lodash`, `d3`) that you simply keep. You tick the ones to try.

Before writing, it also names the packages the **converted** code still imports:

~~~text
Your converted code still imports these — they stay dependencies of your app:
  • lodash — no Weave equivalent — kept as-is
  • rxjs   — Weave replaces this: what is left is what could not be translated without guessing

Your app does not have these yet:
  pnpm add lodash@^4.17.21
  pnpm add -D @org/interfaces@^1.4.0
~~~

The command uses **your** package manager (read from `packageManager` in `package.json`, then the lockfile) and
pins each package to the version the **source** app used, so the code lands against what it was written for.
After the files are written you are asked whether to run it — asked, not done, because installing writes
`package.json` and the lockfile and goes to the network.

There are two commands because there are two places. A package the converted code **calls** is a real
`dependency`: it is in the bundle, and a runtime dependency parked in `devDependencies` disappears under a
production install (`npm ci --omit=dev`) and breaks the app where nobody is looking. A package reached only
through `import type` is erased by TypeScript and never reaches the bundle, so it is a `devDependency` — shipping
it to everyone who installs your app would be for nothing. Imported both ways counts as runtime: one value import
is enough to put it in the bundle.

`@angular/*` never appears on either list: those imports come from files that were carried rather than converted,
and installing Angular to make them resolve is not a fix, it is the migration undone.

The specs are checked before anything runs. Package names come from `import` specifiers in the code being
migrated, so migrating a repository you did not write must not be able to run a command: anything outside the
npm-name-plus-range grammar stops the whole install and is named, rather than being escaped and hoped for.

### RxJS is translated, not annotated

Weave is signal-native and has no stream primitive, so an app that finishes a migration still importing `rxjs`
has been *moved*, not migrated. The chains are rewritten.

The rewrite is a fold over a **shape**, because an RxJS chain in application code is almost never an infinite
stream — it is one of three things, and each has an exact JavaScript equivalent:

| The source | Its shape | So the operators are |
|---|---|---|
| `of(x)`, a call the unit declares as returning `Observable<T>` | one emission | plain expression application — `map(f)` is `f(x)` |
| `of(a, b)`, `concat(…)`, `EMPTY` | a finite sequence | the array methods they were modelled on — `mergeMap` is `flatMap`, `distinct` is a `Set`, `toArray` collects it back into one emission |
| `from(p)`, `forkJoin([…])` | one asynchronous emission | `.then(…)` / `await` |

That second row of the first column matters more than it looks. Real chains do not start at an `of(…)` — they
start at a **call**: `this._resolveCrumbs(route).pipe(…)`. So before converting anything, the migration scans the
whole unit for every declaration returning an `Observable<…>` and folds against that map. Without it the fold
gave up on the first operator of almost every real file, which is what "it did nothing to my code" looks like.
The assumption is stated because it is one: such a function **emits once** — in application code an `Observable`
returned by a resolver, a service call or a wrapper is a request, not a live feed.

~~~ts
// before
load(ids: string[]): Observable<string[]> {
  return concat(of(ids), of([])).pipe(mergeMap((xs) => xs), filter((x) => !!x), distinct(), toArray());
}

// after
const load = (ids: string[]): string[] => {
  return [...new Set([ids, []].flatMap((xs) => xs).filter((x) => !!x))];
};
~~~

The signature follows the body: a chain that folded to a value returns that value, one that folded to a promise
returns `Promise<T>`. A `BehaviorSubject` becomes a `signal` outright — it already held a current value, shared it
with every reader, and notified on write — so `.next(v)` is `v.set(…)`, `.value` is `v()`, and `.complete()` is
dropped because teardown is the owner scope's job. `firstValueFrom(x)` is `await x`, and the function that gained
the `await` is marked `async`.

**An operator with no equivalent stops its own chain, and the whole chain is left standing.** `debounceTime`,
`delay`, `scan` over a live source and the rest of the genuinely time-based operators have no expression form, so
those chains keep their `rxjs` import and their `Observable` signature — together, so the signature never
promises a plain value over code that still returns a stream. Each one is named in a `TODO(weave migrate)`. A
chain rewritten up to the operator that stopped it would compile and lie, so it is never half-rewritten.

`x instanceof Observable` becomes `false`: that is the class, checked at runtime, and after a migration nothing in
the app is an Observable — so the branch it guards is dead, and saying so is the translation.

This covers the converted components and services *and* the files carried across untouched — a helper module with
no decorator is exactly where the streams hide. The `rxjs` imports the translation made dead are pruned per
binding, so a single surviving `Observable` no longer drags `of`, `map` and `concat` along with it.

### Where it lands

The converted code mirrors the source layout, so by default a library's folders arrive under `src/` as they were
— which is fine in an empty app and crowded in one that already has a `src/` of its own. So the destination is
asked for:

~~~text
Where should the converted code go? [Enter = D:\my-app\src, or a folder under it]
> features/breadcrumbs
  → D:\my-app\srceaturesreadcrumbs
~~~

Enter keeps the root. A typed folder puts the whole converted tree under it, and the symbol table follows, so the
imports between the written files point where those files actually landed. A path that would escape `src/` — an
absolute path, a drive letter, a `..` segment — is refused and re-asked rather than resolved: this command writes
inside the app it was pointed at, and that stays true of a typed answer as much as of a computed one.

### What the target app has to be able to resolve

A migrated file that imports from `@my-org/interfaces` compiles in the source workspace and nowhere else. Every
symbol the migration writes — including the ones in files carried across whole — goes into a table, and the
assembled output is resolved against it in one pass, so an import through a workspace alias is repointed at the
copy that actually landed. What is left over is reported before anything is written: the packages the converted
code still imports, and the declarations nothing provides.

Bindings the draft would otherwise name into thin air are declared instead. An injected `Router` whose *calls*
were rewritten still has to exist when something reads the service itself (`_router.url`), so it is declared as a
hole with a `TODO` rather than dropped; and the local alias a constructor wrote for it (`const _router: Router =
this._router`) is removed, because once `this.` is gone that line declares a binding from itself.

### The look that does not come with the folder

A component carries its own stylesheets: `styleUrls` are renamed to the sibling Weave expects, and inline
`styles:` are written out as that sibling too. What no component folder holds is the shared stylesheet library
many projects keep — and a component migrated out of such a project lands *correct* and renders unstyled, with
nothing on screen saying why.

So every converted template is read for the classes it applies — static `class="…"` tokens and `class:` toggles
alike — and any class its own stylesheets do not define is looked up across the source workspace. Where the rule
lives is written at the top of the template, and named once for the whole run before anything is written:

~~~text
Some of the look lives outside these components: 3 template(s) use classes styled elsewhere.
  • libs/styles/src/lib/_breadcrumbs.scss
~~~

The rules are **named, never copied**. Lifted out of its library a rule loses the variables, the mixins and the
nesting around it, so a carried copy is about as likely to fail to compile as to work. A class assembled at
runtime (`class="icon-{{ kind }}"`) is not a name, so nothing is claimed about it; a class defined nowhere in the
workspace is not reported at all, because it belongs to a global stylesheet the app already loads.

### It asks for what it cannot see

A method calls a method calls a method, and some of those live somewhere the walk never went — a workspace
library reached through a `tsconfig` alias, or an injected class with no definition in this unit. Neither default
is right on its own: following every library turns one imported type into hundreds of files, and following none
migrates a service your app leans on as a name and nothing else.

So each one is **asked for by name**, with what is at stake shown:

~~~text
These are USED here, but I cannot look inside them:

  • @sps-interfaces (your workspace library) — used for User, IBreadcrumb
    I can reach it at: /repo/libs/sps-interfaces
    Migrate it too? [y/N] >

  • AnalyticsService (injected by 3 file(s) — I don't have its class)
    Path to it (Enter to skip): >
~~~

Say yes and it analyses that unit too, folds the result in, recomputes coverage over the combined source — and
then asks again, because opening one thing reveals the next. Say no and its calls arrive as `TODO(weave migrate)`
with the original code beside them. **Either answer is recorded in the plan**: *you chose not to show me this*
and *this wasn't there* are different answers, and only one of them is the tool's fault.

Yes means **what you use**, not the whole library. A library entry is a barrel, so walking one from its entry
reaches every file in it — importing one interface would migrate all two hundred. The files that *declare* the
names you actually import are the roots, and only what they reach comes across.

A granted unit's output lands under its own folder (`src/sps-interfaces/…`), so it never collides with your app's.

> **This is assisted, not automatic.** Method and getter bodies *are* translated — `this.x` is a rename with a
> known target, not a judgement call — and the original travels beside the result as a comment so every rewrite
> is checkable. What is left to you is what the tool genuinely cannot know: an unmapped service call, a `this.`
> with no counterpart in the class, an RxJS operator that is genuinely about time. Each one is a
> `TODO(weave migrate)` with the reason. Read the plan, then work through them.

## weave.config.ts

One config file is the source of truth for the config-driven pipeline. Every option:

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `root` | `string` | — | Root component module. Weave generates the entry, mounts it, and auto-registers custom elements. *Mutually exclusive with `entry`.* |
| `entry` | `string` | — | Hand-written entry module (custom bootstrap). *Mutually exclusive with `root`.* |
| `mount` | `string` | `'#app'` | CSS selector the root component mounts into (used with `root`). |
| `index` | `string` | — | HTML shell; Weave injects the entry script + stylesheet link. |
| `publicDir` | `string` | the config dir | Static web root — served live in dev, copied verbatim into the build. |
| `outDir` | `string` | `'dist'` | Output directory for `weave build`. |
| `base` | `string` | `''` (root) | Sub-path the app is served under (`'/my-app/'`). Prefixes every injected URL, is answered by the dev server, and becomes the router's basename. |
| `styleLang` | `'css' \| 'scss' \| 'sass'` | `'css'` | Component style language; the loader pairs `<base>.<styleLang>` with no probing. |
| `routesDir` | `string` | — | Pages directory; routes regenerate before each build/dev. |
| `styles` | `string[]` | `[]` | Global stylesheets, compiled and concatenated *before* component CSS. |
| `dev.port` | `number` | esbuild picks | Dev server port (config mode only). |
| `dev.proxy` | `ProxyTable` | — | Proxy matching dev-server request paths to a backend (`target`, `changeOrigin`, `rewrite`). |
| `build.minify` | `boolean` | `true` | Minify the production bundle. |
| `ssg.routes` | `string[]` | derived from `routesDir` | Explicit list of routes for `weave build --ssg`. Falls back to every static route under `routesDir`, else just `/`. |
| `ssg.resume` | `boolean` | `false` | Make the client **adopt** the prerendered HTML instead of re-rendering over it. See [Static generation & resume](/learn/static-generation). |

Define it with the typed helper for autocomplete:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/shell',
  index: 'src/index.html',
  publicDir: 'public',
  routesDir: 'src/pages',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'],
  dev: { port: 5173 },
});
~~~

The config can be `weave.config.ts`, `.js`, `.mjs`, or `.json`. TS/JS configs are compiled on the fly with esbuild and imported via a `data:` URL — no temp file, no build step. The `defineConfig` import is swapped for a tiny inline identity function during that compile, so loading the config never pulls in the whole CLI.

### styleLang: all three are real

`styleLang` isn't decoration — each value drives genuinely different compilation:

| Value | What happens |
|-------|--------------|
| `css` | Zero-cost passthrough — the file is read as-is, no compiler involved. A pure-CSS app never loads Sass at all. |
| `scss` | Compiled with Sass using standard SCSS syntax (braces and semicolons). |
| `sass` | Compiled with Sass using the **indented** syntax (no braces, whitespace-significant). |

Sass is a *lazy* dependency: it's only imported the first time a `.scss`/`.sass` source is actually compiled. The component loader pairs each component with its sibling style file by extension (e.g. `button.ts` → `button.scss`) with no probing, so the `styleLang` you set is exactly the extension it looks for.

## Type-checking templates: weave check

`weave check` type-checks your templates against your code — the thing a plain bundler can't do. For each component it builds a virtual TypeScript module that places every template expression against `ReturnType<typeof setup>`, then checks it all in one strict program. Diagnostics map back to the exact `.html` line and column, printed as `file:line:col - error TS<code>: message`.

**Everything else under the roots is checked too.** Services, stores, helpers, generated route modules — every `.ts` that is not a component joins the same program, under the same tsconfig, so `weave check` is the whole project's gate and not only its templates'. (It used to check components alone, which meant a plain module could hold an error `tsc --noEmit` would refuse.)

It also reports the mistakes that *compile clean and fail silently* — markup that produces a working build
and a broken page. Each is framed at its own line in the template file:

- `<button onclick={{ inc }}>` sets an **attribute** whose value is the function's source text. The button
  renders; the handler never runs. Weave binds events with `on:`.
- `on:clik` — a listener for an event nothing ever fires.
- `@fro (t of items()) { … }` — an unrecognised block, left in the page as literal text.
- `xyz:abc={{ x }}` — an unknown prefix, emitted as a plain attribute.

Your editor shows the same warnings as you type, underlined where they are, with a quick fix on the
lightbulb ("Replace `clik` with `click`"). The editor and `weave check` run the same code, so they
never disagree about the same file.

### Seeing the reactive graph

~~~bash
weave dev --devtools
~~~

A panel in the corner of your own app: every named `signal`, `computed` and `effect` with its live value,
plus a graph, a trace of what triggered what, and the owner tree. It updates without polling — it is itself
an effect, so it re-runs when anything it reads changes.

Off unless you ask for it. Two things it will not show: a node you did not `name`, and a signal created at
module scope — a node is registered through its owner, and a module-scope one has none.

### What will this change break?

~~~bash
weave check --impact src/lib/code-block/code-block.ts
~~~

~~~
src/lib/code-block/code-block.ts is rendered by 2 files

  directly (1):
    src/lib/api-page/api-page.ts

  and reached through those (1):
    src/pages/reference/[pkg].ts
~~~

Read from the composition graph, not from a search — a grep finds a tag's *name*, which is not the same as
the components that resolve to this file. Direct and transitive are kept apart because they mean different
things: a direct user is a file you will probably read, a transitive one is a screen that can change under
you without its own file being touched. It does not type-check, since the question is usually asked while
the tree is still red.

### Renaming a binding renames the code behind it

Rename `{{ count() }}` in a template (F2) and the `const count` in the sibling `.ts` follows, along with
everything in `setup` that reads it — and `return { count }` stays a shorthand rather than becoming
`return { total: count }`. The references are found by TypeScript itself, so nothing is renamed that
should not be.

### The template can declare into `setup` for you

A component is two files, and you say every name twice — once where you use it, once where you define it.
One of those mirrors is already gone: auto-expose writes `setup`'s `return` when you omit it. `--fix`
removes the other, where the markup says **without doubt** what the missing thing is.

`<button on:click={{ save }}>` with no `save` can only be `() => void`, so `weave check --fix` writes it:

~~~ts
export function setup(): { n: number; save: () => void } {
  const n = 1;
  const save = (): void => {
    // TODO
  };
  return { n, save };
}
~~~

A two-way binding is settled the same way, and not by guessing what you probably meant: the runtime writes
a specific type back into the signal, and your markup says which one.

| you wrote | you get |
| --- | --- |
| `bind:checked={{ done }}` | `const done = signal(false);` |
| `bind:value={{ age }}` on `type="number"` (or `range`) | `const age = signal(0);` |
| `bind:value={{ tags }}` on `<select multiple>` | `const tags = signal<string[]>([]);` |
| `bind:value={{ name }}` anywhere else | `const name = signal('');` |

The `signal` import comes with it, joining your existing `@weave-framework/runtime` import if you have one.

Your editor offers the same on the lightbulb — *Declare `save` in setup()* — and only once: if the name is
already anywhere in the script, nothing is proposed. Both authoring forms are covered: a sibling `.ts` and
a `.weave`, whose script is grown in place.

The declaration, the return and the declared type move together. It writes **declarations, never logic** —
the `TODO` is yours — and it declines wherever the shape would be a guess. `{{ total }}` could be a string,
a number or a signal, so nothing is written and the error stays; `@for (t of items())` says only that
`items` returns something iterable, and an element type of `unknown` makes every use of `t` an error, which
is worse than silence. `bind:group` writes back in whatever type the signal already holds, and an `<input>`
whose `type` is itself a binding is a string one render and a number the next — both are left alone. A
return type that is not written inline belongs to another declaration and is left alone too. A tool that
guesses here is one you would switch off.

`weave check --fix` repairs the ones with **exactly one** right answer — the three above — and then re-checks.
The unknown-prefix rule offers no fix: several prefixes could have been meant, and a wrong automatic edit is
worse than none. Fixing `@fro` often removes a type error too, since the loop variable only becomes real once
the block is a block.

It catches:

- **Bad template expressions** — a typo'd binding, calling a non-function, a wrong type inside `{{ }}`, `@if`, `@for`, `@let`, or `@await`.
- **Child-component prop contracts** — a parent's `<Child prop={{ expr }}>` is checked against the child's `setup` first parameter, so passing the wrong prop type (or omitting a required prop) is an error at the usage site.
- **Generic components, at the type they are actually used with.** A `setup<T>` is checked by *instantiating* it from the props you pass, not by reading its parameter type out of the function. `<Select options={{ rows() }} optionValue={{ pick }} />` infers `T` from `rows()`, so an accessor written for a different shape is an error — the checking the component's author wrote `SelectProps<T>` to provide, in a template, which cannot write a type argument of its own.
- **A signal read without its `()`** — `{{ count }}` where you meant `{{ count() }}`. A function reaching a text
  position is rendered as its own source code, which used to be a page that says `() => { … }` and no error
  anywhere. Text interpolation is the only position where this is checked: a function passed to an event or a
  callback prop is exactly right and stays silent.
- **Directive references** — `use:` and `transition:` names must resolve to something real.
- **Template-only imports** — an import used *only* in the template isn't falsely flagged as unused.
- **Everything a plain `tsc --noEmit` catches, in the rest of your code** — a wrong type in a service, an import of a module that does not exist, an unused-but-typed mistake in a store.

Pass one or more roots; with none, it defaults to `['src']`. Any error makes it exit non-zero, so it's a drop-in CI gate.

## Editor support

Weave has real IDE integration — red squiggles on type errors *inside templates*, hover, completion, go-to-definition, and rename across the `.ts`/`.html` boundary. It's powered by a shared [Volar](https://volarjs.dev) language server, so the same engine backs every editor.

> **Where to get the plugins.** They are **not on the VS Code Marketplace or the JetBrains Marketplace yet** — you install them from a file. Download the latest build from the repo's [`plugins/editor/`](https://github.com/weave-framework/weave/tree/main/plugins/editor) folder:
> - VS Code → [`plugins/editor/vscode/weave-language-0.6.7.vsix`](https://github.com/weave-framework/weave/tree/main/plugins/editor/vscode)
> - WebStorm → [`plugins/editor/webstorm/weave-webstorm-0.23.7.zip`](https://github.com/weave-framework/weave/tree/main/plugins/editor/webstorm)
>
> (Use whatever the newest version in those folders is.)

### VS Code

1. Download the `.vsix` file (above).
2. Install it — either from the terminal:
   ```bash
   code --install-extension weave-language-0.6.7.vsix
   ```
   …or from the UI: open the **Extensions** panel → click the **⋯** menu at the top → **Install from VSIX…** → pick the file.
3. Reload VS Code (**Developer: Reload Window**, or just restart it).
4. Open a component — a `.weave` file, or a `.html` template whose sibling `.ts` exports a `setup`. Type errors in the template now show red squiggles, and hover / go-to-definition work across the `.ts`↔`.html` boundary.

That's it. The extension registers the `.weave` and `weave-html` languages, ships syntax highlighting, and wires the Weave TypeScript plugin into VS Code's TypeScript service automatically.

### WebStorm / JetBrains

WebStorm needs **two** things — a host plugin and the Weave plugin:

1. **Install LSP4IJ** (the Weave plugin runs on top of it): **Settings → Plugins → Marketplace**, search **LSP4IJ**, install, and let WebStorm restart.
2. **Install the Weave plugin from disk:** **Settings → Plugins** → click the **gear icon** → **Install Plugin from Disk…** → pick the downloaded `weave-webstorm-*.zip` → restart when prompted.
3. **Enable type-checking on the `.ts` side** (one-time per project): add the Weave TypeScript plugin to your `tsconfig.json` so WebStorm's own TypeScript service loads it —
   ```json
   {
     "compilerOptions": {
       "plugins": [{ "name": "@weave-framework/typescript-plugin" }]
     }
   }
   ```
   then **restart the TypeScript service** (**Settings → Languages & Frameworks → TypeScript**, or right-click a `.ts` file → *TypeScript → Restart TypeScript Service*).
4. Open a `.weave` or component `.html` file — diagnostics, hover, and go-to-definition light up.

> **Why the extra `tsconfig` step?** WebStorm only loads tsserver plugins listed in `tsconfig.json` (VS Code injects it for you). Without step 3 you'd get a spurious *"Module … has no default export"* error on component imports.

### Under the hood

Two pieces do the work, both reusing the same virtual-module machinery as `weave check`:

- **The Weave language server** — a Volar LSP server (TypeScript + CSS services) used by both editors. It reports template diagnostics on the `.html` side. It ships **inside** the two editor plugins; there is nothing to install separately.
- **`@weave-framework/typescript-plugin`** — a tsserver plugin that takes over component `.ts` files (and `.weave` SFCs) so imports used only in templates aren't marked unused, and a parent's import of a child resolves the child's typed props.

## Formatting templates: Prettier

Weave templates use a dialect Prettier's stock HTML parser can't read — `{{ }}` interpolation, `@if`/`@for`/`@switch` control flow, and `on:`/`bind:`/`use:` bindings all make it throw (`SyntaxError: Opening tag "Button" not terminated`). The usual escape hatch is to `.prettierignore` your templates — which means the files you edit most never get formatted. `@weave-framework/prettier-plugin` fixes that: it formats `.weave` SFCs and Weave-template `.html` files as first-class Prettier citizens, so you can drop them from `.prettierignore` and get format-on-save, `prettier --check` in CI, and pre-commit hooks back.

It doesn't ship its own grammar — it **reuses the Weave compiler's parser**, so the formatter can never drift from what actually compiles. Embedded `{{ }}` expressions are formatted by delegating to Prettier's own `typescript` printer, and a `.weave` SFC's `<script>`/`<style>` blocks go through the `typescript`/`css`/`scss` printers.

Install it as a dev dependency and add it to your `plugins`:

~~~bash
npm install -D @weave-framework/prettier-plugin
~~~

`.weave` files are picked up automatically (the extension is unambiguous). Weave-template `.html` files need an explicit opt-in, because `.html` is also plain HTML — the plugin deliberately does **not** hijack every `.html` in your project. Route your Weave templates to the `weave` parser with a Prettier `overrides` entry:

~~~jsonc title=".prettierrc"
{
  "plugins": ["@weave-framework/prettier-plugin"],
  "overrides": [
    { "files": "src/**/*.html", "options": { "parser": "weave" } }
  ]
}
~~~

Point the `files` glob at wherever your Weave `.html` templates live (e.g. `src/**/*.html`). Any `.html` **not** matched is left to Prettier's normal HTML formatter, untouched.

What it does: elements and components lay their attributes on one line when they fit, else one per line; the binding kinds (`on:`, `bind:`, `use:`, `class:`, `style:`, `ref`, `.prop`) are preserved exactly; control-flow blocks reindent while keeping their `@`-syntax intact (`@@` stays escaped); `{{ }}` expressions get formatted; and HTML comments are preserved. Formatting is idempotent — running it twice produces no further changes.

:::callout info "Whitespace: conservative by design"
The current release reindents block structure and formats expressions, but does **not** aggressively reflow inline text runs — so nothing that could change rendering (significant whitespace between inline elements, `<pre>` content) is touched. Prettier-grade inline whitespace reflow is a planned follow-up.
:::

## DevTools: inspecting the reactive graph

Weave ships a zero-dependency, in-app DevTools panel for looking at your live reactive graph — every **named** `signal`/`computed`/`effect`, its current value, and which sources trigger it. It's off unless you turn it on, so production pays nothing.

~~~ts
import { enableDevtools, mountDevtoolsPanel, signal } from '@weave-framework/runtime';

enableDevtools();                          // BEFORE creating signals (unnamed nodes never register)
const count = signal(0, { name: 'count' }); // name a node to surface it
mountDevtoolsPanel();                       // floating overlay; returns a disposer
~~~

The panel updates live with no polling (it reads the graph inside an effect), filters by name, and has three tabs:

- **Nodes** — the flat list: every named node with its live value and its dependencies (`← count`), so you can see *who triggers whom*.
- **Trace** — a temporal log of what just fired: each `from → to` propagation event as a value change dirties an observer, newest first. This answers "why did *that* recompute?" that a static graph can't.
- **Tree** — the reactive graph mapped back onto the **component/owner scopes** you think in, rather than a flat list. A component scope (mounted via `mountComponent`) is named after the component.

For programmatic access: `inspect()` snapshots all named nodes, `inspectGraph()` returns nodes **plus edges**, `inspectTrace(limit?)` / `traceFor(id)` read the trigger-trace ring-buffer (bounded via `setTraceLimit`; `clearTrace()` empties it), and `inspectTree()` returns the owner hierarchy. Gate the calls behind a dev flag (e.g. `import.meta.env.DEV`) so nothing ships to production.

## Any screen, in any state, in one second

Getting a screen into the state you actually need to look at — no rows, ten thousand rows, the request
failed, the document already sent — normally means driving the app there by hand every time, or standing
up fake data to do it for you. Weave state is a graph of **named** signals that is not fused to the DOM,
so a state can be captured from a real run and set back.

With `weave dev --devtools`, the panel has a **States** tab: get the app where you want it, give the
state a name, press **Save**. It lands in `.weave/states/<name>.json` — plain JSON, so commit it and the
whole team has that screen.

~~~bash
weave dev --state empty     # open the app already in that state
~~~

**Apply** in the panel does the same thing live, without a reload, which is the fast way to flip between
states while you work on the screen.

What is captured is exactly the signals you **named**:

~~~ts
const rows = signal<Row[]>([], { name: 'rows' });   // in the state
const draft = signal('');                            // not — it has no name
~~~

Nothing is predicted and nothing is inferred. A `computed` is not saved either, because it is not state —
setting its sources reproduces it. Values travel through Weave's own serialization, so a `Date`, a `Map`
or a `Set` in a signal survives the round trip. Names the app no longer has are skipped when a state is
applied, and the panel tells you how many signals it actually set — a state saved before a rename is
still worth most of its value.

All of it is dev-only: `--devtools` and `--state` exist on `weave dev`, and a production build has no
part of it.

## Merging templates without inventing conflicts

Two people work on one template: one wires a handler onto a button, the other rewords its label. Git
merges lines, and a tag and its text live on the same line, so it stops and asks a human to resolve a
disagreement that does not exist. `weave merge` teaches git to read the file as a tree instead.

~~~bash
weave merge --install    # once per clone
~~~

That registers a merge driver in this clone's git config and adds two lines to `.gitattributes`
(`*.html merge=weave-template`, `*.weave merge=weave-template`) — commit those, and everyone who runs
the install command once gets the same behaviour.

From then on, when a merge touches a template:

- **Git tries first.** Anything git merges cleanly is used exactly as git produced it. The tree merge
  only ever runs on files git could not merge, so installing this can add resolutions but never change
  one you already had.
- **Different nodes merge.** An attribute added here and a label reworded there are different things,
  even on one line. Two different attributes on one tag likewise.
- **The same node changed twice is still a conflict.** Two people setting the same `href` to different
  values is a real disagreement, and you get git's normal conflict markers to resolve by hand.
- **Nothing is reformatted.** The merge splices the original text of each node, so untouched lines come
  out byte-for-byte unchanged.
- **Control-flow blocks are one unit.** Two sides editing the same `@if`/`@for` block fall back to
  git's line merge, which often still handles it.

A file the template parser cannot read — a page with a `<!DOCTYPE>`, say — is simply left to git.

## AI editor integration (MCP)

`@weave-framework/mcp` is a **Model Context Protocol** server that exposes the Weave toolchain to MCP-capable AI editors as structured tools — so your assistant can compile-check a template, type-check the project, resolve routes, or scaffold a component instead of guessing. It's a small in-house JSON-RPC-over-stdio server (zero third-party deps); the tools thin-wrap the existing compiler/check/router.

~~~jsonc title="MCP client config"
{
  "mcpServers": {
    "weave": { "command": "weave-mcp", "cwd": "/path/to/your/project" }
  }
}
~~~

Equivalently, `weave mcp` starts the same server. The tools are `weave_compile_template` (validate markup → real compiler errors), `weave_check` (project diagnostics), `weave_routes` (file-based route tree), and `weave_scaffold_component` (generate a component's files — returned, never written without you).

:::callout info "What you just learned"
One `weave` CLI does it all — once `@weave-framework/cli` is a dev dependency you run it as `weave <cmd>` (via `npm run`/`npx`). The commands are `dev` (watch + live-reload), `build` (static `dist/`, plus `--ssg` prerendering), `check` (template + child-prop type-checking), `routes` (file-based route gen), `merge` (a git merge driver for templates), and `mcp` (the AI-editor server). `dev` also takes `--devtools` (the reactive-graph panel) and `--state <name>` (open the app in a state you saved from it). The big idea: a `weave.config.ts` switches `dev`/`build` into the full config-driven pipeline, while no config drops you into a bare legacy flag-driven one — and `dev` behaves quite differently between them (in-memory server vs esbuild's serve, port from config vs `--port`). Flags like `--config`, `--out`, `--serve`, `--port`, `--no-minify`, and `--eager` each belong to a specific command and pipeline. `styleLang` really compiles `css`/`scss`/`sass` differently, and editor support is a shared Volar server behind a VS Code extension and a WebStorm/LSP4IJ plugin.
:::

[Next: Recipes →](/learn/recipes) · [Reference: configuration →](/reference/config) · [Installation →](/learn/installation)
