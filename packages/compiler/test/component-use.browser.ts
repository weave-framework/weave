import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, createOwner, runInOwner, disposeOwner, type Owner, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

// `use:` actions on a component tag forward to the component's single root DOM element,
// with the identical lifecycle (onMount timing, cleanup / { update, destroy }, order) that
// an element-level action gets — reusing the same `applyAction` path. A component that does
// not render exactly one Element is a loud error, never a silent mis-attach.

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Let queued onMount microtasks flush (applyAction defers to onMount timing). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

type Comp = (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node;

/** A single-root component: renders exactly one `<button class="wc-btn">`. */
const Button: Comp = () => {
  const b: HTMLButtonElement = document.createElement('button');
  b.className = 'wc-btn';
  b.textContent = 'Go';
  return b;
};

/** A multi-root component: renders a 3-node fragment (no single root Element). */
const Multi: Comp = () => {
  const f: DocumentFragment = document.createDocumentFragment();
  f.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return f;
};

/**
 * Compile a component-bearing template (function mode) with `_c` supplying the child
 * components, mount it inside a fresh container, and return a `dispose` that unmounts.
 * `fn` may throw synchronously (the single-root guard fires the instant the node is
 * produced) — in that case nothing is added to the document.
 */
function mountC(
  html: string,
  ctx: Record<string, unknown>,
  scope: string[],
  components: Record<string, Comp>
): { container: HTMLElement; dispose: () => void } {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Node = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Node;
  const owner: Owner = createOwner();
  const node: Node = runInOwner(owner, () => fn(ctx, rt, components)); // may throw (componentRoot)
  const container: HTMLElement = document.createElement('div');
  container.appendChild(node);
  document.body.appendChild(container);
  return {
    container,
    dispose: () => {
      disposeOwner(owner);
      container.remove();
    },
  };
}

test('use: on a single-root component forwards the action to its root element', async () => {
  let gotEl: Element | null = null;
  const flag = (el: Element): void => {
    gotEl = el;
  };
  const { container, dispose } = mountC('<Button use:flag></Button>', { flag }, ['flag'], { Button });
  const btn: Element | null = container.querySelector('.wc-btn');

  assert.equal(gotEl, null, 'action must NOT run during construction (onMount timing)');
  await tick();
  assert.equal(gotEl, btn, 'action receives the component root <button>');
  assert.ok(gotEl && document.contains(gotEl), 'root element is live in the document when the action runs');
  dispose();
});

test('aria/attrs an action sets land on the component root element', async () => {
  const menu = (el: Element): void => {
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
  };
  const { container, dispose } = mountC('<Button use:menu></Button>', { menu }, ['menu'], { Button });
  await tick();
  const btn: Element | null = container.querySelector('.wc-btn');
  assert.equal(btn?.getAttribute('aria-haspopup'), 'menu', 'aria-haspopup is on the root button');
  assert.equal(btn?.getAttribute('aria-expanded'), 'false', 'aria-expanded is on the root button');
  dispose();
});

test('one action definition attaches to BOTH a component and a native element (one menu, N triggers)', async () => {
  const triggers: Element[] = [];
  const menu = (el: Element, _opts: unknown): void => {
    el.setAttribute('aria-haspopup', 'menu');
    triggers.push(el);
  };
  const opts: { items: string[] } = { items: ['edit', 'delete'] }; // defined ONCE
  const { container, dispose } = mountC(
    '<div><Button use:menu={{ opts }}></Button><a use:menu={{ opts }}>Bottom</a></div>',
    { menu, opts },
    ['menu', 'opts'],
    { Button }
  );
  await tick();
  const btn: Element | null = container.querySelector('.wc-btn');
  const link: Element | null = container.querySelector('a');
  assert.equal(btn?.getAttribute('aria-haspopup'), 'menu', 'aria landed on the component root button');
  assert.equal(link?.getAttribute('aria-haspopup'), 'menu', 'aria landed on the native trigger');
  assert.equal(triggers.length, 2, 'the same definition ran for both triggers');
  dispose();
});

test('use:action={{arg}} passes the arg; reactive { update } re-runs on change; destroy on unmount', async () => {
  const size: Signal<number> = signal(1);
  const seen: number[] = [];
  let initial: unknown = undefined;
  let destroyed: boolean = false;
  const track = (_el: Element, n: number): dom.ActionResult<number> => {
    initial = n;
    return { update: (v: number): void => void seen.push(v), destroy: (): void => void (destroyed = true) };
  };
  const { dispose } = mountC('<Button use:track={{ size() }}></Button>', { track, size }, ['track', 'size'], { Button });
  await tick();
  assert.equal(initial, 1, 'the initial arg reaches the action');
  size.set(2);
  await tick();
  size.set(3);
  await tick();
  assert.deepEqual(seen, [2, 3], 'update() re-runs with the new arg on each change');
  dispose();
  assert.equal(destroyed, true, 'destroy() runs on unmount');
});

test('multiple use: on one component all run, in order, each with the root element', async () => {
  const order: string[] = [];
  let elA: Element | null = null;
  let elB: Element | null = null;
  const a = (el: Element): void => {
    order.push('a');
    elA = el;
  };
  const b = (el: Element): void => {
    order.push('b');
    elB = el;
  };
  const { container, dispose } = mountC('<Button use:a use:b></Button>', { a, b }, ['a', 'b'], { Button });
  await tick();
  const btn: Element | null = container.querySelector('.wc-btn');
  assert.deepEqual(order, ['a', 'b'], 'both actions ran, in template order');
  assert.equal(elA, btn, 'first action attached to the root');
  assert.equal(elB, btn, 'second action attached to the same root');
  dispose();
});

test('a returned cleanup fn runs on unmount', async () => {
  let cleaned: boolean = false;
  const wire = (_el: Element): (() => void) => (): void => void (cleaned = true);
  const { dispose } = mountC('<Button use:wire></Button>', { wire }, ['wire'], { Button });
  await tick();
  assert.equal(cleaned, false, 'cleanup has not run while mounted');
  dispose();
  assert.equal(cleaned, true, 'cleanup ran on unmount');
});

test('use: on a multi-root component is a loud error, not a silent no-op', () => {
  const flag = (): void => {};
  let err: unknown = null;
  try {
    mountC('<Multi use:flag></Multi>', { flag }, ['flag'], { Multi });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'a multi-root component with use: throws (not a silent no-op)');
  assert.ok(
    (err as Error).message.includes('use: on <Multi>: actions attach to a single root element, but <Multi> renders 3 nodes'),
    `clear single-root error message, got: ${(err as Error).message}`
  );
});
