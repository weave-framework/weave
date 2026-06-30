import { signal, type Signal } from '@weave-framework/runtime';
import { resource, type Resource } from '@weave-framework/data';
import { Link } from '@weave-framework/router';
import { api } from '../../data/api';
import type { Task } from '../../types';

// `<Link>` is used in task-detail.html.
void Link;

interface TaskDetailSetup {
  id: () => string;
  task: Resource<Task>;
  showRaw: Signal<boolean>;
  toggleRaw: () => boolean;
}

/** Task detail route (`task/:id`). */
export function setup(props: { params: { id: string } }): TaskDetailSetup {
  const id = (): string => props.params.id;

  // A resource refetches whenever the route param changes — even though RouterView
  // updates `params` in place (no remount) when navigating task→task. Showcases
  // @await (B.4) over a reactive resource.
  const task: Resource<Task> = resource(
    () => props.params.id,
    (id) => api.get<Task>('/tasks/' + id)
  );

  const showRaw: Signal<boolean> = signal(false);
  const toggleRaw = (): boolean => showRaw.set((v) => !v);

  return { id, task, showRaw, toggleRaw };
}
