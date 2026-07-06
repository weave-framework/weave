import { test, assert } from '../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import { defineComponent, extendSetup, mount, type Component } from '@weave-framework/runtime/dom';

// RFC 0008 — component-file extension, mode #1 (full template override). `extendSetup` is the
// runtime half the compiler emits for `export const extend = Base`: it composes the base
// component's setup context with the extension's own — base keys reused, extension keys
// override/add, an optional props seam reshaping the props the BASE setup reads, all with
// chaining. The base's raw setup is retrieved from the `__wSetup` that `defineComponent` attaches.

type Ctx = Record<string, unknown>;

/** A base component whose setup returns a known context (functions, like a real component). */
function makeBase(): Component {
  return defineComponent(
    (ctx: Ctx): Node => {
      const t: HTMLElement = document.createElement('div');
      t.textContent = `${(ctx.a as () => string)()}|${(ctx.b as () => string)()}`;
      return t;
    },
    (props: Ctx): Ctx => ({
      a: (): string => 'base-a',
      b: (): string => 'base-b',
      items: (): unknown => props.items,
    })
  );
}

test('defineComponent attaches the raw setup as __wSetup (the compose seam)', () => {
  const Base: Component = makeBase();
  const withSetup: { __wSetup?: (p: Ctx) => Ctx } = Base;
  assert.ok(typeof withSetup.__wSetup === 'function', 'the base component carries its setup for extension');
  const ctx: Ctx = withSetup.__wSetup!({ items: [1, 2] });
  assert.equal((ctx.a as () => string)(), 'base-a');
  assert.deepEqual((ctx.items as () => unknown)(), [1, 2]);
});

test('extendSetup: base keys are reused, extension keys override + add', () => {
  const Base: Component = makeBase();
  const owner: Owner = createOwner();
  const merged: Ctx = runInOwner(owner, () =>
    extendSetup(Base, (_props, _base) => ({
      b: (): string => 'ext-b', // override
      c: (): string => 'ext-c', // add
    }))({ items: [9] })
  );
  assert.equal((merged.a as () => string)(), 'base-a', 'base-only key reused');
  assert.equal((merged.b as () => string)(), 'ext-b', 'extension overrides the base key');
  assert.equal((merged.c as () => string)(), 'ext-c', 'extension adds a new key');
  assert.deepEqual((merged.items as () => unknown)(), [9], 'base key that reads props still works');
  disposeOwner(owner);
});

test('extendSetup: `own(props, base)` receives the live base context', () => {
  const Base: Component = makeBase();
  let sawBaseA: string | null = null;
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    extendSetup(Base, (_props, base) => {
      sawBaseA = (base.a as () => string)();
      return {};
    })({})
  );
  assert.equal(sawBaseA, 'base-a', 'own setup can read the base context it extends');
  disposeOwner(owner);
});

test('extendSetup: the props seam runs BEFORE the base setup (deep reshape)', () => {
  const Base: Component = makeBase();
  const owner: Owner = createOwner();
  const merged: Ctx = runInOwner(owner, () =>
    extendSetup(
      Base,
      undefined,
      (props) => ({ ...props, items: (props.items as number[]).map((n) => n * 10) }) // reshape props
    )({ items: [1, 2, 3] })
  );
  // `items` is a BASE key that reads `props.items` — proving the reshape reached the base setup,
  // not just a returned key the template sees.
  assert.deepEqual((merged.items as () => unknown)(), [10, 20, 30], 'base setup read the reshaped props');
  disposeOwner(owner);
});

test('extendSetup: chaining — an extended component extends again', () => {
  const Base: Component = makeBase();
  // First extension, as the compiler would emit it: a real component whose setup is composed.
  const Ext: Component = defineComponent((): Node => document.createElement('div'), extendSetup(Base, () => ({ c: (): string => 'ext-c' })));
  const owner: Owner = createOwner();
  const merged: Ctx = runInOwner(owner, () =>
    extendSetup(Ext, (_p, base) => ({ d: (): string => `${(base.c as () => string)()}+d` }))({})
  );
  assert.equal((merged.a as () => string)(), 'base-a', 'grandparent base key survives two levels');
  assert.equal((merged.c as () => string)(), 'ext-c', 'first-extension key visible to the second');
  assert.equal((merged.d as () => string)(), 'ext-c+d', 'second extension composes on the merged context');
  disposeOwner(owner);
});

test('extendSetup end-to-end: a mounted extension renders base + overridden + added values', () => {
  const Base: Component = makeBase();
  // The extension: full-override template that reads a base key (a), an overridden key (b),
  // and a newly-added key (c) — exactly what a mode-#1 extension compiles to.
  const Ext: Component = defineComponent(
    (ctx: Ctx): Node => {
      const p: HTMLElement = document.createElement('p');
      p.textContent = `${(ctx.a as () => string)()} ${(ctx.b as () => string)()} ${(ctx.c as () => string)()}`;
      return p;
    },
    extendSetup(Base, () => ({ b: (): string => 'ext-b', c: (): string => 'ext-c' }))
  );
  const container: HTMLElement = document.createElement('div');
  document.body.appendChild(container);
  const owner: Owner = createOwner();
  const node: Node = runInOwner(owner, () => Ext({}));
  const unmount: () => void = mount(node, container);
  assert.equal(container.textContent, 'base-a ext-b ext-c', 'DOM reflects base + override + addition');
  unmount();
  disposeOwner(owner);
  container.remove();
});
