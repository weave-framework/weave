import { test, assert } from '../../../../tools/harness.js';
import { signal, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import { infiniteScroll, type InfiniteScrollOptions } from '@weave-framework/ui/cdk';

/**
 * `IntersectionObserver` delivers its first record asynchronously, off the rendering steps — two
 * frames is the settled point the other CDK scroll tests use for the same reason.
 */
const settle = (): Promise<void> =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

interface Harness {
  /** Every `onLoad` call, so a test can assert "once", not merely "at least once". */
  loads: number;
  hasMore: Signal<boolean>;
  loading: Signal<boolean>;
  sentinel: HTMLElement;
  container: HTMLElement;
  handle: ReturnType<typeof infiniteScroll>;
  /** The action's owner — disposed alone when a test needs to separate teardown from DOM removal. */
  owner: Owner;
  dispose: () => void;
}

/**
 * A scroll container with `contentHeight` of filler above the sentinel. `contentHeight: 0` puts the
 * sentinel on screen immediately — the empty-list / short-page case; a tall filler pushes it out of
 * view so a test has to scroll to reach it.
 */
function mount(
  opts: Partial<InfiniteScrollOptions> = {},
  contentHeight: number = 0,
  containerHeight: number = 200,
): Harness {
  const container: HTMLElement = document.createElement('div');
  container.style.cssText = `height:${containerHeight}px; overflow:auto`;
  const filler: HTMLElement = document.createElement('div');
  filler.style.height = `${contentHeight}px`;
  const sentinel: HTMLElement = document.createElement('div');
  sentinel.style.height = '1px';
  container.append(filler, sentinel);
  document.body.appendChild(container);

  const hasMore: Signal<boolean> = signal<boolean>(true);
  const loading: Signal<boolean> = signal<boolean>(false);
  const h: Harness = {
    loads: 0,
    hasMore,
    loading,
    sentinel,
    container,
    handle: null as unknown as ReturnType<typeof infiniteScroll>,
    owner: null as unknown as Owner,
    dispose: (): void => {},
  };
  const owner: Owner = createOwner();
  h.owner = owner;
  h.handle = runInOwner(owner, () =>
    infiniteScroll(sentinel, {
      hasMore: (): boolean => hasMore(),
      loading: (): boolean => loading(),
      onLoad: (): void => {
        h.loads++;
      },
      root: container,
      rootMargin: '0px',
      ...opts,
    }),
  );
  h.dispose = (): void => {
    disposeOwner(owner);
    container.remove();
  };
  return h;
}

/* ─────────────────── firing ─────────────────── */

test('infiniteScroll: a sentinel already in view asks for a page (FW-20)', async () => {
  const h: Harness = mount();
  await settle();
  assert.equal(h.loads, 1, 'the empty-list case loads without any scrolling');
  h.dispose();
});

test('infiniteScroll: nothing is requested while a fetch is in flight (FW-20)', async () => {
  const h: Harness = mount();
  h.loading.set(true);
  await settle();
  assert.equal(h.loads, 0, 'loading() gates the very first fire');
  h.loading.set(false);
  assert.equal(h.loads, 1, 'and releases it when the flight clears');
  h.dispose();
});

test('infiniteScroll: a short page chains — loading true→false with the sentinel still on screen (FW-20)', async () => {
  const h: Harness = mount();
  await settle();
  assert.equal(h.loads, 1);
  // A page arrives that does not fill the viewport: the sentinel never left, so only the loading
  // edge can re-trigger. This is the "list stops after page 1 on a tall screen" bug.
  h.loading.set(true);
  h.loading.set(false);
  assert.equal(h.loads, 2, 'the next page is requested without the sentinel leaving view');
  h.dispose();
});

test('infiniteScroll: one page per flight — a load does not fire twice on its own (FW-20)', async () => {
  const h: Harness = mount();
  await settle();
  assert.equal(h.loads, 1);
  await settle();
  assert.equal(h.loads, 1, 'still one — a steady intersecting state does not re-fire');
  h.dispose();
});

/* ─────────────────── hasMore ─────────────────── */

test('infiniteScroll: idle while hasMore is false, and re-arms when it flips back (FW-20)', async () => {
  const h: Harness = mount();
  h.hasMore.set(false);
  await settle();
  assert.equal(h.loads, 0, 'exhausted list asks for nothing');
  h.hasMore.set(true); // e.g. a filter reset
  assert.equal(h.loads, 1, 're-arms without remounting');
  h.dispose();
});

/* ─────────────────── the scroll container ─────────────────── */

test('infiniteScroll: inside a scroll container it waits until the sentinel is near (FW-20)', async () => {
  const h: Harness = mount({}, 2000); // sentinel pushed far below the 200px container
  await settle();
  assert.equal(h.loads, 0, 'out of view — nothing requested');
  h.container.scrollTop = 2000;
  await settle();
  assert.equal(h.loads, 1, 'scrolling it into view requests the page');
  h.dispose();
});

test('infiniteScroll: rootMargin fires early, before the sentinel is actually visible (FW-20)', async () => {
  const near: Harness = mount({ rootMargin: '400px' }, 500);
  await settle();
  assert.equal(near.loads, 1, '400px of margin reaches a sentinel 300px below the fold');
  near.dispose();

  const far: Harness = mount({ rootMargin: '0px' }, 500);
  await settle();
  assert.equal(far.loads, 0, 'without the margin the same sentinel is out of range');
  far.dispose();
});

/* ─────────────────── lifecycle ─────────────────── */

/**
 * Asserting on `loads` cannot prove this: disposing the owner kills the effect that calls `onLoad`,
 * so a leaked observer would look identical. Count the real `disconnect()` instead — the leak this
 * guards is an observer still holding the element after the owner is gone.
 */
test('infiniteScroll: owner disposal disconnects the observer (FW-20)', async () => {
  const Real: typeof IntersectionObserver = IntersectionObserver;
  let disconnects: number = 0;
  class Spy extends Real {
    override disconnect(): void {
      disconnects++;
      super.disconnect();
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = Spy;
  try {
    const h: Harness = mount({}, 2000);
    await settle();
    assert.equal(disconnects, 0, 'nothing disconnected while it is live');
    disposeOwner(h.owner); // the owner alone — the container stays in the document
    assert.equal(disconnects, 1, 'owner disposal ran the action teardown');
    h.container.remove();
  } finally {
    (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = Real;
  }
});

test('infiniteScroll: nothing is requested after disposal (FW-20)', async () => {
  const h: Harness = mount({}, 2000);
  await settle();
  assert.equal(h.loads, 0);
  disposeOwner(h.owner);
  h.container.scrollTop = 2000; // still in the document, so a live observer WOULD see this
  await settle();
  assert.equal(h.loads, 0, 'a disposed sentinel requests nothing');
  h.container.remove();
});

test('infiniteScroll: update() re-observes when rootMargin changes (FW-20)', async () => {
  const h: Harness = mount({ rootMargin: '0px' }, 500);
  await settle();
  assert.equal(h.loads, 0, 'out of range at first');
  h.handle.update({
    hasMore: (): boolean => h.hasMore(),
    loading: (): boolean => h.loading(),
    onLoad: (): void => {
      h.loads++;
    },
    root: h.container,
    rootMargin: '400px',
  });
  await settle();
  assert.equal(h.loads, 1, 'the widened margin now reaches it');
  h.dispose();
});

test('infiniteScroll: destroy() is idempotent and safe to call directly (FW-20)', async () => {
  const h: Harness = mount({}, 2000);
  await settle();
  h.handle.destroy();
  h.handle.destroy(); // no throw
  h.container.scrollTop = 2000;
  await settle();
  assert.equal(h.loads, 0);
  h.dispose();
});
