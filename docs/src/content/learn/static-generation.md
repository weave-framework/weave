# Static generation & resume

`weave build --ssg` renders every route to real HTML at build time, and the browser **resumes** that HTML instead of rebuilding it. The page arrives already painted and already crawlable; the JavaScript that follows picks up the reactive graph the build left behind, without re-running any of your `setup()` functions.

This is opt-in and additive. A normal `weave build` is unchanged — nothing on this page costs you a byte unless you ask for it.

## The two modes

`--ssg` alone prerenders each route and then **client-renders** over it. The HTML is a first paint and an SEO surface; the browser still builds the whole app once the bundle lands.

Adding `ssg.resume` prerenders each route **and adopts it**:

~~~ts
// weave.config.ts
import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/shell',
  routesDir: 'src/pages',
  ssg: { resume: true },
});
~~~

~~~bash
npx weave build --ssg
~~~

You get one `index.html` per route, each carrying its own state snapshot, plus the client bundle.

## What resume actually means

On the server, the build runs your components, produces DOM, and **snapshots the reactive graph** — every signal's value, per component instance — into an inline `<script type="application/weave">`.

On the client, Weave reads that snapshot, rebuilds the signals, and **attaches the existing DOM to them**. Nothing is re-created and nothing re-runs:

- `setup()` is **never called on the client**. Its work already happened at build time; the values crossed the wire.
- The DOM nodes the server wrote are the nodes you keep. A text binding re-binds the *same* text node.
- Handlers are rebuilt from the compiled component, not from a re-executed closure.

That last point is the difference between resuming and re-running. Re-running means paying for the whole render twice — once on the server to produce HTML, once in the browser to discover what the HTML already says. Resuming pays once.

## What ships to the reader

Each route is its own chunk. A reader downloads the shared client bundle plus **only the route they opened** — not the other 111 pages of your site. Measured in the browser on this documentation site, one page went from **1555.7 KB to 169.7 KB** of transferred payload.

Splitting by route is the floor, not the ceiling: what a chunk *imports* is the number that matters. If one module pulls in every page's content or every demo in your library, every route chunk pulls it in too, and splitting buys you nothing. Reach for `lazy()` at that boundary:

~~~ts
const Chart = lazy(() => import('./chart.js'));
~~~

**A `lazy()` component still prerenders.** The build waits for the import, renders the real component, and writes its HTML — then leaves the chunk out of everyone else's bundle. Lazy means "not in your bundle", not "not in your HTML", so there is no trade to make between a complete first paint and a small download.

## Your document, on every page

A generated page is your `index.html`, not a new document. Its `<html>` attributes and its whole `<head>` are carried onto every prerendered route — `lang`, a theme attribute, `<base>`, the viewport meta, your description and social meta, your favicon, anything else you put there. Two things the generator owns: `<meta charset>`, and the `<title>`, which is **the route's own** (whatever the render set) rather than the shell's.

`<base href="/">` matters more here than in a single-page build. A prerendered route lives at a real path — `/learn/templates/index.html` — so a browser resolves every *relative* URL on that page against `/learn/templates/`, not the site root. With your `<base>` carried across, `href="favicon.svg"` means the same thing on every page it did on the first one.

## Data

A `resource()` that fetches during a prerender is **awaited before the HTML is written**, and its result travels in the snapshot:

~~~ts
import { resource } from '@weave-framework/data';

export function setup() {
  const posts = resource(() => fetch('https://api.example.com/posts').then((r) => r.json()));
  return { posts };
}
~~~

The prerendered HTML contains the posts. The client resumes with them already present — no spinner on first paint, and no second request for data the build already has.

## What cannot resume

Some things are not serializable, and some are not reachable from a snapshot at all. When Weave meets one it **says so at build time** and client-renders that component instead — the page still works, it just re-runs that subtree's `setup()`. It never fails silently.

Which values, exactly? Rather than a list to trust, here they are going through the **same `serialize`**
the server render uses to write a page's snapshot. Press the button and read the column on the right:

:::demo ssg-wire

:::callout see "What you should see"
Plain data crosses, and so do the things people expect to fail: a `Date` comes back a `Date`, a `Map` a
`Map`, `undefined` and `NaN` survive as themselves — none of which `JSON.stringify` manages — and an
object that points at itself round-trips without hanging.

What does not cross is the live things: a function, a class instance with methods, a DOM node. Not
because they are exotic, but because there is nothing on the other side to rebuild them **from**.

And one row deserves a sentence, because it looks like a contradiction. **A signal object itself does
not cross** — a signal is a function, and the message says so. Yet signals resume perfectly well, because
resume never serializes the signal: it stores the signal's **value** and re-creates the signal around it
on the client. The distinction matters the moment you try to hand something across by hand.

That is the whole rule, and it is worth stating as a question rather than a list: not "is this JSON",
but **"could the client build this again from what arrived"**.
:::

**A value that cannot cross the wire.** A router, a class instance with methods, a live socket. Return those from `setup()` and that component client-renders. Values Weave can rebuild — signals, plain data, anything it can re-derive from module scope — cross fine.

~~~ts
// re-derived on the client: fine
const router = createRouter(routes);
return { router };

// returned inline: nothing to re-derive from — the whole root client-renders
return { router: createRouter(routes) };
~~~

### The other half: what your template does

A value has to survive the wire. A **template** has to survive something else — a walk. Resume does not
rebuild your DOM; it walks the DOM the server already wrote, node by node, and hooks your signals onto
what it finds. That walk needs to know, before it starts, exactly what shape it will meet.

Eleven constructs break that promise, and for each one the compiler refuses **out loud** rather than
adopting the wrong node and leaving you with a page that looks right and does nothing.

| in your template | why resume cannot walk it | what to do instead |
| --- | --- | --- |
| `use:action` | an action is a function, and a function cannot cross the snapshot — after resume there is nothing left to call | import the action at module scope, so the client rebuilds it |
| `use:action` on a `<Component>` | the same, on a component tag | the same |
| `bind:value` (any `bind:`) | two-way means the DOM writes back into a signal the server never saw write | `value={{ name() }}` with `on:input` — one direction each, both adoptable |
| `transition:fade`, `in:fly`, `out:…` | a transition is a lifecycle effect, and the adopt walk does not stage lifecycle | keep transitions below the fold, where a client render costs nothing |
| a non-reactive interpolation `{{ user }}` | text written once carries no marker, so it merges with the static text beside it and the cursor loses count | call it — `{{ user() }}` — or give it its own element |
| `on:click\|capture`, `on:scroll\|passive` | resume dispatches every event through one delegated listener, and those two modifiers cannot be expressed there | drop the modifier, or add that listener yourself in `onMount` |
| `@defer` | its content does not exist yet when the snapshot is written | fine below the fold; that is what `@defer` is for |
| `@await` | the page was written before the promise settled | prerender the data instead — see [Data](#data) above |
| `<w:element this={{ tag }}>` | the tag is decided at run time, so the walk cannot know what it will meet | `@if` over the two or three real tags |
| `@defer` / `@await` in a nested position | reported as **`in a position resume cannot adopt`** — the same limits, seen from the walk instead of the block | as above |
| an `effect()` or `onMount()` in `setup()` reading a local | it reads something `setup()` does not return, so the client has nothing to rebuild it from | return that value (or use it in the template, and let auto-return expose it) |

:::callout trap "Fix one, and a second may appear"
The compiler keeps the **first** cause it meets and stops recording. That is deliberate — once a
component is client-rendered, every later reason is noise — but it means a template with two problems
tells you about one. Rebuild after each fix until the warning is gone.
:::

### What the warning looks like

It arrives as an ordinary build warning, framed at the component's file:

~~~
▲ [WARNING] this component cannot be resumed — its template uses a `fade` transition. The whole subtree
will be client-rendered instead (setup re-runs). Remove or move that construct to make the component
adoptable.

    src/components/notification-panel/notification-panel.html
~~~

Nothing is broken. That panel simply renders the way it would without `--ssg`: its `setup()` runs again in
the browser. Whether that matters depends on the component — a notification panel, no; the article body
the reader came for, very much yes.

## Effects and mount hooks

Resume never calls `setup()`, so nothing written inside it is re-executed. But Weave does not need to re-execute it — the compiler reads `setup()` at build time and knows how to **re-create** what it registered.

An `effect()` in `setup()` is re-created on resume and runs once against the values that came over the wire. That keeps whatever it drives — a document title, a scroll position — consistent with the page you are looking at, and live from then on.

An `onMount()` is re-created too, and fires once the adopted DOM is in place — the same node the server wrote, not a fresh one:

~~~ts
export function setup() {
  const box = signal<Element | null>(null);
  onMount(() => {
    const ro = new ResizeObserver(() => { /* … */ });
    ro.observe(box()!);
    return () => ro.disconnect();
  });
  return { box };
}
~~~

This resumes. The observer attaches to the prerendered element; `setup()` never runs a second time.

The one thing a hook cannot do is see a *build-time* mount, because there is no browser at build time. Anything your hook does is client-side by definition, which is exactly what it was always for.

## The API underneath

You will not call any of this to use `weave build --ssg` — the CLI does. It is documented because a page
that hides its own machinery is a page you cannot debug, and because these are published entry points
somebody eventually needs.

| What | Where | For |
| --- | --- | --- |
| `renderToString`, `renderComponent`, `renderPage` | [`runtime/server`](/reference/runtime-server) | render a component to HTML on Node, with no browser |
| `installServerDom` | [`runtime/server`](/reference/runtime-server) | put Weave's own headless DOM in place before that render |
| `renderDocument`, `PageArtifact`, `DocumentOptions` | [`runtime/document`](/reference/runtime-document) | assemble the finished document — shell, styles, snapshot |
| `serialize`, `deserialize`, `registerSerializableType` | [`runtime/serialize`](/reference/runtime-serialize) | the wire format the demo above exercises |
| `resumePage`, `resumeEvents`, `resumableHandler` | [`runtime/resume`](/reference/runtime-resume) | the client half: adopt the server's DOM instead of rebuilding it |
| `collectResumable`, `handlerAttr` | [`runtime/resume`](/reference/runtime-resume) | what the compiler emits so a handler can be found again |

`registerSerializableType` is the one worth knowing by name: it is how a value that would otherwise be
refused — your own class, a branded id — is taught to cross.

## Where it stands

Per-route splitting, per-component splitting via `lazy()`, prerendering, resume, nested component resume, effects, mount hooks, and data are all in place — gated by a test that builds a real app with the real CLI and resumes it in a real browser.

**Zero JavaScript is reachable, not automatic.** A static subtree inside an eagerly-imported component still ships; `lazy()` is how you draw that line, and you draw it. Splitting below the component — shipping one handler and nothing else — is not built.

## When it goes wrong

Static generation fails in a way ordinary rendering does not: **at build time, on a machine with no
browser**. So the messages tend to arrive in your terminal rather than your console.

:::callout trap "It works in `weave dev` and breaks in `weave build --ssg`"
This is the shape of almost every problem here, and it has one cause: something ran on Node that assumed
a browser. A library that reads `window` when it is imported, a `setup` that measures an element, a
module that touches `localStorage` at the top level.

The fix is the same in each case — move it into `onMount`, which by definition only runs in a browser, or
import it lazily inside one.
:::

**A subtree that quietly client-renders.** This is the one failure here that never shows up on screen.
Weave does not fail silently — it names the component and the reason — but it does *degrade* silently
unless you read the build output. The page looks right; it just re-runs that `setup()`, which is the
thing you were avoiding. The eleven causes are listed under [what cannot resume](#what-cannot-resume);
warnings in an `--ssg` build are not noise around the output, they are part of it.

**A mount selector that is not an `#id`.**

~~~
weave build --ssg: mount selector must be an #id
~~~

The SSG shell has to wrap your app in an element the client can find again by identity. A class or a tag
selector cannot guarantee that, so it is refused rather than guessed at.

**`resumePage: no snapshot <script> found in the document.`** The client tried to resume a page that was
not written by an `--ssg` build — usually a hand-written HTML shell, or a document served from a cache
predating the build.
