import { signal, computed, effect } from '@weave-framework/runtime';
import { store } from '@weave-framework/store';
import Input from '@weave-framework/ui/input';
import Button from '@weave-framework/ui/button';
import Checkbox from '@weave-framework/ui/checkbox';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Badge from '@weave-framework/ui/badge';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Input;
void Button;
void Checkbox;
void ButtonToggle;
void Badge;
void Icon;

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

type Filter = 'all' | 'active' | 'done';

const STORAGE_KEY = 'weave-docs-todos';
const SEED: Todo[] = [
  { id: 1, text: 'Read the Weave signals guide', done: true },
  { id: 2, text: 'Build a component', done: false },
  { id: 3, text: 'Ship it', done: false },
];

/** Load persisted todos, falling back to the seed (and tolerating bad JSON). */
function load(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Todo[]) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : SEED;
  } catch {
    return SEED;
  }
}

/**
 * A global store: one lazily-created bag of signals + actions, shared by every
 * caller. Because the state IS signals, the template updates surgically — and an
 * effect mirrors it to localStorage so the list survives a reload.
 */
const useTodos = store(() => {
  const items = signal<Todo[]>(load());
  let nextId = items().reduce((max, t) => Math.max(max, t.id), 0) + 1;

  // Persist on every change — `items()` is tracked, so this re-runs automatically.
  effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items()));
    } catch {
      /* storage unavailable — the app still works in-memory */
    }
  });

  return {
    items,
    /** Derived: how many tasks are still open. */
    remaining: computed(() => items().filter((t) => !t.done).length),
    add(text: string): void {
      const trimmed = text.trim();
      if (!trimmed) return;
      items.set((xs) => [...xs, { id: nextId++, text: trimmed, done: false }]);
    },
    toggle(id: number, done: boolean): void {
      items.set((xs) => xs.map((t) => (t.id === id ? { ...t, done } : t)));
    },
    remove(id: number): void {
      items.set((xs) => xs.filter((t) => t.id !== id));
    },
    clearDone(): void {
      items.set((xs) => xs.filter((t) => !t.done));
    },
  };
});

interface Setup {
  todos: ReturnType<typeof useTodos>;
  draft: () => string;
  filter: () => Filter;
  filterOpts: { value: Filter; label: string }[];
  visible: () => Todo[];
  hasDone: () => boolean;
  setDraft: (v: string) => void;
  setFilter: (v: string | string[]) => void;
  submit: (e?: Event) => void;
  rowClass: (t: Todo) => string;
}

/** The Todo app component. */
export function setup(): Setup {
  const todos = useTodos();
  const draft = signal('');
  const filter = signal<Filter>('all');
  const filterOpts: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'done', label: 'Done' },
  ];

  // Derived view — recomputed only when the list or the filter changes.
  const visible = computed<Todo[]>(() => {
    const f = filter();
    return todos.items().filter((t) => (f === 'all' ? true : f === 'active' ? !t.done : t.done));
  });
  const hasDone = computed(() => todos.items().some((t) => t.done));

  const submit = (e?: Event): void => {
    e?.preventDefault();
    todos.add(draft());
    draft.set('');
  };

  return {
    todos,
    draft,
    filter,
    filterOpts,
    visible,
    hasDone,
    setDraft: (v) => draft.set(v),
    setFilter: (v) => filter.set(v as Filter),
    submit,
    rowClass: (t) => (t.done ? 'todo__row todo__row--done' : 'todo__row'),
  };
}
