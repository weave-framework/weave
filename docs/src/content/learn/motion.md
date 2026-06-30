# Motion

Animations in Weave attach right to the element with a directive. The framework plays the intro on mount, and — the part that's usually fiddly — **waits** for the outro before removing an element, so things animate *out* as gracefully as they animate *in*.

## The three directives

A transition directive names a function and picks *when* it plays. The prefix is the only difference:

| Directive | Plays on | Registers an outro? |
|-----------|----------|---------------------|
| `transition:fn` | both enter and leave | yes |
| `in:fn` | enter only | no |
| `out:fn` | leave only | yes |

~~~html
<div transition:fade>Fades both ways</div>
<div in:scale>Scales in, then vanishes instantly</div>
<aside out:fly>Appears instantly, then flies out</aside>
~~~

- An **intro** (`transition:`/`in:`) runs once, on mount.
- An **outro** (`transition:`/`out:`) is *registered on the node* so that whatever removes the element later — an `@if` going false, a `@for` row dropping out — can play it and wait for it before pulling the node. `in:` registers nothing, so an `in:`-only element disappears instantly when removed.

### Passing params

Params go in `{{ }}` — the object is handed straight to the transition function:

~~~html
<div in:fly={{ { y: 20, duration: 200 } }}>Slides up 20px over 200ms</div>
~~~

The outer braces are Weave's binding syntax (everything reactive uses `{{ }}`); the inner braces are the object literal. You can also point at a prepared object:

~~~html
<div transition:fade={{ overlayFade }}>…</div>
~~~

:::callout info "Params are a snapshot, not a live binding"
The params expression is read **once, at play time**, by calling the transition function. It is *not* a reactive getter — Weave does not re-run the transition when the values inside change mid-animation. If `enter` is `{ duration: dur() }`, the duration is whatever `dur()` returned the instant the animation started; changing the signal afterward does nothing to a transition already (or about to be) playing. Compute the params you want *before* the element mounts or leaves.
:::

## Built-in transitions

Four ship in the box, importable from `@weave-framework/runtime` (each is tree-shakeable — you only bundle what you import):

~~~ts
import { fade, fly, slide, scale } from '@weave-framework/runtime';
~~~

Every built-in accepts the same three **common options**, plus its own params:

| Option | Default | Meaning |
|--------|---------|---------|
| `delay` | `0` | ms to wait before the animation starts |
| `duration` | `300` | ms the animation runs |
| `easing` | identity (`t => t`) | reshapes the 0→1 progress before it drives the frame |

### `fade`

Animates `opacity` between 0 and 1. No own params — just the common options.

~~~html
<div transition:fade={{ { duration: 150 } }}>…</div>
~~~

### `fly`

Translates from an `(x, y)` offset **while fading**. Both offsets default to `0`, so `fly` with no params is effectively a plain fade — set at least one axis.

| Param | Default | Meaning |
|-------|---------|---------|
| `x` | `0` | horizontal offset in px to fly from / to |
| `y` | `0` | vertical offset in px to fly from / to |

The translation uses `u` (= `1 - t`), so at the *start* of an enter the element sits at the full offset and slides to `(0, 0)` as it fades in; on leave it slides back out to the offset as it fades away.

~~~html
<div in:fly={{ { y: 20 } }} out:fly={{ { x: -40, duration: 200 } }}>…</div>
~~~

### `scale`

Scales from `start` up to 1 **while fading**. The `start` param is the size to grow from (or shrink to) — default `0`, so by default it grows from nothing.

| Param | Default | Meaning |
|-------|---------|---------|
| `start` | `0` | the scale factor to animate from (`0.8` for a subtle pop, `0` for grow-from-nothing) |

The applied scale is `start + (1 - start) * t`, so at `t = 0` the element is at `start` and at `t = 1` it is at `1`.

~~~html
<div in:scale={{ { start: 0.9, duration: 120 } }}>A subtle pop-in</div>
~~~

### `slide`

Collapses / expands the element's **height** (with `overflow: hidden`) while fading the height in. There is **no width option** — it animates height only.

:::callout tip "slide measures the element at play time"
`slide` reads `node.offsetHeight` *when the transition is created* (at play time) and animates from `0` up to that measured height. The element must be measurable at that moment — laid out, not `display:none`. The height is captured once, so a element whose content grows mid-animation won't track the new height.
:::

~~~html
@if (expanded()) {
  <section transition:slide>Accordion body…</section>
}
~~~

:::callout info "Equivalent shapes"
`fade` and `slide` take only the common options (`delay`/`duration`/`easing`). `fly` adds `x`/`y`; `scale` adds `start`. All four also fade opacity except — well, `fade` *is* the opacity, and `slide` fades alongside the height.
:::

## Wiring built-ins into a template

A transition directive resolves its function name through **component scope**, exactly like any other identifier in a template. So the name has to be reachable: either returned from `setup`, or imported at module scope in an SFC.

:::tabs
~~~ts title="setup"
import { fade, fly, slide, scale } from '@weave-framework/runtime';

export function setup() {
  // expose them so the template can name them:
  return { fade, fly, slide, scale, enter: { y: 16, duration: 180 } };
}
~~~
~~~html title="template"
<div transition:fade>…</div>
<li in:fly={{ enter }}>…</li>
~~~
:::

If the name doesn't resolve to a function in scope, it resolves to *nothing* and the directive can't run — so make sure it's exposed.

## Leave animations actually wait

This is the bit that's hard to get right by hand, and Weave handles it. When a control-flow block removes an element, it plays that element's registered outro and removes the node **only after** the animation finishes:

~~~html
@for (t of toasts(); track t.id) {
  <div class="toast" in:fly={{ enter }} out:fade={{ leave }}>
    {{ t.message }}
  </div>
}
~~~

Dismiss a toast and it fades out properly; a new one flies in — no snap, no manual timeout juggling. This holds for every removal path:

- **`@if` / `@else` / `@switch`** — the leaving branch's nodes play their outro before removal.
- **`@key`** — when the key changes, the old content animates out before the new content takes over.
- **`@for`** — a row whose key vanishes plays its outro; and a `@for` whose data **empties to zero** animates each row out (rather than snapping the whole list away).

An element with **no registered outro** (an `in:`-only element, or one with no transition directive at all) is removed synchronously — there's nothing to wait for.

:::callout info "One outro per node"
A node carries a single registered outro. If you write two outro-capable directives on one element (say `transition:fade out:fly`), the second **overwrites** the first — only the last one plays on removal. Use one.
:::

:::callout tip "Component roots can't carry a transition directive"
A directive attaches to a DOM element, not a component tag. If the thing you're animating is a `<Link>` or another component, wrap it in a real element and put the directive there: `<div in:scale out:fade><TaskCard …/></div>`.
:::

## Animating route changes

Hand a transition to the top `<RouterView>` and route swaps animate. The entering view is wrapped in a real host element so the intro plays even for `lazy()` routes (whose own host is `display:contents`) or multi-root templates:

~~~html
<RouterView router={{ router }} transition={{ fade }} transitionParams={{ { duration: 180 } }} />
~~~

`transitionParams` is any object, handed to the transition function — and it follows the same **snapshot** rule as `{{ }}` params: read once when the entering view mounts.

:::callout info "Route transitions are enter-only by design"
`<RouterView transition>` plays the **intro** on the entering view and nothing else. There is no built-in leave animation for the *outgoing* page — the old view is simply replaced. If you want a page to animate *out*, author a page-root `out:` directive yourself inside that page's template; the router's `transition` prop won't do it for you.
:::

See [Router](/learn/router#animating-route-changes) for the surrounding setup.

## Portals: escaping the layout

Modals, tooltips, and toasts often need to render outside an `overflow:hidden` or `z-index` ancestor — but stay *logically* inside your component (so context, effects, and disposal behave normally). That's `<Portal>`. It renders its content into a target (`to`, a selector or element) while leaving a placeholder in its logical spot:

~~~html title="task-modal.html"
<Portal to="body">
  @if (editor.isOpen()) {
    <div class="overlay" transition:fade={{ overlayFade }} on:click={{ onBackdrop }}>
      <div class="dialog" role="dialog" aria-modal="true" in:scale={{ dialogIn }}>
        <TaskForm editId={{ editor.editId() }} onClose={{ editor.close }} />
      </div>
    </div>
  }
</Portal>
~~~

Because the content still lives in your component tree, the `@if`, the transitions, and any `inject()` inside work exactly as if it rendered inline — it just *appears* at `body`.

:::callout info "`to` resolves once, and falls back to body"
`to` is a CSS selector or an `Element`, resolved **once** at mount (default `document.body`). If a selector matches **nothing**, `<Portal>` quietly falls back to `document.body` rather than throwing — unlike [`mount()`](/learn/custom-elements), which *does* throw on a non-matching selector. So a typo'd `to` won't crash; your content just lands on `body`. Double-check the selector if a modal shows up somewhere unexpected.
:::

## Custom transitions

A transition is a function `(node, params) => config`. The config is the Svelte-style contract — every field is optional:

| Field | Default | Meaning |
|-------|---------|---------|
| `delay` | `0` | ms before the animation starts |
| `duration` | `300` | ms the animation runs; **`<= 0` snaps straight to the final frame** (instant) |
| `easing` | `t => t` | reshapes the raw 0→1 progress before it drives `css`/`tick` |
| `css(t, u)` | — | returns per-frame CSS text |
| `tick(t, u)` | — | per-frame side effect (use sparingly) |

### Understanding `t` and `u`

`t` is the eased progress and `u` is always `1 - t`. Which way `t` runs depends on direction:

- On **enter** (intro), `t` goes **0 → 1**.
- On **leave** (outro), `t` goes **1 → 0**.
- `u = 1 - t` always — handy for "the other end" of a value (e.g. an offset that should be full at the start of an enter, hence `u`).

So you write the function once and it reads correctly both ways: at the visible end (`t = 1`) the element is fully present; at the hidden end (`t = 0`) it's gone.

:::tabs
~~~ts title="define"
import type { TransitionFn } from '@weave-framework/runtime/dom';

export const spinIn: TransitionFn<{ turns?: number }> = (node, { turns = 1 } = {}) => ({
  duration: 400,
  easing: (t) => t * t * (3 - 2 * t), // smoothstep
  css: (t, u) => `transform: rotate(${u * turns * 360}deg) scale(${t}); opacity: ${t};`,
});
~~~
~~~html title="use"
<div in:spinIn={{ { turns: 2 } }}>🎉</div>
~~~
:::

### Prefer `css` over `tick`

Both `css` and `tick` are called once per frame. Prefer `css`: CSS-driven frames stay on the compositor and are far smoother. Reach for `tick(t, u)` only when an effect can't be expressed in CSS — e.g. animating text content, or driving the `<canvas>`/Web Audio that CSS can't touch.

:::callout tip "How the runtime drives it (for transition authors)"
The runtime sets the **start frame in a microtask, before paint** — so an entering element is already at its hidden frame the moment it appears, with no flash of the final state. It then steps each frame with `requestAnimationFrame`, applying your `css`/`tick` on top of the element's existing inline styles. When an **intro finishes**, it restores the element's original inline `cssText`, dropping the per-frame overrides — so your transition leaves no residue behind. (A `delay` is honored by holding at the start frame until the delay elapses.)
:::

:::callout info "What you just learned"
`transition:`/`in:`/`out:` attach animations to an element; Weave plays the intro on mount and **awaits** the outro before removal — so `@if`/`@key`/`@for` removals animate out. Built-ins are `fade`/`scale` (`start`)/`fly` (`x`,`y`)/`slide` (height, measured at play time), all sharing `delay`/`duration`/`easing`. Params are a one-time **snapshot**, not reactive. A node holds **one** outro; an `in:`-only node leaves instantly. Animate routes via `<RouterView transition>` — **enter-only**; author a page `out:` for leaves. `<Portal>` renders modals/toasts outside the layout while keeping them logically in the tree (`to` resolves once, falling back to `body`). Write a custom transition as `(node, params) => { delay?, duration?, easing?, css?, tick? }`; prefer `css`, and `duration <= 0` is instant.
:::

[Next: Custom elements & bootstrap →](/learn/custom-elements) · [Reference: @weave-framework/runtime →](/reference/runtime)
