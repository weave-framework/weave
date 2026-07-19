/**
 * Setup-source reference analysis on the TypeScript AST.
 *
 * The question this answers is exactly {@link unresolvedRefs}'s: given a chunk of `setup` source (a handler
 * body, a computed's initializer, a bare `effect(…)` statement), which free identifiers would NOT resolve on
 * the resumed client? Empty ⇒ the binding can be inlined/derived; anything else is a `setup` local that never
 * crossed the snapshot, and the caller turns it into a build warning naming the culprit.
 *
 * WHY THE AST. The hand-rolled answer in `handlers.ts` had to reconstruct, lexically, everything a parser
 * already knows: where a type annotation ends (`stripDeclTypes`, `skipTypeRef`, `endOfAnnotation`,
 * `stripParamTypes`, `skipTypeArgs`), what a destructuring pattern binds (`patternNames`), where a declaration
 * ends when ASI is in play (`declEnd`, `danglingOperator`). Each of those grew by incident — the doc comments
 * name the real components that broke them — and each was a partial answer to a question `ts.createSourceFile`
 * answers completely. A type node is `isTypeNode`, not a run of characters to skip; a binding name is a
 * `BindingElement`, not a comma-split.
 *
 * NO PROGRAM, NO CHECKER — parser only, exactly like `language-server/src/redirect-definition.ts`. This is a
 * pure syntactic scope walk: cheap, synchronous, and free of any filesystem or lib resolution. It is also why
 * `ts` is INJECTED rather than imported: `handlers.ts` is reachable from the compiler's barrel, so a static
 * `import 'typescript'` would pull 9.5 MB into all 54 browser-test bundles that touch the compiler. The caller
 * (the CLI, which already depends on TypeScript) hands the instance in; without it the lexical path stands.
 *
 * KNOWN LIMIT, deliberate: without a checker there is no lib knowledge, so JS globals still come from the
 * `NON_CTX` list in `scope.ts`. That list is the audit's other complaint and is NOT fixed here — deriving it
 * from `lib.*.d.ts` is its own unit. Structure is what moves in this one.
 */

/** The injected TypeScript instance — parser surface only (see the module doc). */
export type TsLike = typeof import('typescript');

/** The internal syntax-error list a parsed `SourceFile` carries; see its use below for why it is reached for. */
interface ParsedSourceFile {
  parseDiagnostics?: readonly unknown[];
}

/**
 * Free identifiers in `source` that resolve to none of: `resolvable` (ctx bindings + module imports the caller
 * unioned in), the source's own declarations, `params` (a `function (e) { … }` binds them outside any arrow),
 * `name` (self-reference / recursion), or `ignore` (the emitted callee, e.g. `computed`).
 *
 * Order is first-seen, and duplicates are collapsed — the caller quotes these back to the author, so a name
 * read three times should be blamed once.
 */
export function unresolvedRefsTs(
  ts: TsLike,
  source: string,
  resolvable: ReadonlySet<string>,
  params: readonly string[] = [],
  name?: string,
  ignore?: string,
  isGlobal: (id: string) => boolean = () => false
): string[] {
  // Parsed as an EXPRESSION, because that is what every caller passes: an arrow, an anonymous `function (…) {}`,
  // an initializer, or a bare `effect(…)` call. Wrapping in a declaration (rather than parsing the fragment as
  // a source file) keeps a leading `function`/`async` from being read as a declaration whose name would then
  // count as a binding of the enclosing scope.
  const file: import('typescript').SourceFile = ts.createSourceFile(
    '__weave_setup_fragment.ts',
    `const __weave_fragment = (${source});`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  // A malformed fragment must not silently report "nothing unresolved" — that would ACCEPT a binding whose body
  // the scanner never understood, and inlining it throws a ReferenceError on the client. The caller's contract
  // is fail-safe: an unreadable source refuses. Signalled by returning the sentinel below.
  //
  // `parseDiagnostics` is TypeScript-internal (there is no public way to read a lone SourceFile's syntax errors
  // without building a Program, which this module exists to avoid), so it is typed here rather than cast away.
  // Were a future TypeScript to drop it, this check would quietly stop refusing — so `ts-refs.browser.ts`
  // asserts a deliberately malformed fragment still returns the sentinel. The gate fails, not the behaviour.
  const diagnostics: readonly unknown[] | undefined = (file as unknown as ParsedSourceFile).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) return [PARSE_FAILED];

  const scopes: Set<string>[] = [new Set([...params, ...(name ? [name] : []), ...(ignore ? [ignore] : [])])];
  const out: string[] = [];
  const seen: Set<string> = new Set();

  const declared = (id: string): boolean => scopes.some((s) => s.has(id));
  const bind = (id: string): void => void scopes[scopes.length - 1].add(id);

  /** Every name a binding name/pattern introduces — `{ a, b: x, ...r }`, `[a, b = 1]`, nested, all of it. */
  const bindPattern = (node: import('typescript').BindingName): void => {
    if (ts.isIdentifier(node)) {
      bind(node.text);
      return;
    }
    // An ObjectBindingPattern's `propertyName` is a KEY, not a binding — only `name` binds. A default value
    // (`{ a = compute() }`) is real code and is walked as an expression by the caller's normal descent.
    for (const el of node.elements) {
      if (ts.isOmittedExpression(el)) continue;
      bindPattern(el.name);
    }
  };

  /** Hoist the declarations of a scope BEFORE walking it — a function may be called above its declaration. */
  const hoist = (nodes: readonly import('typescript').Node[]): void => {
    for (const n of nodes) {
      if (ts.isFunctionDeclaration(n) && n.name) bind(n.name.text);
      else if (ts.isClassDeclaration(n) && n.name) bind(n.name.text);
      else if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) bindPattern(d.name);
    }
  };

  const walk = (node: import('typescript').Node): void => {
    // A TYPE is erased at runtime — it references nothing the client must have. This single check replaces
    // `stripDeclTypes`, `skipTypeRef`, `skipTypeArgs`, `endOfAnnotation` and `stripParamTypes` outright, and it
    // is exact where those were approximations (they were what blamed the real <Checkbox> for reading
    // `HTMLInputElement` and <Select> for reading `boolean`).
    if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return;
    // `x satisfies T` / `x as T` — the type side is already covered above; descend into the value side only.
    if (ts.isTypeAssertionExpression?.(node)) {
      walk(node.expression);
      return;
    }

    // A PROPERTY NAME is not a reference. `obj.foo` reads `obj`; `foo` names a member the client never resolves
    // by scope. An ELEMENT access (`obj[key]`) is different — `key` IS a reference, so it is walked.
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression);
      return;
    }
    // `{ foo: value }` — the key names a property, the value is code. `{ foo }` shorthand has no initializer and
    // IS a reference, so it falls through to the Identifier case below.
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) walk(node.name.expression); // `{ [k]: v }` — `k` is a reference
      walk(node.initializer);
      return;
    }
    // `label: for (…)` / `break label` — a label is not a value binding.
    if (ts.isLabeledStatement(node)) {
      walk(node.statement);
      return;
    }

    // ── scope-introducing nodes ──
    if (
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    ) {
      scopes.push(new Set());
      // A parameter's TYPE is skipped by the type check above; its DEFAULT is code and must be walked in the
      // new scope (a later param may read an earlier one). Bind after walking the default, matching JS order.
      for (const p of node.parameters) {
        if (p.initializer) walk(p.initializer);
        bindPattern(p.name);
      }
      if (node.body) {
        if (ts.isBlock(node.body)) hoist(node.body.statements);
        walk(node.body);
      }
      scopes.pop();
      return;
    }
    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      scopes.push(new Set());
      hoist(ts.isBlock(node) ? node.statements : node.clauses.flatMap((c) => [...c.statements]));
      node.forEachChild(walk);
      scopes.pop();
      return;
    }
    // `for (const x of xs)` / `for (let i = 0; …)` — the loop head binds into the loop's own scope.
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      scopes.push(new Set());
      node.forEachChild(walk);
      scopes.pop();
      return;
    }
    if (ts.isCatchClause(node)) {
      scopes.push(new Set());
      if (node.variableDeclaration) bindPattern(node.variableDeclaration.name);
      walk(node.block);
      scopes.pop();
      return;
    }
    // A declaration binds AFTER its own initializer is walked — `const x = x` reads the outer `x`, and more to
    // the point `const label = label()` (a ctx binding shadowed by a local of the same name) must blame neither.
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) walk(node.initializer);
      bindPattern(node.name);
      return;
    }

    if (ts.isIdentifier(node)) {
      const id: string = node.text;
      if (id && !declared(id) && !resolvable.has(id) && !isGlobal(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      return;
    }

    node.forEachChild(walk);
  };

  // Skip the synthetic `const __weave_fragment =` wrapper and walk only the user's expression.
  const stmt: import('typescript').Statement = file.statements[0];
  if (stmt && ts.isVariableStatement(stmt)) {
    const init: import('typescript').Expression | undefined = stmt.declarationList.declarations[0]?.initializer;
    if (init) walk(init);
  }
  return out;
}

/**
 * Returned as the sole element when the fragment does not parse. It is not a real identifier (no valid JS name
 * contains a space), so a caller that merely checks `length === 0` refuses the binding — the fail-safe answer —
 * while one that reports the list can recognise it and say something better.
 */
export const PARSE_FAILED: string = '<unparsable setup source>';
