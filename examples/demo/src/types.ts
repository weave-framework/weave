/** Shared domain types for the Weave Board demo. */

export type Status = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'med' | 'high';

/** One acceptance-criteria row — a nested group inside the task form's checklist array. */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee?: string;
  checklist?: ChecklistItem[];
}

/** Payload for creating a task (no id yet). */
export type NewTask = Omit<Task, 'id'>;

export const STATUSES: Status[] = ['todo', 'doing', 'done'];
export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};
