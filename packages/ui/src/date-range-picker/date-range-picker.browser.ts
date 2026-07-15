import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { createDateAdapter, type DateAdapter } from '@weave-framework/ui/cdk';
import {
  setup,
  template,
  type DateRangePickerProps,
  type DateRangePickerContext,
  type DateRangePickerControl,
  type DateRange,
} from '@weave-framework/ui/date-range-picker';
import * as IconMod from '@weave-framework/ui/icon';
import { toComponent } from '../internal/compose.js';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const A: DateAdapter = createDateAdapter({ locale: 'en-US' });

type MakeRender = (ctx: DateRangePickerContext, rt: unknown, c: unknown) => (ctx: DateRangePickerContext, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted {
  root: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount(props: DateRangePickerProps): Promise<Mounted> {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: DateRangePickerContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    return make(ctx, rt, { Icon: toComponent(IconMod as never) })(ctx, {});
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

function rangeField(initial: DateRange | null): DateRangePickerControl {
  return { value: signal<DateRange | null | undefined>(initial), touched: signal(false), error: (): string | null => null };
}
const field = (m: Mounted): HTMLElement => m.root.querySelector('.weave-date-range-picker__field') as HTMLElement;
const panel = (): HTMLElement | null => document.body.querySelector('.weave-date-range-picker__panel');
const cells = (): HTMLButtonElement[] =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-date-range-picker__cell:not(.weave-date-range-picker__cell--blank)'));
const cellByText = (t: string): HTMLButtonElement => cells().find((c) => (c.textContent ?? '') === t) as HTMLButtonElement;
const gridKey = (k: string, shift: boolean = false): void => {
  document.body
    .querySelector('.weave-date-range-picker__grid')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k, shiftKey: shift }));
};
const hover = (t: string): void => {
  cellByText(t).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
};
const viewSwitch = (): HTMLButtonElement => document.body.querySelector('.weave-date-range-picker__view-switch') as HTMLButtonElement;
const matchRe = (s: string, re: RegExp, msg?: string): void => assert.ok(re.test(s), msg ?? `${JSON.stringify(s)} matches ${re}`);

const JUN2026 = (day: number): Date => A.create(2026, 5, day);
const RANGE = (a: number, b: number): DateRange => ({ start: JUN2026(a), end: JUN2026(b) });
// An empty picker opens to today's month — build expected days in that month for null-value tests.
const TODAY: Date = A.today();
const thisMonth = (day: number): Date => A.create(A.getYear(TODAY), A.getMonth(TODAY), day);

/* ── field ── */
test('date-range-picker: renders a combobox field; placeholder shows when empty', async () => {
  const m: Mounted = await mount({ control: rangeField(null), placeholder: 'Pick a range', locale: 'en-US' });
  const f: HTMLElement = field(m);
  assert.equal(f.getAttribute('role'), 'combobox');
  assert.equal(f.getAttribute('aria-haspopup'), 'dialog');
  matchRe(f.textContent ?? '', /Pick a range/);
  assert.ok(m.root.querySelector('.weave-date-range-picker__value--placeholder'));
  m.dispose();
});

test('date-range-picker: the field icon is a lucide calendar <Icon>', async () => {
  const m: Mounted = await mount({ control: rangeField(null), locale: 'en-US' });
  const icon: Element | null = m.root.querySelector('.weave-date-range-picker__icon');
  assert.ok(icon?.querySelector('.weave-icon svg'), 'calendar renders a lucide svg');
  m.dispose();
});

test('date-range-picker: shows "start – end" formatted via the adapter', async () => {
  const m: Mounted = await mount({ control: rangeField(RANGE(10, 15)), locale: 'en-US' });
  matchRe(field(m).textContent ?? '', /Jun 10, 2026 – Jun 15, 2026/);
  m.dispose();
});

/* ── open + committed highlight ── */
test('date-range-picker: opens to the start month; endpoints + in-between are marked', async () => {
  const m: Mounted = await mount({ control: rangeField(RANGE(10, 15)), locale: 'en-US' });
  assert.equal(panel(), null, 'closed initially');
  field(m).click();
  assert.ok(panel(), 'calendar opened');
  matchRe(panel()!.querySelector('.weave-date-range-picker__month-label')!.textContent ?? '', /June 2026/);
  assert.ok(cellByText('10').classList.contains('weave-date-range-picker__cell--range-start'), '10 = range start');
  assert.ok(cellByText('10').classList.contains('weave-date-range-picker__cell--selected'), '10 = accent fill');
  assert.ok(cellByText('15').classList.contains('weave-date-range-picker__cell--range-end'), '15 = range end');
  assert.ok(cellByText('12').classList.contains('weave-date-range-picker__cell--in-range'), '12 = in range');
  assert.ok(!cellByText('9').classList.contains('weave-date-range-picker__cell--in-range'), '9 outside');
  m.dispose();
});

/* ── two-click selection ── */
test('date-range-picker: two clicks commit a range + close; the anchor stays open after the first', async () => {
  const ctl: DateRangePickerControl = rangeField(null);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('10').click(); // anchor
  assert.equal(ctl.value(), null, 'no commit on the first click');
  assert.ok(panel(), 'panel stays open picking the end');
  assert.ok(cellByText('10').classList.contains('weave-date-range-picker__cell--selected'), 'anchor highlighted');
  cellByText('15').click(); // complete
  const v: DateRange = ctl.value() as DateRange;
  assert.ok(v && A.isSameDay(v.start as Date, thisMonth(10)) && A.isSameDay(v.end as Date, thisMonth(15)), 'committed 10–15 of the open month');
  assert.equal(panel(), null, 'closed after completing');
  m.dispose();
});

test('date-range-picker: clicking before the anchor swaps the order (start ≤ end)', async () => {
  const ctl: DateRangePickerControl = rangeField(null);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('15').click(); // anchor
  cellByText('10').click(); // earlier → becomes the start
  const v: DateRange = ctl.value() as DateRange;
  assert.ok(A.isSameDay(v.start as Date, thisMonth(10)) && A.isSameDay(v.end as Date, thisMonth(15)), 'ordered to 10–15');
  m.dispose();
});

/* ── hover preview ── */
test('date-range-picker: hovering while picking the end previews the span', async () => {
  const m: Mounted = await mount({ control: rangeField(null), locale: 'en-US' });
  field(m).click();
  cellByText('10').click(); // anchor
  hover('14');
  assert.ok(cellByText('12').classList.contains('weave-date-range-picker__cell--preview'), '12 previewed in-between');
  assert.ok(cellByText('14').classList.contains('weave-date-range-picker__cell--preview-edge'), '14 = dashed preview edge');
  assert.ok(cellByText('14').classList.contains('weave-date-range-picker__cell--preview-end'), '14 caps the preview band');
  assert.ok(!cellByText('16').classList.contains('weave-date-range-picker__cell--preview'), '16 beyond the hover not previewed');
  m.dispose();
});

test('date-range-picker: day cells survive a hover — the real second click still commits (no grid rebuild)', async () => {
  // Regression: hovering while picking the end used to full-rebuild the grid, detaching the day
  // cell under the pointer so a real mousedown+mouseup (split across a hover re-decorate) never
  // fired `click`. The preview must now re-decorate in place, keeping each cell's identity.
  const ctl: DateRangePickerControl = rangeField(null);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('10').click(); // anchor
  const before: HTMLButtonElement = cellByText('15');
  hover('14'); // preview update — must NOT rebuild the grid
  assert.equal(cellByText('15'), before, 'the day-15 button is the SAME element after a hover');
  // A real interrupted click: mousedown → a mid-click hover re-decorate → mouseup, all on the SAME node.
  const target: HTMLButtonElement = cellByText('15');
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  hover('12'); // jitter: another preview update between down and up
  assert.ok(target.isConnected, 'target day cell is still attached after a mid-click hover');
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.click(); // fires because mousedown+mouseup shared the still-attached target
  const v: DateRange = ctl.value() as DateRange;
  assert.ok(v && A.isSameDay(v.start as Date, thisMonth(10)) && A.isSameDay(v.end as Date, thisMonth(15)), 'the second click committed the range');
  assert.equal(panel(), null, 'panel closed after completing');
  m.dispose();
});

test('date-range-picker: no preview band before an anchor is chosen', async () => {
  const m: Mounted = await mount({ control: rangeField(null), locale: 'en-US' });
  field(m).click();
  hover('14'); // no anchor yet
  assert.ok(!cellByText('14').classList.contains('weave-date-range-picker__cell--preview-edge'), 'no preview without an anchor');
  m.dispose();
});

/* ── keyboard ── */
test('date-range-picker: keyboard picks the anchor then completes the range', async () => {
  const ctl: DateRangePickerControl = rangeField(RANGE(15, 15));
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click(); // focus starts on the start (Jun 15)
  gridKey('Enter'); // anchor = Jun 15
  assert.ok(panel(), 'still open after anchoring via keyboard');
  gridKey('ArrowRight'); // → Jun 16
  gridKey('Enter'); // complete
  const v: DateRange = ctl.value() as DateRange;
  assert.ok(A.isSameDay(v.start as Date, JUN2026(15)) && A.isSameDay(v.end as Date, JUN2026(16)), 'Jun 15–16 via keyboard');
  assert.equal(panel(), null, 'closed after completing');
  m.dispose();
});

/* ── discard on close ── */
test('date-range-picker: Escape after the first click discards the pending selection', async () => {
  const ctl: DateRangePickerControl = rangeField(RANGE(10, 15));
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('20').click(); // start a new anchor
  gridKey('Escape');
  assert.equal(panel(), null, 'closed');
  const v: DateRange = ctl.value() as DateRange;
  assert.ok(A.isSameDay(v.start as Date, JUN2026(10)) && A.isSameDay(v.end as Date, JUN2026(15)), 'value unchanged (pending discarded)');
  m.dispose();
});

/* ── bounds ── */
test('date-range-picker: min/max disable out-of-range days', async () => {
  const m: Mounted = await mount({ control: rangeField(null), min: JUN2026(10), max: JUN2026(20), locale: 'en-US' });
  field(m).click();
  assert.equal(cellByText('5').disabled, true, 'before min disabled');
  assert.equal(cellByText('25').disabled, true, 'after max disabled');
  assert.equal(cellByText('15').disabled, false, 'in range enabled');
  m.dispose();
});

/* ── clear ── */
test('date-range-picker: clearable × resets the value', async () => {
  const ctl: DateRangePickerControl = rangeField(RANGE(10, 15));
  const m: Mounted = await mount({ control: ctl, clearable: true, locale: 'en-US' });
  const clear: HTMLButtonElement = m.root.querySelector('.weave-date-range-picker__clear') as HTMLButtonElement;
  assert.ok(clear, 'clear shown when a range is set');
  clear.click();
  assert.equal(ctl.value(), null);
  m.dispose();
});

/* ── value/onChange binding (no control) ── */
test('date-range-picker: value + onChange binding (uncontrolled forms convention)', async () => {
  let out: DateRange | null = null;
  const m: Mounted = await mount({ value: null, onChange: (v) => (out = v), locale: 'en-US' });
  field(m).click();
  cellByText('3').click();
  cellByText('7').click();
  assert.ok(out && A.isSameDay((out as DateRange).start as Date, thisMonth(3)) && A.isSameDay((out as DateRange).end as Date, thisMonth(7)));
  m.dispose();
});

/* ── shared drill-down core ── */
test('date-range-picker: the day header opens the shared year grid (drill-down core)', async () => {
  const m: Mounted = await mount({ control: rangeField(RANGE(10, 15)), locale: 'en-US' });
  field(m).click();
  matchRe(viewSwitch().textContent ?? '', /June 2026/);
  viewSwitch().click();
  assert.ok(document.body.querySelector('.weave-date-range-picker__year-grid'), 'year grid opened in the same panel');
  m.dispose();
});
