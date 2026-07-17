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

**A value that cannot cross the wire.** A router, a class instance with methods, a live socket. Return those from `setup()` and that component client-renders. Values Weave can rebuild — signals, plain data, anything it can re-derive from module scope — cross fine.

~~~ts
// re-derived on the client: fine
const router = createRouter(routes);
return { router };

// returned inline: nothing to re-derive from — the whole root client-renders
return { router: createRouter(routes) };
~~~

**A `use:` action or a non-reactive interpolation** in the template. The build message names the construct and the file.

Each of these is a warning in your build output, with the component and the reason. Read them: a warning here means a subtree you thought was resumed is quietly being rebuilt.

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

## Where it stands

Per-route splitting, per-component splitting via `lazy()`, prerendering, resume, nested component resume, effects, mount hooks, and data are all in place — gated by a test that builds a real app with the real CLI and resumes it in a real browser.

**Zero JavaScript is reachable, not automatic.** A static subtree inside an eagerly-imported component still ships; `lazy()` is how you draw that line, and you draw it. Splitting below the component — shipping one handler and nothing else — is not built.
