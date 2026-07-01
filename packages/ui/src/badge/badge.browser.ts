import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type BadgeProps, type BadgeContext } from '@weave-framework/ui/badge';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

type RenderFn = (ctx: BadgeContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: BadgeContext, rt: unknown, c: unknown) => RenderFn;

/** Mount `<Badge>` with `content` projected into the default slot (the host). */
function mount(props: BadgeProps, slot?: () => Node): { el: HTMLElement; mark: HTMLElement | null; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: BadgeContext = setup(props);
    const { code } = compileTemplate(template, {
      mode: 'function',
      scope: ['badgeClass', 'ariaLabel', 'showMark', 'markText'],
    });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;')
    ) as MakeRender;
    const render: RenderFn = make(ctx, rt, {});
    return render(ctx, slot ? { default: slot } : {});
  });
  document.body.appendChild(el);
  return { el, mark: el.querySelector<HTMLElement>('.weave-badge__mark'), dispose: (): void => { disposeOwner(owner); el.remove(); } };
}

const host = (): Node => {
  const s: HTMLElement = document.createElement('span');
  s.textContent = '●';
  return s;
};

/* ─────────────────────────── count ─────────────────────────── */

test('count: renders the host + a positioned mark showing the count', () => {
  const { el, mark, dispose } = mount({ content: 3 }, host);
  assert.ok(el.classList.contains('weave-badge'));
  assert.ok(!el.className.includes('weave-badge--'), 'count carries no variant modifier');
  assert.ok(mark, 'a __mark is rendered');
  assert.equal(mark!.textContent, '3');
  assert.equal(mark!.getAttribute('aria-hidden'), 'true', 'the pill is decorative');
  dispose();
});

test('count: the count is announced via aria-label on the host container', () => {
  const { el, dispose } = mount({ content: 7 }, host);
  assert.equal(el.getAttribute('aria-label'), '7');
  dispose();
});

test('count: max caps the displayed number (99+)', () => {
  const { mark, dispose } = mount({ content: 128, max: 99 }, host);
  assert.equal(mark!.textContent, '99+');
  dispose();
});

test('count: no content → no mark, no aria-label (nothing to show)', () => {
  const { el, mark, dispose } = mount({}, host);
  assert.equal(mark, null, 'mark omitted');
  assert.equal(el.hasAttribute('aria-label'), false);
  dispose();
});

test('count: an explicit label overrides the derived count label', () => {
  const { el, dispose } = mount({ content: 3, label: '3 unread messages' }, host);
  assert.equal(el.getAttribute('aria-label'), '3 unread messages');
  dispose();
});

/* ─────────────────────────── dot ─────────────────────────── */

test('dot: always renders a bare mark with the --dot modifier (no text)', () => {
  const { el, mark, dispose } = mount({ variant: 'dot' }, host);
  assert.ok(el.classList.contains('weave-badge--dot'));
  assert.ok(mark, 'dot mark rendered even with no content');
  assert.equal(mark!.textContent, '');
  assert.equal(mark!.getAttribute('aria-hidden'), 'true');
  dispose();
});

/* ─────────────────────────── tag ─────────────────────────── */

test('tag: standalone label — the slot is the text, no positioned mark, no aria-label', () => {
  const { el, mark, dispose } = mount({ variant: 'tag' }, () => document.createTextNode('New'));
  assert.ok(el.classList.contains('weave-badge--tag'));
  assert.equal(mark, null, 'no __mark for a tag');
  assert.equal(el.textContent, 'New', 'slot text is the visible label');
  assert.equal(el.hasAttribute('aria-label'), false, 'visible text is the name');
  dispose();
});

/* ─────────────────────────── position + class ─────────────────────────── */

test('position: bottom-start adds the --bottom and --start modifiers', () => {
  const { el, dispose } = mount({ content: 1, position: 'bottom-start' }, host);
  assert.ok(el.classList.contains('weave-badge--bottom'));
  assert.ok(el.classList.contains('weave-badge--start'));
  dispose();
});

test('position: top-end (default) adds no corner modifier', () => {
  const { el, dispose } = mount({ content: 1 }, host);
  assert.ok(!el.classList.contains('weave-badge--bottom'));
  assert.ok(!el.classList.contains('weave-badge--start'));
  dispose();
});

test('forwarded class is appended', () => {
  const { el, dispose } = mount({ content: 1, class: 'nav-badge' }, host);
  assert.ok(el.classList.contains('weave-badge') && el.classList.contains('nav-badge'));
  dispose();
});
