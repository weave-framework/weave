/**
 * Go-to-definition refinement: a template binding `{{ list }}` is emitted as `__ctx.list`
 * over `type __WeaveCtx = ReturnType<typeof setup>`, so TypeScript resolves it to the
 * *shorthand property* in `setup`'s `return { list, … }` — landing F12 on the (often huge)
 * return object instead of the `const list = …` declaration the author means. TS won't
 * forward a member-access to a shorthand's initializer, so we post-process the definition
 * result: when a target lands on a `ShorthandPropertyAssignment` inside a `return` of a
 * `setup` function, we re-point it at the same-named `const` in that function.
 *
 * Wraps every TypeScript service's `provideDefinition`; non-matching targets pass through
 * untouched, so ordinary go-to-definition is unaffected.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Ts = typeof import('typescript');
/** Minimal structural shape of a Volar service instance (avoids a hard type dep). */
interface ServiceInstance {
  provideDefinition?: (document: unknown, position: unknown, token: unknown) => unknown;
  [k: string]: unknown;
}
/** Any Volar service plugin — a `create(context)` that yields an instance. */
type ServicePlugin = { create(context: never): unknown };
interface LspPos {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPos;
  end: LspPos;
}
interface LocationLinkish {
  targetUri?: string;
  uri?: string;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
  range?: LspRange;
}

/** LSP {line,character} → absolute offset in `text`. */
function offsetAt(text: string, pos: LspPos): number {
  let line: number = 0;
  let i: number = 0;
  while (line < pos.line && i < text.length) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
    i++;
  }
  return i + pos.character;
}

/** Absolute offset → LSP {line,character}. */
function posAt(text: string, offset: number): LspPos {
  let line: number = 0;
  let last: number = 0;
  for (let i: number = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return { line, character: offset - last };
}

/** Deepest node whose span contains `offset`. */
function nodeAt(sf: import('typescript').SourceFile, offset: number, ts: Ts): import('typescript').Node | undefined {
  let hit: import('typescript').Node | undefined;
  const visit = (n: import('typescript').Node): void => {
    if (offset < n.getStart(sf) || offset >= n.getEnd()) return;
    hit = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hit;
}

/** The nearest enclosing `setup` function (declaration or `const setup = …`), if any. */
function enclosingSetup(node: import('typescript').Node, ts: Ts): import('typescript').FunctionLikeDeclarationBase | undefined {
  for (let n: import('typescript').Node | undefined = node; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'setup') return n;
    if ((ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) && n.parent.name.text === 'setup') {
      return n;
    }
  }
  return undefined;
}

/** Is `node` inside a `return` statement? */
function inReturn(node: import('typescript').Node, ts: Ts): boolean {
  for (let n: import('typescript').Node | undefined = node; n; n = n.parent) {
    if (ts.isReturnStatement(n)) return true;
    if (ts.isFunctionLike(n)) return false; // crossed a function boundary before a return
  }
  return false;
}

/** If `offset` is on a shorthand property in a `setup` return, the same-named `const` name node. */
function setupConstFor(sf: import('typescript').SourceFile, offset: number, ts: Ts): import('typescript').Identifier | undefined {
  const node: import('typescript').Node | undefined = nodeAt(sf, offset, ts);
  if (!node || !ts.isIdentifier(node)) return undefined;
  const shorthand: import('typescript').Node = node.parent;
  if (!ts.isShorthandPropertyAssignment(shorthand)) return undefined;
  if (!inReturn(shorthand, ts)) return undefined;
  const fn: import('typescript').FunctionLikeDeclarationBase | undefined = enclosingSetup(shorthand, ts);
  if (!fn || !fn.body) return undefined;

  const name: string = node.text;
  let found: import('typescript').Identifier | undefined;
  const visit = (n: import('typescript').Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n.name;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn.body, visit);
  return found;
}

/**
 * The real component `.ts` a definition target lives in. Handles both a direct `file://…/x.ts`
 * and Volar's `volar-embedded-content://ts/<enc source uri>` (the virtual TS module): the `setup`
 * script is embedded verbatim at the TOP of that virtual module, so its line/char coordinates equal
 * the sibling `.ts`'s for the script region — where a setup return always lives. We resolve the
 * sibling `.ts`, keep the original `targetUri`, and rewrite only the range; Volar maps it back.
 */
function realTsForTarget(uri: string): string | undefined {
  if (uri.toLowerCase().endsWith('.ts')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return undefined;
    }
  }
  const m: RegExpMatchArray | null = uri.match(/^volar-embedded-content:\/\/[^/]+\/(.+)$/);
  if (!m) return undefined;
  let inner: string = m[1];
  for (let i: number = 0; i < 3 && !inner.startsWith('file:'); i++) {
    try {
      inner = decodeURIComponent(inner);
    } catch {
      break;
    }
  }
  if (!inner.startsWith('file:')) return undefined;
  let p: string;
  try {
    p = fileURLToPath(inner);
  } catch {
    return undefined;
  }
  if (p.toLowerCase().endsWith('.ts')) return p;
  if (p.toLowerCase().endsWith('.html')) return p.replace(/\.html$/i, '.ts'); // separate form: sibling `.ts`
  return undefined; // `.weave` SFC virtual differs — leave it
}

/** Rewrite a single definition link to the `const` when it lands on a setup-return shorthand. */
function redirectLink(link: LocationLinkish, ts: Ts): LocationLinkish {
  const uri: string | undefined = link.targetUri ?? link.uri;
  const sel: LspRange | undefined = link.targetSelectionRange ?? link.range;
  if (typeof uri !== 'string' || !sel) return link;

  const tsPath: string | undefined = realTsForTarget(uri);
  if (!tsPath) return link;
  let text: string;
  try {
    text = readFileSync(tsPath, 'utf8');
  } catch {
    return link;
  }

  const sf: import('typescript').SourceFile = ts.createSourceFile(tsPath, text, ts.ScriptTarget.Latest, true);
  const constName: import('typescript').Identifier | undefined = setupConstFor(sf, offsetAt(text, sel.start), ts);
  if (!constName) return link;

  // Coordinates are shared between the virtual TS's script region and the real `.ts`, so the
  // const's line/char double as the (virtual) target range; Volar maps it back to the `.ts`.
  const range: LspRange = { start: posAt(text, constName.getStart(sf)), end: posAt(text, constName.getEnd()) };
  return { ...link, targetRange: range, targetSelectionRange: range, ...(link.range ? { range } : {}) };
}

/**
 * Wrap each TypeScript service so its `provideDefinition` redirects setup-return shorthands
 * to their `const`. Everything else passes through.
 */
export function withSetupConstRedirect<T extends ServicePlugin>(services: T[], ts: Ts): T[] {
  return services.map((svc) => ({
    ...svc,
    create(context: never): ServiceInstance {
      const instance: ServiceInstance = svc.create(context) as ServiceInstance;
      const orig = instance.provideDefinition?.bind(instance);
      if (!orig) return instance;
      instance.provideDefinition = async (document: unknown, position: unknown, token: unknown): Promise<unknown> => {
        const res: unknown = await orig(document, position, token);
        const links: unknown[] | undefined = Array.isArray(res) ? res : res && typeof res === 'object' ? [res] : undefined;
        if (!links) return res;
        const out: LocationLinkish[] = links.map((link) => redirectLink(link as LocationLinkish, ts));
        return Array.isArray(res) ? out : out[0];
      };
      return instance;
    },
  }) as unknown as T);
}
