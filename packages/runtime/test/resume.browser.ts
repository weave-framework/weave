import { test, assert } from '../../../tools/harness.js';
import { resumeEvents, handlerAttr, type ResumeHandler, type ResumeControl } from '@weave-framework/runtime/resume';

const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

/** Build a detached root, run the callback to populate it, append to the document, return it. */
function mount(build: (root: HTMLElement) => void): HTMLElement {
  const root: HTMLDivElement = document.createElement('div');
  build(root);
  document.body.appendChild(root);
  return root;
}

test('resume: handlerAttr convention', () => {
  assert.equal(handlerAttr('click'), 'data-won-click');
  assert.equal(handlerAttr('input'), 'data-won-input');
});

test('resume: a click on a referenced element resolves + invokes the handler (event + element)', () => {
  let seen: { ref: string; ev: Event; el: Element } | null = null;
  const root: HTMLElement = mount((r) => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.setAttribute('data-won-click', 'h1');
    btn.id = 'b';
    r.appendChild(btn);
  });
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: (ref) => ((ev, el) => (seen = { ref, ev, el })) as ResumeHandler,
  });
  const btn: HTMLButtonElement = root.querySelector('#b') as HTMLButtonElement;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.ok(seen, 'handler fired');
  assert.equal(seen!.ref, 'h1', 'resolver got the ref');
  assert.is(seen!.el, btn, 'handler got the element that carried the reference');
  assert.equal(seen!.ev.type, 'click', 'handler got the event');
  ctl.dispose();
  root.remove();
});

test('resume: delegation — a click on a child dispatches the ancestor handler', () => {
  let fired: number = 0;
  const root: HTMLElement = mount((r) => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.setAttribute('data-won-click', 'h1');
    const span: HTMLSpanElement = document.createElement('span');
    span.id = 'inner';
    btn.appendChild(span);
    r.appendChild(btn);
  });
  const ctl: ResumeControl = resumeEvents(root, { resolve: () => (() => fired++) as ResumeHandler });
  (root.querySelector('#inner') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 1, 'a click on the inner span dispatched the button’s handler');
  ctl.dispose();
  root.remove();
});

test('resume: nearest ancestor wins (nested handlers)', () => {
  const hits: string[] = [];
  const root: HTMLElement = mount((r) => {
    const outer: HTMLDivElement = document.createElement('div');
    outer.setAttribute('data-won-click', 'outer');
    const inner: HTMLButtonElement = document.createElement('button');
    inner.setAttribute('data-won-click', 'inner');
    inner.id = 'i';
    outer.appendChild(inner);
    r.appendChild(outer);
  });
  const ctl: ResumeControl = resumeEvents(root, { resolve: (ref) => (() => hits.push(ref)) as ResumeHandler });
  (root.querySelector('#i') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(hits, ['inner'], 'only the nearest (inner) handler ran, not the outer');
  ctl.dispose();
  root.remove();
});

test('resume: lazy — the resolver is NOT called until an event fires', () => {
  let resolves: number = 0;
  const root: HTMLElement = mount((r) => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.setAttribute('data-won-click', 'h1');
    btn.id = 'b';
    r.appendChild(btn);
  });
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: () => {
      resolves++;
      return (() => {}) as ResumeHandler;
    },
  });
  assert.equal(resolves, 0, 'nothing resolved just from wiring resume (fully lazy)');
  (root.querySelector('#b') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(resolves, 1, 'resolved only on the first interaction');
  ctl.dispose();
  root.remove();
});

test('resume: multiple event types are each delegated', () => {
  const hits: string[] = [];
  const root: HTMLElement = mount((r) => {
    const input: HTMLInputElement = document.createElement('input');
    input.setAttribute('data-won-input', 'oninput');
    input.setAttribute('data-won-focus', 'onfocus');
    input.id = 'in';
    r.appendChild(input);
  });
  const ctl: ResumeControl = resumeEvents(root, { resolve: (ref) => (() => hits.push(ref)) as ResumeHandler });
  const input: HTMLInputElement = root.querySelector('#in') as HTMLInputElement;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('focus', { bubbles: true }));
  assert.deepEqual(hits.sort(), ['onfocus', 'oninput'], 'both event types dispatched');
  ctl.dispose();
  root.remove();
});

test('resume: an async resolver (lazy import) is awaited before invoking', async () => {
  let fired: number = 0;
  const root: HTMLElement = mount((r) => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.setAttribute('data-won-click', 'h1');
    btn.id = 'b';
    r.appendChild(btn);
  });
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: () => Promise.resolve((() => fired++) as ResumeHandler),
  });
  (root.querySelector('#b') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 0, 'not yet — the handler resolves on a microtask');
  await tick();
  assert.equal(fired, 1, 'invoked after the promise resolves');
  ctl.dispose();
  root.remove();
});

test('resume: dispose() stops dispatching', () => {
  let fired: number = 0;
  const root: HTMLElement = mount((r) => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.setAttribute('data-won-click', 'h1');
    btn.id = 'b';
    r.appendChild(btn);
  });
  const ctl: ResumeControl = resumeEvents(root, { resolve: () => (() => fired++) as ResumeHandler });
  const btn: HTMLElement = root.querySelector('#b') as HTMLElement;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  ctl.dispose();
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 1, 'no dispatch after dispose');
  root.remove();
});

test('resume: extraEvents delegates a type not present at scan time', () => {
  let fired: number = 0;
  const root: HTMLElement = mount(() => {});
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: () => (() => fired++) as ResumeHandler,
    extraEvents: ['click'],
  });
  // add a referenced element AFTER resume
  const btn: HTMLButtonElement = document.createElement('button');
  btn.setAttribute('data-won-click', 'late');
  root.appendChild(btn);
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 1, 'a later-added element still dispatches via the pre-armed delegated listener');
  ctl.dispose();
  root.remove();
});
