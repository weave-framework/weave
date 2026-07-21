/**
 * Infinite scroll — a sentinel that asks for the next page when it nears the viewport (FW-20).
 *
 * The CDK's scroll family covers overlay scroll strategies (`scroll`), windowing data you already
 * have (`virtual-scroll`) and resize/mutation signals (`observers`). "Fetch the next page when the
 * user nears the bottom" was the one missing piece, and it is the paging model every cursor-based
 * list uses. Small, universal, and easy to get subtly wrong — which is what puts it here beside
 * `focus-trap` and `live-announcer` rather than in every application.
 *
 * Headless: no markup, no spinner, no empty state. Put it on a bare element after the rows and
 * render whatever you like next to it.
 *
 *   <div use:infiniteScroll={{ { hasMore: () => list.hasMore(),
 *                               loading: () => list.loading(),
 *                               onLoad:  () => list.loadMore() } }}></div>
 *
 * Composes with `virtual-scroll` rather than competing: that one decides what to *render*, this one
 * decides when to *ask for more*.
 */

import { signal, effect, onDispose, type Signal } from '@weave-framework/runtime';
import { isBrowser } from './platform.js';

export interface InfiniteScrollOptions {
  /** More pages exist. While false nothing is requested; flipping it back to true re-arms. */
  hasMore: () => boolean;
  /**
   * A fetch is in flight. Never fires while this is true — and its **`true → false` edge is what
   * chains the next page**: when a load finishes with the sentinel still on screen, the next page is
   * requested immediately. Without that, a page too short to fill a tall viewport would leave the
   * list stuck after page 1, because the sentinel never left the screen to re-trigger the observer.
   */
  loading: () => boolean;
  /** Fetch the next page. */
  onLoad: () => void;
  /** How early to fire, as an `IntersectionObserver` rootMargin. Default `'150px'`. */
  rootMargin?: string;
  /** Scroll container. Default `null` — the viewport. Any scrollable ancestor works. */
  root?: Element | null;
}

/**
 * `use:infiniteScroll={{ options }}` — request the next page while `el` is near the scrollport.
 *
 * Returns the `{ update, destroy }` handle: `update` re-observes when `root`/`rootMargin` change,
 * `destroy` disconnects on unmount.
 */
export const infiniteScroll = (
  el: Element,
  options: InfiniteScrollOptions,
): { update: (next: InfiniteScrollOptions) => void; destroy: () => void } => {
  let opts: InfiniteScrollOptions = options;

  /** Whether the sentinel is currently within `rootMargin` of the scrollport. */
  const intersecting: Signal<boolean> = signal<boolean>(false);
  let observer: IntersectionObserver | null = null;

  const connect = (): void => {
    observer?.disconnect();
    if (!isBrowser || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]): void => {
        // The last entry is the current state; an observer may batch several.
        intersecting.set(entries[entries.length - 1].isIntersecting);
      },
      { root: opts.root ?? null, rootMargin: opts.rootMargin ?? '150px' },
    );
    observer.observe(el);
  };

  connect();

  /**
   * The single decision point, reactive over all three inputs. Reading `loading()` here is what
   * makes a finished load re-evaluate: the effect re-runs on its `true → false` edge and fires
   * again if the sentinel is still in view.
   *
   * This cannot spin. `onLoad` is expected to flip `loading` to true, which re-runs the effect into
   * the guarded branch; and if a consumer changes no tracked signal at all, nothing re-runs it.
   */
  effect((): void => {
    if (!intersecting() || !opts.hasMore() || opts.loading()) return;
    opts.onLoad();
  });

  const destroy = (): void => {
    observer?.disconnect();
    observer = null;
  };
  onDispose(destroy);

  return {
    update: (next: InfiniteScrollOptions): void => {
      const reconnect: boolean = next.root !== opts.root || next.rootMargin !== opts.rootMargin;
      opts = next;
      // Only the observer's own configuration needs a new observer; the callbacks are read live.
      if (reconnect) connect();
    },
    destroy,
  };
};
