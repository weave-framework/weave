/**
 * @weave-framework/check — template type-checking.
 *
 * Generates a never-bundled virtual `.ts` per component (verbatim `setup` + a
 * synthesized `__weave__()` placing each template expression against
 * `ReturnType<typeof setup>`), type-checks them with the real TypeScript
 * compiler, and maps diagnostics back to the original `.weave`/`.html` line:col.
 */

export { buildVirtualSfc, buildVirtualSeparate, type Virtual, type WeaveMapping, type ResolveChild } from './emit.js';
export { resolveChildModule } from './children-fs.js';
export { runCheck, offsetToLineCol, type Diagnostic } from './check.js';
export { checkProject } from './project.js';
export { templateOf, templateFindings, type WeaveFileKind } from './template-lint.js';
