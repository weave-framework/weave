# Todo list

The "hello world" of app-building — but a real one. This little app covers the whole reactive loop: you type,
a signal changes, derived values recompute, a keyed list re-renders, and the result is mirrored to `localStorage`
so it survives a reload. It's maybe sixty lines of logic, and there isn't a single manual DOM update in it.

:::demo examples-todo

Add a task, tick a few off, switch the filter, reload the page — the list is still there.

## What it shows

- **State as signals** — the task list is a `signal`; the "N left" counter and the filtered view are `computed`
  values derived from it. [Thinking in signals →](/learn/signals)
- **A global store** — the list lives in a [`store`](/learn/store), a lazily-created singleton, so state and
  actions sit in one place, separate from the view.
- **Persistence with an `effect`** — one effect writes the list to `localStorage` on every change, automatically.
- **Keyed lists & conditionals** — `@for (… track id)` renders a row per task; `@if / @else` handles the empty
  state. [Templates →](/learn/templates)
- **Real components** — [`Input`](/ui/input), [`Button`](/ui/button), [`Checkbox`](/ui/checkbox),
  [`ButtonToggle`](/ui/button-toggle), [`Badge`](/ui/badge), and [`Icon`](/ui/icon), all from
  `@weave-framework/ui`.

## The store

All the state and every action live in one `store`. It's a plain function returning a bag of signals and the
functions that mutate them — no reducers, no selectors. The `effect` at the top is the entire persistence layer:
because it reads `items()`, Weave re-runs it whenever the list changes.

:::tabs
~~~ts title="todos.store.ts"
import { signal, computed, effect } from '@weave-framework/runtime';
import { store } from '@weave-framework/store';

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

const STORAGE_KEY = 'weave-docs-todos';

/** Load persisted todos, tolerating missing or malformed storage. */
function load(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Todo[]) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const useTodos = store(() => {
  const items = signal<Todo[]>(load());
  let nextId = items().reduce((max, t) => Math.max(max, t.id), 0) + 1;

  // Persist on every change — `items()` is tracked, so this re-runs itself.
  effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items()));
    } catch {
      /* storage unavailable — the app still works in-memory */
    }
  });

  return {
    items,
    remaining: computed(() => items().filter((t) => !t.done).length),
    add: (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      items.set((xs) => [...xs, { id: nextId++, text: trimmed, done: false }]);
    },
    toggle: (id: number, done: boolean) =>
      items.set((xs) => xs.map((t) => (t.id === id ? { ...t, done } : t))),
    remove: (id: number) => items.set((xs) => xs.filter((t) => t.id !== id)),
    clearDone: () => items.set((xs) => xs.filter((t) => !t.done)),
  };
});
~~~
:::

:::callout tip "Why a store and not just a signal?"
For a component this small you *could* keep the `signal` in `setup`. The store earns its keep the moment a second
component needs the same list — a header badge, a "clear all" button in a toolbar — because `useTodos()` returns
the *same* instance everywhere, with zero prop-drilling.
:::

## The component

`setup` pulls in the store, holds the two pieces of *view* state that don't belong in it (the draft text and the
active filter), and derives the visible slice. Notice how little there is — the store does the heavy lifting.

:::tabs
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Button from '@weave-framework/ui/button';
import Checkbox from '@weave-framework/ui/checkbox';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Badge from '@weave-framework/ui/badge';
import Icon from '@weave-framework/ui/icon';
import { useTodos } from './todos.store';

type Filter = 'all' | 'active' | 'done';

export function setup() {
  const todos = useTodos();
  const draft = signal('');
  const filter = signal<Filter>('all');
  const filterOpts = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'done', label: 'Done' },
  ];

  // Recomputed only when the list or the filter changes.
  const visible = computed(() => {
    const f = filter();
    return todos.items().filter((t) => (f === 'all' ? true : f === 'active' ? !t.done : t.done));
  });
  const hasDone = computed(() => todos.items().some((t) => t.done));

  const submit = (e?: Event) => {
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
    setDraft: (v: string) => draft.set(v),
    setFilter: (v: string | string[]) => filter.set(v as Filter),
    submit,
    rowClass: (t: { done: boolean }) => (t.done ? 'todo__row todo__row--done' : 'todo__row'),
  };
}
~~~
~~~html title="app.html"
<div class="todo">
  <form class="todo__add" on:submit={{ submit }}>
    <Input value={{ draft() }} onInput={{ setDraft }} label={{ 'New task' }}
           placeholder={{ 'What needs doing?' }} class="todo__input" />
    <Button type={{ 'submit' }}>Add</Button>
  </form>

  <div class="todo__bar">
    <ButtonToggle options={{ filterOpts }} value={{ filter() }} onChange={{ setFilter }}
                  label={{ 'Filter tasks' }} />
    <Badge variant={{ 'tag' }}>{{ todos.remaining() }} left</Badge>
  </div>

  @if (visible().length) {
    <ul class="todo__list">
      @for (t of visible(); track t.id) {
        <li class={{ rowClass(t) }}>
          <Checkbox checked={{ t.done }} onChange={{ (d) => todos.toggle(t.id, d) }} label={{ t.text }} />
          <Button variant={{ 'icon' }} label={{ 'Delete task' }} on:click={{ () => todos.remove(t.id) }}>
            <Icon name={{ 'trash-2' }} />
          </Button>
        </li>
      }
    </ul>
  } @else {
    <p class="todo__empty">Nothing here — add a task above.</p>
  }

  @if (hasDone()) {
    <div class="todo__footer">
      <Button variant={{ 'ghost' }} on:click={{ todos.clearDone }}>Clear completed</Button>
    </div>
  }
</div>
~~~
~~~scss title="app.scss"
.todo {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 440px;
}
.todo__add { display: flex; gap: 10px; align-items: flex-end; }
.todo__input { flex: 1; }
.todo__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.todo__list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
}
.todo__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; }
.todo__row + .todo__row { border-top: 1px solid var(--border); }
.todo__row--done { color: var(--muted); text-decoration: line-through; }
.todo__empty {
  margin: 0; padding: 20px; text-align: center; color: var(--muted);
  border: 1px dashed var(--border); border-radius: 10px;
}
.todo__footer { display: flex; justify-content: flex-end; }
~~~
:::

## How a click flows through

Ticking a checkbox is the whole reactive model in one gesture:

1. `Checkbox`'s `onChange` fires `todos.toggle(t.id, d)` — an action on the store.
2. The action calls `items.set(...)`, replacing the task with a `done`-flipped copy.
3. Three readers of `items()` wake up: the `visible` computed (re-filters), the `remaining` computed (the badge
   re-counts), and the persistence `effect` (re-writes storage). Each recomputes **only because it read the
   signal** — nothing else on the page is touched.
4. The keyed `@for` reconciles: because rows are tracked by `id`, the one changed row updates in place instead of
   the list re-rendering.

You wrote none of that wiring. You changed a value; the graph did the rest.

## Notes

- **The keyed `track t.id` matters.** It's what lets Weave move and update individual rows instead of rebuilding
  the list — try filtering while a row is focused and watch focus stay put.
- **The empty state is just an `@else`.** No flag, no separate "empty" component — the same `@if` that renders the
  list renders the placeholder when there's nothing to show.
- **Persistence is one effect.** Swapping `localStorage` for a `fetch` to your API is a one-line change inside that
  effect — the rest of the app doesn't know or care where the list lives.

Ready for something with more moving parts? The [Data dashboard](/examples/dashboard) puts a sortable, paginated
table through its paces.
