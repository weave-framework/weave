import { test, assert } from '../../../tools/harness.js';
import { parseTemplate, applyPatches, compileComponent, type PatchOp } from '@weave-framework/compiler';
import type { TemplateNode, ElementNode, Attr, StaticAttr } from '@weave-framework/compiler';

// RFC 0008 #3 — declarative template patches. applyPatches mutates a base template's AST by
// selector (tag / .class / [attr] / [attr=value]); the inserted markup and added attributes are
// parsed by the SAME Weave parser, so {{ }} / on: / @for all work inside a patch. Fail-loud on a
// zero-match selector. compileComponent threads `patches` through before codegen.

/** Depth-first find the first element matching a class. */
function byClass(nodes: TemplateNode[], cls: string): ElementNode | undefined {
  for (const n of nodes) {
    if (n.type === 'element') {
      const c: Attr | undefined = n.attrs.find((a): a is StaticAttr => a.type === 'static' && a.name === 'class');
      if (c && (c as StaticAttr).value.split(/\s+/).includes(cls)) return n;
      const inner: ElementNode | undefined = byClass(n.children, cls);
      if (inner) return inner;
    }
    if (n.type === 'for') {
      const inner: ElementNode | undefined = byClass(n.children, cls);
      if (inner) return inner;
    }
  }
  return undefined;
}

const BASE: string = '<ul class="list"><li class="row">{{ item }}</li></ul>';

test('patch attr: adds an event binding to the matched element (parsed by the real parser)', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate(BASE), [
    { op: 'attr', sel: '.row', attr: 'on:click={{ () => pick(item) }}' },
  ]);
  const row: ElementNode | undefined = byClass(ast, 'row');
  const ev: Attr | undefined = row?.attrs.find((a) => a.type === 'event');
  assert.ok(ev, 'the row gained an event binding');
  assert.equal((ev as { name: string }).name, 'click', 'it is on:click');
});

test('patch attr: replaces a like-named attribute rather than duplicating it', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate('<div class="x" tabindex="0"></div>'), [
    { op: 'attr', sel: '.x', attr: 'tabindex="-1"' },
  ]);
  const el: ElementNode = ast[0] as ElementNode;
  const tabs: Attr[] = el.attrs.filter((a) => 'name' in a && a.name === 'tabindex');
  assert.equal(tabs.length, 1, 'tabindex not duplicated');
  assert.equal((tabs[0] as StaticAttr).value, '-1', 'tabindex replaced');
});

test('patch removeAttr: drops the named attribute', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate('<div class="x" tabindex="0"></div>'), [
    { op: 'removeAttr', sel: '.x', name: 'tabindex' },
  ]);
  assert.ok(!(ast[0] as ElementNode).attrs.some((a) => 'name' in a && a.name === 'tabindex'), 'tabindex removed');
});

test('patch prepend/append: insert first/last children', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate('<div class="x"><span>mid</span></div>'), [
    { op: 'prepend', sel: '.x', html: '<b>first</b>' },
    { op: 'append', sel: '.x', html: '<i>last</i>' },
  ]);
  const kids: TemplateNode[] = (ast[0] as ElementNode).children;
  assert.equal((kids[0] as ElementNode).tag, 'b', 'prepended child is first');
  assert.equal((kids[kids.length - 1] as ElementNode).tag, 'i', 'appended child is last');
});

test('patch before/after: insert siblings around the match', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate('<div><p class="t">x</p></div>'), [
    { op: 'before', sel: '.t', html: '<hr/>' },
    { op: 'after', sel: '.t', html: '<br/>' },
  ]);
  const kids: TemplateNode[] = (ast[0] as ElementNode).children;
  assert.deepEqual(kids.map((k) => (k as ElementNode).tag), ['hr', 'p', 'br'], 'hr before, br after the p');
});

test('patch replace / remove / wrap', () => {
  const replaced: TemplateNode[] = applyPatches(parseTemplate('<div><p class="t">x</p></div>'), [
    { op: 'replace', sel: '.t', html: '<h2>new</h2>' },
  ]);
  assert.equal(((replaced[0] as ElementNode).children[0] as ElementNode).tag, 'h2', 'replaced');

  const removed: TemplateNode[] = applyPatches(parseTemplate('<div><p class="t">x</p><span>y</span></div>'), [
    { op: 'remove', sel: '.t' },
  ]);
  assert.equal((removed[0] as ElementNode).children.length, 1, 'p removed, span remains');

  const wrapped: TemplateNode[] = applyPatches(parseTemplate('<div><p class="t">x</p></div>'), [
    { op: 'wrap', sel: '.t', html: '<section class="wrap"></section>' },
  ]);
  const wrap: ElementNode = (wrapped[0] as ElementNode).children[0] as ElementNode;
  assert.equal(wrap.tag, 'section', 'wrapper is the section');
  assert.equal((wrap.children[0] as ElementNode).tag, 'p', 'matched element is now inside the wrapper');
});

test('patch selectors: tag / [attr] / [attr=value]', () => {
  const byTag: TemplateNode[] = applyPatches(parseTemplate('<ul><li>a</li></ul>'), [
    { op: 'attr', sel: 'li', attr: 'data-x="1"' },
  ]);
  assert.ok((((byTag[0] as ElementNode).children[0]) as ElementNode).attrs.some((a) => 'name' in a && a.name === 'data-x'));

  const byAttr: TemplateNode[] = applyPatches(parseTemplate('<div role="listbox"><div role="option">a</div></div>'), [
    { op: 'attr', sel: '[role=option]', attr: 'aria-selected="false"' },
  ]);
  const opt: ElementNode = (byAttr[0] as ElementNode).children[0] as ElementNode;
  assert.ok(opt.attrs.some((a) => 'name' in a && a.name === 'aria-selected'), '[role=option] matched');
});

test('patch works inside a @for (nested match)', () => {
  const ast: TemplateNode[] = applyPatches(parseTemplate(BASE), [
    { op: 'attr', sel: '.row', attr: 'on:dblclick={{ () => open(item) }}' },
  ]);
  const row: ElementNode | undefined = byClass(ast, 'row');
  assert.ok(row?.attrs.some((a) => a.type === 'event' && a.name === 'dblclick'), 'row inside @for was patched');
});

test('patch fail-loud: a selector that matches nothing throws', () => {
  let err: unknown = null;
  try {
    applyPatches(parseTemplate(BASE), [{ op: 'attr', sel: '.nope', attr: 'data-x="1"' }]);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error && (err as Error).message.includes("selector '.nope' matched no element"), 'clear zero-match error');
});

test('compileComponent threads patches: the compiled render wires the patched markup', () => {
  const { code } = compileComponent({
    script: 'import List from "./list";\nexport const extend = List;\nexport function setup(props, base) { return { ...base, total: () => 1, open: (i) => i }; }',
    template: BASE, // the base template the loader resolved
    patches: [
      { op: 'attr', sel: '.row', attr: 'on:dblclick={{ () => open(item) }}' },
      { op: 'prepend', sel: '.list', html: '<li class="count">{{ total() }} total</li>' },
    ] as PatchOp[],
  });
  assert.ok(/listen\([^)]*"dblclick"/.test(code), `the added event is wired; got:\n${code}`);
  assert.ok(code.includes('count') && /total/.test(code), 'the prepended header markup is compiled in');
  assert.ok(code.includes('extendSetup(extend, setup)'), 'still an extension (setup composed with the base)');
});
