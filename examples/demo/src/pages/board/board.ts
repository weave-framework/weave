import { onMount, signal, debounced, fade, scale, type Signal, type Computed } from '@weave/runtime';
import type { TransitionFn } from '@weave/runtime/dom';
import { Link } from '@weave/router';
import { useBoard, type BoardStore } from '../../stores/board';
import { useEditor, type EditorStore } from '../../stores/editor';
import TaskCard from '../../components/task-card/task-card';
import BoardInsights from '../../components/board-insights/board-insights';
import type { Status, Task } from '../../types';

interface BoardSetup {
  board: BoardStore;
  editor: EditorStore;
  query: Signal<string>;
  visible: (status: Status) => Task[];
  scale: TransitionFn<{ start?: number; duration?: number } | void>;
  fade: TransitionFn<{ duration?: number } | void>;
  cardIn: { start: number; duration: number };
  cardOut: { duration: number };
}

// `<TaskCard>` / `<Link>` are referenced in index.html — capitalized tags resolve
// to these module-level imports, so they need no entry in setup's return.
void TaskCard;
void BoardInsights;
void Link;

/** The board route (path `''`): three status columns with a debounced filter. */
export function setup(): BoardSetup {
  const board: BoardStore = useBoard();
  const editor: EditorStore = useEditor();
  onMount(() => void board.load());

  const query: Signal<string> = signal('');
  const filter: Computed<string> = debounced(query, 200); // trails the input by 200ms of quiet (B.1)

  /** Tasks in a column, narrowed by the (debounced) search query. */
  const visible = (status: Status): Task[] => {
    const q: string = filter().trim().toLowerCase();
    return board.byStatus(status).filter((t) => !q || t.title.toLowerCase().includes(q));
  };

  return {
    board,
    editor,
    query,
    visible,
    // Cards scale+fade in on enter and fade out on leave (B.13). The `@for` row root
    // (a real `.card-wrap` element) carries the directives so `reconcileKeyed` waits
    // for the leave outro before removing — a card added/removed by a filter, status
    // change, or optimistic create animates in/out instead of snapping.
    scale,
    fade,
    cardIn: { start: 0.97, duration: 160 },
    cardOut: { duration: 140 },
  };
}
