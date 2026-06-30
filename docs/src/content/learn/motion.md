# Motion

Animations in Weave attach right to the element with a directive. The framework plays the intro on mount, and — the part that's usually fiddly — **waits** for the outro before removing an element, so things animate *out* as gracefully as they animate *in*.

## The three directives

| Directive | Plays on |
|-----------|----------|
| `transition:fn` | both enter and leave |
| `in:fn` | enter only |
| `out:fn` | leave only |

~~~html
<div transition:fade>Fades both ways</div>
<div in:scale>Scales in, vanishes instantly</div>
<aside out:fly>Appears instantly, flies out</aside>
~~~

Pass params with `{{ }}` — an object handed to the transition function:

~~~html
<div in:fly={{ { y: 20, duration: 200 } }}>Slides up 20px over 200ms</div>
~~~

## Built-in transitions

Four come in the box, from `@weave/runtime`:

- **`fade`** — opacity 0 ↔ 1
- **`scale`** — grows/shrinks from a smaller size
- **`fly`** — translates from an `x`/`y` offset (with fade)
- **`slide`** — collapses/expands height

~~~ts
import { fade, fly, slide, scale } from '@weave/runtime';
// expose them from setup so the template can name them:
return { fade, fly, slide, scale, params: { duration: 180 } };
~~~

~~~html
<div transition:fade={{ params }}>…</div>
~~~

All accept the common options: `delay`, `duration` (ms, default 300), and `easing` (a `t => t` curve).

## Leave animations actually wait

This is the bit that's hard to get right by hand, and Weave handles it. When a control-flow block removes an element — an `@if` going false, a `@for` row dropping out — it plays that element's registered `out:`/`transition:` outro and removes the node **only after** the animation finishes:

~~~html
@for (t of toasts(); track t.id) {
  <div class="toast" in:fly={{ enter }} out:fade={{ leave }}>
    {{ t.message }}
  </div>
}
~~~

Dismiss a toast and it fades out properly; a new one flies in — no snap, no manual timeout juggling. The same is true for `@if`, `@key`, and a `@for` emptying to zero.

:::callout tip "Component roots can't carry a transition directive"
A directive attaches to a DOM element, not a component tag. If the thing you're animating is a `<Link>` or another component, wrap it in a real element and put the directive there: `<div in:scale out:fade><TaskCard …/></div>`.
:::

## Animating route changes

Hand a transition to the top `<RouterView>` and route swaps animate — the entering view is wrapped so the intro plays even for lazy or multi-root views:

~~~html
<RouterView router={{ router }} transition={{ fade }} transitionParams={{ { duration: 180 } }} />
~~~

See [Router](/learn/router#animating-route-changes) for the surrounding setup.

## Portals: escaping the layout

Modals, tooltips, and toasts often need to render outside an `overflow:hidden` or `z-index` ancestor — but stay *logically* inside your component (so context, effects, and disposal behave normally). That's `<Portal>`. It renders its content into a target (`to`, a selector or element, default `document.body`) while leaving a placeholder in its logical spot:

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

## Custom transitions

A transition is a function `(node, params) => config`. The config is the Svelte-style contract — give it a `css(t, u)` that returns per-frame CSS as `t` goes 0→1 (entering) or 1→0 (leaving):

~~~ts
import type { TransitionFn } from '@weave/runtime/dom';

export const spinIn: TransitionFn<{ turns?: number }> = (node, { turns = 1 } = {}) => ({
  duration: 400,
  easing: (t) => t * t * (3 - 2 * t), // smoothstep
  css: (t, u) => `transform: rotate(${u * turns * 360}deg) scale(${t}); opacity: ${t};`,
});
~~~

~~~html
<div in:spinIn={{ { turns: 2 } }}>🎉</div>
~~~

Prefer `css` over `tick` — CSS-driven frames stay on the compositor and are far smoother. Reach for `tick(t, u)` only when an effect can't be expressed in CSS (e.g. animating text content).

:::callout info "What you just learned"
`transition:`/`in:`/`out:` attach animations to an element; Weave plays the intro on mount and **awaits** the outro before removal — so `@if`/`@for` removals animate out. Built-ins are `fade`/`scale`/`fly`/`slide`. Animate routes via `<RouterView transition>`. `<Portal>` renders modals/toasts outside the layout while keeping them logically in the tree. Write a custom transition as `(node, params) => { duration, easing, css }`.
:::

[Next: Custom elements & bootstrap →](/learn/custom-elements) · [Reference: @weave/runtime →](/reference/runtime)
