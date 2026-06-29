import { effect, fade, scale } from '@weave/runtime';
import { Portal, type TransitionFn } from '@weave/runtime/dom';
import TaskForm from '../../pages/task-form/task-form';
import { useEditor, type EditorStore } from '../../stores/editor';

// `<Portal>` / `<TaskForm>` are referenced in task-modal.html.
void Portal;
void TaskForm;

interface TaskModalSetup {
  editor: EditorStore;
  fade: TransitionFn<{ duration?: number } | void>;
  scale: TransitionFn<{ start?: number; duration?: number } | void>;
  overlayFade: { duration: number };
  dialogIn: { start: number; duration: number };
  onBackdrop: (e: MouseEvent) => void;
}

/** Focusable controls inside the open dialog (for autofocus + the Tab trap). */
function focusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.tm-dialog button, .tm-dialog input, .tm-dialog select')].filter(
    (el) => !el.hasAttribute('disabled')
  );
}

/**
 * The global task editor overlay. Rendered once in the shell; shows the create/edit
 * form in a `Portal` (so it escapes the layout's stacking context) with fade/scale
 * transitions. While open it owns the accessible-modal concerns the framework leaves
 * to the app: Escape to close, scroll-lock, autofocus, focus restore, and a Tab trap.
 */
export function setup(): TaskModalSetup {
  const editor: EditorStore = useEditor();

  effect(() => {
    if (!editor.isOpen()) return;

    const trigger: HTMLElement | null = document.activeElement as HTMLElement | null;
    const prevOverflow: string = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        editor.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items: HTMLElement[] = focusables();
      if (items.length === 0) return;
      const first: HTMLElement = items[0];
      const last: HTMLElement = items[items.length - 1];
      const active: Element | null = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    // Focus the first field once the dialog content has rendered (a microtask after
    // the `@if` inserts it — reactivity is synchronous, so it's already there).
    queueMicrotask(() => focusables()[0]?.focus());

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.(); // restore focus to whatever opened the modal
    };
  });

  return {
    editor,
    fade,
    scale,
    overlayFade: { duration: 160 },
    dialogIn: { start: 0.96, duration: 160 },
    onBackdrop: (e: MouseEvent) => {
      if (e.target === e.currentTarget) editor.close();
    },
  };
}
