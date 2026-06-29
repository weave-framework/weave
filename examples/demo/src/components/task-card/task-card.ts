import { useEditor, type EditorStore } from '../../stores/editor';
import type { Task } from '../../types';

/** A single task card. `task` is passed by the board; rendered inside each column. */
export function setup(props: { task: Task }): { task: () => Task; editor: EditorStore } {
  // Re-exposed so the template reads through the (reactive) prop getter.
  const task = (): Task => props.task;
  const editor: EditorStore = useEditor();
  return { task, editor };
}
