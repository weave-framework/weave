/**
 * The board store — a lazy singleton bag of signals + actions over the task data.
 * Because the state IS signals, any component that reads `tasks()` updates
 * surgically; there are no selectors, reducers, or context plumbing.
 *
 * It holds plain signals (not a `resource`) plus an explicit `load()` action so
 * the data lifecycle is owner-independent — the store outlives any one component.
 */

import { store } from '@weave-framework/store';
import { signal, computed, type Signal, type Computed } from '@weave-framework/runtime';
import { api } from '../data/api';
import type { Task, NewTask, Status } from '../types';

export interface BoardStore {
  tasks: Signal<Task[]>;
  loading: Signal<boolean>;
  error: Signal<string | null>;
  load: (force?: boolean) => Promise<void>;
  byStatus: (status: Status) => Task[];
  byId: (id: string) => Task | undefined;
  create: (input: NewTask) => Promise<Task>;
  update: (id: string, patch: Partial<NewTask>) => Promise<Task>;
  counts: Computed<{ total: number; done: number }>;
}

export const useBoard: () => BoardStore = store(() => {
  const tasks: Signal<Task[]> = signal<Task[]>([]);
  const loading: Signal<boolean> = signal(false);
  const error: Signal<string | null> = signal<string | null>(null);
  let loaded: boolean = false;

  /** Fetch the task list. Safe to call repeatedly; only the first triggers a load. */
  async function load(force: boolean = false): Promise<void> {
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

  /** A single task by id (synchronous, from the already-loaded list). */
  const byId = (id: string): Task | undefined => tasks().find((t) => t.id === id);

  let tmpSeq: number = 0;

  /**
   * Create a task with an OPTIMISTIC insert: the row appears instantly under a
   * temporary id, the POST runs, then the server task replaces the temp on
   * success — or the temp is removed on failure (rollback). The form awaits the
   * returned promise to know when to navigate / surface the error.
   */
  async function create(input: NewTask): Promise<Task> {
    const temp: Task = { ...input, id: `tmp-${++tmpSeq}` };
    tasks.set((xs) => [...xs, temp]);
    try {
      const saved: Task = await api.post<Task>('/tasks', input);
      tasks.set((xs) => xs.map((t) => (t.id === temp.id ? saved : t)));
      return saved;
    } catch (e) {
      tasks.set((xs) => xs.filter((t) => t.id !== temp.id));
      throw e;
    }
  }

  /** Patch a task with the same optimistic-then-reconcile (or rollback) flow. */
  async function update(id: string, patch: Partial<NewTask>): Promise<Task> {
    const prev: Task | undefined = byId(id);
    tasks.set((xs) => xs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const saved: Task = await api.patch<Task>('/tasks/' + id, patch);
      tasks.set((xs) => xs.map((t) => (t.id === id ? saved : t)));
      return saved;
    } catch (e) {
      if (prev) tasks.set((xs) => xs.map((t) => (t.id === id ? prev : t)));
      throw e;
    }
  }

  /** Reactive progress summary for the header. */
  const counts: Computed<{ total: number; done: number }> = computed(() => {
    const list: Task[] = tasks();
    return {
      total: list.length,
      done: list.filter((t) => t.status === 'done').length,
    };
  });

  return { tasks, loading, error, load, byStatus, byId, create, update, counts };
});
