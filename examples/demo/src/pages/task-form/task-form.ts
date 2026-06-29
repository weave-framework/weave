import { onMount } from '@weave/runtime';
import { navigate, Link } from '@weave/router';
import {
  field,
  form,
  group,
  fieldArray,
  validators,
  type Field,
  type Group,
  type FieldArray,
  type ValuesOf,
} from '@weave/forms';
import { control } from '@weave/forms/dom';
import { useBoard, type BoardStore } from '../../stores/board';
import { api } from '../../data/api';
import { STATUSES, type Status, type Priority, type NewTask, type Task, type ChecklistItem } from '../../types';

// `<Link>` is referenced in task-form.html.
void Link;

/** One acceptance-criteria row: a nested group (form → fieldArray → group → field). */
type ChecklistGroup = Group<{ text: Field<string>; done: Field<boolean> }>;

/** The form's control set — fields plus a dynamic checklist array of nested groups. */
type TaskFields = {
  title: Field<string>;
  assignee: Field<string>;
  status: Field<Status>;
  priority: Field<Priority>;
  checklist: FieldArray<ChecklistItem>;
};

interface TaskFormSetup {
  editId: string | undefined;
  heading: string;
  fields: TaskFields;
  form: Group<TaskFields>;
  statuses: Status[];
  priorities: Priority[];
  checklist: () => ChecklistGroup[];
  addItem: () => void;
  removeItem: (item: ChecklistGroup) => void;
  onSubmit: (e?: Event) => void;
  control: typeof control;
}

const PRIORITIES: Priority[] = ['low', 'med', 'high'];

/**
 * The create / edit form (routes `new` and `task/:id/edit`). The form owns the
 * whole submit dance — `form.submit()` does touchAll → await async validation →
 * focus-first-error / run the handler with `submitting`/`submitError` tracked —
 * so this setup is just *declaring* the controls and persisting on success.
 */
export function setup(props: { params?: { id?: string } }): TaskFormSetup {
  const board: BoardStore = useBoard();
  const editId: string | undefined = props.params?.id;

  // On a deep link the list may not be loaded yet; load + seed in onMount below.
  const seed: Task | undefined = editId ? board.byId(editId) : undefined;

  const title: Field<string> = field(seed?.title ?? '', [
    validators.required('A title is required'),
    validators.minLength(3, 'Title must be at least 3 characters'),
    validators.maxLength(80, 'Title must be at most 80 characters'),
  ]);

  // Async: every non-empty assignee is checked against the (mock) team directory.
  const assignee: Field<string> = field<string>(seed?.assignee ?? '', [], {
    asyncValidate: async (name, { signal: abort }): Promise<string | null> => {
      if (!name.trim()) return null;
      const team: string[] = await api.get<string[]>('/team', { signal: abort });
      return team.includes(name.trim()) ? null : `"${name.trim()}" is not on the team`;
    },
  });

  const status: Field<Status> = field<Status>(seed?.status ?? 'todo');
  const priority: Field<Priority> = field<Priority>(seed?.priority ?? 'med');

  // A dynamic checklist: each row is a nested group { text, done }, so the form
  // nests form → fieldArray → group → field. Seeded from the task on edit.
  const checklist: FieldArray<ChecklistItem> = fieldArray<ChecklistItem>(
    (s) =>
      group({
        text: field(s?.text ?? '', [validators.required('Describe the item')]),
        done: field(s?.done ?? false),
      }),
    seed?.checklist ?? []
  );

  const fields: TaskFields = { title, assignee, status, priority, checklist };

  // Cross-field rule: a high-priority task must have an owner.
  const taskForm: Group<TaskFields> = form<TaskFields>(fields, {
    validate: (v): Record<string, string> | null =>
      v.priority === 'high' && !v.assignee.trim()
        ? { assignee: 'High-priority tasks need an owner' }
        : null,
  });

  // Cold deep link: fetch the list, then seed the controls (guarded so a live edit
  // is never clobbered).
  onMount(() => {
    if (!editId || seed) return;
    void board.load().then(() => {
      const t: Task | undefined = board.byId(editId);
      if (!t) return;
      if (!title.touched()) title.value.set(t.title);
      if (!assignee.touched()) assignee.value.set(t.assignee ?? '');
      status.value.set(t.status);
      priority.value.set(t.priority);
      if (checklist.length() === 0) (t.checklist ?? []).forEach((c) => checklist.push(c));
    });
  });

  // The form drives validation + pending/error itself; we just persist + navigate.
  const onSubmit: (e?: Event) => void = taskForm.submit(async (v: ValuesOf<TaskFields>): Promise<void> => {
    const input: NewTask = {
      title: v.title.trim(),
      status: v.status,
      priority: v.priority,
      ...(v.assignee.trim() ? { assignee: v.assignee.trim() } : {}),
      ...(v.checklist.length ? { checklist: v.checklist } : {}),
    };
    const saved: Task = editId ? await board.update(editId, input) : await board.create(input);
    navigate(editId ? '/task/' + saved.id : '/');
  });

  return {
    editId,
    heading: editId ? 'Edit task' : 'New task',
    fields,
    form: taskForm,
    statuses: STATUSES,
    priorities: PRIORITIES,
    checklist: () => checklist.controls() as ChecklistGroup[],
    addItem: () => checklist.push(),
    removeItem: (item: ChecklistGroup) => {
      const i: number = checklist.controls().indexOf(item);
      if (i >= 0) checklist.removeAt(i);
    },
    onSubmit,
    control,
  };
}
