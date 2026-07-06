import { test, assert } from '../../../tools/harness.js';
import { buildVirtualSfc, type Virtual, type WeaveMapping } from '../src/emit.js';

/** Newlines are flattened to spaces in generated expressions; compare modulo that. */
const norm = (s: string): string => s.replace(/[\r\n]/g, ' ');

/** Find the mapping whose source quotes exactly `needle` in the template region. */
function mapOf(v: Virtual, needle: string): WeaveMapping | undefined {
  return v.mappings.find(
    (m) => m.source === 'template' && v.templateText.slice(m.sourceOffset, m.sourceOffset + m.length) === needle
  );
}

// `use:` on a COMPONENT tag must be type-checked with the same (Element, arg) signature
// probe the element path uses — so `weave check` validates the action on components too. The
// generated virtual TS calls the action as `(action)(null as any, arg)`; both the action name
// and the argument are mapped back to their template offsets for diagnostics.

test('check: use: on a component type-checks the action as (Element, arg), like an element', () => {
  const src: string = [
    '<script>',
    'import Button from "./button";',
    'export function setup() { return { menu: (_el: Element, _o: unknown) => {}, opts: { items: [] }, Button }; }',
    '</script>',
    '<Button use:menu={{ opts }}>Trigger</Button>',
  ].join('\n');
  const v: Virtual = buildVirtualSfc('Comp.weave', src);

  // The action is invoked with a null Element + the arg — the (Element, arg) callability check.
  assert.ok(
    norm(v.text).includes('.menu)(null as any, ') && norm(v.text).includes('.opts);'),
    `expected the action to be checked as (Element, arg); got:\n${v.text}`
  );
  // Both the action name and its argument map back to the template for pinned diagnostics.
  assert.ok(mapOf(v, 'menu'), 'the use: action name maps to its template offset');
  assert.ok(mapOf(v, 'opts'), 'the use: argument maps to its template offset');
});

test('check: an argument-less use: on a component checks action(Element)', () => {
  const src: string = [
    '<script>',
    'import Button from "./button";',
    'export function setup() { return { autofocus: (_el: Element) => {}, Button }; }',
    '</script>',
    '<Button use:autofocus>Go</Button>',
  ].join('\n');
  const v: Virtual = buildVirtualSfc('Comp.weave', src);
  assert.ok(
    norm(v.text).includes('.autofocus)(null as any);'),
    `expected action(Element) for an argument-less use:; got:\n${v.text}`
  );
  assert.ok(mapOf(v, 'autofocus'), 'the argument-less action name maps to its template offset');
});
