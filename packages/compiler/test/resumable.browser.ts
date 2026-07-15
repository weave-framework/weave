import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { resumeEvents, collectResumable, resumableHandler, handlerAttr, type ResumeHandler } from '@weave-framework/runtime/resume';
import { bindTextResumable, adoptText, blockStart, adoptIsland, after } from '@weave-framework/runtime/adopt';
import { snapshot, resume, resumePage, SNAPSHOT_ID, type AdoptFn } from '@weave-framework/runtime/graph';
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
  after: typeof after;
} = { ...dom, signal, computed, effect, root, resumableHandler, bindTextResumable, adoptText, blockStart, adoptIsland, after };

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
  assert.ok(code.includes('function handlers(ctx)'), 'emits a handlers factory');
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
  const body: string = code.slice(code.indexOf('function handlers(ctx)'));
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
  const node = render({ count }) as HTMLButtonElement;
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
  container.appendChild(render({ count }));
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

test('E1.2b-2: a resumable fragment with a not-yet-adoptable block (a component) emits NO adopt fn — falls back to CSR', () => {
  const { code } = compileTemplate('<div>hi <Widget /></div>', {
    mode: 'module',
    scope: [],
    resumable: true,
  });
  assert.ok(!code.includes('render.adopt'), 'a child component is not island-replayable yet (nested resume is later)');
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
  assert.ok(adoptBody.includes('adoptIsland('), 'the adopt render island-replays via adoptIsland');
  assert.ok(adoptBody.includes('ifBlock('), 'then re-runs the normal ifBlock against the cleared island');

  // an ELEMENT with dynamics AFTER the block → its subtree index is unreachable → no adopt fn (leaf interps
  // after a block ARE adoptable via the E1.2c-4 cursor, but a dynamic element after a block is not yet)
  const afterEl = compileTemplate('<div>@if (show()) { <p>x</p> }<b>{{ tail() }}</b></div>', {
    mode: 'module', scope: ['show', 'tail'], resumable: true,
  });
  assert.ok(!afterEl.code.includes('render.adopt'), 'a dynamic element after a block still blocks adopt (E1.2c-4 is leaf interps)');

  // a child component is not island-replayable yet → no adopt fn
  const comp = compileTemplate('<div>hi <Widget /></div>', {
    mode: 'module', scope: [], resumable: true,
  });
  assert.ok(!comp.code.includes('render.adopt'), 'a component stays CSR fallback (nested resume is later)');
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
  assert.ok(/adoptIsland\(/.test(adoptBody) && /_e\d+ = /.test(adoptBody), 'the block captures its ] end anchor as the cursor base');
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

test('E1.2b-2: adopt re-binds the SERVER text node in place — signal update flows, node identity kept, no re-render', () => {
  const render = compileResumable('<button on:click={{() => count.set((c) => c + 1)}}>Count: {{ count() }}</button>', ['count']);
  const adopt = (render as { adopt?: AdoptFn }).adopt;
  const handlers = (render as { handlers?: (c: Record<string, unknown>) => Record<string, ResumeHandler> }).handlers;
  assert.equal(typeof adopt, 'function', 'the resumable render carries an adopt fn');

  // ── server ── render the resumable target (stamps the data-won marker + isolates the dynamic text) + snapshot
  const serverCount: Signal<number> = signal(7);
  const serverNode = render({ count: serverCount }) as HTMLButtonElement;
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
