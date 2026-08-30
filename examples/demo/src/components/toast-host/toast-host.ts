import { fade, fly, type TransitionFn } from '@weave-framework/runtime';
import { Portal } from '@weave-framework/runtime/dom';
import { useToasts, type Toast, type ToastStore } from '../../stores/toast';

// `<Portal>` is referenced in toast-host.html.
void Portal;

interface ToastHostSetup {
  toasts: () => Toast[];
  dismiss: (id: number) => void;
  fly: TransitionFn<{ x?: number; duration?: number } | void>;
  fade: TransitionFn<{ duration?: number } | void>;
  enter: { x: number; duration: number };
  leave: { duration: number };
}

/**
 * Renders the global toast stack. Mounted once in the shell; a `Portal` floats it
 * over everything (including the editor modal) at the corner. Each toast is a keyed
 * `@for` row whose root is a real element, so it carries the transitions directly —
 * `in:fly` (slide in from the right) and `out:fade` (the leave the store's removal awaits).
 */
export function setup(): ToastHostSetup {
  const store: ToastStore = useToasts();
  return {
    toasts: store.toasts,
    dismiss: store.dismiss,
    fly,
    fade,
    enter: { x: 24, duration: 180 },
    leave: { duration: 160 },
  };
}
