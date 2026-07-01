# Weave

**A fine-grained reactive, signal-native UI framework.** Compiled, TypeScript-first, no Virtual DOM,
**zero third-party dependencies.**

📚 **Docs:** https://weave-framework.github.io/weave/

---

## This package

`weave-framework` is a **meta-package**: installing it pulls in the framework's core and feature packages
in one shot —

- [`@weave-framework/runtime`](https://www.npmjs.com/package/@weave-framework/runtime) — signals, reactivity, DOM, lifecycle, context/DI
- [`@weave-framework/router`](https://www.npmjs.com/package/@weave-framework/router) — file-based routing
- [`@weave-framework/store`](https://www.npmjs.com/package/@weave-framework/store) — signal-based state
- [`@weave-framework/forms`](https://www.npmjs.com/package/@weave-framework/forms) — typed reactive forms
- [`@weave-framework/i18n`](https://www.npmjs.com/package/@weave-framework/i18n) — translations with ICU
- [`@weave-framework/data`](https://www.npmjs.com/package/@weave-framework/data) — async resources

You import from the individual packages (`import { signal } from '@weave-framework/runtime'`); they are
zero-dependency and `sideEffects: false`, so anything you don't use is tree-shaken away.

## Start a new project (recommended)

Don't install this by hand — scaffold a ready-to-run app with the CLI:

```bash
npm create weave@latest my-app
```

That wires up the compiler, dev server, and every feature package for you. See the
[Installation guide](https://weave-framework.github.io/weave/) for pnpm/yarn and manual setup.

## License

MIT
