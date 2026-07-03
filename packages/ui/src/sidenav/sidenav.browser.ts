import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type SidenavProps, type SidenavContext, type SidenavApi } from '@weave-framework/ui/sidenav';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = ['root', 'drawer', 'rootClass', 'drawerModal', 'onKeydown', 'onBackdropClick'];

type RenderFn = (ctx: SidenavContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: SidenavContext, rt: unknown, c: unknown) => RenderFn;

interface Mounted {
  root: HTMLElement;
  drawer: HTMLElement;
  content: HTMLElement;
  backdrop: HTMLElement;
  dispose: () => void;
}

function mount(props: SidenavProps, slots: Record<string, () => Node> = {}): Mounted {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: SidenavContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;'),
    ) as MakeRender;
    return make(ctx, rt, {})(ctx, slots);
  });
  document.body.appendChild(root);
  return {
    root,
    drawer: root.querySelector('.weave-sidenav__drawer') as HTMLElement,
    content: root.querySelector('.weave-sidenav__content') as HTMLElement,
    backdrop: root.querySelector('.weave-sidenav__backdrop') as HTMLElement,
    dispose: (): void => {
      disposeOwner(owner);
      root.remove();
    },
  };
}

const textNode = (t: string): (() => Node) => (): Node => document.createTextNode(t);
const buttonNode = (label: string): (() => Node) => (): Node => {
  const b: HTMLButtonElement = document.createElement('button');
  b.textContent = label;
  return b;
};

/* ── structure + slots ── */
test('sidenav renders drawer / content / backdrop and projects both slots', () => {
  const m: Mounted = mount(
    { mode: 'side' },
    { drawer: textNode('NAV'), default: textNode('PAGE') },
  );
  assert.ok(m.drawer && m.content && m.backdrop, 'three parts present');
  assert.equal(m.drawer.textContent, 'NAV');
  assert.equal(m.content.textContent, 'PAGE');
  m.dispose();
});

test('sidenav: over-mode open drawer declares aria-modal; side / closed do not', () => {
  const over: Mounted = mount({ mode: 'over', defaultOpened: true });
  assert.equal(over.drawer.getAttribute('aria-modal'), 'true', 'over + opened is modal');
  over.dispose();
  const side: Mounted = mount({ mode: 'side', defaultOpened: true });
  assert.equal(side.drawer.getAttribute('aria-modal'), null, 'side mode is not modal');
  side.dispose();
  const closed: Mounted = mount({ mode: 'over', defaultOpened: false });
  assert.equal(closed.drawer.getAttribute('aria-modal'), null, 'over + closed is not modal');
  closed.dispose();
});

/* ── mode + open modifier classes ── */
test('explicit side mode + defaultOpened reflects on the root class', () => {
  const m: Mounted = mount({ mode: 'side', defaultOpened: true });
  assert.ok(m.root.classList.contains('weave-sidenav--side'), 'side modifier');
  assert.ok(m.root.classList.contains('weave-sidenav--opened'), 'opened modifier');
  m.dispose();
});

test('explicit over mode adds the backdrop modifier only while open', () => {
  const m: Mounted = mount({ mode: 'over', defaultOpened: true });
  assert.ok(m.root.classList.contains('weave-sidenav--over'), 'over modifier');
  assert.ok(m.root.classList.contains('weave-sidenav--backdrop'), 'backdrop active when open');
  m.dispose();
});

test('side mode never shows the backdrop', () => {
  const m: Mounted = mount({ mode: 'side', defaultOpened: true });
  assert.ok(!m.root.classList.contains('weave-sidenav--backdrop'), 'no backdrop in side');
  m.dispose();
});

test('position=end adds the --end modifier', () => {
  const m: Mounted = mount({ mode: 'side', position: 'end' });
  assert.ok(m.root.classList.contains('weave-sidenav--end'));
  m.dispose();
});

test('forwards a custom class onto the root', () => {
  const m: Mounted = mount({ mode: 'side', class: 'app-shell' });
  assert.ok(m.root.classList.contains('app-shell'));
  m.dispose();
});

/* ── controlled binding ── */
test('controlled opened + onOpenedChange (backdrop click requests close, does not self-mutate)', () => {
  const opened: Signal<boolean> = signal<boolean>(true);
  let last: boolean | null = null;
  const m: Mounted = mount({
    mode: 'over',
    get opened(): boolean {
      return opened();
    },
    onOpenedChange: (v: boolean) => (last = v),
  });
  assert.ok(m.root.classList.contains('weave-sidenav--opened'), 'reflects controlled true');
  m.backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(last, false, 'backdrop click requested close');
  assert.ok(m.root.classList.contains('weave-sidenav--opened'), 'controlled state unchanged until parent updates');
  // The parent updating the source signal flips the class.
  opened.set(false);
  assert.ok(!m.root.classList.contains('weave-sidenav--opened'), 'follows the controlled source');
  m.dispose();
});

/* ── imperative api ── */
test('api ref exposes open / close / toggle + reactive opened()', async () => {
  let api: SidenavApi | null = null;
  const m: Mounted = mount({ mode: 'side', defaultOpened: false, api: (a: SidenavApi) => (api = a) });
  await tick();
  assert.ok(api, 'api delivered on mount');
  const a: SidenavApi = api as unknown as SidenavApi;
  assert.equal(a.opened(), false);
  a.open();
  assert.equal(a.opened(), true, 'open() sets state');
  assert.ok(m.root.classList.contains('weave-sidenav--opened'), 'root reflects api open');
  a.toggle();
  assert.equal(a.opened(), false, 'toggle() flips');
  assert.ok(!m.root.classList.contains('weave-sidenav--opened'));
  m.dispose();
});

/* ── Esc closes only in over mode ── */
test('Escape closes an open over drawer, is ignored in side mode', () => {
  let overClosed: boolean | null = null;
  const over: Mounted = mount({ mode: 'over', defaultOpened: true, onOpenedChange: (v: boolean) => (overClosed = v) });
  over.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(overClosed, false, 'over: Esc closed');
  assert.ok(!over.root.classList.contains('weave-sidenav--opened'), 'uncontrolled state closed');
  over.dispose();

  let sideClosed: boolean | null = null;
  const side: Mounted = mount({ mode: 'side', defaultOpened: true, onOpenedChange: (v: boolean) => (sideClosed = v) });
  side.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sideClosed, null, 'side: Esc ignored');
  side.dispose();
});

/* ── responsive (breakpoint-driven mode + open) ── */
test('responsive: a matching narrow query yields over + closed', () => {
  const m: Mounted = mount({ breakpoint: '(max-width: 100000px)' }); // always matches → narrow
  assert.ok(m.root.classList.contains('weave-sidenav--over'), 'auto over when narrow');
  assert.ok(!m.root.classList.contains('weave-sidenav--opened'), 'auto closed when narrow');
  m.dispose();
});

test('responsive: a non-matching narrow query yields side + open', () => {
  const m: Mounted = mount({ breakpoint: '(max-width: 1px)' }); // never matches → wide
  assert.ok(m.root.classList.contains('weave-sidenav--side'), 'auto side when wide');
  assert.ok(m.root.classList.contains('weave-sidenav--opened'), 'auto open when wide');
  m.dispose();
});

/* ── a11y: focus trap in over mode ── */
test('over mode traps focus into the open drawer', async () => {
  const m: Mounted = mount({ mode: 'over', defaultOpened: true }, { drawer: buttonNode('Link') });
  await tick();
  assert.ok(m.drawer.contains(document.activeElement), 'focus moved into the drawer');
  m.dispose();
});
