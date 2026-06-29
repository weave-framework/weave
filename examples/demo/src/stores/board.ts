/**
 * The board store — a lazy singleton bag of signals + actions over the task data.
 * Because the state IS signals, any component that reads `tasks()` updates
 * surgically; there are no selectors, reducers, or context plumbing.
 *
 * It holds plain signals (not a `resource`) plus an explicit `load()` action so
 * the data lifecycle is owner-independent — the store outlives any one component.
 */

import { store } from '@weave/store';
import { signal, computed } from '@weave/runtime';
import { api } from '../data/api';
import type { Task, Status } from '../types';

export const useBoard = store(() => {
  const tasks = signal<Task[]>([]);
  const loading = signal(false);
  const error = signal<string | null>(null);
  let loaded = false;

  /** Fetch the task list. Safe to call repeatedly; only the first triggers a load. */
  async function load(force = false): Promise<void> {
    if (loaded && !force) return;
    loaded = true;
    loading.set(true);
    error.set(null);
    try {
      tasks.set(await api.get<Task[]>('/tasks'));
    } catch (e) {
      error.set(e instanceof Error ? e.message : String(e));
    } finally {
      loading.set(false);
    }
  }

  /** Tasks belonging to a single column. */
  const byStatus = (status: Status): Task[] => tasks().filter((t) => t.status === status);

  /** Reactive progress summary for the header. */
  const counts = computed(() => {
    const list = tasks();
    return {
      total: list.length,
      done: list.filter((t) => t.status === 'done').length,
    };
  });

  return { tasks, loading, error, load, byStatus, counts };
});
