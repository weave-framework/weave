/**
 * @weave/compiler — turns Weave templates into fine-grained DOM code.
 * M3: templates, interpolation, attribute/event/prop/class/ref bindings.
 */
export { compileTemplate, type CompileOptions } from './codegen.js';
export { parseTemplate, ParseError } from './parser.js';
export { scopeCss, scopeAttr, hashCss } from './css.js';
export type * from './ast.js';
