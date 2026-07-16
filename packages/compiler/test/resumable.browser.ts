import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { resumeEvents, collectResumable, resumableHandler, handlerAttr, type ResumeHandler } from '@weave-framework/runtime/resume';
import { bindTextResumable, adoptText, blockStart, adoptIsland, blockEndOf, clearBlock, after, adoptComponent } from '@weave-framework/runtime/adopt';
import { snapshot, resume, resumePage, SNAPSHOT_ID, collectStates, registerState, ROOT_ID, type AdoptFn } from '@weave-framework/runtime/graph';
import { compileTemplate } from '@weave-framework/compiler';

/**
 * E0.2b — the compiler's `resumable` target. DOM event handlers compile to `resumableHandler(...)` refs
 * (from `@weave-framework/runtime/resume`) instead of an eager `listen(...)`; the server-rendered HTML
 * carries `data-won-<event>` markers and a delegated {@link resumeEvents} dispatches them on first
 * interaction (see RFC 0009). These tests pin the emit shape, prove eager stays byte-for-byte, and drive
 * a real resumed click end-to-end (including per-row handlers in a `@for`).
 */

// The runtime object the compiled (function-mode) code references as `rt` — dom + core + resume helper.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
  resumableHandler: typeof resumableHandler;
  bindTextResumable: typeof bindTextResumable;
  adoptText: typeof adoptText;
  blockStart: typeof blockStart;
  adoptIsland: typeof adoptIsland;
  blockEndOf: typeof blockEndOf;
  clearBlock: typeof clearBlock;
  after: typeof after;
  adoptComponent: typeof adoptComponent;
  registerState: typeof registerState;
} = { ...dom, signal, computed, effect, root, resumableHandler, bindTextResumable, adoptText, blockStart, adoptIsland, blockEndOf, clearBlock, after, adoptComponent, registerState };

/** Compile in the `resumable` target and hand back the bare `(ctx, slots) => Node` render fn. */
function compileResumable(html: string, scope: string[] = []): (ctx: unknown, slots?: unknown) => Element {
  const { code } = compileTemplate(html, { mode: 'function', scope, resumable: true });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {}) as (ctx: unknown, slots?: unknown) => Element;
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * Render the way the SERVER does — inside a collecting session, exactly as `renderPage` runs it. That is what
 * makes each `on:` site stamp its `data-won-*` marker for the client to resume; the same render WITHOUT a
 * session is a live client render and wires real listeners instead (a CSR fallback, a route swap, a late
 * `@for` row). The captured handler map is discarded here — the client rebuilds handlers from the factory.
 */
function serverRender<T>(fn: () => T): T {
  return collectResumable(fn).node;
}

/* ──────────── emit shape ──────────── */

test('resumable module emits a handler ref + imports from runtime/resume, not listen', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>{{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
    resumable: true,
  });
  assert.ok(code.includes('from "@weave-framework/runtime/resume"'), 'imports the resume entry');
  assert.ok(code.includes('resumableHandler('), 'emits a resumable handler ref');
  assert.ok(code.includes('"click"') && code.includes('"w0"'), 'passes the event + a stable site ref');
  assert.ok(!code.includes('listen('), 'no eager listener in the resumable target');
  // Reactive text isolates via bindTextResumable (adopt marker) in this target, imported from runtime/adopt.
  assert.ok(code.includes('bindTextResumable('), 'reactive text uses the marker-isolating bind');
  assert.ok(code.includes('from "@weave-framework/runtime/adopt"'), 'imports the adopt entry');
  assert.ok(!/\bbindText\(/.test(code), 'no plain eager bindText in the resumable target');
});

test('eager (default) target is unchanged — listen(), plain bindText, no resume/adopt import', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>{{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
  });
  assert.ok(code.includes('listen('), 'still wires an eager listener');
  assert.ok(code.includes('bindText('), 'plain bindText (byte-for-byte eager)');
  assert.ok(!code.includes('resumableHandler('), 'no resumable ref');
  assert.ok(!code.includes('bindTextResumable('), 'no adopt marker bind');
  assert.ok(!code.includes('runtime/resume') && !code.includes('runtime/adopt'), 'never imports resume/adopt');
});

test('each event site gets a distinct stable ref (w0, w1, …)', () => {
  const { code } = compileTemplate('<div><button on:click={{a}}>a</button><button on:input={{b}}>b</button></div>', {
    mode: 'module',
    scope: ['a', 'b'],
    resumable: true,
  });
  assert.ok(code.includes('"w0"') && code.includes('"w1"'), 'two sites → two refs');
});

test('resumable render isolates reactive text with a $ marker (adopt-ready)', () => {
  const x: Signal<string> = signal('world');
  const render = compileResumable('<p>Hello, {{ x() }}!</p>', ['x']);
  const p: HTMLElement = render({ x }) as HTMLElement;
  assert.equal(p.textContent, 'Hello, world!', 'renders the value inline');
  const marker: ChildNode | undefined = [...p.childNodes].find((n) => n.nodeType === 8 && (n as Comment).data === '$');
  assert.ok(marker, 'a $ marker isolates the dynamic text so adjacent static text cannot merge with it');
  assert.equal((marker!.nextSibling as Text).data, 'world', 'the dynamic text is the node right after the marker');
  x.set('there');
  assert.equal(p.textContent, 'Hello, there!', 'updates reactively');
});

/* ──────────── behaviour: a resumed click ──────────── */

test('resumable: a resumed click invokes the right handler (no eager listener)', () => {
  const count: Signal<number> = signal(0);
  const inc = (): number => count.set((c) => c + 1);
  const render = compileResumable('<button on:click={{inc}}>x</button>', ['count', 'inc']);

  const { node, handlers } = collectResumable(() => render({ count, inc }));
  const btn: HTMLButtonElement = node as HTMLButtonElement;
  const container: HTMLElement = host();
  container.appendChild(btn);

  // the element carries the marker, and NO live listener was attached at render time
  assert.ok(btn.getAttribute(handlerAttr('click'))!.startsWith('w0#'), 'stamped data-won-click marker');
  btn.click();
  assert.equal(count(), 0, 'a bare click does nothing before resume (handler was not wired eagerly)');

  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  btn.click();
  btn.click();
  assert.equal(count(), 2, 'after resume, the delegated dispatch invokes the handler');
  ctl.dispose();
});

test('resumable: preventDefault modifier still applies through the handler body', () => {
  let ran: boolean = false;
  const onSubmit = (): boolean => (ran = true);
  const render = compileResumable('<button on:click|preventDefault={{onSubmit}}>go</button>', ['onSubmit']);
  const { node, handlers } = collectResumable(() => render({ onSubmit }));
  const container: HTMLElement = host();
  container.appendChild(node);
  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  const ev: MouseEvent = new MouseEvent('click', { cancelable: true, bubbles: true });
  node.dispatchEvent(ev);
  assert.ok(ran, 'handler ran via resume');
  assert.ok(ev.defaultPrevented, 'preventDefault modifier honoured in the resumable target');
  ctl.dispose();
});

test('resumable: each @for row registers its OWN handler (instance-unique refs)', () => {
  const items: Signal<number[]> = signal([10, 20, 30]);
  const picked: Signal<number> = signal(0);
  const render = compileResumable(
    '<ul>@for (n of items(); track n) { <li><button on:click={{() => picked.set(n)}}>{{ n }}</button></li> }</ul>',
    ['items', 'picked']
  );
  const { node, handlers } = collectResumable(() => render({ items, picked }));
  const container: HTMLElement = host();
  container.appendChild(node);

  const buttons: HTMLButtonElement[] = [...node.querySelectorAll('button')] as HTMLButtonElement[];
  assert.equal(buttons.length, 3, 'three rows rendered');
  // three DISTINCT ids captured (not one shared ref overwriting)
  const ids: string[] = buttons.map((b) => b.getAttribute(handlerAttr('click'))!);
  assert.equal(new Set(ids).size, 3, 'each row got a distinct data-won-click id');
  assert.equal(handlers.size, 3, 'three handlers registered');

  const ctl = resumeEvents(container, { resolve: (id) => handlers.get(id) });
  buttons[1].click();
  assert.equal(picked(), 20, 'clicking the second row invoked THAT row’s handler, not a shared one');
  buttons[2].click();
  assert.equal(picked(), 30, 'third row too');
  ctl.dispose();
});

/* ──────────── E1.1: the emitted handlers(ctx) factory ──────────── */

test('E1.1: resumable module emits a handlers(ctx) factory, attaches + exports it', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>{{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
    resumable: true,
  });
  assert.ok(code.includes('function handlers(ctx, props)'), 'emits a handlers factory (props is its E1.20 second parameter)');
  assert.ok(code.includes('render.handlers = handlers'), 'attaches the factory to render');
  assert.ok(code.includes('export { handlers }'), 'names it as an export');
  assert.ok(code.includes('export default render'), 'default export stays render');
});

test('E1.1: a block-local (@for row) handler is NOT hoisted into the root factory', () => {
  const { code } = compileTemplate(
    '<div><button on:click={{root}}>r</button><ul>@for (n of items(); track n) { <li><button on:click={{() => pick.set(n)}}>{{ n }}</button></li> }</ul></div>',
    { mode: 'module', scope: ['root', 'items', 'pick'], resumable: true }
  );
  // exactly ONE entry in the factory (the root button); the row handler stays in-render only
  const body: string = code.slice(code.indexOf('function handlers(ctx, props)'));
  const entries: number = (body.slice(0, body.indexOf('}')).match(/"w\d+":/g) ?? []).length;
  assert.equal(entries, 1, 'only the root-fragment handler is in the factory (row handler excluded)');
});

test('E1.1: resume() drives the EMITTED factory end-to-end — no hand-authored handlers', () => {
  // an INLINE handler that touches a signal (which IS in the snapshot); a named setup fn would need a
  // lazily-imported chunk (deferred), but a signal-touching handler resumes from the graph alone.
  const render = compileResumable('<button on:click={{() => count.set((c) => c + 1)}}>x</button>', ['count']);
  assert.equal(typeof (render as { handlers?: unknown }).handlers, 'function', 'render carries the emitted factory');

  // ── server ── render (stamps the marker) + snapshot the reactive state
  const count: Signal<number> = signal(3);
  const node = serverRender(() => render({ count })) as HTMLButtonElement;
  const container: HTMLElement = host();
  container.appendChild(node);
  assert.ok(node.getAttribute(handlerAttr('click'))!.startsWith('w0#'), 'server HTML carries the marker');
  const wire = snapshot({ count });

  // ── client ── resume with the EMITTED factory (render.handlers), never hand-authored
  const app = resume(container, { snapshot: wire, handlers: (render as { handlers: (c: Record<string, unknown>) => Record<string, ResumeHandler> }).handlers });
  assert.equal((app.ctx.count as Signal<number>)(), 3, 'resumed signal carries the server value');

  const out: HTMLSpanElement = document.createElement('span');
  container.appendChild(out);
  effect(() => { out.textContent = String((app.ctx.count as Signal<number>)()); });

  node.click();
  assert.equal((app.ctx.count as Signal<number>)(), 4, 'the EMITTED handler mutated the resumed signal');
  assert.equal(out.textContent, '4', 'reactivity flows — no hand-authored factory, setup never re-run');
  app.dispose();
});

test('E1.2: resumePage reads the embedded snapshot <script> and resumes (SSG client entry)', () => {
  // server: render the resumable component + embed the state snapshot exactly as renderPage would
  const render = compileResumable('<button on:click={{() => count.set((c) => c + 1)}}>x</button>', ['count']);
  const count: Signal<number> = signal(10);
  const container: HTMLElement = host();
  container.appendChild(serverRender(() => render({ count })) as Node);
  const script: HTMLScriptElement = document.createElement('script');
  script.type = 'application/weave';
  script.id = SNAPSHOT_ID;
  script.textContent = JSON.stringify(snapshot({ count }));
  document.body.appendChild(script);

  // client: resumePage finds the snapshot by id, deserializes, and wires the emitted factory — no hand-authoring
  const app = resumePage({
    root: container,
    handlers: (render as { handlers: (c: Record<string, unknown>) => Record<string, ResumeHandler> }).handlers,
  });
  assert.equal((app.ctx.count as Signal<number>)(), 10, 'resumePage rebuilt the state from the embedded snapshot');

  (container.querySelector('button') as HTMLButtonElement).click();
  assert.equal((app.ctx.count as Signal<number>)(), 11, 'a click resumed the lazy handler against the rebuilt graph');

  app.dispose();
  script.remove();
});

test('E1.2: resumePage throws loudly when the snapshot script is missing', () => {
  let threw: boolean = false;
  try {
    resumePage({ root: host(), handlers: () => ({}) });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'a missing snapshot <script> is a loud error, not a silent no-op');
});

/* ──────────── E1.2b-2: the adopt-mode render (re-attach in place, no re-render) ──────────── */

test('E1.2b-2: a flat resumable module emits + exports an adopt(_r,…) fn — adoptText, shifted index, no events', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>Count: {{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
    resumable: true,
  });
  assert.ok(code.includes('function adopt(_r'), 'emits an adopt(_r, …) fn taking the server root');
  assert.ok(code.includes('render.adopt = adopt'), 'attaches it to render');
  assert.ok(code.includes('export { adopt }'), 'exports it');
  assert.ok(code.includes('adoptText('), 'adopt re-binds reactive text via adoptText');
  assert.ok(code.includes('from "@weave-framework/runtime/adopt"'), 'imports the adopt entry');
  // The reactive-text anchor is pristine child 1 (after "Count: "); its own marker+text push it to server
  // index 3, and adopt navigates that shifted position — NOT the pristine 1 the create render clones to.
  const adoptBody: string = code.slice(code.indexOf('function adopt(_r'));
  assert.ok(/child\(_r, 3\)/.test(adoptBody), 'navigates the SHIFTED server index (pristine 1 + marker/text)');
  assert.ok(!adoptBody.slice(0, adoptBody.indexOf('render.adopt')).includes('resumableHandler'),
    'adopt skips events — resume() re-arms them via the data-won markers (delegated dispatch)');
});

test('E1.2b-2: adopt indices compound — each preceding dynamic text shifts a sibling by 2, across nesting', () => {
  // <p>{{a}}{{b}}</p>: a at pristine 0 → server 2 (own marker+text); b at pristine 1 → server 5 (a's 2 + own 2).
  const flat = compileTemplate('<p>{{ a() }}{{ b() }}</p>', { mode: 'module', scope: ['a', 'b'], resumable: true });
  const flatAdopt: string = flat.code.slice(flat.code.indexOf('function adopt(_r'));
  assert.ok(/child\(_r, 2\)/.test(flatAdopt), 'first dynamic text → server index 2 (its own marker+text)');
  assert.ok(/child\(_r, 5\)/.test(flatAdopt), 'second dynamic text → server index 5 (preceding 2 + its own 2)');

  // <div>{{a}}<p>{{b}}</p></div>: a → server 2; the <p> is shifted to server 3 by a's marker+text, and b
  // inside <p> is at server 2 — so b's node is child(_r, 3, 2). Proves the shift applies per-level.
  const nested = compileTemplate('<div>{{ a() }}<p>{{ b() }}</p></div>', { mode: 'module', scope: ['a', 'b'], resumable: true });
  const nestedAdopt: string = nested.code.slice(nested.code.indexOf('function adopt(_r'));
  assert.ok(/child\(_r, 2\)/.test(nestedAdopt), 'the div-level dynamic text is at server index 2');
  assert.ok(/child\(_r, 3, 2\)/.test(nestedAdopt), 'the <p> shifted to 3 by the preceding text; its inner text at 2');
});

test('E1.2b-2: a resumable fragment with a not-yet-adoptable construct emits NO adopt fn — falls back to CSR', () => {
  // (this pinned `<slot>` until E1.17 made it island-replay; a `use:` action is still genuinely un-navigable)
  const { code } = compileTemplate('<div><b use:tooltip>x</b></div>', {
    mode: 'module',
    scope: ['tooltip'],
    resumable: true,
  });
  assert.ok(!code.includes('render.adopt'), 'a `use:` action is not adopt-navigable yet (falls back to CSR)');
});

/* ──────────── E1.2c: block-boundary markers (cursor-walk foundation) ──────────── */

test('E1.2c: the resumable render brackets a block with [ … ] markers (adopt-ready), block stays reactive', () => {
  const show: Signal<boolean> = signal(true);
  const render = compileResumable('<div>@if (show()) { <i>hi</i> }</div>', ['show']);
  const div: HTMLElement = render({ show }) as HTMLElement;
  const i: HTMLElement = div.querySelector('i')!;
  assert.equal((i.previousSibling as Comment).data, '[', 'a [ boundary marker sits right before the branch content');
  assert.equal((i.nextSibling as Comment).data, ']', 'the block end anchor carries the ] data (right after the content)');
  // eager stays byte-for-byte — a plain <!----> anchor, no [ marker
  const eager = compileTemplate('<div>@if (show()) { <i>hi</i> }</div>', { mode: 'module', scope: ['show'] });
  assert.ok(!eager.code.includes('blockStart') && !eager.code.includes(']'), 'eager target keeps a plain anchor, no brackets');
  // the block is still live — toggling removes the branch (brackets are inert to the reactive machinery)
  show.set(false);
  assert.ok(!div.querySelector('i'), 'the @if still reacts (the [ / ] markers do not disturb ifBlock)');
  show.set(true);
  assert.ok(div.querySelector('i'), 're-renders on toggle back');
});

test('E1.2c: the resumable module emits blockStart + a ] anchor; imports it from runtime/adopt', () => {
  const { code } = compileTemplate('<ul>@for (n of items(); track n) { <li>{{ n }}</li> }</ul>', {
    mode: 'module',
    scope: ['items'],
    resumable: true,
  });
  assert.ok(code.includes('blockStart('), 'brackets the @for block with a runtime blockStart');
  assert.ok(code.includes('from "@weave-framework/runtime/adopt"'), 'imports blockStart from the adopt entry');
  assert.ok(/template\("[^"]*<!--\]-->/.test(code), 'the block end anchor is emitted as a ] comment in the template');
});

/* ──────────── E1.2c-2: @if island-replay adopt ──────────── */

test('E1.2c-2: an adoptable @if emits an adopt fn (adoptIsland + ifBlock); non-adoptable positions do not', () => {
  // @if as the last indexed thing at its level → adoptable (island-replay)
  const ok = compileTemplate('<div><h1>{{ t() }}</h1>@if (show()) { <p>{{ b() }}</p> }</div>', {
    mode: 'module', scope: ['t', 'show', 'b'], resumable: true,
  });
  assert.ok(ok.code.includes('render.adopt'), 'an adoptably-positioned @if emits an adopt fn');
  const adoptBody: string = ok.code.slice(ok.code.indexOf('function adopt(_r'));
  assert.ok(adoptBody.includes('blockEndOf(') && adoptBody.includes('clearBlock('), 'the adopt render clears the server island in place');
  assert.ok(adoptBody.includes('ifBlock('), 'then re-runs the normal ifBlock against the cleared island');

  // An element with a NESTED BLOCK after a block adopts since E1.23: it is found via the E1.2c-5 cursor, and
  // the block INSIDE it sits at a fixed index at its own level. (This asserted the opposite until then.)
  const afterEl = compileTemplate('<div>@if (show()) { <p>x</p> }<section>@if (more()) { <i>y</i> }</section></div>', {
    mode: 'module', scope: ['show', 'more'], resumable: true,
  });
  assert.ok(afterEl.code.includes('render.adopt'), 'an element with a nested block after a block adopts (E1.23)');

  // A `use:` whose action is a SETUP binding cannot be rebuilt on a resume (a function never crosses the
  // snapshot) → still CSR fallback. An out-of-scope action is a module ref, which E1.21/E1.22 adopt.
  const useComp = compileTemplate('<div><Widget use:tip /></div>', {
    mode: 'module', scope: ['tip'], resumable: true,
  });
  assert.ok(!useComp.code.includes('render.adopt'), 'a ctx `use:` action stays CSR fallback — nothing rebuilds it');
});

test('E1.2c-2: adopt replays an @if island — statics adopt in place, the block re-renders REACTIVELY', () => {
  const render = compileResumable('<div><h1>{{ title() }}</h1>@if (show()) { <p>{{ body() }}</p> }</div>', ['title', 'show', 'body']);
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  const handlers = (render as { handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler> }).handlers;
  assert.equal(typeof adopt, 'function', 'the @if fragment carries an adopt fn');

  // ── server ── render (resumable: markers + [ … ] brackets) with the branch shown, then snapshot
  const title: Signal<string> = signal('Hi');
  const show: Signal<boolean> = signal(true);
  const body: Signal<string> = signal('shown');
  const serverNode = render({ title, show, body }) as HTMLElement;
  const wire = snapshot({ title, show, body });
  const serverHtml: string = serverNode.outerHTML;
  assert.ok(serverHtml.includes('shown') && serverHtml.includes('<!--[-->'), 'server rendered the live branch inside [ … ]');

  // ── client ── fresh parse (dead DOM), then resume with the emitted adopt + handlers
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const div: HTMLElement = container.querySelector('div')!;
  const app = resume(div, {
    snapshot: wire,
    handlers: handlers as (c: Record<string, unknown>) => Record<string, ResumeHandler>,
    adopt,
  });

  // the <h1> static/text ADOPTED in place (not re-created) — and reactive against the resumed signal
  assert.equal(div.querySelector('h1')!.textContent, 'Hi', 'h1 text present after adopt');
  (app.ctx.title as Signal<string>).set('Hello');
  assert.equal(div.querySelector('h1')!.textContent, 'Hello', 'h1 text adopted in place — updates from the resumed graph');

  // the @if island REPLAYED — its branch is now a fresh, fully reactive render
  assert.equal(div.querySelector('p')!.textContent, 'shown', 'the branch body rendered');
  (app.ctx.body as Signal<string>).set('changed');
  assert.equal(div.querySelector('p')!.textContent, 'changed', 'the replayed island is reactive (body updates)');
  (app.ctx.show as Signal<boolean>).set(false);
  assert.ok(!div.querySelector('p'), 'the @if toggles OFF after resume');
  (app.ctx.show as Signal<boolean>).set(true);
  assert.ok(div.querySelector('p'), 'and back ON — full control-flow reactivity resumed');
  app.dispose();
});

/* ──────────── E1.2c-3: @for island-replay adopt ──────────── */

test('E1.2c-3: adopt replays a @for island — the heading adopts in place, the list re-renders REACTIVELY', () => {
  const render = compileResumable(
    '<div><h2>{{ title() }}</h2><ul>@for (n of items(); track n) { <li>{{ n }}</li> }</ul></div>',
    ['title', 'items']
  );
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'a fragment whose last indexed thing is a @for emits an adopt fn');

  // ── server ── render the list + snapshot
  const title: Signal<string> = signal('Nums');
  const items: Signal<number[]> = signal([1, 2, 3]);
  const serverNode = render({ title, items }) as HTMLElement;
  const wire = snapshot({ title, items });
  const serverHtml: string = serverNode.outerHTML;
  assert.ok(/<li[^>]*>1<\/li>/.test(serverHtml.replace(/<!--[^>]*-->/g, '')), 'server rendered the rows');

  // ── client ── fresh parse + resume (no handlers factory — the list has no events)
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const div: HTMLElement = container.querySelector('div')!;
  const app = resume(div, { snapshot: wire, adopt });

  // heading adopted in place + reactive
  assert.equal(div.querySelector('h2')!.textContent, 'Nums', 'the <h2> text is present after adopt');
  (app.ctx.title as Signal<string>).set('Numbers');
  assert.equal(div.querySelector('h2')!.textContent, 'Numbers', '<h2> adopted in place — updates from the resumed graph');

  // the @for island replayed — rows are live + keyed-reactive
  const rowText = (): string[] => [...div.querySelectorAll('li')].map((li) => li.textContent!);
  assert.deepEqual(rowText(), ['1', '2', '3'], 'the rows rendered after replay');
  (app.ctx.items as Signal<number[]>).set([1, 2, 3, 4]);
  assert.deepEqual(rowText(), ['1', '2', '3', '4'], 'appending an item adds a row — the replayed @for is reactive');
  (app.ctx.items as Signal<number[]>).set([9, 1]);
  assert.deepEqual(rowText(), ['9', '1'], 'replacing the list reconciles rows — full @for reactivity resumed');
  app.dispose();
});

/* ──────────── E1.2c-4: post-block cursor (a bound node AFTER a block) ──────────── */

test('E1.2c-4: a reactive interp AFTER a block adopts via the cursor — emit shape', () => {
  const { code } = compileTemplate('<div>@if (show()) { <p>x</p> }{{ tail() }}</div>', {
    mode: 'module', scope: ['show', 'tail'], resumable: true,
  });
  assert.ok(code.includes('render.adopt'), 'a leaf interp after a block is now adoptable');
  const adoptBody: string = code.slice(code.indexOf('function adopt(_r'));
  assert.ok(/after\(_e\d+, 3\)/.test(adoptBody), 'the trailing interp binds via after(<blockEnd>, 3) — 3 = its $ + text + anchor');
  assert.ok(/blockEndOf\(/.test(adoptBody) && /_e\d+ = /.test(adoptBody), 'the block captures its ] end anchor as the cursor base');
});

test('E1.2c-4: adopt resumes a block PLUS a trailing interp — the tail after the block updates in place', () => {
  const render = compileResumable(
    '<div><h4>{{ head() }}</h4>@if (show()) { <p>body</p> }{{ tail() }}</div>',
    ['head', 'show', 'tail']
  );
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'the fragment (pre-block text + block + post-block interp) is adoptable');

  // ── server ──
  const head: Signal<string> = signal('H');
  const show: Signal<boolean> = signal(true);
  const tail: Signal<string> = signal('T');
  const serverNode = render({ head, show, tail }) as HTMLElement;
  const wire = snapshot({ head, show, tail });
  const serverHtml: string = serverNode.outerHTML;
  assert.ok(serverHtml.includes('body') && serverHtml.replace(/<!--[^>]*-->/g, '').includes('T'), 'server rendered branch + tail');

  // ── client ──
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const div: HTMLElement = container.querySelector('div')!;
  // the tail interp is the last child (its <!----> anchor); the text sits right before it (after its $ marker)
  const tailAnchor: Comment = div.lastChild as Comment;
  const tailNode: Text = tailAnchor.previousSibling as Text;
  assert.equal(tailNode.data, 'T', 'the post-block tail text was found via the cursor (server value)');

  const app = resume(div, { snapshot: wire, adopt });
  assert.equal(div.querySelector('h4')!.textContent, 'H', 'pre-block <h4> adopted');

  // the tail (reached by after(], 3)) is reactive in place — the SAME node, re-bound
  (app.ctx.tail as Signal<string>).set('TAIL');
  assert.equal(tailNode.data, 'TAIL', 'the post-block interp updates the EXISTING node in place — cursor bound the right one');

  // and the block between them still island-replays reactively
  (app.ctx.show as Signal<boolean>).set(false);
  assert.ok(!div.querySelector('p'), 'the @if between the two texts toggles off');
  assert.equal(tailNode.data, 'TAIL', 'toggling the block does NOT disturb the post-block tail (] is stable)');
  (app.ctx.show as Signal<boolean>).set(true);
  assert.ok(div.querySelector('p'), 'block back on');
  (app.ctx.head as Signal<string>).set('HEAD');
  assert.equal(div.querySelector('h4')!.textContent, 'HEAD', 'the pre-block text is reactive too');
  app.dispose();
});

/* ──────────── E1.2c-5: post-block element (a block-free element after a block) ──────────── */

test('E1.2c-5: an element with dynamics AFTER a block adopts — its subtree rebases onto a cursor var', () => {
  const { code } = compileTemplate('<div>@if (show()) { <p>x</p> }<footer>© {{ year() }}</footer></div>', {
    mode: 'module', scope: ['show', 'year'], resumable: true,
  });
  assert.ok(code.includes('render.adopt'), 'a block-free element after a block is adoptable');
  const adoptBody: string = code.slice(code.indexOf('function adopt(_r'));
  assert.ok(/_p\d+ = after\(_e\d+, 1\)/.test(adoptBody), 'the <footer> is captured via after(<blockEnd>, 1) as a cursor var');
  assert.ok(/child\(_p\d+/.test(adoptBody), 'its <footer> subtree navigation rebases onto that cursor var');
});

test('E1.2c-5: adopt resumes a block PLUS a trailing element subtree — the element text is reactive in place', () => {
  const render = compileResumable(
    '<div><h5>{{ head() }}</h5>@if (show()) { <p>body</p> }<footer>© {{ year() }} <b>{{ org() }}</b></footer></div>',
    ['head', 'show', 'year', 'org']
  );
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'the fragment (block + trailing element subtree) is adoptable');

  // ── server ──
  const head: Signal<string> = signal('H');
  const show: Signal<boolean> = signal(true);
  const year: Signal<number> = signal(2026);
  const org: Signal<string> = signal('Weave');
  const serverNode = render({ head, show, year, org }) as HTMLElement;
  const wire = snapshot({ head, show, year, org });

  // ── client ──
  const container: HTMLElement = host();
  container.innerHTML = serverNode.outerHTML;
  const div: HTMLElement = container.querySelector('div')!;
  const footer: HTMLElement = div.querySelector('footer')!;
  const bold: HTMLElement = footer.querySelector('b')!;
  const app = resume(div, { snapshot: wire, adopt });

  assert.ok(footer.textContent!.includes('2026') && footer.textContent!.includes('Weave'), 'the post-block <footer> subtree is present');

  // both dynamic texts inside the post-block element are reactive in place
  (app.ctx.year as Signal<number>).set(2027);
  assert.ok(footer.textContent!.includes('2027'), 'the year interp inside the post-block <footer> updates');
  (app.ctx.org as Signal<string>).set('WeaveFW');
  assert.equal(bold.textContent, 'WeaveFW', 'a nested interp deeper in the post-block subtree updates too');

  // the block between the header and the footer still island-replays
  (app.ctx.show as Signal<boolean>).set(false);
  assert.ok(!div.querySelector('p'), 'the @if between them toggles off');
  assert.ok(footer.textContent!.includes('2027'), 'toggling the block does not disturb the post-block element');
  (app.ctx.head as Signal<string>).set('HEAD');
  assert.equal(div.querySelector('h5')!.textContent, 'HEAD', 'the pre-block header stays reactive');
  app.dispose();
});

/* ──────────── E1.2c-6a: multi-root fragments ──────────── */

test('E1.2c-6a: a multi-root fragment is adoptable (was single-root only); a `use:` fragment still is not', () => {
  const multi = compileTemplate('<span>{{ a() }}</span><b>{{ c() }}</b>', {
    mode: 'module', scope: ['a', 'c'], resumable: true,
  });
  assert.ok(multi.code.includes('render.adopt'), 'two element roots now emit an adopt fn');

  // (`<slot>` stood here until E1.17; it island-replays now, so the opt-out is pinned on a real one)
  const used = compileTemplate('<div><b use:tooltip>x</b></div>', { mode: 'module', scope: ['tooltip'], resumable: true });
  assert.ok(!used.code.includes('render.adopt'), 'a `use:` action opts out (not adopt-navigable yet)');
});

test('E1.2c-6a: adopt resumes a MULTI-ROOT fragment in place against the mount container', () => {
  // two sibling roots + a bare text-interp root — the top level is the mount container, not one element
  const render = compileResumable('<span>{{ a() }}</span> <b>{{ c() }}</b>', ['a', 'c']);
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'the multi-root fragment carries an adopt fn');

  // ── server ── render the fragment into a container, snapshot
  const a: Signal<string> = signal('A');
  const c: Signal<number> = signal(1);
  const mount: HTMLElement = host();
  mount.appendChild(render({ a, c })); // a DocumentFragment of [<span>, ' ', <b>]
  const wire = snapshot({ a, c });
  const serverHtml: string = mount.innerHTML;
  assert.ok(serverHtml.includes('A') && serverHtml.includes('<b'), 'server rendered both roots');

  // ── client ── fresh parse into a container; resume against the CONTAINER (it holds the roots)
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const app = resume(container, { snapshot: wire, adopt });

  const span: HTMLElement = container.querySelector('span')!;
  const bold: HTMLElement = container.querySelector('b')!;
  assert.equal(span.textContent, 'A', 'first root adopted');
  assert.equal(bold.textContent, '1', 'second root adopted');

  (app.ctx.a as Signal<string>).set('AA');
  assert.equal(span.textContent, 'AA', 'the first root is reactive in place');
  (app.ctx.c as Signal<number>).set(2);
  assert.equal(bold.textContent, '2', 'the second root is reactive in place — both roots resumed');
  app.dispose();
});

/* ──────────── E1.2c-6: component (nested) resume ──────────── */

test('E1.2c-6: adopt resumes a static CHILD component in place — child setup never re-runs, both reactive', () => {
  // compile the child (resumable) and wrap it as a real component (as the loader/component.ts would)
  const childCode: string = compileTemplate('<b>{{ label() }}</b>', { mode: 'function', scope: ['label'], resumable: true }).code;
  const childRender = new Function('rt', '_c', childCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as ((ctx: unknown, slots?: unknown) => Node) & { adopt?: AdoptFn };
  let childSetups: number = 0;
  const Child = dom.defineComponent(
    childRender as never,
    (props: Record<string, unknown>) => { childSetups++; return { label: signal((props.start as string) ?? 'x') }; }
  ) as dom.Component & { adopt?: AdoptFn };
  Child.adopt = childRender.adopt; // component.ts attaches render.adopt to the component in the resumable target

  // compile the parent, referencing Child via _c
  const parentCode: string = compileTemplate('<div><h1>{{ title() }}</h1><Child /></div>', { mode: 'function', scope: ['title'], resumable: true }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Child }) as ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };
  assert.equal(typeof parentRender.adopt, 'function', 'the parent (with a static child component) is adoptable');

  // ── server ── render + collect the child ctx; snapshot the whole { $root, c0 } map
  const title: Signal<string> = signal('T');
  const box: HTMLElement = host();
  const states = collectStates(() => { box.appendChild(parentRender({ title }, {})); });
  assert.ok(states.c0, 'the static child self-registered its ctx under c0 (via the $wid preamble)');
  assert.equal(childSetups, 1, 'child setup ran once on the server');
  states[ROOT_ID] = { title };
  const wire = snapshot(states);
  const serverHtml: string = (box.firstElementChild as HTMLElement).outerHTML;

  // ── client ── fresh parse + resume
  const client: HTMLElement = host();
  client.innerHTML = serverHtml;
  const div: HTMLElement = client.querySelector('div')!;
  const app = resume(div, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(childSetups, 1, 'RESUME did NOT re-run the child setup — resumed, not re-rendered');

  // parent text adopted + reactive
  assert.equal(div.querySelector('h1')!.textContent, 'T', 'parent <h1> adopted');
  (app.ctx.title as Signal<string>).set('TITLE');
  assert.equal(div.querySelector('h1')!.textContent, 'TITLE', 'parent text reactive in place');

  // child adopted in place + reactive via its resumed ctx in the states map
  assert.equal(div.querySelector('b')!.textContent, 'x', 'child <b> adopted with its server value');
  (app.states.c0 as { label: Signal<string> }).label.set('LBL');
  assert.equal(div.querySelector('b')!.textContent, 'LBL', 'the resumed CHILD component is reactive in place — nested resume works');
  app.dispose();
});

/* ──────────── E1.24: @key, @render, @snippet ──────────── */

test('E1.24: a `@snippet` after a block does not block adopt — it consumes no DOM position at all', () => {
  // A `@snippet` is a DECLARATION: it compiles to a function and emits no node, so it cannot shift any index.
  // The refusal ("not cursor-handled") had nothing to handle.
  const { code } = compileTemplate(
    '<div>@if (a()) { <i>x</i> }@snippet row(v) { <b>{{ v }}</b> }@render (row(n()))</div>',
    { mode: 'module', scope: ['a', 'n'], resumable: true },
  );
  assert.ok(code.includes('render.adopt'), 'a @snippet + @render after a block is adoptable');
});

test('E1.24: `@key` and `@render` island-replay on adopt — the statics around them stay put', () => {
  const render = compileResumable(
    '<div><h1>{{ t() }}</h1>@key (k()) { <i>K{{ n() }}</i> }</div>',
    ['t', 'k', 'n'],
  );
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'an @key block is adoptable (it replays like @if)');

  const t: Signal<string> = signal('T');
  const k: Signal<number> = signal(1);
  const n: Signal<number> = signal(5);
  const serverNode = serverRender(() => render({ t, k, n })) as HTMLElement;
  const wire = snapshot({ t, k, n });
  assert.equal(serverNode.querySelector('i')!.textContent, 'K5', 'server rendered the keyed block');

  const container: HTMLElement = host();
  container.innerHTML = serverNode.outerHTML;
  const div: HTMLElement = container.querySelector('div')!;
  const h1: HTMLElement = div.querySelector('h1')!;
  const app = resume(div, { snapshot: wire, adopt });

  assert.is(div.querySelector('h1'), h1, 'the heading before it was ADOPTED, not re-created');
  assert.equal(h1.textContent, 'T', 'with its server value');
  assert.equal(div.querySelectorAll('i').length, 1, 'the keyed block replayed once — no duplicate');

  (app.ctx.n as Signal<number>).set(9);
  assert.equal(div.querySelector('i')!.textContent, 'K9', 'the block is reactive after resume');
  (app.ctx.t as Signal<string>).set('T2');
  assert.equal(h1.textContent, 'T2', 'and the adopted heading is still bound in place');
  (app.ctx.k as Signal<number>).set(2);
  assert.equal(div.querySelectorAll('i').length, 1, 'a key change still re-creates exactly one block');
  app.dispose();
});

/* ──────────── E1.23: an element with its own block, after a block ──────────── */

test('E1.23: an element containing a block, placed AFTER a block, adopts — both blocks stay reactive', () => {
  // The one post-block refusal E1.15 deliberately kept, and the biggest compile-side one left on the docs (30).
  // Its subtree already rebases onto the post-block cursor (E1.2c-5), and inside the element the inner block's
  // `[` marker sits at a fixed index — nothing variable precedes it at THAT level. So the refusal is the same
  // kind of over-caution E1.15 turned out to be. Prove it with a round-trip, not by reading the code.
  const render = compileResumable(
    '<div>@if (a()) { <i>A{{ n() }}</i> }<p>tail@if (b()) { <b>B{{ n() }}</b> }</p></div>',
    ['a', 'b', 'n'],
  );
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  assert.equal(typeof adopt, 'function', 'an element with a nested block, after a block, is adoptable');

  // ── server ──
  const a: Signal<boolean> = signal(true);
  const b: Signal<boolean> = signal(true);
  const n: Signal<number> = signal(1);
  const serverNode = serverRender(() => render({ a, b, n })) as HTMLElement;
  const wire = snapshot({ a, b, n });
  assert.equal(serverNode.querySelector('i')!.textContent, 'A1', 'server rendered the first block');
  assert.equal(serverNode.querySelector('p b')!.textContent, 'B1', 'and the one nested in the trailing <p>');

  // ── client ──
  const container: HTMLElement = host();
  container.innerHTML = serverNode.outerHTML;
  const div: HTMLElement = container.querySelector('div')!;
  const p: HTMLElement = div.querySelector('p')!;
  const app = resume(div, { snapshot: wire, adopt });

  assert.is(div.querySelector('p'), p, 'the trailing <p> itself was ADOPTED, not re-created');
  assert.ok(/tail/.test(p.textContent!), 'its static text is intact');
  assert.equal(div.querySelectorAll('i').length, 1, 'the first block replayed once — no duplicate');
  assert.equal(div.querySelectorAll('p b').length, 1, 'and so did the nested one');

  // both blocks live, against the resumed signals
  (app.ctx.n as Signal<number>).set(7);
  assert.equal(div.querySelector('i')!.textContent, 'A7', 'the first block is reactive');
  assert.equal(div.querySelector('p b')!.textContent, 'B7', 'the block nested after it is reactive too');
  (app.ctx.b as Signal<boolean>).set(false);
  assert.equal(div.querySelectorAll('p b').length, 0, 'the nested block still swaps out');
  assert.ok(/tail/.test(p.textContent!), 'without disturbing the element around it');
  app.dispose();
});

/* ──────────── E1.22: a `use:` forwarded onto a component ──────────── */

test('E1.22: a `use:` on a COMPONENT runs ONCE, on the ADOPTED root — not on a duplicate', async () => {
  // `<Button use:ripple>` is 20 sites on the docs. The danger is not that the action fails to run — it is that
  // the old emit would have CREATED a second copy of the child, so the page would carry a duplicate and the
  // action would land on the wrong node. Assert the DOM, not just the call.
  const childCode: string = compileTemplate('<b>{{ n() }}</b>', { mode: 'function', scope: ['n'], resumable: true }).code;
  const childRender = new Function('rt', '_c', childCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as
    ((ctx: unknown, slots?: unknown) => Node) & { adopt?: AdoptFn };
  let childSetups: number = 0;
  const Child = dom.defineComponent(childRender as never, () => { childSetups++; return { n: signal(3) }; }) as
    dom.Component & { adopt?: AdoptFn };
  Child.adopt = childRender.adopt;

  // A bare (out-of-scope) action is a MODULE reference — the real shape (`import { ripple } from …`), and the
  // one E1.21/E1.22 allow, since the client has it without any snapshot. Expose it the way the module would.
  const applied: Element[] = [];
  (globalThis as unknown as { mark: (el: Element) => void }).mark = (el: Element): void => {
    applied.push(el);
    el.setAttribute('data-acted', '1');
  };

  const parentCode: string = compileTemplate('<div><Child use:mark /></div>', {
    mode: 'function', scope: [], resumable: true,
  }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Child }) as
    ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };
  assert.equal(typeof parentRender.adopt, 'function', 'a `use:` on a component no longer refuses adopt');

  // ── server ── the action does NOT run here: `onMount` is inert on the server, which is exactly why adopt may
  // re-run it. (This render is in a real browser, so drain the mount queue before asserting.)
  const box: HTMLElement = host();
  const states = collectStates(() => { box.appendChild(serverRender(() => parentRender({}, {})) as Node); });
  states[ROOT_ID] = {};
  const wire = snapshot(states);
  const serverHtml: string = (box.firstElementChild as HTMLElement).outerHTML;
  // `applyAction` defers to onMount (a microtask), so drain it before discarding what this browser-side stand-in
  // for the server did. On a REAL server none of it runs at all — that is the whole premise of E1.21/E1.22.
  await Promise.resolve();
  applied.length = 0;

  // ── client ──
  const client: HTMLElement = host();
  client.innerHTML = serverHtml;
  const div: HTMLElement = client.querySelector('div')!;
  const app = resume(div, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(childSetups, 1, 'the child ADOPTED — its setup did not re-run');
  await Promise.resolve();

  assert.equal(div.querySelectorAll('b').length, 1, 'exactly ONE child on the page — no duplicate was mounted');
  assert.equal(applied.length, 1, `the action ran exactly once; got ${applied.length}`);
  assert.is(applied[0], div.querySelector('b')!, 'and on the ADOPTED root that is actually on the page');
  assert.equal(div.querySelector('b')!.getAttribute('data-acted'), '1', 'its effect is on the live node');
  (app.states.c0 as { n: Signal<number> }).n.set(9);
  assert.equal(div.querySelector('b')!.textContent, '9', 'the adopted child is still reactive');
  app.dispose();
});

/* ──────────── E1.20: props reach a resumed CHILD's handlers ──────────── */

test('E1.20: a resumed CHILD click reads its `props` — live from the parent`s resumed ctx, setup never re-runs', () => {
  // The last root cause, end to end: the child's handler reads `props.step`, which only exists because the
  // PARENT's adopt walk built the props object and handed it to adoptComponent. And it must be LIVE — the prop
  // is a getter over the parent's resumed signal, so changing the parent must change what the child's click does.
  const childCode: string = compileTemplate('<b on:click={{ bump }}>{{ n() }}</b>', {
    mode: 'function',
    scope: ['n', 'bump'],
    resumable: true,
    resumableHandlers: new Map([['bump', '() => ctx.n.set((v) => v + props.step)']]),
  }).code;
  const childRender = new Function('rt', '_c', childCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as
    ((ctx: unknown, slots?: unknown) => Node) & { adopt?: AdoptFn; handlers?: (c: Record<string, unknown>, p?: Record<string, unknown>) => Record<string, ResumeHandler> };
  let childSetups: number = 0;
  const Child = dom.defineComponent(childRender as never, () => { childSetups++; return { n: signal(1), bump: () => {} }; }) as
    dom.Component & { adopt?: AdoptFn; handlers?: unknown };
  Child.adopt = childRender.adopt;
  Child.handlers = childRender.handlers;

  const parentCode: string = compileTemplate('<div><Child step={{ step() }} /></div>', {
    mode: 'function', scope: ['step'], resumable: true,
  }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Child }) as
    ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };

  // ── server ──
  const step: Signal<number> = signal(10);
  const box: HTMLElement = host();
  // BOTH sessions, as `renderPage` runs them: collectStates captures each instance's ctx, collectResumable
  // makes the `on:` sites stamp their `data-won-*` markers. Without the latter there is nothing to click.
  const states = collectStates(() => { box.appendChild(serverRender(() => parentRender({ step }, {})) as Node); });
  states[ROOT_ID] = { step };
  const wire = snapshot(states);
  const serverHtml: string = (box.firstElementChild as HTMLElement).outerHTML;

  // ── client ──
  const client: HTMLElement = host();
  client.innerHTML = serverHtml;
  const div: HTMLElement = client.querySelector('div')!;
  const app = resume(div, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(childSetups, 1, 'the child adopted — its setup did not re-run');

  const b: HTMLElement = div.querySelector('b')!;
  b.click();
  assert.equal(b.textContent, '11', 'the click read `props.step` (1 + 10) — props reached the resumed factory');

  (app.ctx.step as Signal<number>).set(100);
  b.click();
  assert.equal(b.textContent, '111', 'and the prop is LIVE: it is a getter over the parent`s resumed signal');
  app.dispose();
});

/* ──────────── E1.19: setup-local helpers as factory locals ──────────── */

test('E1.19: a resumed click runs through a setup HELPER rebuilt as a factory local — real click, real state', () => {
  // The emit shape is checked in component.browser.ts; this is the part that matters — the factory local must
  // actually exist and be callable when the delegated dispatch fires on a client that never ran `setup`.
  const { code } = compileTemplate('<button on:click={{ inc }}>{{ count() }}</button>', {
    mode: 'function',
    scope: ['count', 'inc'],
    resumable: true,
    resumableHandlers: new Map([['inc', '() => bump(2)']]),          // the site body calls the helper…
    resumableLocals: new Map([['bump', '(by) => ctx.count.set((n) => n + by)']]), // …which the factory declares
  });
  const render = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as
    ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn; handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler> };

  const serverCount: Signal<number> = signal(5);
  const serverNode = serverRender(() => render({ count: serverCount, inc: () => {} })) as HTMLButtonElement;
  const wire = snapshot({ count: serverCount }); // `inc` and `bump` are functions — neither crosses the wire

  const container: HTMLElement = host();
  container.innerHTML = serverNode.outerHTML;
  const btn: HTMLButtonElement = container.querySelector('button')!;
  const app = resume(btn, { snapshot: wire, adopt: render.adopt, handlers: render.handlers });

  btn.click();
  assert.equal((app.ctx.count as Signal<number>)(), 7, 'the click ran the helper (5 + 2) — the factory local resolved');
  btn.click();
  assert.equal((app.ctx.count as Signal<number>)(), 9, 'and it is the SAME local across clicks, as setup`s closure was');
  assert.equal(btn.textContent, '9', 'the adopted text node reflects it');
  app.dispose();
});

/* ──────────── E1.17: <slot> ──────────── */

test('E1.17: a <slot> component adopts — its own state resumes, setup never re-runs, and the projected content renders', () => {
  // Every container component (`<Toolbar>`, `<Card>`, `<Sidenav>`…) has a slot, so `<slot>` refused adopt meant
  // each one fell back to CSR and lost its own state. The slot CONTENT belongs to the parent and is rendered by
  // the parent's slot fn, so it island-replays like an `@if` — but the component around it now adopts.
  const childCode: string = compileTemplate('<div class="c"><b>{{ n() }}</b><slot></slot></div>', {
    mode: 'function', scope: ['n'], resumable: true,
  }).code;
  const childRender = new Function('rt', '_c', childCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as
    ((ctx: unknown, slots?: unknown) => Node) & { adopt?: AdoptFn };
  assert.equal(typeof childRender.adopt, 'function', 'a template containing a <slot> is adoptable');

  let childSetups: number = 0;
  const Child = dom.defineComponent(
    childRender as never,
    () => { childSetups++; return { n: signal(4) }; }
  ) as dom.Component & { adopt?: AdoptFn };
  Child.adopt = childRender.adopt;

  const parentCode: string = compileTemplate('<section><Child><i>{{ label() }}</i></Child></section>', {
    mode: 'function', scope: ['label'], resumable: true,
  }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Child }) as
    ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };

  // ── server ──
  const label: Signal<string> = signal('projected');
  const box: HTMLElement = host();
  const states = collectStates(() => { box.appendChild(parentRender({ label }, {})); });
  assert.ok(states.c0, 'the slotted child self-registered its ctx');
  states[ROOT_ID] = { label };
  const wire = snapshot(states);
  const serverHtml: string = (box.firstElementChild as HTMLElement).outerHTML;
  assert.ok(/projected/.test(serverHtml), 'the server rendered the projected slot content');

  // ── client ──
  const client: HTMLElement = host();
  client.innerHTML = serverHtml;
  const section: HTMLElement = client.querySelector('section')!;
  const app = resume(section, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(childSetups, 1, 'the child ADOPTED — its setup did not re-run despite holding a slot');

  assert.equal(section.querySelector('.c b')!.textContent, '4', "the child's own binding adopted at its server value");
  assert.equal(section.querySelector('.c i')!.textContent, 'projected', 'the projected content is on the page exactly once');
  assert.equal(section.querySelectorAll('.c i').length, 1, 'and was not duplicated by the replay');

  (app.states.c0 as { n: Signal<number> }).n.set(9);
  assert.equal(section.querySelector('.c b')!.textContent, '9', "the child's resumed state is live in place");
  (app.ctx.label as Signal<string>).set('re-projected');
  assert.equal(section.querySelector('.c i')!.textContent, 're-projected', "the slot content is live against the PARENT's resumed ctx");
  app.dispose();
});

/* ──────────── E1.16: element refs ──────────── */

test('E1.16: a `ref` capture adopts — the ref re-binds to the ADOPTED server node, never crossing the wire', () => {
  // An element ref is not state and never can be: a DOM node cannot be serialized, which is why every
  // ref-holding component was dropped to CSR (52 `ref` refusals + 228 instance drops on the docs site — one
  // problem). But adopt does not NEED it on the wire: the walk already resolves the node, so `setRef` binds the
  // resumed signal to the adopted element exactly as the create path binds it to the created one.
  const { code } = compileTemplate('<div><p ref={{ host }}>{{ count() }}</p></div>', {
    mode: 'function',
    scope: ['count', 'host'],
    resumable: true,
    resumableDerived: new Map([['host', 'rt.signal(null)']]), // as compileComponent emits for `const host = signal(null)`
  });
  const render = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as
    ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn; derive?: (c: Record<string, unknown>) => unknown };
  assert.equal(typeof render.adopt, 'function', 'a template with a `ref` is adoptable — the adopt walk HAS the node');

  // ── server ── the ref captures the SERVER node; only `count` crosses the wire
  const serverCount: Signal<number> = signal(7);
  const serverHost: Signal<Element | null> = signal<Element | null>(null);
  const serverNode = serverRender(() => render({ count: serverCount, host: serverHost })) as HTMLElement;
  assert.equal((serverHost() as Element)?.tagName, 'P', 'the server render captured its own <p> into the ref');
  const serverHtml: string = serverNode.outerHTML;
  const wire = snapshot({ count: serverCount });

  // ── client ── fresh parse; `host` is absent from the snapshot, so derive rebuilds it as an empty signal
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const div: HTMLElement = container.querySelector('div')!;
  const clientP: HTMLElement = div.querySelector('p')!;
  const app = resume(div, { snapshot: wire, adopt: render.adopt, derive: render.derive });

  const bound = (app.ctx.host as Signal<Element | null>)();
  assert.ok(bound, 'the ref is populated after resume (it was rebuilt, then bound by the adopt walk)');
  assert.is(bound as Element, clientP, 'the ref points at the ADOPTED server <p> — the very node on the page');
  assert.ok(bound !== (serverHost() as Element), 'and not at the stale server-render node');
  app.dispose();
});

/* ──────────── E1.15: sibling components after a block ──────────── */

/** Compile `<el>{{ label() }}</el>` as a real resumable component, counting its setup runs. */
function labelComponent(el: string, start: string, count: { n: number }): dom.Component & { adopt?: AdoptFn } {
  const code: string = compileTemplate(`<${el}>{{ label() }}</${el}>`, { mode: 'function', scope: ['label'], resumable: true }).code;
  const render = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as ((ctx: unknown, slots?: unknown) => Node) & { adopt?: AdoptFn };
  const C = dom.defineComponent(
    render as never,
    () => { count.n++; return { label: signal(start) }; }
  ) as dom.Component & { adopt?: AdoptFn };
  C.adopt = render.adopt; // component.ts attaches render.adopt in the resumable target
  return C;
}

test('E1.15: two SIBLING components both adopt in place — neither setup re-runs, both stay reactive', () => {
  // `<Foo /><Bar />` is the single most common template shape there is; every E1.2c-6/E1.8 test used exactly
  // ONE component, so the post-block gate refused the second one (and thus every real app) unnoticed.
  const a: { n: number } = { n: 0 };
  const b: { n: number } = { n: 0 };
  const Foo = labelComponent('b', 'A', a);
  const Bar = labelComponent('i', 'B', b);

  const parentCode: string = compileTemplate('<div><Foo /><Bar /></div>', { mode: 'function', scope: [], resumable: true }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Foo, Bar }) as ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };
  assert.equal(typeof parentRender.adopt, 'function', 'two sibling components are adoptable (the gate used to refuse the 2nd)');

  // ── server ── both children self-register; snapshot { $root, c0, c1 }
  const box: HTMLElement = host();
  const states = collectStates(() => { box.appendChild(parentRender({}, {})); });
  assert.ok(states.c0, 'the FIRST child self-registered its ctx (c0)');
  assert.ok(states.c1, 'the SECOND child self-registered its ctx (c1)');
  assert.equal(a.n, 1, 'first child setup ran once on the server');
  assert.equal(b.n, 1, 'second child setup ran once on the server');
  states[ROOT_ID] = {};
  const wire = snapshot(states);
  const serverHtml: string = (box.firstElementChild as HTMLElement).outerHTML;

  // ── client ── fresh parse + resume
  const client: HTMLElement = host();
  client.innerHTML = serverHtml;
  const div: HTMLElement = client.querySelector('div')!;
  const app = resume(div, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(a.n, 1, 'RESUME did not re-run the FIRST child setup');
  assert.equal(b.n, 1, 'RESUME did not re-run the SECOND child setup — it adopted, it did not re-render');

  assert.equal(div.querySelector('b')!.textContent, 'A', 'first child adopted with its server value');
  assert.equal(div.querySelector('i')!.textContent, 'B', 'second child adopted with its server value');
  (app.states.c0 as { label: Signal<string> }).label.set('A2');
  (app.states.c1 as { label: Signal<string> }).label.set('B2');
  assert.equal(div.querySelector('b')!.textContent, 'A2', 'first child reactive in place');
  assert.equal(div.querySelector('i')!.textContent, 'B2', 'SECOND child reactive in place — the post-block cursor reached it');
  app.dispose();
});

test('E1.2b-2: adopt re-binds the SERVER text node in place — signal update flows, node identity kept, no re-render', () => {
  const render = compileResumable('<button on:click={{() => count.set((c) => c + 1)}}>Count: {{ count() }}</button>', ['count']);
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  const handlers = (render as { handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler> }).handlers;
  assert.equal(typeof adopt, 'function', 'the resumable render carries an adopt fn');

  // ── server ── render the resumable target (stamps the data-won marker + isolates the dynamic text) + snapshot
  const serverCount: Signal<number> = signal(7);
  const serverNode = serverRender(() => render({ count: serverCount })) as HTMLButtonElement;
  const wire = snapshot({ count: serverCount });
  const serverHtml: string = serverNode.outerHTML; // exactly what renderPage would serialize

  // ── client ── a FRESH parse of the server HTML: dead DOM, no live bindings carried over from the render above
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const btn: HTMLButtonElement = container.querySelector('button')!;
  const marker: ChildNode = [...btn.childNodes].find((n) => n.nodeType === 8 && (n as Comment).data === '$')!;
  const clientText: Text = marker.nextSibling as Text;
  assert.equal(clientText.data, '7', 'the client parsed the server-rendered value, isolated by its marker');

  // resume with the EMITTED adopt + handlers — no hand-authoring, no setup (ctx comes from the snapshot). The
  // resume root IS the component's single root element (what render returns / adopt navigates from as `_r`).
  const app = resume(btn, {
    snapshot: wire,
    handlers: handlers as (c: Record<string, unknown>) => Record<string, ResumeHandler>,
    adopt,
  });
  assert.equal((app.ctx.count as Signal<number>)(), 7, 'resumed the server value from the snapshot');
  assert.is((btn.childNodes[2] as Text), clientText, 'adopt re-bound the EXISTING server text node (no re-creation)');
  assert.equal(btn.childNodes.length, 4, 'no extra nodes inserted on adopt (static "Count: ", marker, text, anchor)');

  btn.click();
  assert.equal((app.ctx.count as Signal<number>)(), 8, 'the delegated resume dispatch fired the handler against the rebuilt graph');
  assert.equal(clientText.data, '8', 'the adopted text node updated IN PLACE — reactivity flows through adopt');
  assert.equal(btn.textContent, 'Count: 8', 'the button reads the updated value');
  app.dispose();
});

test('resumableHandler returns instance-unique ids and registers into the active session', () => {
  const el1: HTMLButtonElement = document.createElement('button');
  const el2: HTMLButtonElement = document.createElement('button');
  const seen: string[] = [];
  const { handlers } = collectResumable(() => {
    const a: string = resumableHandler(el1, 'click', 'w0', (() => seen.push('a')) as ResumeHandler);
    const b: string = resumableHandler(el2, 'click', 'w0', (() => seen.push('b')) as ResumeHandler);
    assert.ok(a !== b, 'same site ref → distinct instance ids');
    return null;
  });
  assert.equal(handlers.size, 2, 'both handlers captured');
  handlers.get(el2.getAttribute('data-won-click')!)!(new Event('click'), el2);
  assert.deepEqual(seen, ['b'], 'the second element’s id resolves to the second handler');
});

/* ──────────── E1.5 — named-handler resume (compile-time inlining) ──────────── */

/**
 * The payoff test. `on:click={{ inc }}` compiles its site to `ctx.inc`, but `inc` is a FUNCTION — `registerState`
 * drops it from the snapshot (it cannot serialize), so on the client `ctx.inc` is undefined and the button is
 * dead. E1.5 has `compileComponent` extract inc's body from `setup` and rewrite it against ctx; the factory then
 * closes over the resumed `ctx.count` exactly like an inline handler. Here we drive the emitted code with the
 * body compileComponent produces, and snapshot WITHOUT `inc` — precisely what the SSG pipeline does.
 */
function compileNamed(handlers?: Map<string, string>): ((ctx: unknown, slots?: unknown) => Element) & {
  adopt?: AdoptFn;
  handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler>;
} {
  const { code } = compileTemplate('<button on:click={{ inc }}>{{ count() }}</button>', {
    mode: 'function',
    scope: ['count', 'inc'],
    resumable: true,
    resumableHandlers: handlers,
  });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {});
}

test('E1.5: a NAMED handler RESUMES — its inlined body clicks against the resumed ctx, with `inc` absent from the snapshot', () => {
  // exactly what compileComponent emits for `const inc = () => count.set((n) => n + 1)`
  const render = compileNamed(new Map([['inc', '() => ctx.count.set((n) => n + 1)']]));

  // ── server ── render with the real setup ctx (count + inc), then snapshot ONLY what serializes (no `inc`)
  const serverCount: Signal<number> = signal(3);
  const node = serverRender(() => render({ count: serverCount, inc: () => serverCount.set((n) => n + 1) })) as HTMLButtonElement;
  const wire = snapshot({ count: serverCount }); // registerState drops the function — this is the real payload
  const serverHtml: string = node.outerHTML;

  // ── client ── fresh parse (dead DOM), resume, click
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const btn: HTMLButtonElement = container.querySelector('button')!;
  assert.equal(btn.textContent, '3', 'the server value is in the DOM');
  const app = resume(btn, { snapshot: wire, handlers: render.handlers, adopt: render.adopt });
  assert.equal(app.ctx.inc, undefined, 'the handler function did NOT cross the wire — only its inlined body did');

  btn.click();
  assert.equal((app.ctx.count as Signal<number>)(), 4, 'the resumed NAMED handler ran against the resumed signal');
  assert.equal(btn.textContent, '4', 'and the adopted text node updated in place — no re-render');
  app.dispose();
});

test('E1.5 DoD: WITHOUT the inlining the same named handler is dead (proves the fix is what makes it work)', () => {
  const render = compileNamed(); // no resumableHandlers → the factory emits a bare `ctx.inc`
  const serverCount: Signal<number> = signal(3);
  const node = serverRender(() => render({ count: serverCount, inc: () => serverCount.set((n) => n + 1) })) as HTMLButtonElement;
  const wire = snapshot({ count: serverCount });

  const container: HTMLElement = host();
  container.innerHTML = node.outerHTML;
  const btn: HTMLButtonElement = container.querySelector('button')!;
  const app = resume(btn, { snapshot: wire, handlers: render.handlers, adopt: render.adopt });
  btn.click();
  assert.equal((app.ctx.count as Signal<number>)(), 3, 'ctx.inc is undefined → the click does nothing (today’s gap)');
  assert.equal(btn.textContent, '3', 'the DOM never changed');
  app.dispose();
});

/* ──────────── E1.6 — computeds re-derived on resume ──────────── */

/**
 * The gap this closes was worse than a dead button: a `computed` is dropped from the snapshot (no writable
 * surface to serialize), but the template CALLS it — so `ctx.doubled()` threw and took the WHOLE resume down
 * (adopt never finished, no events armed, page inert). `derive(ctx)` rebuilds it over the resumed signals
 * before adopt runs.
 */
function compileComputed(computeds?: Map<string, string>): ((ctx: unknown, slots?: unknown) => Element) & {
  adopt?: AdoptFn;
  derive?: (ctx: Record<string, unknown>) => unknown;
} {
  const { code } = compileTemplate('<p>{{ doubled() }}</p>', {
    mode: 'function',
    scope: ['doubled'],
    resumable: true,
    resumableDerived: computeds,
  });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {});
}

test('E1.6: a computed is REBUILT on resume — the page adopts and stays reactive through the derived value', () => {
  // what compileComponent emits: the FULL initializer, ctx-rewritten (its callee is the module's own import;
  // function mode reaches it via `rt`).
  const render = compileComputed(new Map([['doubled', 'rt.computed(() => ctx.count() * 2)']]));
  assert.equal(typeof render.derive, 'function', 'the render carries a derive');

  // ── server ── the real setup ctx; the snapshot carries ONLY the signal (registerState drops the computed)
  const count: Signal<number> = signal(3);
  const doubled = computed(() => count() * 2);
  const node = render({ doubled }) as HTMLElement;
  const serverHtml: string = node.outerHTML;
  const wire = snapshot({ count });

  // ── client ── fresh parse + resume
  const container: HTMLElement = host();
  container.innerHTML = serverHtml;
  const p: HTMLElement = container.querySelector('p')!;
  assert.equal(p.textContent, '6', 'the server rendered the computed value');

  const app = resume(p, { snapshot: wire, adopt: render.adopt, derive: render.derive });
  assert.equal(p.textContent, '6', 'resumed in place — the derived computed matches the server value');
  assert.equal(typeof app.ctx.doubled, 'function', 'the computed was rebuilt onto the resumed ctx');

  // and it is LIVE: setting the underlying signal flows through the rebuilt computed into the adopted DOM
  (app.ctx.count as Signal<number>).set(10);
  assert.equal(p.textContent, '20', 'the rebuilt computed is reactive against the resumed signal');
  app.dispose();
});

test('E1.6 DoD: WITHOUT derive the same page THROWS on resume (this was killing the whole page, not one button)', () => {
  const render = compileComputed(); // no resumableComputeds → no derive emitted
  const count: Signal<number> = signal(3);
  const doubled = computed(() => count() * 2);
  const container: HTMLElement = host();
  container.innerHTML = (render({ doubled }) as HTMLElement).outerHTML;
  const p: HTMLElement = container.querySelector('p')!;

  let threw: string = '';
  try {
    resume(p, { snapshot: snapshot({ count }), adopt: render.adopt });
  } catch (e) {
    threw = (e as Error).message;
  }
  assert.ok(/doubled is not a function/.test(threw), `resume throws without the rebuild (got: ${threw || 'no error'})`);
});

/* ──────────── E1.8 — a CHILD component's own events resume ──────────── */

test('E1.8: a static <Child> with its OWN on:click resumes — the click runs the child handler over the child ctx', () => {
  // child: its own button + handler + reactive text
  const childCode = compileTemplate('<button on:click={{ () => count.set((c) => c + 1) }}>{{ count() }}</button>', {
    mode: 'function', scope: ['count'], resumable: true,
  }).code;
  const childRender = new Function('rt', '_c', childCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {}) as ((ctx: unknown) => Node) & { adopt?: AdoptFn; handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler> };
  let childSetups = 0;
  const Child = dom.defineComponent(childRender as never, () => { childSetups++; return { count: signal(0) }; }) as dom.Component & { adopt?: AdoptFn; handlers?: unknown };
  Child.adopt = childRender.adopt;
  (Child as { handlers?: unknown }).handlers = childRender.handlers; // component.ts attaches this in the resumable target

  // parent: a static child, no events of its own
  const parentCode = compileTemplate('<div><h1>{{ title() }}</h1><Child /></div>', { mode: 'function', scope: ['title'], resumable: true }).code;
  const parentRender = new Function('rt', '_c', parentCode.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, { Child }) as ((ctx: unknown, slots?: unknown) => Element) & { adopt?: AdoptFn };

  // ── server ── render + collect the child ctx under c0, snapshot { $root, c0 }
  const title = signal('T');
  const box = host();
  const states = collectStates(() => { box.appendChild(serverRender(() => parentRender({ title }, {}))); });
  assert.ok(states.c0, 'the child self-registered under c0');
  assert.equal(childSetups, 1, 'child setup ran once on the server');
  states[ROOT_ID] = { title };
  const wire = snapshot(states);
  const serverHtml = (box.firstElementChild as HTMLElement).outerHTML;

  // ── client ── fresh parse + resume (parent has no handlers of its own)
  const client = host();
  client.innerHTML = serverHtml;
  const div = client.querySelector('div')!;
  const btn = div.querySelector('button')!;
  assert.equal(btn.textContent, '0', 'the child rendered its server value');

  const app = resume(div, { snapshot: wire, adopt: parentRender.adopt });
  assert.equal(childSetups, 1, 'resume did NOT re-run the child setup');

  btn.click(); // the CHILD's own handler — must resolve against the child ctx, not the (handler-less) root
  assert.equal((app.states.c0 as { count: Signal<number> }).count(), 1, 'the child handler ran against the child signal');
  assert.equal(btn.textContent, '1', 'the child text adopted in place updated');
  btn.click();
  assert.equal(btn.textContent, '2', 'and it stays live');
  app.dispose();
});
