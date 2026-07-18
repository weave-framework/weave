# @weave-framework/check

Weave template type-checking — virtual `.ts` generation + `tsc`, mapped back to source.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/check
```

Usually run through the CLI (`weave check`). Scaffolded apps already include it:

```bash
npm create weave@latest my-app
```

## What it does

Type-checking stops at the template boundary in most toolchains. Here it doesn't: each template is compiled into a **virtual TypeScript file** whose expressions are the template's expressions, that file is handed to `tsc`, and every diagnostic is mapped back through a source map to the line and column in the template you actually wrote.

So a typo in an interpolation, a misspelled prop on a child component, or a call with the wrong argument type is a build error with a real location — not a blank screen at runtime.

```ts
import { checkProject } from '@weave-framework/check';

const diagnostics = checkProject(['src']); // one or more roots to walk
```

Each diagnostic carries the file, line, column, and message. `runCheck` is the lower-level single-run entry, `buildVirtualSfc` / `buildVirtualSeparate` (from `@weave-framework/check/emit`) produce the virtual file plus its mapping, and `offsetToLineCol` converts an offset for reporting.

`typescript` is a peer dependency — the check runs against the same TypeScript your project uses.

📚 **Guides + full API reference:** [Tooling guide](https://weaveframework.dev/learn/tooling)

## License

MIT
