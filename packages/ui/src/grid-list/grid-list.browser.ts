import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type GridListProps, type GridListContext } from '@weave-framework/ui/grid-list';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

type RenderFn = (ctx: GridListContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: GridListContext, rt: unknown, c: unknown) => RenderFn;

function mount(props: GridListProps, slot?: () => Node): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: GridListContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: ['gridListClass'] });
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

const tiles = (): Node => {
  const frag: DocumentFragment = document.createDocumentFragment();
  for (const [i, label] of ['A', 'B', 'C'].entries()) {
    const tile: HTMLElement = document.createElement('div');
    tile.className = i === 1 ? 'weave-grid-list__tile weave-grid-list__tile--accent' : 'weave-grid-list__tile';
    tile.textContent = label;
    frag.appendChild(tile);
  }
  return frag;
};

test('renders a .weave-grid-list container with its tiles projected', () => {
  const { el, dispose } = mount({}, tiles);
  assert.ok(el.classList.contains('weave-grid-list'), 'base class');
  assert.equal(el.querySelectorAll('.weave-grid-list__tile').length, 3, 'three tiles projected');
  dispose();
});

test('one tile can carry the --accent modifier', () => {
  const { el, dispose } = mount({}, tiles);
  const accent: HTMLElement[] = Array.from(el.querySelectorAll<HTMLElement>('.weave-grid-list__tile--accent'));
  assert.equal(accent.length, 1, 'exactly one accent tile');
  assert.equal(accent[0].textContent, 'B');
  dispose();
});

test('imposes no ARIA role (unopinionated layout container)', () => {
  const { el, dispose } = mount({}, tiles);
  assert.equal(el.getAttribute('role'), null, 'consumer sets a role if the context needs one');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { el, dispose } = mount({ class: 'gallery' }, tiles);
  assert.ok(el.classList.contains('weave-grid-list') && el.classList.contains('gallery'));
  dispose();
});
