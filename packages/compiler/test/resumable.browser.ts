import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { resumeEvents, collectResumable, resumableHandler, handlerAttr, type ResumeHandler } from '@weave-framework/runtime/resume';
import { compileTemplate } from '@weave-framework/compiler';

/**
 * E0.2b — the compiler's `resumable` target. DOM event handlers compile to `resumableHandler(...)` refs
 * (from `@weave-framework/runtime/resume`) instead of an eager `listen(...)`; the server-rendered HTML
 * carries `data-won-<event>` markers and a delegated {@link resumeEvents} dispatches them on first
 * interaction (see RFC 0009). These tests pin the emit shape, prove eager stays byte-for-byte, and drive
 * a real resumed click end-to-end (including per-row handlers in a `@for`).
 */

// The runtime object the compiled (function-mode) code references as `rt` — dom + core + resume helper.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
  resumableHandler: typeof resumableHandler;
} = { ...dom, signal, computed, effect, root, resumableHandler };

/** Compile in the `resumable` target and hand back the bare `(ctx, slots) => Node` render fn. */
function compileResumable(html: string, scope: string[] = []): (ctx: unknown, slots?: unknown) => Element {
  const { code } = compileTemplate(html, { mode: 'function', scope, resumable: true });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {}) as (ctx: unknown, slots?: unknown) => Element;
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── emit shape ──────────── */

test('resumable module emits a handler ref + imports from runtime/resume, not listen', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>{{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
    resumable: true,
  });
  assert.ok(code.includes('from "@weave-framework/runtime/resume"'), 'imports the resume entry');
  assert.ok(code.includes('resumableHandler('), 'emits a resumable handler ref');
  assert.ok(code.includes('"click"') && code.includes('"w0"'), 'passes the event + a stable site ref');
  assert.ok(!code.includes('listen('), 'no eager listener in the resumable target');
  assert.ok(code.includes('bindText('), 'non-event bindings are unchanged');
});

test('eager (default) target is unchanged — listen(), no resume import', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>{{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
  });
  assert.ok(code.includes('listen('), 'still wires an eager listener');
  assert.ok(!code.includes('resumableHandler('), 'no resumable ref');
  assert.ok(!code.includes('runtime/resume'), 'never imports the resume entry');
});

test('each event site gets a distinct stable ref (w0, w1, …)', () => {
  const { code } = compileTemplate('<div><button on:click={{a}}>a</button><button on:input={{b}}>b</button></div>', {
    mode: 'module',
    scope: ['a', 'b'],
    resumable: true,
  });
  assert.ok(code.includes('"w0"') && code.includes('"w1"'), 'two sites → two refs');
});

/* ──────────── behaviour: a resumed click ──────────── */

test('resumable: a resumed click invokes the right handler (no eager listener)', () => {
  const count: Signal<number> = signal(0);
  const inc = (): number => count.set((c) => c + 1);
  const render = compileResumable('<button on:click={{inc}}>x</button>', ['count', 'inc']);

  const { node, handlers } = collectResumable(() => render({ count, inc }));
  const btn: HTMLButtonElement = node as HTMLButtonElement;
  const container: HTMLElement = host();
  container.appendChild(btn);

  // the element carries the marker, and NO live listener was attached at render time
  assert.ok(btn.getAttribute(handlerAttr('click'))!.startsWith('w0#'), 'stamped data-won-click marker');
  btn.click();
  assert.equal(count(), 0, 'a bare click does nothing before resume (handler was not wired eagerly)');

  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  btn.click();
  btn.click();
  assert.equal(count(), 2, 'after resume, the delegated dispatch invokes the handler');
  ctl.dispose();
});

test('resumable: preventDefault modifier still applies through the handler body', () => {
  let ran: boolean = false;
  const onSubmit = (): boolean => (ran = true);
  const render = compileResumable('<button on:click|preventDefault={{onSubmit}}>go</button>', ['onSubmit']);
  const { node, handlers } = collectResumable(() => render({ onSubmit }));
  const container: HTMLElement = host();
  container.appendChild(node);
  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  const ev: MouseEvent = new MouseEvent('click', { cancelable: true, bubbles: true });
  node.dispatchEvent(ev);
  assert.ok(ran, 'handler ran via resume');
  assert.ok(ev.defaultPrevented, 'preventDefault modifier honoured in the resumable target');
  ctl.dispose();
});

test('resumable: each @for row registers its OWN handler (instance-unique refs)', () => {
  const items: Signal<number[]> = signal([10, 20, 30]);
  const picked: Signal<number> = signal(0);
  const render = compileResumable(
    '<ul>@for (n of items(); track n) { <li><button on:click={{() => picked.set(n)}}>{{ n }}</button></li> }</ul>',
    ['items', 'picked']
  );
  const { node, handlers } = collectResumable(() => render({ items, picked }));
  const container: HTMLElement = host();
  container.appendChild(node);

  const buttons: HTMLButtonElement[] = [...node.querySelectorAll('button')] as HTMLButtonElement[];
  assert.equal(buttons.length, 3, 'three rows rendered');
  // three DISTINCT ids captured (not one shared ref overwriting)
  const ids: string[] = buttons.map((b) => b.getAttribute(handlerAttr('click'))!);
  assert.equal(new Set(ids).size, 3, 'each row got a distinct data-won-click id');
  assert.equal(handlers.size, 3, 'three handlers registered');

  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  buttons[1].click();
  assert.equal(picked(), 20, 'clicking the second row invoked THAT row’s handler, not a shared one');
  buttons[2].click();
  assert.equal(picked(), 30, 'third row too');
  ctl.dispose();
});

test('resumableHandler returns instance-unique ids and registers into the active session', () => {
  const el1: HTMLButtonElement = document.createElement('button');
  const el2: HTMLButtonElement = document.createElement('button');
  const seen: string[] = [];
  const { handlers } = collectResumable(() => {
    const a: string = resumableHandler(el1, 'click', 'w0', (() => seen.push('a')) as ResumeHandler);
    const b: string = resumableHandler(el2, 'click', 'w0', (() => seen.push('b')) as ResumeHandler);
    assert.ok(a !== b, 'same site ref → distinct instance ids');
    return null;
  });
  assert.equal(handlers.size, 2, 'both handlers captured');
  handlers.get(el2.getAttribute('data-won-click')!)!(new Event('click'), el2);
  assert.deepEqual(seen, ['b'], 'the second element’s id resolves to the second handler');
});
