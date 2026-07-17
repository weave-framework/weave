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

Each route is its own chunk. A reader downloads the shared client bundle plus **only the route they opened** — not the other 111 pages of your site. On this documentation site that is the difference between 350 KB and about 10 KB, gzipped, for a single page.

Prerendering and code-splitting pull in opposite directions, and Weave resolves it in the build rather than making you choose: the server render is synchronous and cannot wait on a lazily-imported chunk, so it gets static imports, while the browser gets the lazy ones it can actually split on. You write your routes once and both are generated for you.

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

**A lifecycle hook in `setup()`.** `onMount()` registers work for after the DOM lands. Resume never runs `setup()`, and the build never ran the hook either (there is no browser at build time), so the work would simply never happen. Weave refuses to adopt such a component rather than drop its behaviour on the floor.

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

## Effects

An `effect()` in `setup()` *is* re-created on resume, and runs once against the values that came over the wire. That keeps whatever it drives — a document title, a scroll position — consistent with the page you are looking at, and live from then on.

An `onMount()` does not, and cannot: see above.

## Where it stands

Per-route splitting, prerendering, resume, nested component resume, and data are all in place and gated by a test that builds a real app with the real CLI and resumes it in a real browser.

**Per-component splitting is not.** An interactive component still travels in its route's chunk, so a page that is mostly static still pays for the one island on it. Making a static subtree ship literally zero JavaScript is the remaining piece of this work.
