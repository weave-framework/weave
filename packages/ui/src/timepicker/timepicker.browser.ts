import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { setup, template, type TimepickerProps, type TimepickerContext, type TimepickerControl, type TimeValue } from '@weave-framework/ui/timepicker';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

type MakeRender = (ctx: TimepickerContext, rt: unknown, c: unknown) => (ctx: TimepickerContext, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted {
  root: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount(props: TimepickerProps): Promise<Mounted> {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: TimepickerContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    return make(ctx, rt, {})(ctx, {});
  });
  document.body.appendChild(root);
  await tick();
  return {
    root,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      root.remove();
    },
  };
}

function timeField(initial: TimeValue | null): TimepickerControl {
  return { value: signal<TimeValue | null | undefined>(initial), touched: signal(false), error: (): string | null => null };
}
const matchRe = (s: string, re: RegExp): void => assert.ok(re.test(s), `${JSON.stringify(s)} matches ${re}`);
const field = (m: Mounted): HTMLElement => m.root.querySelector('.weave-timepicker__field') as HTMLElement;
const panel = (): HTMLElement | null => document.body.querySelector('.weave-timepicker__panel');
const cols = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('.weave-timepicker__col'));
const colValue = (col: HTMLElement): string => col.querySelector('.weave-timepicker__col-value')!.textContent ?? '';
const up = (col: HTMLElement): HTMLButtonElement => col.querySelectorAll<HTMLButtonElement>('.weave-timepicker__spin')[0];
const down = (col: HTMLElement): HTMLButtonElement => col.querySelectorAll<HTMLButtonElement>('.weave-timepicker__spin')[1];
const ampm = (): HTMLButtonElement | null => document.body.querySelector('.weave-timepicker__ampm');

const T0930: TimeValue = { hours: 9, minutes: 30 };

/* ── field ── */
test('timepicker: renders a combobox field; formats the value (12h locale)', async () => {
  const m: Mounted = await mount({ control: timeField(T0930), locale: 'en-US' });
  const f: HTMLElement = field(m);
  assert.equal(f.getAttribute('role'), 'combobox');
  matchRe(f.textContent ?? '', /9:30\s*AM/);
  m.dispose();
});

test('timepicker: placeholder shows when empty', async () => {
  const m: Mounted = await mount({ control: timeField(null), placeholder: 'Pick a time', locale: 'en-US' });
  matchRe(field(m).textContent ?? '', /Pick a time/);
  assert.ok(m.root.querySelector('.weave-timepicker__value--placeholder'));
  m.dispose();
});

/* ── panel open ── */
test('timepicker: clicking opens hour:minute spinner columns + AM/PM (12h)', async () => {
  const m: Mounted = await mount({ control: timeField(T0930), locale: 'en-US' });
  assert.equal(panel(), null);
  field(m).click();
  assert.ok(panel());
  assert.equal(cols().length, 2, 'hour + minute columns');
  assert.equal(colValue(cols()[0]), '9', 'hour');
  assert.equal(colValue(cols()[1]), '30', 'minute');
  assert.equal(ampm()!.textContent, 'AM');
  m.dispose();
});

/* ── spinner ops ── */
test('timepicker: hour ▲ increments (12h) + commits', async () => {
  const ctl: TimepickerControl = timeField(T0930);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  up(cols()[0]).click();
  assert.deepEqual(ctl.value(), { hours: 10, minutes: 30 });
  assert.equal(colValue(cols()[0]), '10');
  m.dispose();
});

test('timepicker: hour wraps within the AM/PM half (12 → 1, keeps AM)', async () => {
  const ctl: TimepickerControl = timeField({ hours: 11, minutes: 0 }); // 11 AM
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  up(cols()[0]).click(); // 11 → 12 (noon would flip, but the hour spinner stays in-half → 12 AM slot = 0h)
  assert.equal(colValue(cols()[0]), '12');
  up(cols()[0]).click(); // 12 → 1
  assert.equal(colValue(cols()[0]), '1');
  assert.equal(ampm()!.textContent, 'AM', 'AM/PM unchanged by the hour spinner');
  m.dispose();
});

test('timepicker: minute ▲/▼ steps by `step`', async () => {
  const ctl: TimepickerControl = timeField(T0930);
  const m: Mounted = await mount({ control: ctl, step: 15, locale: 'en-US' });
  field(m).click();
  up(cols()[1]).click(); // 30 → 45
  assert.deepEqual(ctl.value(), { hours: 9, minutes: 45 });
  down(cols()[1]).click(); // 45 → 30
  assert.deepEqual(ctl.value(), { hours: 9, minutes: 30 });
  m.dispose();
});

test('timepicker: AM/PM toggle flips 12 hours', async () => {
  const ctl: TimepickerControl = timeField(T0930); // 09:30
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  ampm()!.click();
  assert.deepEqual(ctl.value(), { hours: 21, minutes: 30 }, '9:30 AM → 9:30 PM');
  assert.equal(ampm()!.textContent, 'PM');
  m.dispose();
});

/* ── 24h ── */
test('timepicker: use24 shows 0-23 hours + no AM/PM', async () => {
  const ctl: TimepickerControl = timeField({ hours: 13, minutes: 15 });
  const m: Mounted = await mount({ control: ctl, use24: true, locale: 'en-GB' });
  matchRe(field(m).textContent ?? '', /13:15/);
  field(m).click();
  assert.equal(colValue(cols()[0]), '13');
  assert.equal(ampm(), null, 'no AM/PM in 24h');
  up(cols()[0]).click(); // 13 → 14
  assert.deepEqual(ctl.value(), { hours: 14, minutes: 15 });
  m.dispose();
});

/* ── keyboard ── */
test('timepicker: Arrow Up/Down on a spinbutton column inc/decrements', async () => {
  const ctl: TimepickerControl = timeField(T0930);
  const m: Mounted = await mount({ control: ctl, use24: true, locale: 'en-GB' });
  field(m).click();
  cols()[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
  assert.deepEqual(ctl.value(), { hours: 10, minutes: 30 });
  cols()[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  assert.deepEqual(ctl.value(), { hours: 10, minutes: 25 });
  m.dispose();
});

/* ── min/max clamp ── */
test('timepicker: committed time is clamped to [min, max]', async () => {
  const ctl: TimepickerControl = timeField({ hours: 9, minutes: 30 });
  const m: Mounted = await mount({ control: ctl, min: { hours: 9, minutes: 0 }, max: { hours: 17, minutes: 0 }, use24: true, locale: 'en-GB' });
  field(m).click();
  down(cols()[0]).click(); // 9 → 8, below min 9:00 → clamps to 09:00
  assert.deepEqual(ctl.value(), { hours: 9, minutes: 0 });
  m.dispose();
});

/* ── clear + Escape + binding ── */
test('timepicker: clearable × resets the value', async () => {
  const ctl: TimepickerControl = timeField(T0930);
  const m: Mounted = await mount({ control: ctl, clearable: true, locale: 'en-US' });
  (m.root.querySelector('.weave-timepicker__clear') as HTMLButtonElement).click();
  assert.equal(ctl.value(), null);
  m.dispose();
});

test('timepicker: Escape closes + returns focus to the field', async () => {
  const m: Mounted = await mount({ control: timeField(T0930), locale: 'en-US' });
  field(m).click();
  assert.ok(panel());
  cols()[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(panel(), null);
  assert.equal(document.activeElement, field(m));
  m.dispose();
});

test('timepicker: value + onChange binding (uncontrolled forms convention)', async () => {
  let out: TimeValue | null = null;
  const m: Mounted = await mount({ value: T0930, onChange: (v) => (out = v), use24: true, locale: 'en-GB' });
  field(m).click();
  up(cols()[1]).click(); // minute 30 → 35
  assert.deepEqual(out, { hours: 9, minutes: 35 });
  m.dispose();
});
