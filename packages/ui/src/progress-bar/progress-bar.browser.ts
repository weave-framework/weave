import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type ProgressBarProps, type ProgressBarContext } from '@weave-framework/ui/progress-bar';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = ['barClass', 'valueNow', 'fillStyle', 'label'];

function mount(props: ProgressBarProps): { bar: HTMLElement; fill: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const bar: HTMLElement = runInOwner(owner, () => {
    const ctx: ProgressBarContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(bar);
  const fill: HTMLElement = bar.querySelector<HTMLElement>('.weave-progress-bar__fill')!;
  return { bar, fill, dispose: (): void => { disposeOwner(owner); bar.remove(); } };
}

/* ─────────────────────────── determinate ─────────────────────────── */

test('determinate: role=progressbar with min/max and valuenow', () => {
  const { bar, dispose } = mount({ value: 42 });
  assert.equal(bar.getAttribute('role'), 'progressbar');
  assert.equal(bar.getAttribute('aria-valuemin'), '0');
  assert.equal(bar.getAttribute('aria-valuemax'), '100');
  assert.equal(bar.getAttribute('aria-valuenow'), '42');
  dispose();
});

test('determinate: the fill width tracks the value', () => {
  const { fill, dispose } = mount({ value: 42 });
  assert.equal(fill.style.width, '42%');
  dispose();
});

test('determinate: no value defaults to 0%', () => {
  const { bar, fill, dispose } = mount({});
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(fill.style.width, '0%');
  dispose();
});

test('determinate: value above 100 clamps to 100', () => {
  const { bar, fill, dispose } = mount({ value: 150 });
  assert.equal(bar.getAttribute('aria-valuenow'), '100');
  assert.equal(fill.style.width, '100%');
  dispose();
});

test('determinate: negative value clamps to 0', () => {
  const { bar, fill, dispose } = mount({ value: -20 });
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(fill.style.width, '0%');
  dispose();
});

test('determinate: a non-finite value falls back to 0', () => {
  const { bar, dispose } = mount({ value: Number.NaN });
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  dispose();
});

test('determinate: value updates reactively through a signal', () => {
  const value: ReturnType<typeof signal<number>> = signal(10);
  const { bar, fill, dispose } = mount({ get value() { return value(); } });
  assert.equal(fill.style.width, '10%');
  value.set(75);
  assert.equal(bar.getAttribute('aria-valuenow'), '75', 'aria-valuenow reflows');
  assert.equal(fill.style.width, '75%', 'fill reflows');
  dispose();
});

/* ─────────────────────────── indeterminate ─────────────────────────── */

test('indeterminate: adds the --indeterminate modifier', () => {
  const { bar, dispose } = mount({ indeterminate: true });
  assert.ok(bar.classList.contains('weave-progress-bar--indeterminate'));
  dispose();
});

test('indeterminate: omits aria-valuenow (value is unknown)', () => {
  const { bar, dispose } = mount({ indeterminate: true, value: 50 });
  assert.ok(!bar.hasAttribute('aria-valuenow'), 'no valuenow while indeterminate');
  assert.equal(bar.getAttribute('aria-valuemin'), '0', 'min/max still present');
  assert.equal(bar.getAttribute('aria-valuemax'), '100');
  dispose();
});

test('indeterminate: fill carries no inline width (keyframes drive it)', () => {
  const { fill, dispose } = mount({ indeterminate: true });
  assert.equal(fill.getAttribute('style'), null, 'no inline style');
  dispose();
});

/* ─────────────────────────── a11y + forwarding ─────────────────────────── */

test('label sets the bar aria-label', () => {
  const { bar, dispose } = mount({ value: 30, label: 'Upload' });
  assert.equal(bar.getAttribute('aria-label'), 'Upload');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { bar, dispose } = mount({ value: 30, class: 'tall' });
  assert.ok(bar.classList.contains('weave-progress-bar') && bar.classList.contains('tall'));
  dispose();
});
