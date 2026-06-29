/**
 * UI store for the task editor overlay. A tiny global singleton so any page
 * (board's "New task", a detail page's "Edit") can open the same modal — the
 * modal itself lives once, in the app shell, and reads this state.
 */

import { store } from '@weave/store';
import { signal, type Signal } from '@weave/runtime';

/** Closed, or open in create / edit mode. */
type EditorState = null | { mode: 'new' } | { mode: 'edit'; id: string };

export interface EditorStore {
  isOpen: () => boolean;
  /** The id being edited, or undefined in create mode. Reactive. */
  editId: () => string | undefined;
  /** Open the editor — pass a task id to edit, or nothing to create. */
  open: (id?: string) => void;
  close: () => void;
}

export const useEditor: () => EditorStore = store(() => {
  const state: Signal<EditorState> = signal<EditorState>(null);
  return {
    isOpen: () => state() !== null,
    editId: () => {
      const s: EditorState = state();
      return s && s.mode === 'edit' ? s.id : undefined;
    },
    open: (id?: string) => state.set(id ? { mode: 'edit', id } : { mode: 'new' }),
    close: () => state.set(null),
  };
});
