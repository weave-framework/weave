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
import {
  setup,
  template,
  type ButtonToggleProps,
  type ButtonToggleContext,
  type ButtonToggleOption,
} from '@weave-framework/ui/button-toggle';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'host', 'options', 'groupClass', 'groupRole', 'segmentRole', 'label',
  'ariaChecked', 'ariaPressed', 'tabindexFor', 'isOptionDisabled', 'activate', 'onKeydown',
];

function mount(props: ButtonToggleProps): { group: HTMLElement; segments: HTMLButtonElement[]; dispose: () => void } {
  const owner: Owner = createOwner();
  const group: HTMLElement = runInOwner(owner, () => {
    const ctx: ButtonToggleContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(group);
  // Segments are stable (the option list doesn't change within a test), so query once.
  const segments: HTMLButtonElement[] = Array.from(
    group.querySelectorAll<HTMLButtonElement>('.weave-button-toggle__segment')
  );
  return { group, segments, dispose: (): void => { disposeOwner(owner); group.remove(); } };
}

const OPTS: ButtonToggleOption[] = [
  { value: 'list', label: 'List' },
  { value: 'grid', label: 'Grid' },
  { value: 'map', label: 'Map' },
];
const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

/* ─────────────────────────── single-select (radiogroup) ─────────────────────────── */

test('single: renders a radiogroup of role=radio segments', () => {
  const { group, segments, dispose } = mount({ options: OPTS, value: 'list' });
  assert.equal(group.getAttribute('role'), 'radiogroup');
  assert.equal(segments.length, 3);
  assert.ok(segments.every((s) => s.getAttribute('role') === 'radio'), 'each segment is a radio');
  assert.equal(segments[0].textContent, 'List');
  dispose();
});

test('single: the selected segment carries aria-checked=true, others false', () => {
  const { segments, dispose } = mount({ options: OPTS, value: 'grid' });
  assert.deepEqual(segments.map((s) => s.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.ok(segments.every((s) => !s.hasAttribute('aria-pressed')), 'no aria-pressed in single mode');
  dispose();
});

test('single: aria-checked tracks a reactive value signal (updates after mount)', () => {
  const v: Signal<string> = signal<string>('list');
  const { segments, dispose } = mount({
    options: OPTS,
    get value(): string {
      return v();
    },
  });
  assert.deepEqual(segments.map((s) => s.getAttribute('aria-checked')), ['true', 'false', 'false']);
  v.set('map'); // change the bound value AFTER mount
  assert.deepEqual(
    segments.map((s) => s.getAttribute('aria-checked')),
    ['false', 'false', 'true'],
    'aria-checked reflects the new value reactively',
  );
  dispose();
});

test('single: roving tabindex — only the selected segment is tabbable', () => {
  const { segments, dispose } = mount({ options: OPTS, value: 'map' });
  assert.deepEqual(segments.map((s) => s.getAttribute('tabindex')), ['-1', '-1', '0']);
  dispose();
});

test('single: with no value, the first enabled segment is the tab stop', () => {
  const { segments, dispose } = mount({ options: OPTS, value: null });
  assert.deepEqual(segments.map((s) => s.getAttribute('tabindex')), ['0', '-1', '-1']);
  dispose();
});

test('single: clicking a segment emits its value', () => {
  let got: string | string[] | undefined;
  const { segments, dispose } = mount({ options: OPTS, value: 'list', onChange: (v) => (got = v) });
  segments[2].click();
  assert.equal(got, 'map');
  dispose();
});

test('single: ArrowRight moves selection to the next segment, and wraps', () => {
  const value: Signal<string> = signal('list');
  const emitted: string[] = [];
  const { group, dispose } = mount({
    options: OPTS,
    get value() { return value(); },
    onChange: (v) => { emitted.push(v as string); value.set(v as string); },
  });
  key(group, 'ArrowRight');
  assert.equal(emitted.at(-1), 'grid', 'list → grid');
  key(group, 'ArrowRight');
  assert.equal(emitted.at(-1), 'map', 'grid → map');
  key(group, 'ArrowRight');
  assert.equal(emitted.at(-1), 'list', 'map → wraps to list');
  dispose();
});

test('single: Arrow skips a disabled segment', () => {
  const opts: ButtonToggleOption[] = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }];
  let got: string | undefined;
  const { group, dispose } = mount({ options: opts, value: 'a', onChange: (v) => (got = v as string) });
  key(group, 'ArrowRight');
  assert.equal(got, 'c', 'a → c (b is skipped)');
  dispose();
});

test('single: a disabled segment renders the native disabled attribute and is not selectable', () => {
  const opts: ButtonToggleOption[] = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }];
  let got: string | undefined;
  const { segments, dispose } = mount({ options: opts, value: 'a', onChange: (v) => (got = v as string) });
  assert.equal(segments[1].disabled, true, 'native disabled reflected');
  segments[1].click();
  assert.equal(got, undefined, 'clicking a disabled segment does nothing');
  dispose();
});

/* ─────────────────────────── multi-select (toolbar) ─────────────────────────── */

test('multi: renders role=group with aria-pressed toggle buttons (no radio semantics)', () => {
  const { group, segments, dispose } = mount({ multiple: true, options: OPTS, value: ['grid'] });
  assert.equal(group.getAttribute('role'), 'group');
  assert.ok(segments.every((s) => !s.hasAttribute('role')), 'plain buttons, not radios');
  assert.deepEqual(segments.map((s) => s.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.ok(segments.every((s) => !s.hasAttribute('aria-checked')), 'no aria-checked in multi mode');
  dispose();
});

test('multi: clicking toggles membership in the value array', () => {
  const value: Signal<string[]> = signal<string[]>(['list']);
  const { segments, dispose } = mount({
    multiple: true,
    options: OPTS,
    get value() { return value(); },
    onChange: (v) => value.set(v as string[]),
  });
  segments[1].click(); // add grid
  assert.deepEqual(value(), ['list', 'grid']);
  segments[0].click(); // remove list
  assert.deepEqual(value(), ['grid']);
  dispose();
});

test('multi: Space toggles the focused segment (not just click)', () => {
  const value: Signal<string[]> = signal<string[]>([]);
  const { group, segments, dispose } = mount({
    multiple: true,
    options: OPTS,
    get value() { return value(); },
    onChange: (v) => value.set(v as string[]),
  });
  key(group, 'ArrowRight'); // focus moves to index 1 (from the first tab stop, 0 → 1)
  key(segments[1], ' ');
  assert.deepEqual(value(), ['grid'], 'Space pressed the focused toggle');
  dispose();
});

/* ─────────────────────────── group state + a11y ─────────────────────────── */

test('group disabled: every segment is disabled', () => {
  const { segments, dispose } = mount({ options: OPTS, value: 'list', disabled: true });
  assert.ok(segments.every((s) => s.disabled), 'all segments disabled');
  dispose();
});

test('label sets the group aria-label', () => {
  const { group, dispose } = mount({ options: OPTS, value: 'list', label: 'View mode' });
  assert.equal(group.getAttribute('aria-label'), 'View mode');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { group, dispose } = mount({ options: OPTS, value: 'list', class: 'toolbar-seg' });
  assert.ok(group.classList.contains('weave-button-toggle') && group.classList.contains('toolbar-seg'));
  dispose();
});
