# Publishing Weave to npm

Weave ships to npm as scoped packages under **`@weave/*`** plus the **`create-weave`** scaffold. This is the maintainer checklist. The actual upload requires npm credentials and is a manual, deliberate step.

## What gets published

In dependency order (the order `tools/publish-packages.mjs` uses):

1. `@weave/runtime`
2. `@weave/compiler`
3. `@weave/store`
4. `@weave/i18n`
5. `@weave/data`
6. `@weave/forms`
7. `@weave/router`
8. `@weave/check`
9. `@weave/cli`
10. `create-weave`

Editor tooling (`@weave/language-server`, `@weave/typescript-plugin`) is **not** part of this flow — publish it on its own track if/when desired. The monorepo root, `examples/demo`, and `docs/` are private and never published.

## How packages are built for publishing

- **Library packages** (`runtime`, `router`, `store`, `forms`, `i18n`, `data`, `compiler`, `check`) compile via `tsc -p tsconfig.build.json` → `dist/` (`.js` + `.d.ts`, module structure preserved). Their `package.json` `exports`/`main`/`types` point at `dist/`; only `dist/` is in the published tarball (`files`).
- **`@weave/cli`** emits declarations via `tsc` and bundles a runnable `dist/cli.js` via esbuild (`packages/cli/build.mjs`), inlining `@weave/compiler` + `@weave/check`. Its `bin` is a thin launcher importing `dist/cli.js` — no runtime bundling, no monorepo-layout assumptions. `esbuild` + `typescript` are real `dependencies`; `sass` is optional.
- `workspace:*` inter-package deps are rewritten to the concrete version (`0.2.0`) automatically by `pnpm publish` at pack time.

Build everything:

```bash
pnpm build:packages
```

## Prerequisites (one-time)

1. The **`@weave` org must exist on npm** and your account must have publish rights to it. Create it at npmjs.com if needed (or change the scope across all `packages/*/package.json` if `@weave` is unavailable).
2. `npm login` (or `pnpm login`) with that account.

## Publish

Dry-run first (packs + validates, uploads nothing):

```bash
pnpm publish:dry
```

Then the real publish:

```bash
pnpm publish:packages
```

The script builds fresh `dist/`, then runs `pnpm publish --access public --no-git-checks` per package in dependency order. Already-published versions are skipped by npm, so it's safe to re-run after fixing a failure.

## After publishing

- Verify a clean install in a throwaway dir **outside** the repo: `npm create weave@latest demo && cd demo && npm install && npm run build`.
- Re-deploy the docs so the install page matches what's live (`bash publish/scrub.sh …`).
- Bump versions for the next release (all packages share `0.2.0` today; keep them in lockstep or adopt a versioning tool when they diverge).
