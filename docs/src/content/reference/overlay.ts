/**
 * Hand-authored Reference overlay — the human half of the "hybrid" API docs.
 *
 * `api.gen.ts` is generated from the source (signatures, params, TSDoc summaries);
 * THIS file layers prose + copyable examples on top, and survives every regen.
 *  - `intros[pkg]`            — a markdown intro rendered above a package's symbols.
 *  - `examples['pkg/symbol']` — copyable examples rendered under a symbol.
 *
 * Keep examples short, correct, and idiomatic; deep explanations live in the Learn
 * guides, which each symbol's generated TSDoc already points at in spirit.
 */

export interface ApiExample {
  /** Optional label (unused by the renderer today; documents intent). */
  label?: string;
  lang: string;
  code: string;
}

/** Per-package intro, authored as markdown (callouts/tables/code all work). */
export const intros: Record<string, string> = {
  runtime: `The reactive core and the DOM runtime the compiler targets. Everything else is built on these
primitives — signals, derivations, ownership, context, and the control-flow/transition helpers.

:::callout tip "Where to start"
If you're new, read [Thinking in signals](/learn/signals) and [Reactivity in depth](/learn/reactivity) first —
they explain the mental model these signatures assume. This page is the exhaustive catalog.
:::

Import the reactive primitives from \`@weave/runtime\`; the DOM helpers the compiler emits (and a few you
use directly, like \`Portal\`, \`ErrorBoundary\`, \`lazy\`, \`mountComponent\`) live in \`@weave/runtime/dom\`.`,

  router: `The official client-side router — history-based and signal-driven, so any view that reads the path or
query updates surgically on navigation. Routes are usually generated from the filesystem (see
[Router](/learn/router)); the exports here are what you place, read, and navigate with.`,

  store: `Built-in state management. A store is a lazily-instantiated singleton bag of signals and actions —
no selectors, no reducers, no context plumbing. The whole package is one function. See [Store](/learn/store).`,

  forms: `Signal-native form state and validation. A \`field\` is a writable signal plus derived
\`error\`/\`valid\`/\`touched\`; \`group\`/\`form\` and \`fieldArray\` compose fields to any depth through one
\`Control\` interface. Bind controls with \`use:control\` from \`@weave/forms/dom\`. See [Forms](/learn/forms).`,

  i18n: `Signal-native internationalization — an optional add-on that costs nothing until you call
\`createI18n()\`. \`t('key')\` reads locale + message signals, so bindings re-translate the instant
\`setLocale()\` runs. See [Internationalization](/learn/i18n).`,

  data: `Signal-native async data on top of native \`fetch\`. \`resource\` is for reads (auto-refetch +
cancellation), \`action\` for writes, \`optimistic\` for instant UI, and \`createClient\` is a small fetch
wrapper with a functional interceptor chain. See the [Recipes](/learn/recipes#fetching-data).`,
};

/** Per-symbol examples, keyed by \`<pkg>/<symbolName>\`. */
export const examples: Record<string, ApiExample[]> = {
  /* ───────────── @weave/runtime ───────────── */
  'runtime/signal': [
    {
      lang: 'ts',
      code: `const count = signal(0);
count();                   // read (and subscribe) → 0
count.set(5);              // write a value
count.set((n) => n + 1);   // write via updater → 6
count.peek();              // read WITHOUT subscribing → 6

// custom equality: setting an equal value is a no-op
const point = signal({ x: 0, y: 0 }, { equals: (a, b) => a.x === b.x && a.y === b.y });`,
    },
  ],
  'runtime/computed': [
    {
      lang: 'ts',
      code: `const first = signal('Ada');
const last = signal('Lovelace');
const full = computed(() => \`\${first()} \${last()}\`);
full();           // "Ada Lovelace" — computed once, then cached
last.set('Byron');
full();           // "Ada Byron" — recomputed only because a dep changed`,
    },
  ],
  'runtime/effect': [
    {
      lang: 'ts',
      code: `const theme = signal('light');
const stop = effect(() => {
  document.body.dataset.theme = theme(); // runs now + on every change
});
theme.set('dark');  // effect re-runs automatically
stop();             // tear down manually (rarely needed — ownership does it)

// cleanup: return a function (runs before re-run + on dispose)
effect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});`,
    },
  ],
  'runtime/batch': [
    {
      lang: 'ts',
      code: `const x = signal(0), y = signal(0);
effect(() => console.log(x(), y()));
batch(() => {
  x.set(1);
  y.set(2);
}); // the effect runs ONCE after both writes, not twice`,
    },
  ],
  'runtime/untrack': [
    {
      lang: 'ts',
      code: `effect(() => {
  const live = source();                 // tracked: re-runs on change
  const snap = untrack(() => config());  // read, but DON'T subscribe
  apply(live, snap);
});`,
    },
  ],
  'runtime/tick': [
    {
      lang: 'ts',
      code: `count.set(5);
// The DOM text already says 5 — updates are synchronous.
await tick(); // waits for microtask-queued work (onMount, boundary swaps) if you need it`,
    },
  ],
  'runtime/onMount': [
    {
      lang: 'ts',
      code: `export function setup() {
  onMount(() => {
    inputEl()?.focus();         // the DOM exists now
    return () => cleanup();     // optional teardown on unmount
  });
  return { /* … */ };
}`,
    },
  ],
  'runtime/onCleanup': [
    {
      lang: 'ts',
      code: `effect(() => {
  const socket = open(room());
  onCleanup(() => socket.close()); // before next run + on dispose
});`,
    },
  ],
  'runtime/createContext': [
    {
      lang: 'ts',
      code: `import { createContext, provide, inject } from '@weave/runtime';

export const ThemeContext = createContext<'light' | 'dark'>('light');

// an ancestor:
provide(ThemeContext, 'dark');
// any descendant:
const theme = inject(ThemeContext); // 'dark', or the default if none provided`,
    },
  ],
  'runtime/linkedSignal': [
    {
      lang: 'ts',
      code: `const selected = linkedSignal(() => items()[0]);
selected.set(items()[2]); // local override
// …items() reloads → selected resets to the new items()[0]`,
    },
  ],
  'runtime/debounced': [
    {
      lang: 'ts',
      code: `const query = signal('');
const q = debounced(query, 300); // trails query() by 300ms of quiet
// drive search off q() — fires once typing settles`,
    },
  ],
  'runtime/watch': [
    {
      lang: 'ts',
      code: `watch(userId, (id, prevId) => {
  console.log(\`\${prevId} → \${id}\`);
}, { immediate: false }); // only source is tracked; callback gets the previous value`,
    },
  ],
  'runtime/root': [
    {
      lang: 'ts',
      code: `root((dispose) => {
  effect(() => render(state()));
  // …later, tear the whole scope down:
  // dispose();
});`,
    },
  ],

  /* ───────────── @weave/router ───────────── */
  'router/createRouter': [
    {
      lang: 'ts',
      code: `import { createRouter } from '@weave/router';
import { routes } from '../pages/routes.gen';

export const router = createRouter(routes);
// serve under a sub-path:
// export const router = createRouter(routes, { basename: '/app' });`,
    },
  ],
  'router/navigate': [
    {
      lang: 'ts',
      code: `import { navigate } from '@weave/router';
const save = async () => { await store.create(input); navigate('/'); };`,
    },
  ],
  'router/Link': [
    {
      lang: 'html',
      code: `<Link to="/">Home</Link>
<Link to="/stress" activeClass="active">Stress</Link>
<Link to={{ '/task/' + t.id }}>Open</Link>  <!-- prefetches on hover by default -->`,
    },
  ],
  'router/RouterView': [
    {
      lang: 'html',
      code: `<!-- top outlet (takes the router) -->
<RouterView router={{ router }} transition={{ fade }} />

<!-- nested outlet, inside a layout — discovers the router via context -->
<RouterView />`,
    },
  ],
  'router/afterEach': [
    {
      lang: 'ts',
      code: `import { afterEach } from '@weave/router';
const off = afterEach(({ path }) => { document.title = titleFor(path); });
// off() to unsubscribe`,
    },
  ],
  'router/currentQuery': [
    {
      lang: 'ts',
      code: `import { currentQuery } from '@weave/router';
const tab = () => currentQuery().tab ?? 'overview'; // reactive`,
    },
  ],

  /* ───────────── @weave/store ───────────── */
  'store/store': [
    {
      lang: 'ts',
      code: `import { store } from '@weave/store';
import { signal, computed } from '@weave/runtime';

export const useCart = store(() => {
  const items = signal<Item[]>([]);
  const total = computed(() => items().reduce((s, i) => s + i.price, 0));
  return { items, total, add: (i: Item) => items.set((xs) => [...xs, i]) };
});

const cart = useCart(); // same instance everywhere`,
    },
  ],

  /* ───────────── @weave/forms ───────────── */
  'forms/field': [
    {
      lang: 'ts',
      code: `import { field, validators } from '@weave/forms';

const email = field('', [validators.required(), validators.email()]);
email.value.set('a@b.com');
email.error();   // null when valid, else the first message
email.valid();   // boolean (reactive)`,
    },
  ],
  'forms/group': [
    {
      lang: 'ts',
      code: `const f = form({
  password: field('', [validators.minLength(8)]),
  confirm: field(''),
}, {
  validate: (v) => v.password !== v.confirm ? { confirm: 'Passwords differ' } : null,
});
f.valid();   // true only when every child is valid AND no cross-field error`,
    },
  ],
  'forms/fieldArray': [
    {
      lang: 'ts',
      code: `const tags = fieldArray(() => field('', [validators.required()]));
tags.push();            // add a blank item
tags.removeAt(0);       // remove one
tags.controls();        // the live Control[] — render with @for`,
    },
  ],
  'forms/validators': [
    {
      lang: 'ts',
      code: `field('', [
  validators.required('Required'),
  validators.minLength(3),
  validators.pattern(/^[a-z-]+$/, 'Lowercase + dashes only'),
]);
// custom validator: (value) => string | null
const even = (n: number) => (n % 2 === 0 ? null : 'Must be even');`,
    },
  ],

  /* ───────────── @weave/i18n ───────────── */
  'i18n/createI18n': [
    {
      lang: 'ts',
      code: `import { createI18n } from '@weave/i18n';

export const i18n = createI18n({
  lang: 'en',
  fallbackLang: 'en',
  messages: {
    en: { hello: 'Hello, {{ name }}!' },
    lt: { hello: 'Sveikas, {{ name }}!' },
  },
});`,
    },
  ],
  'i18n/t': [
    {
      lang: 'ts',
      code: `import { t } from '@weave/i18n';
t('hello', { name: 'Ada' });                 // bare → current snapshot
const greeting = computed(() => t('hello', { name: name() })); // tracked → re-translates`,
    },
  ],
  'i18n/setLocale': [
    {
      lang: 'ts',
      code: `import { setLocale } from '@weave/i18n';
await setLocale('lt'); // lazy-loads the language (+ fallback), then every t() binding updates`,
    },
  ],

  /* ───────────── @weave/data ───────────── */
  'data/resource': [
    {
      lang: 'ts',
      code: `import { resource } from '@weave/data';

const task = resource(
  () => props.params.id,                         // source — refetch when it changes
  (id, { signal }) => api.get(\`/tasks/\${id}\`, { signal })
);
task.data();     // latest value (or undefined)
task.loading();  // boolean
task.refetch();  // re-run with the current source`,
    },
  ],
  'data/action': [
    {
      lang: 'ts',
      code: `import { action } from '@weave/data';

const save = action((input: NewTask) => api.post('/tasks', input));
await save.run(input);
save.pending();  // true while in flight; only the latest run updates the signals`,
    },
  ],
  'data/optimistic': [
    {
      lang: 'ts',
      code: `import { optimistic } from '@weave/data';

const liked = optimistic(() => server.liked());  // base getter
liked.add(true);                 // show instantly
await server.setLiked(true);     // base changes → overlay clears automatically`,
    },
  ],
  'data/createClient': [
    {
      lang: 'ts',
      code: `import { createClient } from '@weave/data';

export const api = createClient({
  baseUrl: '/api',
  interceptors: [
    (req, next) => { req.headers.set('Authorization', \`Bearer \${token()}\`); return next(req); },
  ],
});
await api.get<Task[]>('/tasks');
await api.post('/tasks', input); // body JSON-encoded`,
    },
  ],
};
