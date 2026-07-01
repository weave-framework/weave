import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type ToolbarProps, type ToolbarContext } from '@weave-framework/ui/toolbar';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

type RenderFn = (ctx: ToolbarContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: ToolbarContext, rt: unknown, c: unknown) => RenderFn;

function mount(props: ToolbarProps, slot?: () => Node): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: ToolbarContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: ['toolbarClass'] });
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
  const s: HTMLElement = document.createElement('strong');
  s.textContent = 'Weave UI';
  return s;
};

test('renders a .weave-toolbar container with its content projected', () => {
  const { el, dispose } = mount({}, content);
  assert.ok(el.classList.contains('weave-toolbar'), 'base class');
  assert.ok(!el.className.includes('weave-toolbar--'), 'no modifier by default');
  assert.equal(el.textContent, 'Weave UI', 'slot content projected');
  dispose();
});

test('variant=ink adds the --ink modifier', () => {
  const { el, dispose } = mount({ variant: 'ink' }, content);
  assert.ok(el.classList.contains('weave-toolbar--ink'));
  dispose();
});

test('sticky adds the --sticky modifier', () => {
  const { el, dispose } = mount({ sticky: true }, content);
  assert.ok(el.classList.contains('weave-toolbar--sticky'));
  dispose();
});

test('ink + sticky + forwarded class all compose', () => {
  const { el, dispose } = mount({ variant: 'ink', sticky: true, class: 'app-bar' }, content);
  assert.ok(el.classList.contains('weave-toolbar'), 'base kept');
  assert.ok(el.classList.contains('weave-toolbar--ink'), 'ink kept');
  assert.ok(el.classList.contains('weave-toolbar--sticky'), 'sticky kept');
  assert.ok(el.classList.contains('app-bar'), 'consumer class forwarded');
  dispose();
});
