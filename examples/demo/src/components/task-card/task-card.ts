import { inject } from '@weave/runtime';
import { useEditor, type EditorStore } from '../../stores/editor';
import { SessionContext, type Session } from '../../app/session';
import type { Task } from '../../types';

interface TaskCardSetup {
  task: () => Task;
  editor: EditorStore;
  /** True when the card's assignee is the signed-in user (from injected session). */
  mine: () => boolean;
}

/** A single task card. `task` is passed by the board; rendered inside each column. */
export function setup(props: { task: Task }): TaskCardSetup {
  // Re-exposed so the template reads through the (reactive) prop getter.
  const task = (): Task => props.task;
  const editor: EditorStore = useEditor();
  // Injected from the shell — no prop threads through Link → card (A.1 context).
  const session: Session = inject(SessionContext);
  const mine = (): boolean => !!props.task.assignee && props.task.assignee === session.currentUser;
  return { task, editor, mine };
}
