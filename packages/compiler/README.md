# @weave-framework/compiler

Weave template compiler — parses `.weave` / `.html` templates into fine-grained DOM code.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/compiler
```

You normally don't call the compiler directly — it runs inside the Weave CLI / build. Scaffold a ready-to-run app:

```bash
npm create weave@latest my-app
```

## What it emits

There is no Virtual DOM and no diff. A template compiles to code that creates its nodes once and wires each binding straight to the signal it reads, so an update touches only the nodes that depend on the value that changed.

```ts
import { compileTemplate } from '@weave-framework/compiler';

const { code } = compileTemplate('<p>{{ name() }}</p>');
```

`compileComponent` is the whole-component path (a `.weave` SFC, or a `.ts` with its sibling template) and is what the build actually uses; `compileTemplateAst` compiles a pre-parsed AST.

## Building tooling on it

The parser and its AST are public, so editor and formatter integrations reuse the real grammar instead of re-implementing it — which is how they stay incapable of drifting from what actually compiles. `@weave-framework/prettier-plugin` and `@weave-framework/check` are both built this way.

```ts
import { parseTemplate, ParseError } from '@weave-framework/compiler';

const ast = parseTemplate('<p>{{ name() }}</p>');
```

Also exported: `applyPatches` (build-time template patches for component extension), the CSS scoping helpers (`scopeCss`, `scopeAttr`, `hostAttr`, `hashCss`), the setup-analysis helpers (`extractSetupHandlers`, `extractSetupBindings`, `extractModuleImports`, …), the scope/rewrite layer (`rewrite`, `ctxScope`, `childScope`), and the source classifiers (`extractSources`, `classifyTemplate`, `classifyStyle`).

📚 **Guides + full API reference:** [Template syntax](https://weaveframework.dev/reference/template-syntax) · [Templates guide](https://weaveframework.dev/learn/templates)

## License

MIT
