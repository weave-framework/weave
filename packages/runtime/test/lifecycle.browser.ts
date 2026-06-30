import { test, assert } from '../../../tools/harness.js';
import { signal, onMount, onDispose, createOwner, runInOwner, disposeOwner } from '@weave-framework/runtime';
import type { Signal, Owner } from '@weave-framework/runtime';
import { defineComponent, mountComponent } from '@weave-framework/runtime/dom';
import type { Component } from '@weave-framework/runtime/dom';

/** Let queued onMount microtasks flush (FIFO — ours were enqueued earlier). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

test('onMount fires after the component DOM is inserted (not synchronously)', async () => {
  const host: HTMLDivElement = document.createElement('div');
  document.body.appendChild(host);
  let liveAtMount: boolean | null = null;
  const C: Component = defineComponent(
    () => {
      const p: HTMLParagraphElement = document.createElement('p');
      p.id = 'om-live';
      return p;
    },
    () => {
      onMount(() => {
        liveAtMount = !!document.getElementById('om-live');
      });
    }
  );
  const unmount: () => void = mountComponent(C, host);
  assert.equal(liveAtMount, null, 'onMount must not run during construction');
  await tick();
  assert.equal(liveAtMount, true, 'onMount runs after insertion — DOM is live');
  unmount();
  host.remove();
});

test('onMount can read a ref populated during render', async () => {
  const host: HTMLDivElement = document.createElement('div');
  document.body.appendChild(host);
  const elRef: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  let tag: string = '';
  const C: Component = defineComponent(
    () => {
      const b: HTMLButtonElement = document.createElement('button');
      elRef.set(b);
      return b;
    },
    () => {
      onMount(() => {
        tag = elRef()?.tagName ?? '';
      });
    }
  );
  mountComponent(C, host);
  await tick();
  assert.equal(tag, 'BUTTON');
  host.remove();
});

test('a returned cleanup runs on unmount', async () => {
  const host: HTMLDivElement = document.createElement('div');
  document.body.appendChild(host);
  let cleaned: number = 0;
  const C: Component = defineComponent(
    () => document.createElement('span'),
    () => {
      onMount(() => () => {
        cleaned++;
      });
    }
  );
  const unmount: () => void = mountComponent(C, host);
  await tick();
  assert.equal(cleaned, 0);
  unmount();
  assert.equal(cleaned, 1);
  host.remove();
});

test('onDispose registered inside onMount ties to the component owner', async () => {
  const host: HTMLDivElement = document.createElement('div');
  document.body.appendChild(host);
  let disposed: number = 0;
  const C: Component = defineComponent(
    () => document.createElement('i'),
    () => {
      onMount(() => {
        onDispose(() => disposed++);
      });
    }
  );
  const unmount: () => void = mountComponent(C, host);
  await tick();
  assert.equal(disposed, 0);
  unmount();
  assert.equal(disposed, 1);
  host.remove();
});

test('onMount does not fire if its scope is disposed before the microtask', async () => {
  let ran: number = 0;
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    onMount(() => ran++);
  });
  disposeOwner(owner); // unmount before the flush
  await tick();
  assert.equal(ran, 0);
});

test('multiple onMount callbacks fire in registration order', async () => {
  const order: number[] = [];
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    onMount(() => order.push(1));
    onMount(() => order.push(2));
  });
  await tick();
  assert.deepEqual(order, [1, 2]);
  disposeOwner(owner);
});
