# Sidenav

The app-shell layout — a drawer beside your main content, in one of three modes. It's **responsive by default**:
leave the mode off and it's an open side-drawer on wide screens and a slide-over on narrow ones. Fix the mode when
you want it to stay put.

:::demo sidenav-demo

## Import

```ts
import Sidenav from '@weave-framework/ui/sidenav';
```

```scss
@use 'pkg:@weave-framework/ui/sidenav';
```

## Basic usage

Put the drawer content in the `drawer` slot and the page in the default slot:

:::tabs
~~~html title="app.html"
<Sidenav mode={{ 'side' }} defaultOpened={{ true }}>
  <nav slot="drawer">…navigation…</nav>
  <div>…main content…</div>
</Sidenav>
~~~
~~~ts title="app.ts"
import Sidenav from '@weave-framework/ui/sidenav';

export function setup() {
  return {};
}
~~~
:::

## Modes

| Mode | Behaviour |
| --- | --- |
| `side` | The drawer sits **in flow**, pushing the content over. |
| `over` | The drawer **floats over** the content with a dimming backdrop — a modal context (focus-trap, Esc + backdrop close). |
| `push` | The drawer floats **and** shifts the content across. |

**Omit `mode` for responsive behaviour** — it consumes the Weave `Narrow` breakpoint (900px): over + closed when
narrow, side + open when wide. That's the off-canvas mobile drawer for free.

## Open state & the imperative handle

The open state follows the Weave convention — controlled `opened` + `onOpenedChange`, or uncontrolled
`defaultOpened`. For a toolbar hamburger, grab the imperative handle via `api`:

```html
<Sidenav api={{ (a) => (nav = a) }}>…</Sidenav>
```

```ts
// then, from a button
nav.toggle(); // or nav.open() / nav.close() / nav.opened()
```

`position` docks the drawer to the `'start'` (default) or `'end'` edge; `backdrop` forces the scrim on/off (default:
shown only in `over` mode).

## Accessibility

In `over` mode the open drawer is modal: it carries `aria-modal="true"`, focus is trapped, the background is
`inert` (the backdrop stays clickable so it can close the drawer), and Esc / backdrop-click close it, restoring
focus. The role of the drawer is yours to set (`navigation` is typical) — Sidenav stays an
unopinionated layout shell.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `'side' \| 'over' \| 'push'` | *(responsive)* | Fixed mode; omit for responsive behaviour. |
| `opened` | `boolean` | — | Controlled open state. |
| `onOpenedChange` | `(opened: boolean) => void` | — | Called when the open state changes. |
| `defaultOpened` | `boolean` | `true` | Uncontrolled initial open state (explicit mode; responsive mode derives it from the breakpoint). |
| `position` | `'start' \| 'end'` | `'start'` | Which edge the drawer docks to. |
| `breakpoint` | `string` | Narrow (900px) | Media query driving responsive mode. |
| `backdrop` | `boolean` | *(over only)* | Force the backdrop on/off. |
| `api` | `(api: SidenavApi) => void` | — | Receives the `{ open, close, toggle, opened }` handle. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

### Slots

| Slot | Content |
| --- | --- |
| `drawer` | The drawer's content (navigation, etc.). |
| *(default)* | The main page content. |
