/**
 * One of two sibling components that both define `.box`, to show the scoping claim rather than assert it.
 *
 * Nothing here coordinates with the other one. Both stylesheets say `.box { … }` with different values,
 * and the compiler rewrites each to match its own `data-w-<hash>`, so neither can reach the other's
 * element. The attribute is read out of the DOM at mount so the page can print the real hash.
 */
import { signal, onMount, type Signal } from '@weave-framework/runtime';

export function setup() {
  const scope: Signal<string> = signal('(reading…)');
  const el: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);

  onMount(() => {
    const node = el();
    if (!node) return;
    const attr = [...node.attributes].map((a) => a.name).find((n) => n.startsWith('data-w-'));
    scope.set(attr ?? '(none)');
  });
}
