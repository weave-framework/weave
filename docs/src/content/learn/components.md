# Components

A component is the unit you build screens out of. In Weave it's refreshingly plain: a `setup` function and a template. No class, no `this`, no lifecycle methods to override. This page is about the component itself — how it's shaped, and how components talk to one another.

## Anatomy of a component

Two sibling files, same base name:

:::tabs
~~~ts title="task-card.ts"
import { inject } from '@weave-framework/runtime';
import { useEditor, type EditorStore } from '../../stores/editor';
import { SessionContext, type Session } from '../../app/session';
import type { Task } from '../../data/types';

export function setup(props: { task: Task }) {
  const task = () => props.task;
  const editor: EditorStore = useEditor();
  const session: Session = inject(SessionContext);
  const mine = () => !!props.task.assignee && props.task.assignee === session.currentUser;
}
~~~
~~~html title="task-card.html"
<article class="card">
  <p class="title">{{ task().title }}</p>
  @if (mine()) {
    <span class="mine">You</span>
  }
  <button on:click={{ () => editor.open(task().id) }}>Edit</button>
</article>
~~~
:::

The rules are short:

- **`setup` runs once**, when the component is created. It's the constructor and the body rolled into one.
- **It receives `props`** — the inputs from the parent.
- **It exposes names to the template** — you write no `return`; the compiler reads the template and
  writes one. For the component above it emits `return { editor, mine, task }`, and **not** `session`,
  which the template never names and which therefore stays private. Functions, signals, computeds, plain
  values: all fair game. ([You may write one yourself](#you-can-skip-the-return) when you want to rename
  or reshape.)
- **The template reads those names.** Call signals/getters with `()` to read (and subscribe).

Because `setup` runs once, you don't memoize anything or guard against re-renders — there are none. State you create lives for the life of the component, and reactivity updates the DOM in place.

:::callout tip "Why a function and not a class?"
A closure already gives you private state (locals) and a public surface (what you return) — so there's nothing for `private` or `this` to add. See [Why Weave?](/learn/why-weave#why-functions-not-classes) for the full reasoning, and [Lifecycle, context & DI](/learn/lifecycle-context-di) for the functional stand-ins for `extends`/`implements`.
:::

### You can skip the `return`

The `return { … }` at the end of `setup` is optional. Leave it out and Weave synthesizes one for you — exposing exactly the names your template reads:

:::tabs
~~~ts title="counter.ts — no return"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const inc = () => count.set((n) => n + 1);
  // no return — Weave exposes `count` and `inc`, because the template names them
}
~~~
~~~html title="counter.html"
<button on:click={{ inc }}>{{ count() }}</button>
~~~
:::

Two things worth knowing:

- **Only what the template references is exposed.** A private helper, a timer, an intermediate value the template never names stays private — it is never added to the context. Nothing leaks.
- **An explicit `return` turns this off.** The moment `setup` has a top-level `return`, Weave uses it verbatim and synthesizes nothing. Write one when you want to rename, reshape, or deliberately expose something the template doesn't read directly.

Both styles type-check identically — hand-written or synthesized, the template is checked against the same context type.

### `setup` is optional, and flexible about its shape

`setup` is not mandatory and not rigid:

- **You can omit it entirely.** A component that's pure markup (no inputs, no state) needs no script — just a template. A `.ts` file becomes a component the moment it has a sibling `.html` (or declares a `template`), with or without a `setup`.
- **It can return nothing.** If `setup` only runs side effects (an `onMount`, a `provide`) and exposes no names, just return nothing — `void` is fine. The template simply has no bindings to read.
- **It can be `const` or `function`, and may be `async`.** All of `export function setup(props) {…}`, `export const setup = (props) => {…}`, and `export async function setup(props) {…}` are recognized. (The loader detects `setup` by either spelling.)

~~~ts title="header.ts — template-only, no setup"
// This file is a component purely because header.html sits next to it.
// No exports needed.
~~~

:::callout info "Prop defaults"
A prop the parent didn't pass reads as `undefined`. Two ways to give it a default:

**`export const propDefaults`** — a static object layered *under* props. A prop the parent omits reads the default; one it passes wins (and stays reactive). Defaulted props also become **optional for the parent** — `weave check` won't demand them:

~~~ts
export const propDefaults = { size: 'md', variant: 'primary' };
export function setup(props: { size: 'sm' | 'md'; variant: string }) {
  // props.size is 'md' when the parent omitted it
}
~~~

Values must be static (no bindings). Passing `undefined` explicitly counts as *passed*, so the default applies only to an **absent** prop.

Or default **inline in `setup`**, when the default depends on other state:

~~~ts
export function setup(props: { size?: 'sm' | 'md' }) {
  const size = () => props.size ?? 'md';
}
~~~
:::

## How a component declares its template and styles

The two-sibling-files layout above is the **convention**, not the only way. A component is really just a script paired with some template text and (optionally) some CSS — and there are several legitimate ways to say where each comes from. Knowing them all saves you from fighting the build when a one-file or inline form would be cleaner.

A `.ts` file is treated as a component when **either** it has a sibling `.html` **or** it exports a `template`. Anything else is an ordinary module.

### Every form for the template

| # | Form | Looks like | When it applies |
| --- | --- | --- | --- |
| 1 | **Sibling file** (convention) | `app.ts` + `app.html` | Default. No `template` export; the loader reads `app.html` next to the `.ts`. |
| 2 | **Inline string** | `export const template = '<h1>{{ x() }}</h1>';` | Classified *inline* because the value contains `<`, `{`, `}`, or a newline. |
| 3 | **Explicit file** | `export const template = './custom.html';` | Classified *file* because the value has a `/` or `\`, or ends in `.html`. Read relative to the `.ts`. |

The "inline vs file" decision is made **by shape**, not by a separate `templateUrl` field. The rule:

- Contains any of `<` `{` `}` newline → **inline markup**.
- Otherwise has a slash/backslash, or ends `.html` → **file path**.
- Otherwise (short, path-less text like `"Hello"`) → treated as **inline** content.

### Every form for the styles

| # | Form | Looks like | When it applies |
| --- | --- | --- | --- |
| 4 | **Sibling file** (convention) | `app.ts` + `app.scss` | Default. No `styles` export; the loader reads the sibling `app.<styleLang>` (extension set by `styleLang` in config). |
| 5 | **Inline string** | `export const styles = '.x { color: red }';` | Classified *inline* (contains `{`, `}`, or a newline). |
| 6 | **Explicit file** | `export const styles = './a.scss';` | Classified *file* (has a slash/backslash, or ends `.css`/`.scss`/`.sass`). |
| 7 | **Array** | `export const styles = ['./base.scss', '.x{…}'];` | Each entry classified **independently** (file or inline), compiled, and concatenated in array order — so the cascade follows the order you list. |

`styles` is the only one of the two that accepts an array; a `template` array is an error (see below). Inline style strings are compiled with the project's `styleLang` (so an inline string in an SCSS project is parsed as SCSS), whereas a file entry is compiled by its **own** extension.

### The `.weave` single-file component

You don't have to split a component across files at all. A `.weave` file holds everything — script, template, and styles — in one place:

~~~html title="counter.weave"
<script>
  import { signal } from '@weave-framework/runtime';
  export function setup() {
    const n = signal(0);
    return { n, inc: () => n.set((v) => v + 1) };
  }
</script>

<button on:click={{ inc }}>Count: {{ n() }}</button>

<style>
  button { font: inherit; padding: 6px 10px; }
</style>
~~~

Everything outside the `<script>` and `<style>` blocks is the template. The `<style>` block is compiled with your configured `styleLang` and scoped exactly like a sibling stylesheet. This is a first-class authoring form — reach for it when a component is small enough that one file reads better than three.

### Fail-loud rules

Weave refuses ambiguous or unsafe declarations at **build time** rather than guessing. Each of these throws:

| You did | Error |
| --- | --- |
| Exported `template` **and** have a sibling `.html` | "declares `template` and also has a sibling .html — remove one" |
| Exported `styles` **and** have a sibling style file | "declares `styles` and also has a sibling .`<styleLang>` — remove one" |
| Pointed `template`/`styles` at a file that doesn't exist | "template file not found" / "style file not found" |
| Used `${…}` in a backtick `template`/`styles` | "cannot use `${…}` — Weave binds with `{expr}`, not JS interpolation" |
| Made `template` an array | "`template` must be a single string, not an array" |
| Gave `template`/`styles` a non-static value (not a string literal, or array of string literals) | "must be a static string" (these are read **statically**, never evaluated — a variable or function call can't be inspected at build time) |

A long `template` may be split across lines with `+`, and **comments between the pieces are fine** — they are
trivia, like whitespace:

~~~ts
export const template: string =
  '<button class={{ c() }}' +
  // the disabled state rides the native attribute
  ' disabled={{ d() }}>' +
  '<slot></slot></button>';
~~~

:::callout tip "Why a backtick still can't interpolate"
You may write a `template` with backticks for multi-line convenience — but `${expr}` inside it is rejected. Weave's binding is `{{ expr }}` in the template, resolved by the compiler; `${…}` is JavaScript string interpolation that would run *before* Weave ever sees the markup. Keeping them separate is what makes the markup analyzable.
:::

## Props: data flowing down

Before the rules, the thing itself. The parent below owns `step` and `total`; the child owns nothing but
its own press count and a function it was handed.

:::demo components-flow

:::callout see "What you should see"
Press the child's button and the parent's **total** climbs by the step — that is an event going **up**,
and it happened by the child calling a function, with no emitter and no shared object.

Now change the **step** with the parent's buttons. The child's label follows immediately, and its
*pressed N times* count **does not reset**. The child was not re-created and its state was not thrown
away: a prop is a live getter into the parent, and only the bindings that read it reacted.

That second half is the part worth pausing on. There was no re-render, so there was nothing to preserve
state *against*.
:::



A parent passes data to a child as attributes. Static values use quotes; dynamic values use `{{ }}`:

~~~html
<TaskCard task={{ t }} />
<Badge priority="high" />
~~~

Inside the child, props arrive as the first argument to `setup`. The key detail: **props are reactive getters, not snapshots.** Reading `props.task` re-reads the parent's expression, so when the parent's data changes, anything in the child that read it updates too. The idiom is to wrap a prop in a getter and expose that:

~~~ts
export function setup(props: { task: Task }) {
  const task = () => props.task; // a getter — stays live
  return { task };
}
~~~

Then `{{ task().title }}` in the template tracks changes to the parent's `task`. (If you destructured `const { task } = props`, you'd capture the value *once* and lose reactivity — so don't.)

:::callout info "No change detection, no re-render"
A prop isn't a value handed over once per render pass — there are no render passes. It's a live getter into the parent, and only the bindings that actually read it react when it changes.
:::

## Events: messages flowing up

A child talks back to its parent by **calling a function the parent gave it**. Pass a callback down as a prop:

:::tabs
~~~html title="parent.html"
<TaskForm editId={{ editor.editId() }} onClose={{ editor.close }} />
~~~
~~~ts title="task-form.ts"
export function setup(props: { editId?: string; onClose: () => void }) {
  // …later, when the user is done:
  const done = () => props.onClose();
  return { done /* …and the rest */ };
}
~~~
:::

There are two spellings, and they are **the same prop**:

- A **plain callback prop**: `onClose={{ fn }}` → the child reads `props.onClose`.
- The **`on:` form** for event-style names: `on:close={{ fn }}` → compiled to the prop `onClose` (the event name is capitalized and prefixed with `on`). So `on:close` and `onClose` arrive at exactly the same prop; `on:select` becomes `onSelect`, and so on.

Use whichever reads better. The point is the same as everywhere else in UI: data flows down, events flow up. There's no emitter object to declare — a function *is* the channel.

:::callout info "What counts as a child component"
A tag is a **child component** when its name starts with an **uppercase letter** — `<TaskCard>`,
`<Badge>`. A lowercase tag is a plain DOM element: `<div>`, and also `<my-widget>`, which is a custom
element the browser handles.

That single rule is the whole decision. There is no registration step and no list to keep in sync.
:::

### What you may put on a component tag

A component tag compiles to a function call with a props object, so the attributes on it are that
component's inputs — not HTML attributes. Four forms are accepted:

| You write | The child receives |
| --- | --- |
| `label="Go"` | the **string** `'Go'`. An explicit empty `hint=""` is the empty string. |
| `disabled` (bare, no value) | the **boolean** `true`. |
| `task={{ t }}` | a **live getter** — the child re-reads your expression, so it stays reactive. |
| `on:close={{ fn }}` | the prop **`onClose`**. See [Events](#events-messages-flowing-up) below. |

And two DOM directives are deliberately allowed through:

- **`use:action={{ arg }}`** is forwarded to the component's single root element, with the same lifecycle
  it has on an element — see [`use:` on components](/learn/templates#use-on-components).
- **`bind:value={{ sig }}`** passes the **signal itself**, not a getter, so the child can both read it
  and write to it. That is the two-way form, and it is sugar for "hand the child your writable signal".

Everything else that looks like a directive — `class:`, `transition:`, `ref`, `show`, `.prop` — is a
**build error** on a component tag, and deliberately so rather than as a missing feature. Each of those
describes one DOM element, and a component is a function that may render several. Put the directive on a
real element inside the component, or pass the value down as a prop. The compiler says exactly that:

~~~
`class:big` is a DOM directive, and <Card> is a component, not an element. A component tag
accepts props (`x={{ v }}`), events (`on:x={{ fn }}`), `bind:` for two-way, and `use:`
(forwarded to its root element). Put `class:` on a real element inside the component, or
pass the value down as a prop.
~~~

## When it goes wrong

Everything above is the shape a component takes when it works. Here is what you actually see when it
does not — the messages, verbatim, because recognizing one is most of fixing it.

### While you are writing the template

The parser stops at the first thing it cannot make sense of, and says where. Every message below is the
real output, produced by feeding the compiler the mistake:

| You wrote | It says |
| --- | --- |
| `<p>` opened and never closed | `Mismatched </div>, expected </p>` |
| a closing tag with nothing open | `Unexpected closing tag at 11` |
| `@else` with no `@if` above it | `Unexpected @else at 5 (no matching block)` |
| `@let = 1;` | `Expected name after @let at 10` |
| something other than `@case` inside `@switch` | `Expected @case/@default or '}' in @switch at 21` |
| `<!--` with no `-->` | ``Unterminated comment: `<!--` has no matching `-->`.`` |

:::callout trap "One mistake, reported somewhere else"
An unclosed tag is the one that reads strangely, because the parser cannot know you meant to close `<p>`
until it meets a `</div>` that does not fit. The error names the line it **noticed** on, not the line
you have to edit — that one is above it.

If you ever see `Template nests more than 500 levels deep`, this is the same mistake wearing a bigger
hat: nothing was closed for a long time, so everything after it became a child of everything before it.
:::

### While the component is being assembled

These come from the loader — they are about the files, not the markup:

| Situation | It says |
| --- | --- |
| a `template` export **and** a sibling `.html` | ``weave: card.ts declares `template` and also has a sibling .html — remove one`` |
| `template` pointing at a file that is not there | `weave: template file not found: ./missing.html (from card.ts)` |
| the same for styles | `weave: style file not found: …` |
| a `<Missing>` tag with no import and no file at any conventional path | ``weave: card.ts composes <Missing> but no import for it was found. Import it in the component's script, or place its module at ../missing/missing.`` |
| two components claiming one custom-element tag | `weave: custom element tag declared twice` |
| a custom-element tag with no hyphen | `weave: custom element tag must contain a hyphen (Custom Elements spec)` |

Each of these is a **build error**, not a warning. That is the deliberate part: an ambiguous declaration
is refused rather than guessed at, so a component never quietly gets a template you did not mean.

### When the declaration is not static

`template` and `styles` are read **statically** at build time — the file is never executed — so anything
the compiler cannot see by reading the text is refused rather than guessed at:

| You wrote | It says |
| --- | --- |
| `export const template = x;` | ``weave: `template` must be a static string`` |
| `export const styles = someList;` | ``weave: `styles` must be a static string or array of strings`` |
| `` export const template = `<p>${name}</p>`; `` | `weave: inline template/styles cannot use ${…} — Weave binds with {expr}, not JS interpolation` |
| `export const template = ['<p>a</p>'];` | ``weave: `template` must be a single string, not an array`` |
| a quote that is never closed | `weave: unterminated string literal in template/styles declaration` |
| `export const template = '<p>' + x;` | ``weave: `template`/`styles` must be a static string — `+` may only join string literals`` |
| a `styles` array that is never closed | `weave: unterminated array in styles declaration` |

Two more come from the extension forms rather than from a plain component:

- **`extends` pointing at a package.** A `#3` extension reads the base's raw template, and a published
  package ships compiled output with no template to read — so the base has to be a **local** module.
  The message names the import it could not follow.
- **A `patch` extension whose base has no readable template.** Same cause, said at the other end: there
  is markup to patch only if there is markup on disk.

:::callout info "Why static, and why that is worth the restriction"
A template that could be computed is a template no tool can read. Static declarations are what let
`weave check` type-check your markup, the editor jump from a tag to its component, and the formatter
format a file it has never executed.

The `${…}` one is the common surprise: a backtick string is fine for multi-line convenience, but
JavaScript interpolation would run *before* Weave ever saw the markup. Weave's own binding is `{{ }}`,
resolved by the compiler — keeping them separate is what makes the markup analyzable.
:::

### While it runs

Two you can meet at runtime, both from putting a thing where it cannot go:

- **`use: on <Card>: actions attach to a single root element, but <Card> renders 3 nodes.`** A `use:`
  action needs one element to own. A component that renders a fragment has no single root, so there is
  nothing to attach to. Wrap it, or move the action onto a real element inside.
- **`<w:element> refuses to create a <script> element (it would execute).`** A dynamic tag name is data,
  and data that can name `<script>` is a way to run code. Refused, always.

### The ones the type checker catches first

Most component mistakes never reach any of the above, because `weave check` sees them:

| You wrote | It says |
| --- | --- |
| `{{ count }}` where `count` is a signal | `Signal<number> is a function, and a template renders a function as its own source text. Call it — a signal is read with () …` |
| `class:big` on a component tag | `class:big is a DOM directive, and <Card> is a component, not an element.` |
| a prop the child requires and you did not pass | `Property 'onAdd' is missing in type '{ step: number; }'` |
| an HTML entity in a template | `&mdash; renders as text, not as — … Type the character itself.` |

Which is the argument for running `weave check` before you go looking: it turns most of this page into
something you never read.

### Making a child available

Import it the ordinary way:

~~~ts
import TaskCard from './task-card';
~~~

If you do not, Weave does not give up immediately — it resolves the tag **by convention** first, trying
three paths relative to the parent component's own directory, in this order:

| # | For `<TaskCard>` it tries | The layout that suits |
| --- | --- | --- |
| 1 | `../task-card/task-card` | a directory per component (how the UI library is laid out) |
| 2 | `./task-card` | flat siblings |
| 3 | `./task-card/task-card` | a nested directory |

The first one that exists (as `.ts` or `.weave`) wins, and Weave writes the import for you. **An explicit
import always beats the convention**, so write one whenever you want the module named outright — or when
two candidates would be ambiguous to a human reading the file.

`weave check` resolves tags the same way, which is the part that matters: a component that renders is
never reported as an unknown name, and a tag matching nothing is an error in both places rather than in
only one of them.

:::callout trap "Your editor may call that import unused"
An import used **only** in the template is invisible to plain TypeScript — nothing in the `.ts` mentions
it. The [Weave editor tooling](/learn/tooling) counts a component tag as a real use, so with it installed
the import is not flagged.

Without it, `tsc --noUnusedLocals` will flag it. That, and only that, is what a `void TaskCard;` line is
for. If you have the tooling, you do not need one.
:::
