/**
 * @weave/compiler — turns Weave templates into fine-grained DOM code.
 * M3: templates, interpolation, attribute/event/prop/class/ref bindings.
 */
export { compileTemplate, type CompileOptions } from './codegen.js';
export { parseTemplate, ParseError } from './parser.js';
export { scopeCss, scopeAttr, hostAttr, hashCss } from './css.js';
export { inferCtxNames } from './infer.js';
export { rewrite, ctxScope, childScope, type Scope, type Binding } from './scope.js';
export {
  compileComponent,
  parseSfc,
  parseSfcLoc,
  type ComponentSource,
  type ComponentSourceLoc,
  type ComponentOptions,
  type CompiledComponent,
} from './component.js';
export {
  extractSources,
  faithfulTemplate,
  classifyTemplate,
  classifyStyle,
  type ExtractedSources,
} from './sources.js';
export type * from './ast.js';
