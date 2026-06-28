/** Shared domain types for the Weave Board demo. */

export type Status = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'med' | 'high';

export interface Task {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee?: string;
}

/** Payload for creating a task (no id yet). */
export type NewTask = Omit<Task, 'id'>;

export const STATUSES: Status[] = ['todo', 'doing', 'done'];
export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};
