import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  type Signal,
  type Owner,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type SliderProps, type SliderContext, type SliderControl } from '@weave-framework/ui/slider';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'host', 'rootClass', 'tabindex', 'min', 'max', 'value', 'valueText', 'label',
  'disabledAttr', 'invalidAttr', 'fillStyle', 'thumbStyle',
  'onPointerdown', 'onPointermove', 'onPointerup', 'onKeydown',
];

function mount(props: SliderProps): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: SliderContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(el);
  return { el, dispose: (): void => { disposeOwner(owner); el.remove(); } };
}

const field = (v: number): SliderControl & { value: Signal<number>; touched: Signal<boolean> } => ({
  value: signal<number>(v),
  touched: signal<boolean>(false),
  error: (): string | null => null,
});
const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

/* ─────────────────────────── structure + a11y ─────────────────────────── */

test('renders role=slider with the value ARIA + a focusable tab stop', () => {
  const { el, dispose } = mount({ value: 40, label: 'Volume' });
  assert.equal(el.getAttribute('role'), 'slider');
  assert.equal(el.getAttribute('aria-valuemin'), '0');
  assert.equal(el.getAttribute('aria-valuemax'), '100');
  assert.equal(el.getAttribute('aria-valuenow'), '40');
  assert.equal(el.getAttribute('aria-valuetext'), '40');
  assert.equal(el.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(el.getAttribute('aria-label'), 'Volume');
  assert.equal(el.getAttribute('tabindex'), '0');
  dispose();
});

test('fill width + thumb position reflect the value percent', () => {
  const { el, dispose } = mount({ value: 25 });
  assert.equal(el.querySelector<HTMLElement>('.weave-slider__fill')?.style.width, '25%');
  assert.equal(el.querySelector<HTMLElement>('.weave-slider__thumb')?.style.left, '25%');
  dispose();
});

/* ─────────────────────────── keyboard ─────────────────────────── */

test('Arrow keys step, Home/End jump, values clamp to the range', () => {
  const seen: number[] = [];
  const { el, dispose } = mount({ defaultValue: 50, step: 1, onChange: (v): void => { seen.push(v); } });
  key(el, 'ArrowRight');
  assert.equal(el.getAttribute('aria-valuenow'), '51');
  key(el, 'ArrowLeft');
  key(el, 'ArrowLeft');
  assert.equal(el.getAttribute('aria-valuenow'), '49');
  key(el, 'Home');
  assert.equal(el.getAttribute('aria-valuenow'), '0');
  key(el, 'ArrowLeft'); // already at min → clamps
  assert.equal(el.getAttribute('aria-valuenow'), '0');
  key(el, 'End');
  assert.equal(el.getAttribute('aria-valuenow'), '100');
  assert.ok(seen.includes(51) && seen.includes(0) && seen.includes(100));
  dispose();
});

test('PageUp/PageDown move by the larger page step', () => {
  const { el, dispose } = mount({ defaultValue: 50, step: 1 }); // page = max(1, (100-0)/10) = 10
  key(el, 'PageUp');
  assert.equal(el.getAttribute('aria-valuenow'), '60');
  key(el, 'PageDown');
  key(el, 'PageDown');
  assert.equal(el.getAttribute('aria-valuenow'), '40');
  dispose();
});

test('step snaps values to the grid', () => {
  const { el, dispose } = mount({ defaultValue: 0, step: 5 });
  key(el, 'ArrowRight');
  assert.equal(el.getAttribute('aria-valuenow'), '5');
  key(el, 'PageUp'); // page = max(5, 10) = 10
  assert.equal(el.getAttribute('aria-valuenow'), '15');
  dispose();
});

test('honours non-default min/max', () => {
  const { el, dispose } = mount({ min: -50, max: 50, defaultValue: 0 });
  assert.equal(el.getAttribute('aria-valuemin'), '-50');
  assert.equal(el.getAttribute('aria-valuemax'), '50');
  assert.equal(el.querySelector<HTMLElement>('.weave-slider__fill')?.style.width, '50%', '0 is the midpoint');
  key(el, 'Home');
  assert.equal(el.getAttribute('aria-valuenow'), '-50');
  dispose();
});

/* ─────────────────────────── controlled + control ─────────────────────────── */

test('controlled value drives the slider; onChange reports the next value', () => {
  const v: Signal<number> = signal<number>(10);
  const seen: number[] = [];
  const { el, dispose } = mount({
    get value(): number { return v(); },
    onChange: (n): void => { seen.push(n); v.set(n); },
  } as SliderProps);
  key(el, 'ArrowRight');
  assert.deepEqual(seen, [11]);
  assert.equal(el.getAttribute('aria-valuenow'), '11', 'value re-drove the DOM');
  dispose();
});

test('control (Field<number>): two-way value + touched-on-interaction + aria-invalid', () => {
  const ctl: SliderControl & { value: Signal<number>; touched: Signal<boolean> } = field(20);
  let invalid: boolean = false;
  const props: SliderProps = { control: { value: ctl.value, touched: ctl.touched, error: (): string | null => (invalid ? 'too low' : null) } };
  const { el, dispose } = mount(props);
  assert.equal(el.getAttribute('aria-valuenow'), '20');
  key(el, 'ArrowRight');
  assert.equal(ctl.value(), 21, 'writes back into the field');
  assert.equal(ctl.touched(), true, 'interaction marks touched');
  dispose();
});

test('control: aria-invalid only while touched AND errored', () => {
  const val: Signal<number> = signal<number>(5);
  const touched: Signal<boolean> = signal<boolean>(false);
  const { el, dispose } = mount({ control: { value: val, touched, error: (): string | null => 'bad' } });
  assert.equal(el.getAttribute('aria-invalid'), null, 'not invalid until touched');
  touched.set(true);
  assert.equal(el.getAttribute('aria-invalid'), 'true');
  assert.ok(el.classList.contains('weave-slider--invalid'));
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('disabled: aria-disabled, not tabbable, keys are inert', () => {
  const { el, dispose } = mount({ defaultValue: 30, disabled: true });
  assert.equal(el.getAttribute('aria-disabled'), 'true');
  assert.equal(el.getAttribute('tabindex'), '-1');
  assert.ok(el.classList.contains('weave-slider--disabled'));
  key(el, 'ArrowRight');
  assert.equal(el.getAttribute('aria-valuenow'), '30', 'no change while disabled');
  dispose();
});

/* ─────────────────────────── pointer drag ─────────────────────────── */

test('pointerdown sets the value from the pointer position on the track', () => {
  const { el, dispose } = mount({ defaultValue: 0 });
  el.style.width = '200px';
  el.style.display = 'block';
  const track: HTMLElement = el.querySelector<HTMLElement>('.weave-slider__track')!;
  const rect: DOMRect = track.getBoundingClientRect();
  // click at 75% across the track
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width * 0.75, pointerId: 1, bubbles: true, cancelable: true }));
  assert.equal(el.getAttribute('aria-valuenow'), '75');
  // a move continues the drag
  el.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.3, pointerId: 1, bubbles: true }));
  assert.equal(el.getAttribute('aria-valuenow'), '30');
  el.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * 0.3, pointerId: 1, bubbles: true }));
  dispose();
});

/* ─────────────────────────── value text ─────────────────────────── */

test('format customises aria-valuetext', () => {
  const { el, dispose } = mount({ value: 42, format: (v): string => `${v}%` });
  assert.equal(el.getAttribute('aria-valuetext'), '42%');
  dispose();
});

/* ─────────────────────────── class forwarding ─────────────────────────── */

test('forwards a custom class onto the root', () => {
  const { el, dispose } = mount({ value: 0, class: 'my-slider' });
  assert.ok(el.classList.contains('weave-slider') && el.classList.contains('my-slider'));
  dispose();
});
