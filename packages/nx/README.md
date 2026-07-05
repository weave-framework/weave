# @weave-framework/nx

An [Nx](https://nx.dev) plugin that makes a [Weave](https://weaveframework.dev) app a first-class
project in an Nx monorepo — **inferred targets**, **executors**, and **generators**. Drop it into an
existing Nx workspace and your Weave apps get Nx caching, `nx affected`, and the project graph with
zero hand-wiring.

## Install

```bash
nx add @weave-framework/nx
# or: npm i -D @weave-framework/nx  and add the plugin to nx.json (below)
```

Register the inference plugin in `nx.json`:

```jsonc
{
  "plugins": ["@weave-framework/nx/plugin"]
}
```

## Inferred targets (crystal)

For every `weave.config.{ts,js,json}` in a project, the plugin infers three targets — no
`project.json` boilerplate:

| Target | Runs | Cached |
|--------|------|--------|
| `build` | `weave build` (output = the config's `outDir`) | ✓ |
| `serve` | `weave dev` (watch + live-reload) | — |
| `check` | `weave check` | ✓ |

```bash
nx build my-app
nx serve my-app
nx check my-app
```

Each target runs the existing `weave` CLI with `cwd` set to the project root, so it resolves that
project's own config — the Weave CLI itself needs no Nx-specific changes.

Override the inferred target names in `nx.json` if they collide with another plugin:

```jsonc
{ "plugins": [{ "plugin": "@weave-framework/nx/plugin", "options": { "buildTargetName": "bundle" } }] }
```

## Generators

```bash
nx g @weave-framework/nx:application my-app          # a Weave app project (+ build/serve/check)
nx g @weave-framework/nx:library ui-kit              # a component library (imported from source)
nx g @weave-framework/nx:component UserCard --project my-app   # a component into a project
```

## Executors (explicit wiring)

Prefer explicit `project.json` targets over inference? The same three are available as executors:
`@weave-framework/nx:build`, `:serve`, `:check`.

## Zero-dependency note

`@nx/devkit` is a dev-time dependency of **this plugin** — correct and unavoidable for an Nx plugin
(it's tooling, only pulled in by Nx users). The Weave runtime, compiler, and router stay
zero-dependency; the executors shell out to the existing `weave` CLI rather than re-implementing the
build.

## License

MIT
