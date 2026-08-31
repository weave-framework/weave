/**
 * A URL that can execute code must not reach a navigable element in silence.
 *
 * `href={{ url }}` looks like an ordinary attribute, and it is — until the value is
 * `javascript:something`, which runs on click. The author did nothing that reads as dangerous (unlike
 * `.innerHTML`, where the dot is the warning), and the framework is the only party that knows both
 * that this attribute is `href` and what the value turned out to be.
 *
 * So it SAYS so, and sets the attribute anyway. Refusing would be the safer end state and it is a
 * behaviour change on a frozen surface — an element that rendered would stop rendering — so it waits
 * for a major. Speaking costs nothing and closes the part that actually bites: not knowing.
 *
 * Measured before choosing this shape. Across four real applications there are 26 dynamic URL
 * bindings, and the schemes below appear in NONE of them — so this cannot fire on working code. Of
 * those 26, seventeen are `<img src>`, where a script scheme does not execute at all; warning there
 * would have been pure noise, which is why the check is scoped to elements that navigate.
 */
import { test, assert } from '../../../tools/harness.js';
import { setAttr, bindAttr } from '@weave-framework/runtime/dom';
import { signal, tick, type Signal } from '@weave-framework/runtime';

/** Capture what the runtime reported while `fn` ran. */
async function reported(fn: () => void | Promise<void>): Promise<string[]> {
  const said: string[] = [];
  const real: typeof console.error = console.error;
  console.error = (...a: unknown[]): void => {
    said.push(a.map(String).join(' '));
  };
  try {
    await fn();
    await tick();
  } finally {
    console.error = real;
  }
  return said;
}

test('url scheme: a javascript: href is reported, and still set', async () => {
  const a: HTMLAnchorElement = document.createElement('a');
  const said: string[] = await reported(() => setAttr(a, 'href', 'javascript:alert(1)'));
  assert.ok(said.some((s) => /javascript:/i.test(s) && /href/.test(s)), `it names the attribute and the scheme (got ${JSON.stringify(said)})`);
  assert.equal(a.getAttribute('href'), 'javascript:alert(1)', 'and the attribute is unchanged — this release only speaks');
});

test('url scheme: the scheme is read the way a browser reads it', async () => {
  const a: HTMLAnchorElement = document.createElement('a');
  // A browser strips tabs and control characters before resolving the scheme, so a check that spells
  // `javascript:` out misses this. It is the same bypass the SVG sanitizer had.
  const said: string[] = await reported(() => setAttr(a, 'href', 'java\tscript:alert(1)'));
  assert.ok(said.length > 0, `a scheme split by a tab is still recognised (got ${JSON.stringify(said)})`);
});

test('url scheme: an ordinary URL says nothing', async () => {
  const a: HTMLAnchorElement = document.createElement('a');
  const said: string[] = await reported(() => {
    setAttr(a, 'href', '/about');
    setAttr(a, 'href', 'https://example.com/x?a=1');
    setAttr(a, 'href', '#anchor');
    setAttr(a, 'href', 'mailto:someone@example.com');
  });
  assert.deepEqual(said, [], 'no warning for the URLs real applications actually use');
});

test('url scheme: an <img> is left alone — a script scheme cannot run there', async () => {
  const img: HTMLImageElement = document.createElement('img');
  const said: string[] = await reported(() => setAttr(img, 'src', 'javascript:alert(1)'));
  assert.deepEqual(said, [], 'seventeen of the twenty-six real bindings are this shape; warning here would be noise');
});

test('url scheme: a reactive binding is checked on every value, not just the first', async () => {
  const a: HTMLAnchorElement = document.createElement('a');
  const url: Signal<string> = signal('/safe');
  const first: string[] = await reported(() => bindAttr(a, 'href', () => url()));
  assert.deepEqual(first, [], 'the safe first value says nothing');
  const later: string[] = await reported(() => {
    url.set('javascript:alert(1)');
  });
  assert.ok(later.length > 0, `a value that arrives later is checked too (got ${JSON.stringify(later)})`);
});
