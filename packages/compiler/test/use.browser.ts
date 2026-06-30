import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, onDispose, onCleanup, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

// The runtime object the compiled (function-mode) code references as `rt`.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Let queued onMount microtasks flush (applyAction defers to onMount timing). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

/**
 * Compile a `use:` template (function mode), instantiate it inside a fresh owner,
 * attach it to the document, and hand back a `dispose` that unmounts it (so
 * action cleanups / onCleanup / effects tear down the way they would in an app).
 */
function mount(
  html: string,
  ctx: Record<string, unknown>,
  scope: string[]
): { el: Element; dispose: () => void } {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  const owner: Owner = createOwner();
  const el: Element = runInOwner(owner, () => fn(ctx, rt, {}));
  document.body.appendChild(el);
  return {
    el,
    dispose: () => {
      disposeOwner(owner);
      el.remove();
    },
  };
}

test('use: runs the action after insertion with the live element (not synchronously)', async () => {
  let calledWith: { el: Element | null; live: boolean } | null = null;
  const flag = (el: Element): void => {
    calledWith = { el, live: document.contains(el) };
  };
  const { el, dispose } = mount('<div id="ua-a" use:flag></div>', { flag }, ['flag']);

  assert.equal(calledWith, null, 'action must NOT run during construction');
  await tick();
  assert.ok(calledWith, 'action ran after the mount microtask');
  assert.equal(calledWith!.el, el, 'action receives the element it is attached to');
  assert.equal(calledWith!.live, true, 'element is live in the document when the action runs');
  dispose();
});

test('use:action={{arg}} passes the argument through', async () => {
  let seen: unknown = undefined;
  const grab = (_el: Element, arg: unknown): void => {
    seen = arg;
  };
  const { dispose } = mount('<div use:grab={{opts}}></div>', { grab, opts: { color: 'red' } }, ['grab', 'opts']);
  await tick();
  assert.deepEqual(seen, { color: 'red' }, 'the arg expression value reaches the action');
  dispose();
});

test('use:action with no arg calls action(el, undefined)', async () => {
  let arg: unknown = 'sentinel';
  let gotEl: Element | null = null;
  const probe = (el: Element, a: unknown): void => {
    gotEl = el;
    arg = a;
  };
  const { el, dispose } = mount('<div use:probe></div>', { probe }, ['probe']);
  await tick();
  assert.equal(gotEl, el, 'element still passed in the no-arg form');
  assert.equal(arg, undefined, 'no-arg form yields an undefined argument');
  dispose();
});

test('reactive arg via getter — action wraps the read in an effect', async () => {
  const text: Signal<string> = signal('hi');
  const seen: string[] = [];
  // The Weave-native reactivity contract: pass a getter, read it inside an effect.
  const tip = (_el: Element, get: () => string): void => {
    effect(() => {
      seen.push(get());
    });
  };
  const { dispose } = mount('<div use:tip={{() => text()}}></div>', { tip, text }, ['tip', 'text']);
  await tick();
  assert.deepEqual(seen, ['hi'], 'effect ran once with the initial value');

  text.set('bye');
  assert.deepEqual(seen, ['hi', 'bye'], 'effect re-ran when the signal changed');
  dispose();

  text.set('after-dispose');
  assert.deepEqual(seen, ['hi', 'bye'], 'effect disposed with the element — no further runs');
});

test('a returned cleanup runs on unmount', async () => {
  let cleaned: number = 0;
  const listen = () => () => {
    cleaned++;
  };
  const { dispose } = mount('<div use:listen></div>', { listen }, ['listen']);
  await tick();
  assert.equal(cleaned, 0, 'cleanup has not run yet');
  dispose();
  assert.equal(cleaned, 1, 'returned cleanup fired on unmount');
});

test('onDispose inside an action runs on unmount (owner-scoped teardown)', async () => {
  let cleaned: number = 0;
  const wire = (): void => {
    onDispose(() => {
      cleaned++;
    });
  };
  const { dispose } = mount('<div use:wire></div>', { wire }, ['wire']);
  await tick();
  assert.equal(cleaned, 0);
  dispose();
  assert.equal(cleaned, 1, 'onDispose registered in the action ties to the element owner');
});

test('onCleanup works inside an effect the action creates', async () => {
  const n: Signal<number> = signal(0);
  const cleanups: number[] = [];
  const wire = (): void => {
    effect(() => {
      const v: number = n();
      onCleanup(() => cleanups.push(v)); // effect-scoped: fires before each re-run + on dispose
    });
  };
  const { dispose } = mount('<div use:wire></div>', { wire, n }, ['wire', 'n']);
  await tick();
  n.set(1); // re-runs the effect → cleans up the v=0 run
  assert.deepEqual(cleanups, [0], 'onCleanup fired for the previous effect run');
  dispose();
  assert.deepEqual(cleanups, [0, 1], 'final onCleanup fired on unmount');
});

test('multiple use: directives on one element each run with that element', async () => {
  const hits: string[] = [];
  const a = (el: Element): number => hits.push('a:' + el.tagName);
  const b = (el: Element): number => hits.push('b:' + el.tagName);
  const { dispose } = mount('<section use:a use:b></section>', { a, b }, ['a', 'b']);
  await tick();
  assert.deepEqual(hits.sort(), ['a:SECTION', 'b:SECTION'], 'both actions ran on the same element');
  dispose();
});

test('use: on a nested (non-root) element resolves the right node', async () => {
  let tag: string = '';
  const mark = (el: Element): void => {
    tag = el.tagName + '#' + el.id;
  };
  const { dispose } = mount('<div><p></p><span id="inner" use:mark></span></div>', { mark }, ['mark']);
  await tick();
  assert.equal(tag, 'SPAN#inner', 'the action is wired to the nested element, not the root');
  dispose();
});
