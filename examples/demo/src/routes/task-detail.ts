import { signal } from '@weave/runtime';
import { resource } from '@weave/data';
import { Link } from '@weave/router';
import { api } from '../api/mock';
import type { Task } from '../types';

// `<Link>` is used in task-detail.html.
void Link;

/** Task detail route (`task/:id`). */
export function setup(props: { params: { id: string } }) {
  const id = () => props.params.id;

  // A resource refetches whenever the route param changes — even though RouterView
  // updates `params` in place (no remount) when navigating task→task. Showcases
  // @await (B.4) over a reactive resource.
  const task = resource(
    () => props.params.id,
    (id) => api.get<Task>('/tasks/' + id)
  );

  const showRaw = signal(false);
  const toggleRaw = () => showRaw.set((v) => !v);

  return { id, task, showRaw, toggleRaw };
}
