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
 * The call itself is read back from what the compiler EMITTED, never reconstructed. The
 * tail is not one shape: a component with no setup ships `defineComponent(render)`, one
 * with setup `(render, setup)`, one that also exports `propDefaults` a THIRD argument, and
 * an `export const extend` component `(render, extendSetup(extend, setup))`. Rebuilding the
 * string here only ever matched the two shapes it was written for, and the first component
 * to declare `propDefaults` — shipped since 1.5.17 — failed the publish build with an error
 * pointing at the compiler instead of at this assumption.
 */
export function typeDefault(code, hasSetup) {
  const propsType = hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  const m = /(?:^|\n)export default (defineComponent\([\s\S]*\));$/.exec(code);
  if (m === null) {
    throw new Error(`weave: unexpected compileComponent tail — cannot inject typed default`);
  }
  const typed =
    `const _weaveDefault = ${m[1]} as unknown as ` +
    `(props: ${propsType}, slots?: Record<string, () => unknown>) => unknown;\n` +
    `export default _weaveDefault;`;
  const head = code.slice(0, m.index);
  return (m[0].startsWith('\n') ? head + '\n' : head) + typed;
}
