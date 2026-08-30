# Weave Board — the retained example app

A complete Weave application, kept in this repository as a **permanent CI gate** rather than as a
showcase. Every framework fix has its own unit test; this app is what catches a change that breaks
several of them in combination — the failure mode a per-fix test cannot see.

What it exercises, end to end:

- **File-based routing** (`src/pages`) with a dynamic segment, a catch-all 404 and code-split lazy chunks
- **Stores** for the board, the editor and toasts, including an optimistic create that rolls back
- **Forms** — validation and `form.submit`
- An **overlay modal** rendered through a portal, with a transition, and a toast host
- **`@defer`** for the insights panel, and an **error boundary** around a route that throws
- A **stress route**: 1,000 keyed rows, a swap that must move nodes rather than rebuild them, and `@@` escaping
- **Router side-effects**: `afterEach` document titles, scroll restoration, route transitions

## Running it

```
pnpm --filter @weave-framework/cli build   # or: pnpm build:packages
node packages/cli/bin/weave.mjs dev --config examples/demo/weave.config.ts
```

## Running it as the gate

```
pnpm verify:demo
```

That builds the app with the real CLI, serves `dist/` over HTTP with an SPA fallback, and drives the
whole stack in a headless browser — including a cold deep link, which is the only way the lazy-chunk
and fallback paths get exercised together.
