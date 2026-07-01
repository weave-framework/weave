import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type CardProps, type CardContext } from '@weave-framework/ui/card';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

type RenderFn = (ctx: CardContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: CardContext, rt: unknown, c: unknown) => RenderFn;

function mount(props: CardProps, slot?: () => Node): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: CardContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: ['cardClass'] });
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
  return { el, dispose: (): void => { disposeOwner(owner); el.remove(); } };
}

const content = (): Node => {
  const t: HTMLElement = document.createElement('h3');
  t.className = 'weave-card__title';
  t.textContent = 'Weekly report';
  return t;
};

test('renders a .weave-card container with its composed content projected', () => {
  const { el, dispose } = mount({}, content);
  assert.ok(el.classList.contains('weave-card'), 'base class');
  assert.ok(!el.className.includes('weave-card--'), 'no modifier by default');
  const title: Element | null = el.querySelector('.weave-card__title');
  assert.ok(title, 'composed part is projected as-is');
  assert.equal(title!.textContent, 'Weekly report');
  dispose();
});

test('interactive adds the --interactive modifier', () => {
  const { el, dispose } = mount({ interactive: true }, content);
  assert.ok(el.classList.contains('weave-card--interactive'));
  dispose();
});

test('not interactive by default', () => {
  const { el, dispose } = mount({}, content);
  assert.ok(!el.classList.contains('weave-card--interactive'));
  dispose();
});

test('forwarded class is appended, base preserved', () => {
  const { el, dispose } = mount({ interactive: true, class: 'span-2' }, content);
  assert.ok(el.classList.contains('weave-card'), 'base kept');
  assert.ok(el.classList.contains('weave-card--interactive'), 'modifier kept');
  assert.ok(el.classList.contains('span-2'), 'consumer class forwarded');
  dispose();
});
