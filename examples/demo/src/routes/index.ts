import { onMount, signal, debounced } from '@weave/runtime';
import { Link } from '@weave/router';
import { useBoard } from '../stores/board';
import TaskCard from '../components/task-card';
import type { Status } from '../types';

// `<TaskCard>` / `<Link>` are referenced in index.html — capitalized tags resolve
// to these module-level imports, so they need no entry in setup's return.
void TaskCard;
void Link;

/** The board route (path `''`): three status columns with a debounced filter. */
export function setup() {
  const board = useBoard();
  onMount(() => board.load());

  const query = signal('');
  const filter = debounced(query, 200); // trails the input by 200ms of quiet (B.1)

  /** Tasks in a column, narrowed by the (debounced) search query. */
  const visible = (status: Status) => {
    const q = filter().trim().toLowerCase();
    return board.byStatus(status).filter((t) => !q || t.title.toLowerCase().includes(q));
  };

  return { board, query, visible };
}
