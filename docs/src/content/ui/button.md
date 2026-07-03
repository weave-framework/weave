# Button

The humblest thread in the whole fabric — and the one you'll pull most often. `<Button>` is a **real native
`<button>`** dressed in the Weave look: five variants, a ripple, and a focus-visible ring. Because it's an honest
button underneath, keyboard, focus, and form submission all come for free — nothing to wire.

:::demo button-events

## Import

Bring in the component and its styles. The component is a subpath import; the styles come from the matching Sass
entry (or the umbrella `@weave-framework/ui`, which pulls in every component).

```ts
import Button from '@weave-framework/ui/button';
```

```scss
@use '@weave-framework/ui/button';
```

:::callout tip "One import, real usage"
Everything on this page is exactly what you'd write in your own project — the live demos above and below import
`@weave-framework/ui/button` and use `<Button>` the same way you will. No special docs-only wiring.
:::

## When to use it

Reach for `<Button>` for anything the user *clicks to do something*: submit a form, open a dialog, trigger an
action. If the thing navigates to another page, that's a link (`<a>` / router `<Link>`) wearing button styles, not
a `<Button>` — keep the semantics honest and screen readers will thank you.

## Basic usage

The button at the top of this page is one line of template plus a few lines of setup — this is the exact code
running above, nothing hidden:

:::tabs
~~~html title="app.html"
<Button on:click={{ inc }}>Clicked {{ count() }} times</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const count = signal(0);
  // `inc` is our click handler; `count` is a signal the template reads.
  const inc = () => count.set((n) => n + 1);
  return { count, inc };
}
~~~
:::

Cause and effect: `on:click={{ inc }}` wires the button to the `inc` function; each click bumps the `count`
signal; and because the template reads `count()`, the label re-renders itself. **`count` and `inc` are just names
we returned from `setup`** — they're not special, call them whatever your app needs. Everything the template
references (`inc`, `count`) is defined right there in `setup`; that's the whole contract.

## Variants

The `variant` prop picks the look. The default is `primary` (the ink fill) — you only pass `variant` to get one
of the others.

:::demo button-variants

| Variant | Looks like | Reach for it when… |
| --- | --- | --- |
| `primary` *(default)* | Solid ink fill | The main action on the screen — the one thing you want clicked. |
| `outline` | Bordered, inverts on hover | A secondary action sitting next to a primary one. |
| `marked` | Text with a 2px accent underline | A quiet action that still wants a hint of emphasis. |
| `ghost` | Text only, no chrome | Low-priority actions, toolbars, dense UIs. |
| `icon` | 34px square, no label text | An icon-only button — **pass a `label` for the accessible name.** |

```html
<Button>Save</Button>
<Button variant={{ 'outline' }}>Cancel</Button>
<Button variant={{ 'ghost' }}>Skip</Button>
```

For the `icon` variant, project an icon and always give it a `label` — that becomes the button's accessible name
(there's no visible text to fall back on):

```html
<Button variant={{ 'icon' }} label={{ 'Delete' }}>
  <Icon name={{ 'trash-2' }} />
</Button>
```

## Events

`<Button>` forwards native button events straight through — `on:click` is the one you'll reach for most. You write
it on the component and it lands on the underlying `<button>` with no plumbing. Here's a complete, runnable example —
a delete button that asks first (click it twice):

:::demo button-confirm

:::tabs
~~~html title="app.html"
<Button variant={{ 'outline' }} on:click={{ remove }}>{{ label() }}</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const armed = signal(false);
  const remove = () => {
    if (!armed()) return armed.set(true); // first click: arm
    // second click: actually delete…
    armed.set(false);
  };
  const label = () => (armed() ? 'Click again to confirm' : 'Delete');
  return { armed, remove, label };
}
~~~
:::

An `on:X` handler is **always a function you return from `setup`** (`remove` here). Any other native button event
works the same way — `on:focus`, `on:blur`, `on:pointerdown`, … each one calls the function you bind to it.

## Content

Whatever you put between the tags is projected into the button — a label, an icon, or both. (`<Icon>` is the
library's own component, `import Icon from '@weave-framework/ui/icon'`.)

```html
<Button>Save changes</Button>
<Button><Icon name={{ 'cloud-download' }} /> Export</Button>
```

## Disabled state

`disabled` is the **native** attribute, so it does everything the platform already does — greys the button, blocks
the click, and takes it out of the tab order — and Weave adds one thing on top: the **ripple is suppressed** too, so
a disabled button gives no feedback at all.

:::demo button-disabled

The `disabled` prop takes a **reactive value** — a signal read — so the button flips itself as your state changes,
with no manual DOM toggling. Here's the demo above in full, every name defined:

:::tabs
~~~html title="app.html"
<Button disabled={{ disabled() }} on:click={{ hit }}>Submit ({{ count() }})</Button>
<Button variant={{ 'ghost' }} on:click={{ toggle }}>{{ label() }}</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const disabled = signal(true); // Submit starts disabled…
  const count = signal(0);
  return {
    disabled,
    count,
    hit: () => count.set((n) => n + 1), // only fires while enabled
    toggle: () => disabled.set((d) => !d), // the ghost button flips it
    label: () => (disabled() ? 'Enable it' : 'Disable it'),
  };
}
~~~
:::

Because `disabled={{ disabled() }}` reads the `disabled` signal, flipping that one value enables or disables the
button — Weave updates the native attribute for you. Click **Enable it** and watch **Submit** come alive.

## Forms

Because it's a native button, `type` decides how it behaves inside a `<form>`:

| `type` | What it does |
| --- | --- |
| `button` *(default)* | Nothing automatic — it never submits by accident. |
| `submit` | Submits the surrounding form (and triggers native validation). |
| `reset` | Resets the surrounding form's fields. |

:::tabs
~~~html title="app.html"
<form on:submit={{ onSubmit }}>
  <!-- your fields… -->
  <Button type={{ 'submit' }}>Create account</Button>
</form>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';

export function setup() {
  // `onSubmit` is your own handler. `type="submit"` is what makes the button
  // trigger it (and the browser's native validation) on click OR Enter.
  const onSubmit = (e: Event) => {
    e.preventDefault();
    // …create the account…
  };
  return { onSubmit };
}
~~~
:::

That's the whole integration: no Weave-specific form binding on the button itself — the platform carries it.

## Accessibility

`<Button>` leans on the real element, so most of a11y is handled for you — but two things are yours to supply.

**Handled for you:**

- It **is** a `<button>`, so Enter and Space activate it, it's in the tab order, and it announces as a button.
- A **focus-visible** ring shows for keyboard users and stays hidden for mouse clicks.
- `disabled` uses the native attribute — correctly removed from the tab order and announced as unavailable.

**Yours to supply:**

- **An accessible name.** Text content is the name; for the icon-only `variant="icon"` there's no text, so
  **`label` is required** — it becomes `aria-label`.
- **`ariaCurrent`** when the button represents the current item in a set (e.g. the active page in a paginator) —
  it sets `aria-current`.

:::callout warn "Icon buttons need a label"
An `icon` button with no `label` has no accessible name — a screen reader announces just "button". Always pass one.
:::

## Composition

`<Button>` is the shared button across the whole library — the Stepper's *Back / Continue*, the Paginator's page
numbers, and any dialog's actions are all this exact component (Weave's rule #1: compose the real thing, never
re-create a look-alike). When you need a button anywhere in your own components, compose this one the same way.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `'primary' \| 'outline' \| 'marked' \| 'ghost' \| 'icon'` | `'primary'` | The visual style. |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | Native button type — controls form behavior. |
| `disabled` | `boolean` | `false` | Native disabled state; also suppresses the ripple. |
| `label` | `string` | — | Accessible name (`aria-label`). **Required** for `variant="icon"`. |
| `ariaCurrent` | `string` | — | Sets `aria-current` (e.g. `'page'`). |
| `class` | `string` | — | Extra classes forwarded onto the host `<button>` (layout stays yours). |

### Events

| Event | Payload | Fires when |
| --- | --- | --- |
| `on:click` | `MouseEvent` | The button is activated (click, Enter, or Space). |

Any other native `<button>` event (`on:focus`, `on:blur`, `on:pointerdown`, …) forwards the same way.

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The button's contents — label text, an `<Icon>`, or both. |
