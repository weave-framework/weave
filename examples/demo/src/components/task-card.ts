import type { Task } from '../types';

/** A single task card. `task` is passed by the board; rendered inside each column. */
export function setup(props: { task: Task }) {
  // Re-exposed so the template reads through the (reactive) prop getter.
  const task = (): Task => props.task;
  return { task };
}
