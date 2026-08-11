/**
 * Inject a props-typed default export into a compiled component module.
 *
 * Shared by `tools/build-ui-components.mjs` (the real staging step) and
 * `tools/verify-ui-typed-default.mjs` (the gate), so the gate exercises the exact
 * function the build runs rather than a copy of it.
 */

/**
 * Replace compileComponent's plain default with a props-typed default so `weave check`
 * (and TS consumers) see `import X from '…/x'` as a callable whose first param is the
 * component's props. `Parameters<typeof setup>[0]` derives the props from the module's
 * own setup, so one substitution fits every component.
 *
 * The return is `Node`, matching the runtime's own `Component` type — a component instance
 * ALWAYS returns its DOM. Saying `unknown` there cost every imperative call site a cast, which
 * is most of the composition surface: a `<Table>` column's `cell: (row) => Node | string`, an
 * `<Expansion>` panel body, anything that takes a `Node`. Slots are `() => Node` for the same
 * reason.
 *
 * The call itself is read back from what the compiler EMITTED, never reconstructed. The
 * tail is not one shape: a component with no setup ships `defineComponent(render)`, one
 * with setup `(render, setup)`, one that also exports `propDefaults` a THIRD argument, and
 * an `export const extend` component `(render, extendSetup(extend, setup))`. Rebuilding the
 * string here only ever matched the two shapes it was written for, and the first component
 * to declare `propDefaults` — shipped since 1.5.17 — failed the publish build with an error
 * pointing at the compiler instead of at this assumption.
 */
export function typeDefault(code, hasSetup, genericDefaultProps, name) {
  // A GENERIC setup cannot be read by `Parameters<>`: applied to an uninstantiated generic, TypeScript
  // resolves every type parameter to `unknown`, and the declared default does not apply (a default is for
  // a CALL, not for destructuring a type). So `<Select>`'s `options` shipped as `unknown[]` and accepted
  // an array of anything — in a template, where an author cannot write a type argument to get out of it.
  // The parameters are re-declared from the source instead. A non-generic component keeps `Parameters<>`,
  // which is exact, so its emitted default is byte-for-byte what it was.
  const generic = hasSetup && genericDefaultProps ? genericDefaultProps(code) : null;
  if (hasSetup && !generic && /export\s+(?:async\s+)?function\s+setup\s*</.test(code)) {
    throw new Error(
      `weave: ${name ?? 'component'} — \`setup\` is generic but its props parameter has no type annotation, ` +
        `so the type parameters cannot be carried onto the default export and every one would silently ` +
        `become \`unknown\`. Annotate the parameter (\`props: XProps<T>\`).`
    );
  }
  const propsType = generic ? generic.propsType : hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  const typeParams = generic ? `<${generic.typeParams}>` : '';
  const m = /(?:^|\n)export default (defineComponent\([\s\S]*\));$/.exec(code);
  if (m === null) {
    throw new Error(`weave: unexpected compileComponent tail — cannot inject typed default`);
  }
  const typed =
    `const _weaveDefault = ${m[1]} as unknown as ` +
    `${typeParams}(props: ${propsType}, slots?: Record<string, () => Node>) => Node;\n` +
    `export default _weaveDefault;`;
  const head = code.slice(0, m.index);
  return (m[0].startsWith('\n') ? head + '\n' : head) + typed;
}
