import { onMount, tick, computed, type Computed } from '@weave/runtime';
import { navigate, Link } from '@weave/router';
import { action, type Action } from '@weave/data';
import { field, form, validators, type Field, type Form } from '@weave/forms';
import { useBoard, type BoardStore } from '../../stores/board';
import { api } from '../../data/api';
import { STATUSES, type Status, type Priority, type NewTask, type Task } from '../../types';

// `<Link>` is referenced in task-form.html.
void Link;

/** The form's field set — one named field per editable column. */
type TaskFields = {
  title: Field<string>;
  assignee: Field<string>;
  status: Field<Status>;
  priority: Field<Priority>;
};

interface TaskFormSetup {
  editId: string | undefined;
  heading: string;
  fields: TaskFields;
  form: Form<TaskFields>;
  statuses: Status[];
  priorities: Priority[];
  submitting: () => boolean;
  submitError: () => string | null;
  onSubmit: (e: Event) => void;
}

const PRIORITIES: Priority[] = ['low', 'med', 'high'];

/**
 * The create / edit form (routes `new` and `task/:id/edit`). It showcases:
 *   • `@weave/forms` sync validators, an async (server) check, and a cross-field rule,
 *   • an `action()`-wrapped optimistic submit (the store inserts/patches instantly),
 *   • `tick()` to move focus to the first error after a failed submit.
 */
export function setup(props: { params?: { id?: string } }): TaskFormSetup {
  const board: BoardStore = useBoard();
  const editId: string | undefined = props.params?.id;

  // On a deep link the list may not be loaded yet; load then seed the fields.
  const seed: Task | undefined = editId ? board.byId(editId) : undefined;

  const title: Field<string> = field(seed?.title ?? '', [
    validators.required('A title is required'),
    validators.minLength(3, 'Title must be at least 3 characters'),
    validators.maxLength(80, 'Title must be at most 80 characters'),
  ]);

  // Async: every non-empty assignee is checked against the (mock) team directory.
  // Debounced + abortable by the field; `field.validating()` drives the spinner.
  const assignee: Field<string> = field<string>(seed?.assignee ?? '', [], {
    asyncValidate: async (name, { signal: abort }): Promise<string | null> => {
      if (!name.trim()) return null;
      const team: string[] = await api.get<string[]>('/team', { signal: abort });
      return team.includes(name.trim()) ? null : `"${name.trim()}" is not on the team`;
    },
  });

  const status: Field<Status> = field<Status>(seed?.status ?? 'todo');
  const priority: Field<Priority> = field<Priority>(seed?.priority ?? 'med');

  const fields: TaskFields = { title, assignee, status, priority };

  // Cross-field rule: a high-priority task must have an owner.
  const taskForm: Form<TaskFields> = form<TaskFields>(fields, {
    validate: (v): Record<string, string> | null =>
      v.priority === 'high' && !v.assignee.trim()
        ? { assignee: 'High-priority tasks need an owner' }
        : null,
  });

  // If we arrived before the list loaded, fetch it and seed the fields (only when
  // the user hasn't typed yet — `touched` guards against clobbering live edits).
  onMount(() => {
    if (!editId || seed) return;
    void board.load().then(() => {
      const t: Task | undefined = board.byId(editId);
      if (!t) return;
      if (!title.touched()) title.value.set(t.title);
      if (!assignee.touched()) assignee.value.set(t.assignee ?? '');
      status.value.set(t.status);
      priority.value.set(t.priority);
    });
  });

  // The submit itself, wrapped so `pending`/`error` are reactive (`action`, B.7).
  const save: Action<NewTask, Task> = action<NewTask, Task>((input) =>
    editId ? board.update(editId, input) : board.create(input)
  );

  const submitError: Computed<string | null> = computed<string | null>(() => {
    const e: unknown = save.error();
    return e == null ? null : e instanceof Error ? e.message : String(e);
  });

  async function submit(): Promise<void> {
    taskForm.touchAll(); // reveal every error, not just visited fields
    if (taskForm.validating()) await waitForValidation(taskForm);
    if (!taskForm.valid()) {
      await tick(); // let the error nodes render…
      focusFirstError(); // …then move focus to the first one
      return;
    }
    const values: { title: string; assignee: string; status: Status; priority: Priority } =
      taskForm.values();
    const input: NewTask = {
      title: values.title.trim(),
      status: values.status,
      priority: values.priority,
      ...(values.assignee.trim() ? { assignee: values.assignee.trim() } : {}),
    };
    try {
      const saved: Task = await save.run(input);
      navigate(editId ? '/task/' + saved.id : '/');
    } catch {
      /* surfaced via submitError() */
    }
  }

  return {
    editId,
    heading: editId ? 'Edit task' : 'New task',
    fields,
    form: taskForm,
    statuses: STATUSES,
    priorities: PRIORITIES,
    submitting: () => save.pending(),
    submitError,
    onSubmit: (e: Event) => {
      e.preventDefault();
      void submit();
    },
  };
}

/** Resolve once the form's async validators have settled (or a 2s safety cap). */
function waitForValidation(f: Form<TaskFields>): Promise<void> {
  return new Promise((resolve) => {
    const start: number = performance.now();
    const poll = (): void => {
      if (!f.validating() || performance.now() - start > 2000) resolve();
      else setTimeout(poll, 30);
    };
    poll();
  });
}

/** Focus the first field whose `.field` group is showing an error. */
function focusFirstError(): void {
  const bad: HTMLElement | null = document.querySelector<HTMLElement>(
    '.task-form .field.invalid input, .task-form .field.invalid select'
  );
  bad?.focus();
}
