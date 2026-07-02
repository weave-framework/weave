/**
 * Compose one Weave UI component inside another's template.
 *
 * A UI component is authored as `{ setup, template }`. To use it as a child element
 * (`<Input .../>`) in another component's template, that child must be a callable
 * `defineComponent(render, setup)` provided in the compiled parent's `_c` map. This
 * helper builds exactly that from a component module — the same shape the real
 * `weave build` (`compileComponent`) emits, done here for the library's own tooling
 * (tests + the gallery). Nested children are passed through so a composed component
 * can itself compose more (e.g. Paginator → Input, Select).
 *
 *   const _c = { Input: toComponent(InputMod) };
 *   // parent template: '<Input control={{ jump }} />'
 */

import * as dom from '@weave-framework/runtime/dom';
import { signal, effect } from '@weave-framework/runtime';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

export interface ComponentModule {
  setup?: (props: Record<string, unknown>) => Record<string, unknown>;
  template: string;
}

/** A map of child-component tag → callable component, injected as the compiled `_c`. */
export type ChildComponents = Record<string, unknown>;

/**
 * Turn a `{ setup, template }` module into a callable Weave component. `children` are
 * the child components its own template composes (its `_c` map), defaulting to none.
 */
export function toComponent(mod: ComponentModule, children: ChildComponents = {}): unknown {
  const scope: string[] = inferCtxNames(parseTemplate(mod.template));
  const { code } = compileTemplate(mod.template, { mode: 'function', scope });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  const render: unknown = new Function('rt', '_c', body)(rt, children);
  return mod.setup
    ? dom.defineComponent(render as never, mod.setup as never)
    : dom.defineComponent(render as never);
}
