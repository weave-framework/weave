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

`<Button>` forwards native button events straight through — `on:click` is the one you'll use most. You write it
on the component and it lands on the underlying `<button>` with no plumbing:

```html
<Button on:click={{ save }}>Save</Button>
```

The click demo at the top of the page is exactly this: `on:click` bound to a handler that bumps a signal.

## Content

Whatever you put between the tags is projected into the button — a label, an icon, both:

```html
<Button>Save changes</Button>
<Button><Icon name={{ 'download' }} /> Export</Button>
```

## Disabled state

`disabled` is the **native** attribute, so it does everything the platform already does — greys the button, blocks
the click, and takes it out of the tab order — and Weave adds one thing on top: the **ripple is suppressed** too, so
a disabled button gives no feedback at all.

:::demo button-disabled

```html
<Button disabled={{ isSaving() }} on:click={{ save }}>Save</Button>
```

Pass a reactive value (a signal read) and the button enables and disables itself as your state changes — no manual
DOM toggling.

## Forms

Because it's a native button, `type` decides how it behaves inside a `<form>`:

| `type` | What it does |
| --- | --- |
| `button` *(default)* | Nothing automatic — it never submits by accident. |
| `submit` | Submits the surrounding form (and triggers native validation). |
| `reset` | Resets the surrounding form's fields. |

```html
<form on:submit={{ onSubmit }}>
  <!-- fields… -->
  <Button type={{ 'submit' }}>Create account</Button>
</form>
```

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
