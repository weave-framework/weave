# @weave-framework/cli

The Weave CLI — `weave build` (add `--ssg` for static generation), `weave dev` (watch + live-reload), `weave check`, `weave routes`.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/cli
```

## Static generation

`weave build --ssg` renders every route to real HTML at build time — painted on arrival, crawlable, and served
as plain files with no server in the request path. Routes are derived automatically and each page is its own
chunk, so a reader downloads the page they opened rather than your whole site.

```bash
npx weave build --ssg
```

Add `ssg: { resume: true }` to `weave.config.ts` and the browser **resumes** that HTML instead of rebuilding
it: the build snapshots the reactive graph into the page, the client re-attaches the existing DOM to it, and
`setup()` never runs on the client.

```ts
// weave.config.ts
export default defineConfig({
  root: 'src/app/shell',
  routesDir: 'src/pages',
  ssg: { resume: true },
});
```

Both are opt-in: a plain `weave build` is unchanged, and a SPA-only app ships none of this. Anything that
cannot resume client-renders instead, and says so at build time with the binding, the file and the cause.
See **[Static generation & resume](https://weaveframework.dev/learn/static-generation)**.

Scaffolded apps already include it (with scripts wired up):

```bash
npm create weave@latest my-app
```

📚 **Guides + full API reference:** [weaveframework.dev](https://weaveframework.dev/)

## License

MIT
