import { onMount, signal, debounced, type Signal, type Computed } from '@weave/runtime';
import { Link } from '@weave/router';
import { useBoard, type BoardStore } from '../../stores/board';
import TaskCard from '../../components/task-card/task-card';
import type { Status, Task } from '../../types';

interface BoardSetup {
  board: BoardStore;
  query: Signal<string>;
  visible: (status: Status) => Task[];
}

// `<TaskCard>` / `<Link>` are referenced in index.html — capitalized tags resolve
// to these module-level imports, so they need no entry in setup's return.
void TaskCard;
void Link;

/** The board route (path `''`): three status columns with a debounced filter. */
export function setup(): BoardSetup {
  const board: BoardStore = useBoard();
  onMount(() => board.load());

  const query: Signal<string> = signal('');
  const filter: Computed<string> = debounced(query, 200); // trails the input by 200ms of quiet (B.1)

  /** Tasks in a column, narrowed by the (debounced) search query. */
  const visible = (status: Status): Task[] => {
    const q: string = filter().trim().toLowerCase();
    return board.byStatus(status).filter((t) => !q || t.title.toLowerCase().includes(q));
  };

  return { board, query, visible };
}
