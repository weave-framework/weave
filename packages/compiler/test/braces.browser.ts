import { test, assert } from '../../../tools/harness.js';
import { parseTemplate } from '@weave-framework/compiler';
import type { ElementNode, Attr } from '@weave-framework/compiler';

// M10 — template binding syntax is unified on DOUBLE braces everywhere. Attribute /
// directive bindings are `attr={{ expr }}` (matching text interpolation `{{ expr }}`).
// A single-brace `attr={ expr }` is kept as a DEPRECATED fallback so templates that
// predate the unification still parse; these tests pin both paths + the equivalence.

/** Parse one template and return the attrs of its first element. */
function attrsOf(html: string): Attr[] {
  const [root] = parseTemplate(html) as ElementNode[];
  return root.attrs;
}

/** The `expr` of the first attr-like binding (attr/prop/event/class/bind/show/use). */
function exprOf(html: string): string | undefined {
  const a: Attr = attrsOf(html)[0];
  return 'expr' in a ? a.expr : undefined;
}

test('canonical: attribute binding uses {{ }}', () => {
  assert.equal(exprOf('<div id={{ name() }}></div>'), 'name()');
  const ev: Attr = attrsOf('<button on:click={{ inc }}>x</button>')[0];
  assert.equal(ev.type, 'event');
  assert.equal((ev as { expr: string }).expr, 'inc');
});

test('single-brace attribute binding is rejected (one syntax — M10 step 5)', () => {
  // The single-brace form is no longer accepted: bindings MUST use {{ }}.
  let threw: boolean = false;
  try {
    parseTemplate('<div id={ name() }></div>');
  } catch {
    threw = true;
  }
  assert.ok(threw, 'a single-brace attribute binding should be a parse error');
});

test('{{ }} balances inner braces: arrow with an object argument', () => {
  // the closing }} must not be confused by the inner object literal's braces
  assert.equal(
    exprOf('<button on:click={{ () => save({ a: 1, b: 2 }) }}>x</button>'),
    '() => save({ a: 1, b: 2 })'
  );
});

test('{{ }} value that is itself an object literal', () => {
  assert.equal(exprOf('<Comp opts={{ { a: 1 } }} />'), '{ a: 1 }');
});

test('{{ }} with trailing object: brace run resolves correctly', () => {
  // `{{ {x:1}}}` — inner object then the closing }}
  assert.equal(exprOf('<Comp v={{ {x: 1}}} />'), '{x: 1}');
});

test('directives all accept {{ }}: prop, class, bind, show, use', () => {
  assert.equal(exprOf('<input .value={{ text() }} />'), 'text()');
  assert.equal(exprOf('<li class:done={{ done() }}>x</li>'), 'done()');
  assert.equal(exprOf('<input bind:value={{ name }} />'), 'name');
  assert.equal(exprOf('<pre show={{ open() }}>x</pre>'), 'open()');
  const use: Attr = attrsOf('<div use:tip={{ label() }}></div>')[0];
  assert.equal(use.type, 'use');
  assert.equal((use as { expr?: string }).expr, 'label()');
});

test('unclosed {{ in an attribute throws', () => {
  let threw: boolean = false;
  try {
    parseTemplate('<div id={{ oops }>x</div>');
  } catch {
    threw = true;
  }
  assert.ok(threw, 'an unclosed {{ attribute should be a parse error');
});

test('text interpolation balances a }} inside a string literal (M3)', () => {
  // a naive indexOf('}}') would cut the expression short at the `}}` inside the string
  const [p] = parseTemplate('<p>{{ fn("}}") }}</p>') as ElementNode[];
  const node: { type: string; expr: string } = p.children[0] as { type: string; expr: string };
  assert.equal(node.type, 'interp');
  assert.equal(node.expr, 'fn("}}")');
});

test('text interpolation balances an inner object literal (M3)', () => {
  const [p] = parseTemplate('<p>{{ ({ a: 1 }).a }}</p>') as ElementNode[];
  const node: { type: string; expr: string } = p.children[0] as { type: string; expr: string };
  assert.equal(node.type, 'interp');
  assert.equal(node.expr, '({ a: 1 }).a');
});
