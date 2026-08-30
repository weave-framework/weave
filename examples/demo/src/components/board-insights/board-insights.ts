import { computed, inject, type Computed } from '@weave-framework/runtime';
import { useBoard, type BoardStore } from '../../stores/board';
import { SessionContext, type Session } from '../../app/session';
import type { Priority } from '../../types';

interface InsightsSetup {
  user: string;
  /** Open (non-done) tasks assigned to the session user. Reactive. */
  mineOpen: () => number;
  /** Task counts per priority. Reactive. */
  byPriority: Computed<Record<Priority, number>>;
}

/**
 * A non-critical summary panel rendered below the board via `@defer (on idle)` — the
 * browser paints the columns first, then fills this in when idle. It injects the same
 * session the shell provided, proving context reaches a deferred subtree (its owner
 * parents to the construction-time owner, like `@if`).
 */
export function setup(): InsightsSetup {
  const board: BoardStore = useBoard();
  const session: Session = inject(SessionContext);

  const mineOpen = (): number =>
    board.tasks().filter((t) => t.assignee === session.currentUser && t.status !== 'done').length;

  const byPriority: Computed<Record<Priority, number>> = computed(() => {
    const acc: Record<Priority, number> = { low: 0, med: 0, high: 0 };
    for (const t of board.tasks()) acc[t.priority]++;
    return acc;
  });

  return { user: session.currentUser, mineOpen, byPriority };
}
