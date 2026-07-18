# create-weave

Scaffold a new Weave app in one command.

```bash
npm create weave@latest my-app
```

Also works with pnpm and yarn:

```bash
pnpm create weave my-app
yarn create weave my-app
```

It sets up a ready-to-run **[Weave](https://weaveframework.dev/)** project — the framework core plus routing, state, forms, i18n, and data (each zero-dependency and tree-shaken when unused) — with the CLI scripts wired up.

Then:

```bash
cd my-app
npm install
npm run dev
```

You get a `weave.config.ts`, a root component with its sibling template, type-checking through `weave check`, and the Weave AI-assistant skills so an MCP-capable editor knows the framework from the first prompt.

📚 **Guides + full API reference:** [Quick start](https://weaveframework.dev/learn/quick-start) · [Installation](https://weaveframework.dev/learn/installation)

## License

MIT
