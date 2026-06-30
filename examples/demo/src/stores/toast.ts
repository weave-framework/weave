/**
 * UI store for transient toast notifications. A tiny global singleton — any page
 * or action (`board.create` succeeded, a submit rolled back) calls `push()` and the
 * `<ToastHost>` (mounted once in the shell) renders the stack with enter/leave motion.
 *
 * The store owns the auto-dismiss timers so a toast disappears on its own; `dismiss`
 * also clears the timer, so a manual close can't leave a stray timeout firing later.
 */

import { store } from '@weave-framework/store';
import { signal, type Signal } from '@weave-framework/runtime';

/** A single notification. `kind` drives the accent color in `<ToastHost>`. */
export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ToastStore {
  /** The live stack, oldest first. Reactive. */
  toasts: () => Toast[];
  /** Show a toast; returns its id. Auto-dismisses after {@link TTL} ms. */
  push: (kind: Toast['kind'], message: string) => number;
  /** Remove a toast now (and cancel its auto-dismiss timer). */
  dismiss: (id: number) => void;
}

/** How long a toast lingers before it auto-dismisses. */
const TTL: number = 4000;

export const useToasts: () => ToastStore = store(() => {
  const list: Signal<Toast[]> = signal<Toast[]>([]);
  const timers: Map<number, ReturnType<typeof setTimeout>> = new Map<number, ReturnType<typeof setTimeout>>();
  let seq: number = 0;

  const dismiss = (id: number): void => {
    const timer: ReturnType<typeof setTimeout> | undefined = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    list.set((xs) => xs.filter((t) => t.id !== id));
  };

  const push = (kind: Toast['kind'], message: string): number => {
    const id: number = ++seq;
    list.set((xs) => [...xs, { id, kind, message }]);
    timers.set(id, setTimeout(() => dismiss(id), TTL));
    return id;
  };

  return { toasts: () => list(), push, dismiss };
});
