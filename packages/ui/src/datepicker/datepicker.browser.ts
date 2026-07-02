import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { createDateAdapter, type DateAdapter } from '@weave-framework/ui/cdk';
import { setup, template, type DatepickerProps, type DatepickerContext, type DatepickerControl } from '@weave-framework/ui/datepicker';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const A: DateAdapter = createDateAdapter({ locale: 'en-US' });

type MakeRender = (ctx: DatepickerContext, rt: unknown, c: unknown) => (ctx: DatepickerContext, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted {
  root: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount(props: DatepickerProps): Promise<Mounted> {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: DatepickerContext = setup(props);
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

function dateField(initial: Date | null): DatepickerControl {
  return { value: signal<Date | null | undefined>(initial), touched: signal(false), error: (): string | null => null };
}
const field = (m: Mounted): HTMLElement => m.root.querySelector('.weave-datepicker__field') as HTMLElement;
const panel = (): HTMLElement | null => document.body.querySelector('.weave-datepicker__panel');
const cells = (): HTMLButtonElement[] =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-datepicker__cell:not(.weave-datepicker__cell--blank)'));
const cellByText = (t: string): HTMLButtonElement =>
  cells().find((c) => (c.textContent ?? '') === t) as HTMLButtonElement;
const gridKey = (k: string, shift: boolean = false): void => {
  document.body
    .querySelector('.weave-datepicker__grid')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k, shiftKey: shift }));
};

const matchRe = (s: string, re: RegExp): void => assert.ok(re.test(s), `${JSON.stringify(s)} matches ${re}`);

const JUN15: Date = A.create(2026, 5, 15);

/* ── field ── */
test('datepicker: renders a combobox field; the value formats via the adapter', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  const f: HTMLElement = field(m);
  assert.equal(f.getAttribute('role'), 'combobox');
  assert.equal(f.getAttribute('aria-haspopup'), 'dialog');
  matchRe(f.textContent ?? '', /Jun 15, 2026/);
  m.dispose();
});

test('datepicker: placeholder shows when empty', async () => {
  const m: Mounted = await mount({ control: dateField(null), placeholder: 'Pick a date', locale: 'en-US' });
  matchRe(field(m).textContent ?? '', /Pick a date/);
  assert.ok(m.root.querySelector('.weave-datepicker__value--placeholder'));
  m.dispose();
});

/* ── open + grid ── */
test('datepicker: clicking the field opens the calendar to the selected month; the day is marked', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  assert.equal(panel(), null, 'closed initially');
  field(m).click();
  assert.ok(panel(), 'calendar opened');
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /June 2026/);
  const sel: HTMLButtonElement = cellByText('15');
  assert.equal(sel.getAttribute('aria-selected'), 'true');
  assert.ok(sel.classList.contains('weave-datepicker__cell--selected'));
  assert.equal(field(m).getAttribute('aria-expanded'), 'true');
  m.dispose();
});

test('datepicker: clicking a day commits it + closes the panel', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('20').click();
  assert.ok(ctl.value() && A.isSameDay(ctl.value() as Date, A.create(2026, 5, 20)), 'committed Jun 20');
  assert.equal(panel(), null, 'closed after select');
  matchRe(field(m).textContent ?? '', /Jun 20, 2026/);
  m.dispose();
});

/* ── min / max / filter ── */
test('datepicker: min/max disable out-of-range days', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, min: A.create(2026, 5, 10), max: A.create(2026, 5, 20), locale: 'en-US' });
  field(m).click();
  assert.equal(cellByText('5').disabled, true, 'before min disabled');
  assert.equal(cellByText('25').disabled, true, 'after max disabled');
  assert.equal(cellByText('15').disabled, false, 'in range enabled');
  cellByText('5').click(); // a disabled <button> dispatches no click → no commit, panel stays open
  assert.ok(panel(), 'still open after clicking a disabled day');
  assert.ok(A.isSameDay(ctl.value() as Date, JUN15), 'value unchanged');
  m.dispose();
});

test('datepicker: dateFilter disables specific days', async () => {
  // Disable weekends.
  const m: Mounted = await mount({
    control: dateField(JUN15),
    dateFilter: (d: Date): boolean => A.getDayOfWeek(d) !== 0 && A.getDayOfWeek(d) !== 6,
    locale: 'en-US',
  });
  field(m).click();
  // Jun 13 2026 is a Saturday, Jun 15 a Monday.
  assert.equal(cellByText('13').disabled, true, 'Saturday filtered out');
  assert.equal(cellByText('15').disabled, false, 'Monday allowed');
  m.dispose();
});

/* ── keyboard ── */
test('datepicker: arrow keys move day focus; Enter selects', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  gridKey('ArrowDown'); // 15 → 22
  gridKey('ArrowRight'); // 22 → 23
  gridKey('Enter');
  assert.ok(A.isSameDay(ctl.value() as Date, A.create(2026, 5, 23)), 'selected Jun 23 via keyboard');
  m.dispose();
});

test('datepicker: PageDown moves a month; Shift+PageDown moves a year', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  gridKey('PageDown'); // → July 2026
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /July 2026/);
  gridKey('PageDown', true); // +1 year → July 2027
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /July 2027/);
  m.dispose();
});

test('datepicker: Escape closes + returns focus to the field', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  assert.ok(panel());
  gridKey('Escape');
  assert.equal(panel(), null);
  assert.equal(document.activeElement, field(m), 'focus returned to the trigger');
  m.dispose();
});

/* ── month nav buttons ── */
test('datepicker: ‹ / › step the visible month', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  (panel()!.querySelector('.weave-datepicker__nav-button') as HTMLButtonElement).click(); // ‹ prev
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /May 2026/);
  m.dispose();
});

/* ── clear ── */
test('datepicker: clearable × resets the value', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, clearable: true, locale: 'en-US' });
  const clear: HTMLButtonElement = m.root.querySelector('.weave-datepicker__clear') as HTMLButtonElement;
  assert.ok(clear, 'clear shown when a date is set');
  clear.click();
  assert.equal(ctl.value(), null);
  m.dispose();
});

/* ── value/onChange binding (no control) ── */
test('datepicker: value + onChange binding (uncontrolled forms convention)', async () => {
  let out: Date | null = null;
  const m: Mounted = await mount({ value: JUN15, onChange: (d) => (out = d), locale: 'en-US' });
  field(m).click();
  cellByText('1').click();
  assert.ok(out && A.isSameDay(out as Date, A.create(2026, 5, 1)));
  m.dispose();
});
